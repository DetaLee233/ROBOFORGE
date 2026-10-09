/* =========================================================
 *  vehicle.js — 载具运行时
 *  负责：
 *    · 由蓝图实例化零件网格
 *    · 装甲伤害 / 断连破坏 / 整体损坏判定
 *    · 简化载具物理（贴地行驶 + 地形法线对齐）
 *    · 武器开火调度
 * ========================================================= */

const SIDE = { PLAYER: 0, ENEMY: 1 };

class Vehicle {
  constructor(bp, side, opts) {
    opts = opts || {};
    this.bp = bp;
    this.name = bp.name || '载具';
    this.side = side;                          // 0 友军 / 1 敌军
    this.teamKey = opts.teamKey ||
      (side === SIDE.PLAYER ? (opts.isPlayer ? 'player' : 'ally') : 'enemy');
    this.isPlayer = !!opts.isPlayer;
    this.alive = true;

    this.group = new THREE.Group();
    this.group.name = 'vehicle:' + this.name;

    this.parts = new Map();        // id -> Part
    this.gridIndex = new Map();    // "x,y,z" -> Part
    this.weapons = [];
    this.wheels = [];
    this.legs = [];
    this.rotors = [];
    this.weaponGroups = { 1: [], 2: [], 3: [] };
    this.activeKey = 1;
    this._volleyCd = { 1: 0, 2: 0, 3: 0 };      // 每组齐射节流
    this._volleyCursor = { 1: 0, 2: 0, 3: 0 };  // 多武器轮询游标
    this.weaponMaxEnergy = 1000;                // 全车共享武器能量池
    this.weaponEnergy = 1000;
    this.weaponRegen = 100;
    this.corePart = null;

    // 全向移动 / 跳跃 / 飞行
    this.omni = false;
    this.canJump = false;
    this.canFly = false;
    this.rotorCount = 0;
    this.legCount = 0;
    this.moveY = 0;          // 飞行升降输入（+1 升 / -1 降）
    this.flySpeed = Config.MAX_AIR;
    this.vy = 0;
    this.accelMag = 0;       // 当前加速度大小（射线炮散布）
    this._prevVel = new THREE.Vector3();

    // 蓄力武器（充能射线炮）
    this.charging = false;
    this.chargeTime = 0;
    this.chargeWeapon = null;
    this.beamMesh = null;
    this.airborne = false;
    this.jumpCooldown = 0;
    this.dashCooldown = 0;
    this.dashTime = 0;
    this.dashSpeed = 0;
    this.dashing = false;
    this.vx = 0;
    this.vz = 0;
    this.moveX = 0;
    this.moveZ = 0;

    // 模块状态
    this.energyPenalty = 0;   // 弹道计算机：能量上限扣减
    this.recoilMult = 1;      // 后坐力倍率
    this.spreadMult = 1;      // 散布倍率
    this.hasBattery = false;  // 备用能源模块
    this.backupCooldown = 0;  // 备用能源冷却（秒）

    this.totalMaxHp = 0;
    this.boundingRadius = 4;

    // 运动状态
    this.position = this.group.position;
    this.heading = opts.heading || (side === SIDE.PLAYER ? Math.PI : 0);
    this.pitch = 0;                 // 机身俯仰（旋翼/飞行由鼠标控制）
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.velocity = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.firing = false;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this._build();
    this._computeMobility();

    // 初始位置
    if (opts.position) this.position.copy(opts.position);
    this.aimPoint.copy(this.position).add(new THREE.Vector3(0, 1, 30));
    this._applyTransform(null);
  }

  /* ---------------- 构建 ---------------- */

  _build() {
    const coreEntry = this.bp.parts.find((p) => p.core) || this.bp.parts[0];
    this._origin = { x: coreEntry.x, y: coreEntry.y, z: coreEntry.z };

    // 先注册全部零件（面剔除需要看到完整邻接表），再统一挂载
    for (const entry of this.bp.parts) this._addPart(entry);

    // 若有部位没标记核心，把第一个方块设为核心
    if (!this.corePart) {
      const fallback = Array.from(this.parts.values()).find((p) => p instanceof Block);
      if (fallback) {
        fallback.core = true;
        this.corePart = fallback;
      }
    }

    this._recomputeStats();
    for (const part of this.parts.values()) this._mountPart(part);
    this._recomputeModules();
    this._ensureActiveKey();
    this._fullParts = this.parts.size;   // 出生时的零件数（用于判断结构是否缺失）
  }

  /** 由蓝图条目实例化并登记单个零件（占用冲突则返回 null）；不挂载网格 */
  _addPart(entry) {
    if (!PartRegistry.has(entry.t)) return null;
    const part = PartRegistry.create(entry.t);
    part.grid.x = entry.x;
    part.grid.y = entry.y;
    part.grid.z = entry.z;
    part.rot = entry.r || 0;
    part.dir = entry.dir || 0;
    part.core = !!entry.core;
    part.vehicle = this;

    const cells = part.footprintCells();
    for (const [dx, dy, dz] of cells) {
      if (this.gridIndex.has(Utils.key(entry.x + dx, entry.y + dy, entry.z + dz))) return null;
    }
    this.parts.set(part.id, part);
    for (const [dx, dy, dz] of cells) {
      this.gridIndex.set(Utils.key(entry.x + dx, entry.y + dy, entry.z + dz), part);
    }

    if (part.core) this.corePart = part;
    if (part instanceof Weapon) {
      part.key = entry.k || part.key || 1;
      this.weapons.push(part);
      (this.weaponGroups[part.key] || this.weaponGroups[1]).push(part);
    } else if (PartRegistry.isKeyed(part.type)) {
      part.key = entry.k || part.key || 1;   // 带按键模块（如备用能源）
    }
    if (part instanceof MovementPart) {
      this.wheels.push(part);
      if (part.flying) this.rotors.push(part);
      else if (!part.isDrive) this.legs.push(part);
    }
    return part;
  }

  /** 计算局部坐标并挂载网格（与整体构建保持一致） */
  _mountPart(part) {
    const cells = part.footprintCells();
    let cx = 0, cy = 0, cz = 0;
    for (const [dx, dy, dz] of cells) {
      cx += (part.grid.x + dx - this._origin.x) * CELL;
      cy += (part.grid.y + dy - this._origin.y) * CELL;
      cz += (part.grid.z + dz - this._origin.z) * CELL;
    }
    const n = cells.length || 1;
    part._local = new THREE.Vector3(cx / n, cy / n, cz / n);
    if (part.yOffset) part._local.y += part.yOffset;

    part.mount(this.group);
    part.mesh.position.copy(part._local);
    if (part.dir) {
      const om = part.orientMatrix();
      if (om) part.mesh.quaternion.setFromRotationMatrix(om);
    }
    if (part.rot) part.mesh.rotateY(part.rot * Math.PI / 2);
    if (!part.dir) {
      part.alignBottomTo((part.grid.y - this._origin.y) * CELL - CELL / 2 + (part.yOffset || 0));
    }
  }

  /** 依据当前存活零件重算包围体 / 总血量等统计 */
  _recomputeStats() {
    let maxR = 0;
    this.topY = 0;
    this.halfWidth = 0;
    this.halfLength = 0;
    this.totalMaxHp = 0;
    for (const part of this.parts.values()) {
      this.totalMaxHp += part.maxHp;
      for (const [dx, dy, dz] of part.footprintCells()) {
        const wx = (part.grid.x + dx - this._origin.x) * CELL;
        const wy = (part.grid.y + dy - this._origin.y) * CELL;
        const wz = (part.grid.z + dz - this._origin.z) * CELL;
        maxR = Math.max(maxR, Math.sqrt(wx * wx + wy * wy + wz * wz));
        this.topY = Math.max(this.topY, wy + CELL * 0.5);
        this.halfWidth = Math.max(this.halfWidth, Math.abs(wx) + CELL * 0.5);
        this.halfLength = Math.max(this.halfLength, Math.abs(wz) + CELL * 0.5);
      }
    }
    this.boundingRadius = maxR + 1.6;
    this.bodyRadius = Utils.clamp(Math.min(this.halfWidth, this.halfLength) * 0.55, 2.0, 5.0);
  }

  /** 汇总功能模块效果（多台不叠加，全部被摧毁后失效） */
  _recomputeModules() {
    let hasComputer = false, hasBattery = false, batteryKey = 0;
    for (const part of this.parts.values()) {
      if (part.type === 'computer') hasComputer = true;
      else if (part.type === 'battery') { hasBattery = true; if (!batteryKey) batteryKey = part.key || 1; }
    }
    this.energyPenalty = hasComputer ? 200 : 0;
    this.recoilMult = hasComputer ? 0.5 : 1;
    this.spreadMult = hasComputer ? 0.5 : 1;
    this.hasComputer = hasComputer;
    this.hasBattery = hasBattery;
    this.batteryKey = batteryKey;

    // 共享武器能量池：弹道计算机使上限 -200（多台不叠加）
    this.weaponMaxEnergy = Math.max(100, 1000 - this.energyPenalty);
    if (this.weaponEnergy > this.weaponMaxEnergy) this.weaponEnergy = this.weaponMaxEnergy;
  }

  /** 当前按键分组的武器列表 */
  activeWeapons() {
    return this.weaponGroups[this.activeKey] || [];
  }

  /** 当前分组武器是否为空 */
  hasWeaponsOn(key) {
    return (this.weaponGroups[key] || []).length > 0;
  }

  /** 当前分组冷却比例：1=刚开火/未就绪，0=就绪（供准星环形进度条） */
  groupCooldownRatio() {
    const weapons = this.activeWeapons();
    if (!weapons.length) return 0;
    const ref = weapons[0];

    // 蓄力武器：蓄力时环随蓄力填充，其余时间显示冷却
    if (ref.charge) {
      const cw = this.chargeWeapon;
      if (this.charging && cw && !cw.destroyed && weapons.indexOf(cw) >= 0) {
        const frac = Utils.clamp(this.chargeTime / (cw.maxCharge || 3), 0, 1);
        return 1 - frac;
      }
      let readiness = 1;
      for (const w of weapons) {
        readiness = Math.min(readiness, 1 - Utils.clamp((w.cooldown || 0) / (w.fireInterval || 1), 0, 1));
      }
      return 1 - readiness;
    }

    const required = ref.requiredCount || weapons.length;
    const rate = ref.ratePerGun
      ? ref.ratePerGun * weapons.length
      : (ref.fullRate || 20) * Math.min(1, weapons.length / required);
    if (rate <= 0) return 0;
    return Utils.clamp((this._volleyCd[this.activeKey] || 0) * rate, 0, 1);
  }

  /** 若当前分组为空，自动切换到有武器的分组 */
  _ensureActiveKey() {
    if (this.activeWeapons().length > 0) return;
    for (const k of [1, 2, 3]) {
      if (this.hasWeaponsOn(k)) { this.activeKey = k; return; }
    }
  }

  /** AI：选择能打到 dist 且射程最长的分组 */
  pickKeyForDistance(dist) {
    let best = null, bestRange = -1;
    let fallback = null, fallbackRange = -1;
    for (const k of [1, 2, 3]) {
      const list = this.weaponGroups[k];
      if (!list || !list.length) continue;
      let r = 0;
      for (const w of list) r = Math.max(r, w.range);
      if (r > fallbackRange) { fallback = k; fallbackRange = r; }
      if (r >= dist * 0.9 && r > bestRange) { best = k; bestRange = r; }
    }
    return best !== null ? best : fallback;
  }

  /** 备用能源：为共享能量池 +800（多台不叠加），并进入冷却 */
  useBackupEnergy() {
    if (!this.hasBattery || this.backupCooldown > 0) return false;
    if (!this.activeWeapons().length) return false;
    this.weaponEnergy = Math.min(this.weaponMaxEnergy, this.weaponEnergy + 800);
    this.backupCooldown = 12;
    Bus.emit('vehicle:backup', { vehicle: this });
    return true;
  }

  _computeMobility() {
    let mass = 0, count = 0, steer = 0, sumMul = 0, clearance = 0, pivot = false, rating = 0;
    let driveCount = 0, legCount = 0, rotorCount = 0, jump = false;
    for (const part of this.parts.values()) {
      mass += part.mass;
      if (part instanceof MovementPart) {
        count++;
        sumMul += (part.speedMul || 1);
        rating += (part.driveRating || 1);
        clearance = Math.max(clearance, part.groundClearance || 0);
        if (part.pivot) pivot = true;
        if (part.isDrive) { driveCount++; steer += part.steer; }
        else if (part.flying) { rotorCount++; }
        else { legCount++; if (part.jump) jump = true; }
      }
    }
    this.mass = Math.max(Config.MASS_MIN, mass);
    this.moveCount = count;
    this.driveRating = rating;
    this.driveCount = driveCount;
    this.legCount = legCount;
    this.rotorCount = rotorCount;
    this.canPivot = pivot;
    this.canJump = legCount > 0 && jump;
    this.canFly = rotorCount >= 2;                 // 至少两个旋翼才可控
    // 无轮/履带时：机械腿或 ≥2 旋翼可全向移动
    this.omni = driveCount === 0 && (legCount > 0 || this.canFly);

    const avgMul = count ? sumMul / count : 0;
    this.speedMul = avgMul;
    this.maxSpeed = Utils.clamp(
      (Config.SPEED_BASE + Config.SPEED_PER_RATING * rating) * avgMul,
      Config.SPEED_MIN, Config.SPEED_MAX
    ) * (1 - Utils.clamp(
      (this.mass - Config.SPEED_MASS_REF) / Config.SPEED_MASS_SPAN, 0, Config.SPEED_MASS_PENALTY
    ));
    this.accel = ((Config.THRUST_BASE + Config.MAX_THRUST * rating) /
      Math.max(Config.THRUST_DIV_MIN, this.mass)) * avgMul;
    this.turnSpeed = Config.TURN_BASE * Utils.clamp(steer / Math.max(1, count), 0, 1) *
      (count > 0 ? 1 : Config.TURN_NO_WHEEL);
    this._computeRideHeight();
  }

  /** 离地高度 = 车体最低点到原点的竖直距离（保证贴地、腿不陷地下） */
  _computeRideHeight() {
    let minBottom = Infinity;
    for (const part of this.parts.values()) {
      let minY = Infinity;
      for (const [dx, dy, dz] of part.footprintCells()) {
        const wy = (part.grid.y + dy - this._origin.y) * CELL;
        if (wy < minY) minY = wy;
      }
      const bottom = minY + (part.yOffset || 0) -
        Math.max(CELL * 0.5, part.groundExtend || 0);
      if (bottom < minBottom) minBottom = bottom;
    }
    this.rideHeight = minBottom === Infinity ? 1.15 : Utils.clamp(-minBottom, 0.5, 48);
  }

  /** 跳跃高度（受负重限制，最多 10 格） */
  jumpHeight() {
    const support = (this.legCount || 0) * ((typeof Leg !== 'undefined' && Leg.LOAD) || Config.LEG_LOAD);
    const factor = Utils.clamp(support / Math.max(1, this.mass), Config.JUMP_FACTOR_MIN, 1);
    return Config.JUMP_CELLS * CELL * factor;
  }

  /** 原地跳跃 */
  jump() {
    if (!this.canJump || this.airborne || this.jumpCooldown > 0) return false;
    this.vy = Math.sqrt(2 * Config.GRAVITY * this.jumpHeight());
    this.airborne = true;
    this.jumpCooldown = Config.JUMP_CD;
    return true;
  }

  /** 向前助跑跳：整台载具向前做抛物运动（50 格距离，冷却 5 秒） */
  dashJump() {
    if (!this.canJump || this.airborne || this.dashCooldown > 0) return false;
    this.vy = Math.sqrt(2 * Config.GRAVITY * this.jumpHeight());
    this.airborne = true;
    const airtime = (2 * this.vy) / Config.GRAVITY;
    this.dashSpeed = (Config.DASH_CELLS * CELL) / Math.max(0.3, airtime);
    this.dashTime = airtime;
    this.dashing = true;
    // 立即赋予水平速度，形成抛物线
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.vx = fx * this.dashSpeed;
    this.vz = fz * this.dashSpeed;
    this.dashCooldown = Config.DASH_CD;
    return true;
  }

  /* ---------------- 生命周期 ---------------- */

  currentHp() {
    let hp = 0;
    for (const part of this.parts.values()) hp += part.hp;
    return hp;
  }

  hpRatio() {
    return this.totalMaxHp > 0 ? this.currentHp() / this.totalMaxHp : 0;
  }

  isDead() {
    return !this.alive;
  }

  /* ---------------- 每帧更新 ---------------- */

  update(dt, ctx, laserDt) {
    if (!this.alive) return;

    // 备用能源冷却
    if (this.backupCooldown > 0) this.backupCooldown = Math.max(0, this.backupCooldown - dt);
    // 共享武器能量回充
    if (this.weaponEnergy < this.weaponMaxEnergy) {
      this.weaponEnergy = Math.min(this.weaponMaxEnergy, this.weaponEnergy + this.weaponRegen * dt);
    }
    // 齐射节流（保留负余量，使 60fps 下也能实现 >20/s 的精确平均射速）
    for (const k of [1, 2, 3]) {
      this._volleyCd[k] -= dt;
      if (this._volleyCd[k] < -0.06) this._volleyCd[k] = -0.06;
    }

    // 零件逻辑（武器回能、车轮滚动）
    for (const part of this.parts.values()) part.update(dt, ctx);

    // 物理
    if (ctx && ctx.arena) this._physics(dt, ctx.arena);

    // 炮塔朝向瞄准点（机枪可独立转动）
    this._aimWeapons(dt);

    // 蓄力武器
    if (this.charging) this._updateCharge(dt, ctx);

    // 开火（仅当前按键分组的武器）；激光持续照射需要独立 dt
    if (this.firing) this._fireWeapons(ctx, laserDt !== undefined ? laserDt : dt);
    else this.extinguishLasers([]);   // 停火：熄灭全部射线
  }

  _aimWeapons(dt) {
    if (!this.weapons.length) return;
    this.group.updateMatrixWorld(true);
    if (!this._aimLocal) {
      this._aimLocal = new THREE.Vector3();
      this._aimDir = new THREE.Vector3();
    }
    const local = this._aimLocal;
    for (const w of this.weapons) {
      if (!w.mesh) continue;
      local.copy(this.aimPoint);
      this.group.worldToLocal(local);
      const dx = local.x - w._local.x;
      const dy = local.y - w._local.y;
      const dz = local.z - w._local.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < 1e-4 && Math.abs(dy) < 1e-4) continue;

      const yaw = Utils.clamp(Math.atan2(dx, dz), -2.75, 2.75);
      const pitch = Utils.clamp(Math.atan2(dy, horiz), -0.6, 1.4);   // 大仰角以打击空中目标

      w.aimYaw = (w.aimYaw === undefined)
        ? yaw : w.aimYaw + Utils.angleDelta(w.aimYaw, yaw) * Math.min(1, dt * 14);
      w.aimPitch = (w.aimPitch === undefined)
        ? pitch : w.aimPitch + (pitch - w.aimPitch) * Math.min(1, dt * 14);

      // 先偏航再俯仰（YXZ），炮口指向瞄准点
      w.mesh.rotation.set(-w.aimPitch, w.aimYaw, 0, 'YXZ');
    }
  }

  _physics(dt, arena) {
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;

    if (this.omni) this._physicsOmni(dt, arena);
    else this._physicsDrive(dt, arena);

    // 垂直：飞行 / 跳跃 / 重力
    const groundY = arena.heightAt(this.position.x, this.position.z) + this.rideHeight;
    if (this.canFly) {
      const desired = Utils.clamp(this.moveY, -1, 1) * this.flySpeed;
      const a = this.accel * dt * Config.FLY_ACCEL;
      this.vy += Utils.clamp(desired - this.vy, -a, a);
      this.position.y += this.vy * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        if (this.vy < 0) this.vy = 0;
      }
      this.airborne = this.position.y > groundY + 0.05;
    } else if (this.airborne) {
      this.vy -= Config.GRAVITY * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.vy = 0;
        this.airborne = false;
        // 落地：结束冲刺，清除残余高速，立即恢复普通移动
        this.dashing = false;
        this.dashTime = 0;
        this.vx *= 0.1;
        this.vz *= 0.1;
        this.speed = Math.hypot(this.vx, this.vz);
      }
    } else {
      this.position.y = groundY;
    }

    // 空气墙 + 掩体碰撞
    arena.clampToBounds(this.position);
    arena.resolveCover(this.position, this.bodyRadius || Config.BODY_RADIUS);

    this._applyTransform(arena);
  }

  /** 轮式 / 履带：油门 + 转向 */
  _physicsDrive(dt, arena) {
    const moveInput = Utils.clamp(this.throttle, -1, 1);

    const n = arena.normalAt(this.position.x, this.position.z);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const grade = -(n.x * fx + n.z * fz);                 // 正 = 沿车头上坡
    const uphill = moveInput >= 0 ? Utils.clamp(grade, 0, 1) : Utils.clamp(-grade, 0, 1);
    const slopeFactor = 1 - uphill * Config.SLOPE_PENALTY;  // 最陡仍保留 35% 速度

    const target = moveInput * this.maxSpeed * (this.speedBuff || 1) * slopeFactor;
    const rate = (moveInput === 0 ? Config.DRIVE_RATE_COAST : Config.DRIVE_RATE) * this.accel * dt * Config.DRIVE_ACCEL;
    if (this.speed < target) this.speed = Math.min(target, this.speed + rate);
    else this.speed = Math.max(target, this.speed - rate);

    if (Math.abs(this.speed) > 0.05 || moveInput !== 0 || (this.canPivot && this.steer !== 0)) {
      let speedFactor = Utils.clamp(Math.abs(this.speed) / 6, 0, 1);
      if (this.canPivot) speedFactor = Math.max(speedFactor, 1);
      else if (moveInput !== 0) speedFactor = Math.max(speedFactor, 0.4);
      speedFactor *= (1 - Utils.clamp(Math.abs(this.speed) / (this.maxSpeed * 1.7), 0, 0.5));
      const dir = this.speed >= 0 ? 1 : -1;
      this.heading -= this.steer * this.turnSpeed * speedFactor * dir * dt;
    }

    this.position.x += fx * this.speed * dt;
    this.position.z += fz * this.speed * dt;
    this.velocity.set(fx * this.speed, 0, fz * this.speed);
  }

  /** 机械腿：全向移动（WASD 前后左右），车身朝朝向（瞄准）方向 */
  _physicsOmni(dt, arena) {
    const h = this.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    let wx = fx * this.moveZ + rx * this.moveX;
    let wz = fz * this.moveZ + rz * this.moveX;
    const len = Math.hypot(wx, wz);
    if (len > 1e-4) { wx /= len; wz /= len; }
    const tvx = wx * this.maxSpeed * (this.speedBuff || 1);
    const tvz = wz * this.maxSpeed * (this.speedBuff || 1);

    if (this.airborne && this.dashing) {
      // 助跑跳：整台载具沿跳起方向保持水平速度（抛物线），落地即恢复控制
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      this.vx = fx * this.dashSpeed;
      this.vz = fz * this.dashSpeed;
      this.dashTime -= dt;
      if (this.dashTime <= 0) this.dashing = false;
    } else {
      const accel = this.accel * dt * Config.OMNI_ACCEL * (this.airborne ? Config.AIR_CONTROL : 1);
      this.vx += Utils.clamp(tvx - this.vx, -accel, accel);
      this.vz += Utils.clamp(tvz - this.vz, -accel, accel);
    }

    this.position.x += this.vx * dt;
    this.position.z += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vz);
    this.velocity.set(this.vx, 0, this.vz);
  }

  _applyTransform(arena) {
    const airborne = this.airborne;
    if (!airborne && arena) {
      this.position.y = arena.heightAt(this.position.x, this.position.z) + this.rideHeight;
    }

    // 飞行载具：机体绕水平轴俯仰（鼠标控制），保持水平滚转
    if (this.canFly) {
      const h = this.heading;
      const pitch = Utils.clamp(this.pitch || 0, -1.25, 1.25);
      const f0 = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
      const right = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const forward = f0.clone().multiplyScalar(cp).addScaledVector(new THREE.Vector3(0, 1, 0), sp).normalize();
      const up = new THREE.Vector3(0, 1, 0).multiplyScalar(cp).addScaledVector(f0, -sp).normalize();
      const m = new THREE.Matrix4().makeBasis(right, up, forward);
      this.group.quaternion.setFromRotationMatrix(m);
      return;
    }

    const normal = (arena && !airborne)
      ? arena.normalAt(this.position.x, this.position.z)
      : new THREE.Vector3(0, 1, 0);

    const forward = this._tmp.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    // 投影到地形平面
    forward.addScaledVector(normal, -forward.dot(normal));
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();

    const right = this._tmp2.crossVectors(normal, forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();

    const m = new THREE.Matrix4().makeBasis(right, up, forward);
    this.group.quaternion.setFromRotationMatrix(m);
  }

  /* ---------------- 开火 ---------------- */

  _fireWeapons(ctx, laserDt) {
    if (!ctx || !ctx.spawnProjectile) return;
    if (this.aimPoint.distanceToSquared(this.position) < 1) return;

    // 蓄力武器单独处理，不参与齐射
    const weapons = this.activeWeapons().filter((w) => !w.charge);
    if (!weapons.length) return;
    const key = this.activeKey;
    if ((this._volleyCd[key] || 0) > 1e-4) return;

    // 射线类武器（工程激光）：持续照射，不走齐射冷却（每帧照，能量流控）
    if (weapons.some((w) => w.beam)) {
      this._fireLasers(weapons.filter((w) => w.beam && !w.destroyed), ctx, laserDt !== undefined ? laserDt : 1 / 60);
      return;
    }

    // 射速随数量提升，达到 requiredCount 后封顶（多余武器不再加成）；
    // ratePerGun 武器（工程激光）不封顶：每把贡献固定射速，线性叠加
    const n = weapons.length;
    const ref = weapons[0];
    const required = ref.requiredCount || n;
    const effectiveRate = ref.ratePerGun
      ? ref.ratePerGun * n
      : (ref.fullRate || 20) * Math.min(1, n / required);
    if (effectiveRate <= 0) return;

    // 轮询选择下一把可开火的武器（每 tick 一发）
    const start = (this._volleyCursor[key] || 0) % n;
    let weapon = null, idx = -1;
    for (let c = 0; c < n; c++) {
      const w = weapons[(start + c) % n];
      if (w.canFire()) { weapon = w; idx = (start + c) % n; break; }
    }
    if (!weapon) return;
    this._volleyCursor[key] = (idx + 1) % n;
    this._volleyCd[key] += 1 / effectiveRate;

    // 榴弹：曲射。有弹道计算机时自动反解命中准星点；无计算机则火炮式，沿准星方向发射
    const isLob = !!weapon.lobbed;
    const artillery = isLob && !this.hasComputer && this.isPlayer;
    weapon.getMuzzleWorld(this._muzzle);
    const target = this._tmp;
    target.copy(this.aimPoint);
    if (isLob && !artillery) {
      const hex = Utils.hexOffsets(n, weapon.aoeRadius / 2);
      const off = hex[idx] || { x: 0, z: 0 };
      const tx = this.aimPoint.x + off.x;
      const tz = this.aimPoint.z + off.z;
      target.set(tx, this.aimPoint.y, tz);
      // 瞄准地面时吸附地形（蜂窝落点贴地）；瞄准空中则保留高空落点
      if (ctx.arena) {
        const gy = ctx.arena.heightAt(tx, tz) + 0.5;
        if (this.aimPoint.y < gy + 2) target.y = gy;
      }
    }

    {
      // 弹道反解：根据炮口与目标点计算发射方向（含重力下坠补偿）
      const gravity = weapon.projectileGravity || BALLISTIC_GRAVITY;
      if (artillery) {
        // 火炮式：不补偿下坠，抬得越高射得越远
        this._dir.subVectors(target, this._muzzle);
        if (this._dir.lengthSq() < 1e-6) return;
        this._dir.normalize();
      } else {
        Utils.solveBallistic(this._muzzle, target, weapon.projectileSpeed, gravity, this._dir);
        if (this._dir.lengthSq() < 1e-6) return;
        this._dir.normalize();
      }

      // 连射散布（弹道计算机可降低散布）
      const spread = (weapon.getSpread ? weapon.getSpread() : 0) * this.spreadMult;
      if (spread > 0) {
        this._dir.x += (Math.random() - 0.5) * spread * 2;
        this._dir.y += (Math.random() - 0.5) * spread * 2;
        this._dir.z += (Math.random() - 0.5) * spread * 2;
        this._dir.normalize();
      }

      weapon.consumeShot();
      const outMul = this.dmgOutMul || 1;   // 输出伤害倍率（夺点优势/劣势强化）
      ctx.spawnProjectile({
        origin: this._muzzle.clone(),
        dir: this._dir.clone(),
        damage: weapon.damage * outMul,
        speed: weapon.projectileSpeed,
        range: weapon.range,
        gravity,
        aoeDamage: (weapon.aoeDamage || 0) * outMul,
        aoeMinDamage: (weapon.aoeMinDamage || 10) * outMul,
        aoeRadius: weapon.aoeRadius || 0,
        shape: weapon.projectileShape || 'tracer',
        scale: weapon.projectileScale || 1,
        team: this.side,
        owner: this,
        weaponType: weapon.type,
      });
      Bus.emit(EV.WEAPON_FIRE, { vehicle: this, weapon });
    }
  }

  /**
   * 工程激光：持续照射（每帧结算，不走齐射冷却）。
   * 能量按每秒 ratePerGun×n 发 × energyCost 流控扣除，断能即熄灭。
   * 每把炮独立维护自己的射线 VFX（beamMesh），命中时射线加粗。
   * 命中敌军零件造成伤害；命中友军零件治疗；被护盾拦截；暴露的敌方八面体受击。
   */
  _fireLasers(guns, ctx, dt) {
    const shots = guns.reduce((s, w) => s + (w.ratePerGun || 1), 0) * dt;
    const cost = shots * (guns[0].energyCost || 0);
    if (this.weaponEnergy < cost) {
      // 能量不足：熄灭所有射线
      for (const w of guns) this._setLaserBeam(w, null);
      return;
    }
    this.weaponEnergy -= cost;

    this.group.updateMatrixWorld(true);
    for (const w of guns) {
      w.getMuzzleWorld(this._muzzle);
      const dir = this._dir.subVectors(this.aimPoint, this._muzzle);
      if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      dir.normalize();

      let maxLen = w.range;
      let baseTeam;
      if (ctx.mode && ctx.mode.beamStop) {
        const stop = ctx.mode.beamStop(this._muzzle, dir, maxLen, this.side, ctx);
        if (stop) {
          maxLen = Math.min(maxLen, stop.dist);
          baseTeam = stop.baseTeam;
        }
      }
      if (ctx.arena) {
        const t = ctx.arena.rayDistance(this._muzzle, dir, maxLen);
        if (t > 0) maxLen = Math.min(maxLen, t);
      }
      let hit = null;
      const probe = this._tmp.copy(this._muzzle).addScaledVector(dir, maxLen);
      for (const v of ctx.vehicles) {
        if (!v.alive || v === this) continue;
        const r = v.collideSegment(this._muzzle, probe);
        if (r) {
          const d = Math.sqrt(r.distSq);
          if (d < maxLen) { maxLen = d; hit = { v, part: r.part }; }
        }
      }
      if (ctx.arena && ctx.arena.hitCover(this._muzzle, probe)) {
        hit = null; baseTeam = undefined;
        let lo = 0, hi = maxLen;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const p = this._tmp.copy(this._muzzle).addScaledVector(dir, mid);
          if (ctx.arena.hitCover(this._muzzle, p)) hi = mid; else lo = mid;
        }
        maxLen = Math.max(0.5, hi);
      }

      const end = this._tmp.copy(this._muzzle).addScaledVector(dir, maxLen);
      // 结算（伤害/治疗量按每秒折算到该帧）
      let effect = false;
      if (hit) {
        effect = true;
        const wp = new THREE.Vector3();
        hit.part.worldPosition(wp);
        const perShot = (w.ratePerGun || 1) * dt;
        if (hit.v.side === this.side) {
          // 友军：优先重建被打掉的零件，其次治疗
          hit.v.repair(w.healAmount * perShot, this);
        } else {
          const dmg = w.damage * perShot * (this.dmgOutMul || 1);
          const lethal = hit.part.hp - dmg <= 0;
          hit.v.hitPart(hit.part, dmg, this);
          Bus.emit(EV.PROJECTILE_HIT, {
            position: wp.clone(), target: hit.v, source: this,
            part: hit.part, damage: dmg, lethal,
          });
          if (this.isPlayer) AudioFX.hit();
        }
      } else if (baseTeam !== undefined && ctx.mode) {
        effect = true;
        ctx.mode.damageBase(baseTeam, w.damage * (w.ratePerGun || 1) * dt * (this.dmgOutMul || 1));
      }

      // 射线 VFX：持续存在，命中时加粗（粗 = 细 ×2.2）
      const radius = w.beamRadius * (effect ? 2.2 : 1);
      this._setLaserBeam(w, { muzzle: this._muzzle.clone(), end: end.clone(), radius });
    }

    if (this.isPlayer) AudioFX.laser(true);
    if (ctx.spawnImpact && this.isPlayer) ctx.spawnImpact(this._muzzle.clone(), 'muzzle', 0.06);
    Bus.emit(EV.WEAPON_FIRE, { vehicle: this, weapon: guns[0] });
  }

  /** 维持/熄灭单把激光的射线网格（世界坐标，挂到场景；命中时加粗） */
  _setLaserBeam(w, beam) {
    if (!beam) {
      if (w.beamMesh) {
        if (w.beamMesh.parent) w.beamMesh.parent.remove(w.beamMesh);
        if (w.beamMesh.geometry) w.beamMesh.geometry.dispose();
        if (w.beamMesh.material) w.beamMesh.material.dispose();
        w.beamMesh = null;
      }
      if (this.isPlayer) AudioFX.laser(false);
      return;
    }
    if (!w.beamMesh) {
      w.beamMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          // 正常混合（加法混合会把浅绿冲成白色）
          color: w.beamColor, transparent: true, opacity: 0.8,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
    }
    // 与射线炮一致：光束用世界坐标，加入场景（而非载具局部空间）
    const host = this._scene || (this.group && this.group.parent);
    if (host && w.beamMesh.parent !== host) host.add(w.beamMesh);
    GameBeam.place(w.beamMesh, beam.muzzle, beam.end);
    const r = beam.radius;
    w.beamMesh.scale.x = r;
    w.beamMesh.scale.z = r;
  }

  /** 熄灭所有激光射线；属于当前开火组的保持 */
  extinguishLasers(keep) {
    const act = keep || this.activeWeapons();
    for (const w of this.weapons) {
      if (w.beamMesh && w.beam && !act.includes(w)) this._setLaserBeam(w, null);
    }
  }

  /* ---------------- 蓄力武器（充能射线炮） ---------------- */

  /** 当前分组中的蓄力武器 */
  _chargeWeapon() {
    return this.activeWeapons().find((w) => w.charge && !w.destroyed) || null;
  }

  startCharge() {
    if (this.charging) return true;
    const w = this._chargeWeapon();
    if (!w || w.cooldown > 0 || this.weaponEnergy <= 0) return false;
    this.charging = true;
    this.chargeWeapon = w;
    this.chargeTime = 0;
    this.firing = false;
    return true;
  }

  _updateCharge(dt, ctx) {
    const w = this.chargeWeapon;
    if (!w || w.destroyed) { this._removeBeam(ctx); this.charging = false; return; }

    if (this.weaponEnergy > 0) {
      const drain = (w.chargeDrain || (this.weaponMaxEnergy / Math.max(0.1, w.maxCharge))) * dt;
      this.weaponEnergy = Math.max(0, this.weaponEnergy - drain);
      this.chargeTime = Math.min(w.maxCharge, this.chargeTime + dt);
    }
    this._updateBeam(w, ctx);
  }

  /** 蓄力期间的白色细射线 */
  _updateBeam(w, ctx) {
    if (!ctx || !ctx.scene) return;
    this.group.updateMatrixWorld(true);
    w.getMuzzleWorld(this._muzzle);
    const dir = this._dir.subVectors(this.aimPoint, this._muzzle);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const len = w.range;
    const end = this._tmp.copy(this._muzzle).addScaledVector(dir, len);

    if (!this.beamMesh) {
      const geo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.beamMesh = new THREE.Mesh(geo, mat);
      ctx.scene.add(this.beamMesh);
    }
    GameBeam.place(this.beamMesh, this._muzzle, end);  }

  _removeBeam(ctx) {
    if (this.beamMesh && ctx && ctx.scene) ctx.scene.remove(this.beamMesh);
    this.beamMesh = null;
  }

  /** 松手发射 */
  releaseCharge(ctx) {
    if (!this.charging) return false;
    const w = this.chargeWeapon;
    this.charging = false;
    this._removeBeam(ctx);
    const f = Utils.clamp(this.chargeTime / (w ? w.maxCharge : 3), 0, 1);
    this.chargeTime = 0;
    if (!w || w.destroyed || w.cooldown > 0) return false;

    w.cooldown = w.fireInterval;
    this.group.updateMatrixWorld(true);
    w.getMuzzleWorld(this._muzzle);
    const dir = this._dir.subVectors(this.aimPoint, this._muzzle);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    dir.normalize();

    // 散布：随发射瞬间的加速度增大
    const spread = (w.baseSpread + this.accelMag * w.accelSpread);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    // 圆柱越蓄越粗（短蓄力最细 0.1 方块 -> 满蓄力 1 方块）
    const radius = Utils.lerp(w.minRadius, w.baseRadius, f);
    const outMul = this.dmgOutMul || 1;
    const areaDmg = Utils.lerp(w.minArea, w.damage, f) * outMul;
    const centerDmg = Utils.lerp(w.minCenter, w.centerDamage, f) * outMul;
    const end = this._tmp2.copy(this._muzzle).addScaledVector(dir, w.range);

    if (ctx && ctx.applyBeam) ctx.applyBeam(this._muzzle.clone(), end.clone(), radius, areaDmg, centerDmg, this.side, this);
    if (ctx && ctx.spawnBeamVFX) ctx.spawnBeamVFX(this._muzzle.clone(), end.clone(), radius);
    Bus.emit(EV.WEAPON_FIRE, { vehicle: this, weapon: w });
    return true;
  }

  /* ---------------- 伤害系统 ---------------- */

  /** 对某个零件造成伤害（dmgInMul 可减免，如夺点劣势强化） */
  hitPart(part, amount, source) {
    if (!this.alive || part.destroyed || !this.parts.has(part.id)) return;
    const destroyed = part.takeDamage(amount * (this.dmgInMul || 1));
    Bus.emit(EV.PART_DAMAGED, { vehicle: this, part, amount, source });
    if (destroyed) {
      this._destroyPart(part, source);
      this._validateStructure();
    }
    Bus.emit(EV.VEHICLE_CHANGED, { vehicle: this });
    this._checkVehicleDestroyed(source);
  }

  /** 修理单个零件（工程激光对友军治疗；已损毁的零件无法恢复） */
  repairPart(part, amount, source) {
    if (!this.alive || part.destroyed || !this.parts.has(part.id)) return;
    if (amount <= 0 || part.hp >= part.maxHp) return;
    part.hp = Math.min(part.maxHp, part.hp + amount);
    Bus.emit(EV.VEHICLE_CHANGED, { vehicle: this });
  }

  /** 蓝图条目中当前缺失（已损毁）的零件；无则 null */
  _missingEntry() {
    const entries = (this.bp && this.bp.parts) || [];
    if (!entries.length || this.parts.size >= entries.length) return null;
    const occ = new Set();
    for (const p of this.parts.values()) occ.add(Utils.key(p.grid.x, p.grid.y, p.grid.z));
    for (const e of entries) {
      if (PartRegistry.has(e.t) && !occ.has(Utils.key(e.x, e.y, e.z))) return e;
    }
    return null;
  }

  /** 按蓝图重建一个已损毁零件（恢复结构、武器分组、网格） */
  restorePart(entry) {
    const part = this._addPart(entry);
    if (!part) return null;
    this._mountPart(part);
    // 新零件覆盖了相邻装甲方块的面，需要刷新其暴露面
    const refresh = new Set();
    for (const [dx, dy, dz] of part.footprintCells()) {
      const bx = part.grid.x + dx, by = part.grid.y + dy, bz = part.grid.z + dz;
      for (const [nx, ny, nz] of GRID_NEIGHBORS) {
        const nb = this.gridIndex.get(Utils.key(bx + nx, by + ny, bz + nz));
        if (nb && nb instanceof Block) refresh.add(nb);
      }
    }
    for (const nb of refresh) nb.refreshFaces();
    this._recomputeStats();
    this._recomputeModules();
    this._ensureActiveKey();
    Bus.emit(EV.VEHICLE_CHANGED, { vehicle: this });
    return part;
  }

  /**
   * 修复（工程激光 / 出生点）：优先按蓝图重建被摧毁的零件（需累积足够修复量），
   * 结构完整后再治疗最虚弱的存活零件。
   */
  repair(amount) {
    if (!this.alive || amount <= 0) return;
    const entry = this._missingEntry();
    if (entry) {
      const cost = (PartRegistry.meta[entry.t] || {}).hp || 100;
      this._repairPool = (this._repairPool || 0) + amount;
      if (this._repairPool >= cost) {
        this._repairPool -= cost;
        this.restorePart(entry);
      }
      return;
    }
    this._healWeakest(amount);
  }

  _healWeakest(amount) {
    let best = null, bestRatio = 1;
    for (const p of this.parts.values()) {
      const r = p.hp / p.maxHp;
      if (r < bestRatio) { bestRatio = r; best = p; }
    }
    if (best) this.repairPart(best, amount);
  }

  /** 移除单个零件（不触发结构验证） */
  _destroyPart(part, source) {
    if (part.destroyed) return;
    part.destroyed = true;
    part.hp = 0;

    if (part.mesh) this.group.remove(part.mesh);
    this.parts.delete(part.id);
    for (const [dx, dy, dz] of part.footprintCells()) {
      this.gridIndex.delete(Utils.key(part.grid.x + dx, part.grid.y + dy, part.grid.z + dz));
    }

    // 刷新相邻装甲方块的暴露面（原本被该零件遮挡的面需重新显示）
    const refresh = new Set();
    for (const [dx, dy, dz] of part.footprintCells()) {
      const bx = part.grid.x + dx, by = part.grid.y + dy, bz = part.grid.z + dz;
      for (const [nx, ny, nz] of GRID_NEIGHBORS) {
        const nb = this.gridIndex.get(Utils.key(bx + nx, by + ny, bz + nz));
        if (nb && nb instanceof Block) refresh.add(nb);
      }
    }
    for (const nb of refresh) nb.refreshFaces();

    if (part === this.corePart) this.corePart = null;
    const wi = this.weapons.indexOf(part);
    if (wi >= 0) this.weapons.splice(wi, 1);
    if (part instanceof Weapon) {
      const list = this.weaponGroups[part.key];
      if (list) {
        const gi = list.indexOf(part);
        if (gi >= 0) list.splice(gi, 1);
      }
    }
    const hi = this.wheels.indexOf(part);
    if (hi >= 0) this.wheels.splice(hi, 1);
    const li = this.legs.indexOf(part);
    if (li >= 0) this.legs.splice(li, 1);

    Bus.emit(EV.PART_DESTROYED, { vehicle: this, part, source });
  }

  /**
   * 结构连通性验证：
   * 找到主体（含核心的连通块），任何孤立零件一并摧毁
   */
  _validateStructure() {
    if (this.parts.size === 0) return;

    // 核心丢失时，选择邻居最多的方块作为新核心
    if (!this.corePart || !this.parts.has(this.corePart.id)) {
      let best = null, bestScore = -1;
      for (const part of this.parts.values()) {
        if (!(part instanceof Block)) continue;
        const score = this._neighborCount(part);
        if (score > bestScore) { bestScore = score; best = part; }
      }
      this.corePart = best || Array.from(this.parts.values())[0];
      if (this.corePart) this.corePart.core = true;
    }
    if (!this.corePart) return;

    // BFS 从核心扩散（遍历所有占用单元，支持多格部件）
    const reachable = new Set();
    const queue = [this.corePart];
    reachable.add(this.corePart.id);
    while (queue.length) {
      const cur = queue.pop();
      for (const [dx, dy, dz] of cur.footprintCells()) {
        const bx = cur.grid.x + dx, by = cur.grid.y + dy, bz = cur.grid.z + dz;
        for (const [nx, ny, nz] of GRID_NEIGHBORS) {
          const nb = this.gridIndex.get(Utils.key(bx + nx, by + ny, bz + nz));
          if (nb && !reachable.has(nb.id)) {
            reachable.add(nb.id);
            queue.push(nb);
          }
        }
      }
    }

    // 摧毁不可达零件
    const orphans = [];
    for (const part of this.parts.values()) {
      if (!reachable.has(part.id)) orphans.push(part);
    }
    for (const part of orphans) {
      this._destroyPart(part, null);
    }

    this._computeMobility();
    this._recomputeModules();
    this._ensureActiveKey();
  }

  _neighborCount(part) {
    const set = new Set();
    for (const [dx, dy, dz] of part.footprintCells()) {
      const bx = part.grid.x + dx, by = part.grid.y + dy, bz = part.grid.z + dz;
      for (const [nx, ny, nz] of GRID_NEIGHBORS) {
        const nb = this.gridIndex.get(Utils.key(bx + nx, by + ny, bz + nz));
        if (nb && nb !== part) set.add(nb.id);
      }
    }
    return set.size;
  }

  /** 剩余总生命值不足 20% 判定为损毁 */
  _checkVehicleDestroyed(source) {
    if (!this.alive) return;
    if (this.parts.size === 0 || this.currentHp() < this.totalMaxHp * 0.2) {
      this._explode(source);
    }
  }

  _explode(source) {
    if (!this.alive) return;
    this.alive = false;
    this.firing = false;
    this.group.visible = false;
    this.extinguishLasers([]);
    AudioFX.explode();
    Bus.emit(EV.VEHICLE_DESTROYED, { vehicle: this, source });
  }

  /* ---------------- 碰撞查询 ---------------- */

  /**
   * 线段 a->b 与载具零件的首个碰撞
   * @returns { part, t } | null
   */
  collideSegment(a, b) {
    if (!this.alive) return null;
    // 粗略包围球剔除
    const mid = this._tmp.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const halfLenSq = a.distanceToSquared(b) * 0.25;
    if (mid.distanceToSquared(this.position) > (this.boundingRadius + 0.6) * (this.boundingRadius + 0.6) + halfLenSq) {
      return null;
    }

    let best = null;
    let bestDistSq = Infinity;
    const wp = new THREE.Vector3();
    const inv = this._invMat || (this._invMat = new THREE.Matrix4());
    const la = this._segA || (this._segA = new THREE.Vector3());
    const lb = this._segB || (this._segB = new THREE.Vector3());
    const segLen = a.distanceTo(b);

    for (const part of this.parts.values()) {
      // 盒体碰撞（如武器/模块的 3×3×3 碰撞箱）
      if (part.boxCollider && part.mesh) {
        inv.copy(part.mesh.matrixWorld).invert();
        la.copy(a).applyMatrix4(inv);
        lb.copy(b).applyMatrix4(inv);
        const h = part.boxCollider;
        const t = Utils.segmentAABB(la, lb, h.x, h.y, h.z);
        if (t >= 0) {
          const dist = t * segLen;
          const d2 = dist * dist;
          if (d2 < bestDistSq) { bestDistSq = d2; best = part; }
        }
        continue;
      }

      // 球形近似
      part.worldPosition(wp);
      const r = part.radius + 0.15;
      const d2 = Utils.segmentPointDistSq(a, b, wp);
      if (d2 <= r * r && d2 < bestDistSq) {
        bestDistSq = d2;
        best = part;
      }
    }
    return best ? { part: best, distSq: bestDistSq } : null;
  }

  dispose(scene) {
    if (scene && this.group.parent) scene.remove(this.group);
  }
}
