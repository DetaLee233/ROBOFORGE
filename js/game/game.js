/* =========================================================
 *  game.js — 5v5 PVE 战斗管理
 *  负责：场景/光照、队伍生成、抛射体、命中特效、
 *        胜负判定、第三人称跟随相机
 * ========================================================= */

const GAME_UP = new THREE.Vector3(0, 1, 0);

class Game {
  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1420);
    this.scene.fog = new THREE.Fog(0x0b1420, 160, 460);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);

    this.arena = null;
    this.vehicles = [];
    this.controllers = [];
    this.projectiles = [];
    this.impacts = [];

    this.state = 'idle';       // idle | playing | over
    this.paused = false;
    this.player = null;
    this.result = null;

    this.lookYaw = 0;
    this.lookPitch = 0.06;
    this.time = 0;

    // 后坐力（叠加在视角上，随时间回复）
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    // 第三人称相机：位于载具 Y/Z 最高点各 +camOffset 方块处（滚轮 5~10 调节）
    this.camDistance = 13;
    this.camOffset = 5;
    this.baseFov = 70;
    this.adsFov = 32;
    this.ads = false;
    this._playerTransparent = false;

    this._camDir = new THREE.Vector3();
    this._camForward = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();

    this._buildLights();
    this._bindInput();
    this._unsubs = [];
  }

  /** 订阅全局战斗事件（销毁时清理，避免多次开局重复订阅） */
  _subscribeCombat() {
    this._unsubs.push(
      Bus.on(EV.VEHICLE_DESTROYED, ({ vehicle }) => {
        if (vehicle) this.spawnExplosion(vehicle.position, Math.max(6, vehicle.boundingRadius));
        if (vehicle && vehicle.beamMesh) { this.scene.remove(vehicle.beamMesh); vehicle.beamMesh = null; }
        if (vehicle && vehicle.isPlayer) AudioFX.charge(false);
        // 模式可接管：复活队列等
        if (this.mode && vehicle) this.mode.onVehicleDestroyed(vehicle, this);
      }),
      Bus.on(EV.PART_DESTROYED, ({ vehicle, part }) => {
        if (!vehicle || !part || !part.mesh) return;
        const wp = new THREE.Vector3();
        part.mesh.getWorldPosition(wp);
        this.spawnImpact(wp, 'part');
      }),
      Bus.on(EV.WEAPON_FIRE, ({ vehicle, weapon }) => {
        if (vehicle && vehicle.isPlayer) this._applyRecoil(weapon);
      })
    );
  }

  /** 玩家开火时的后坐力：抬高视角并随机左右抖动（弹道计算机可降低） */
  _applyRecoil(weapon) {
    const mult = (weapon && weapon.vehicle && weapon.vehicle.recoilMult) || 1;
    const kick = ((weapon && weapon.recoil) || 0.01) * mult;
    this.recoilPitch = Math.min(0.4, this.recoilPitch + kick * (0.7 + Math.random() * 0.8));
    this.recoilYaw = Utils.clamp(this.recoilYaw + (Math.random() - 0.5) * kick * 1.6, -0.2, 0.2);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x9fc7ff, 0x24313a, 0.85);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff2d8, 1.05);
    dir.position.set(90, 150, 60);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const d = 160;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 500;
    dir.shadow.bias = -0.0008;
    this.scene.add(dir);
    this.sun = dir;

    this.scene.add(new THREE.AmbientLight(0x334455, 0.6));
  }

  _bindInput() {
    Bus.on('input:mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (!this.input.locked) { this.input.requestLock(); return; }
    });
    Bus.on('input:keydown', (code) => {
      if (this.state !== 'playing' || this.paused) return;
      const key = this._digitToKey(code);
      if (key) this._switchWeapon(key);
    });
  }

  _digitToKey(code) {
    if (code === Settings.key('weapon1')) return 1;
    if (code === Settings.key('weapon2')) return 2;
    if (code === Settings.key('weapon3')) return 3;
    return 0;
  }

  /**
   * 按键：
   *   · 若该键绑定了备用能源 —— 触发 +800 能量（带按键模块本质是特殊武器）
   *   · 否则切换到该键的武器分组
   */
  _switchWeapon(key) {
    const p = this.player;
    if (!p || !p.alive) return;

    // 备用能源（带按键模块）
    if (p.hasBattery && p.batteryKey === key) {
      if (p.backupCooldown > 0) {
        Bus.emit('hud:notice', { text: '备用能源冷却中 ' + Math.ceil(p.backupCooldown) + 's', key: 'none' });
      } else if (this._backupUseful(p)) {
        p.useBackupEnergy();
        AudioFX.ui();
        Bus.emit('hud:notice', { text: '备用能源 +800', key: 'energy' });
      } else {
        Bus.emit('hud:notice', { text: '能量已满', key: 'none' });
      }
      return;
    }

    // 武器切换
    if (p.hasWeaponsOn(key)) {
      if (key !== p.activeKey) {
        p.activeKey = key;
        AudioFX.ui();
      }
      Bus.emit('hud:notice', { text: '武器 ' + key, key: 'switch' });
    } else {
      Bus.emit('hud:notice', { text: '按键 ' + key + ' 未绑定', key: 'none' });
    }
  }

  /** 备用能源是否真的有用（共享能量池未满） */
  _backupUseful(p) {
    if (!p.activeWeapons().length) return false;
    return p.weaponEnergy < p.weaponMaxEnergy - 0.5;
  }

  /* ---------------- 开始 / 结束 ---------------- */

  start(playerBlueprint, mode) {
    this.dispose();
    this.playerBp = playerBlueprint;
    this.seed = (Math.random() * 1e6) | 0;
    this.modeName = mode === 'capture' ? 'capture' : 'tdm';
    this.mode = this._createMode(this.modeName);

    this.arena = new Arena(this.scene, {
      half: 360,
      seed: this.seed,
      exclusions: this.mode.arenaExclusions(360),
    });
    this.mode.build(this.scene, this);

    this._spawnTeams();
    this.state = 'playing';
    this.paused = false;
    this.result = null;
    this.time = 0;
    this.lookYaw = 0;
    this.lookPitch = 0.06;
    this.aimYaw = this.player ? this.player.heading : 0;
    this._playerTransparent = false;

    this._subscribeCombat();
    this._updateCamera(1);   // 立即吸附到玩家身后，避免首帧相机在原点

    Bus.emit(EV.GAME_START, {});
    this._emitStatus();
  }

  /** 模式注册：新增对局模式在此登记即可 */
  _createMode(name) {
    return name === 'capture' ? new CaptureMode(this) : new TdmMode(this);
  }

  _spawnTeams() {
    const playerPts = this.mode.spawnPoints(this, SIDE.PLAYER);
    const enemyPts = this.mode.spawnPoints(this, SIDE.ENEMY);
    const targetCost = Blueprint.computeCost(this.playerBp);
    const rng = Utils.mulberry32(this.seed ^ 0x1234abcd);

    // 按点数接近度取候选池，排除玩家同款；洗牌成袋，抽完再洗，保证出场多样
    const pickBp = (() => {
      let bag = [];
      const refill = () => {
        const pool = VehicleLibrary.withCost()
          .filter((e) => !this.playerBp || e.bp.name !== this.playerBp.name)
          .sort((a, b) => Math.abs(a.cost - targetCost) - Math.abs(b.cost - targetCost))
          .slice(0, Math.max(4, Math.ceil(VehicleLibrary.all().length * 0.6)))
          .map((e) => e.bp);
        if (!pool.length) pool.push(VehicleLibrary.randomNear(targetCost, rng));
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        bag = pool;
      };
      return () => {
        if (!bag.length) refill();
        return Blueprint.clone(bag.pop());
      };
    })();

    for (let i = 0; i < 5; i++) {
      const isPlayer = i === 0;
      const bp = isPlayer ? this.playerBp : pickBp();
      const v = new Vehicle(bp, SIDE.PLAYER, {
        isPlayer,
        teamKey: isPlayer ? 'player' : 'ally',
        position: playerPts[i],
        heading: Math.PI,
      });
      v.name = isPlayer ? (this.playerBp.name || '玩家') : ('友军-' + bp.name);
      this.scene.add(v.group);
      this.vehicles.push(v);
      if (isPlayer) this.player = v;
      else this.controllers.push(new AIController(v, this, { skill: Config.AI_ALLY_SKILL + Math.random() * Config.AI_ALLY_SPREAD }));
    }

    for (let i = 0; i < 5; i++) {
      const bp = pickBp();
      const v = new Vehicle(bp, SIDE.ENEMY, {
        teamKey: 'enemy',
        position: enemyPts[i],
        heading: 0,
      });
      v.name = '敌军-' + bp.name;
      this.scene.add(v.group);
      this.vehicles.push(v);
      this.controllers.push(new AIController(v, this, { skill: Config.AI_ENEMY_SKILL + Math.random() * Config.AI_ENEMY_SPREAD }));
    }
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
    if (this.mode) { this.mode.dispose(); this.mode = null; }
    for (const v of this.vehicles) {
      if (v.beamMesh) this.scene.remove(v.beamMesh);
      v.dispose(this.scene);
    }
    this.vehicles.length = 0;
    this.controllers.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    for (const im of this.impacts) this.scene.remove(im.mesh);
    this.impacts.length = 0;
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this._disposeTree(this.arena.group);
      this.arena = null;
    }
    this.player = null;
  }

  _disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  /* ---------------- 每帧更新 ---------------- */

  update(dt) {
    if (this.state === 'idle') return;
    if (this.paused) {
      this._updateCamera(dt);
      return;
    }

    this.time += dt;

    this._updateRecoil(dt);
    this._playerInput(dt);
    this._updateCamera(dt);
    this._updatePlayerAim();
    for (const c of this.controllers) c.update(dt);
    for (const v of this.vehicles) {
      // 激光持续照射需要 dt 做能量流控 / 每秒伤害结算
      v.update(dt, this, dt);
    }

    // 载具之间相互分离，避免重叠；随后由模式处理屏障/规则
    this._separateVehicles();
    this.mode.resolveShields(this);
    this.mode.update(dt, this);

    this.scene.updateMatrixWorld(true);

    this._updateProjectiles(dt);
    this._updateImpacts(dt);
    this._checkEnd();
    this._emitStatus();
  }

  /** 载具间分离：把每辆载具近似为沿车身的胶囊体，重叠时沿法线推开 */
  _separateVehicles() {
    const arena = this.arena;
    if (!arena) return;
    const list = this.vehicles.filter((v) => v.alive);
    const n = list.length;

    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = list[i], b = list[j];
          const ra = a.bodyRadius || Config.SEPARATION_RADIUS;
          const rb = b.bodyRadius || Config.SEPARATION_RADIUS;
          const dx = b.position.x - a.position.x;
          const dz = b.position.z - a.position.z;
          const reach = ra + rb + (a.halfLength || 0) + (b.halfLength || 0);
          if (dx * dx + dz * dz > reach * reach) continue;

          const la = Math.max(0, (a.halfLength || 0) - ra);
          const lb = Math.max(0, (b.halfLength || 0) - rb);
          const acx = Math.cos(a.heading), asx = Math.sin(a.heading);
          const bcx = Math.cos(b.heading), bsx = Math.sin(b.heading);
          const a0 = { x: a.position.x - asx * la, z: a.position.z - acx * la };
          const a1 = { x: a.position.x + asx * la, z: a.position.z + acx * la };
          const b0 = { x: b.position.x - bsx * lb, z: b.position.z - bcx * lb };
          const b1 = { x: b.position.x + bsx * lb, z: b.position.z + bcx * lb };

          const cp = Utils.closestSegSeg2D(a0, a1, b0, b1);
          let nx = cp.bx - cp.ax, nz = cp.bz - cp.az;
          let d = Math.sqrt(nx * nx + nz * nz);
          const minD = ra + rb;
          if (d >= minD) continue;
          if (d < 1e-4) { nx = 1; nz = 0; d = 1e-4; }
          else { nx /= d; nz /= d; }
          const pen = (minD - d) * 0.5 + 0.02;
          a.position.x -= nx * pen; a.position.z -= nz * pen;
          b.position.x += nx * pen; b.position.z += nz * pen;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // 分离后重新贴合地形与掩体
    for (const v of list) {
      arena.resolveCover(v.position, v.bodyRadius || Config.BODY_RADIUS);
      arena.clampToBounds(v.position);
      v._applyTransform(arena);
    }
  }

  /** 用同蓝图的新机体替换旧机体（复活 / 出生点修复共用，模式可调用） */
  replaceVehicle(old, bp, side, meta, position, heading) {
    if (old) {
      const vi = this.vehicles.indexOf(old);
      if (vi >= 0) this.vehicles.splice(vi, 1);
      this.scene.remove(old.group);
      old.dispose(this.scene);
      const ci = this.controllers.findIndex((c) => c.vehicle === old);
      if (ci >= 0) this.controllers.splice(ci, 1);
    }
    const v = new Vehicle(bp, side, {
      isPlayer: meta.isPlayer, teamKey: meta.teamKey, position, heading,
    });
    v.name = meta.name;
    this.scene.add(v.group);
    this.vehicles.push(v);
    if (meta.isPlayer) {
      this.player = v;
      v.weaponEnergy = v.weaponMaxEnergy;
      this._updateCamera(1);
    } else {
      this.controllers.push(new AIController(v, this, { skill: meta.skill }));
    }
    return v;
  }

  _updateRecoil(dt) {
    const k = Math.exp(-dt * 6.5);
    this.recoilPitch *= k;
    this.recoilYaw *= k;
    if (Math.abs(this.recoilPitch) < 1e-4) this.recoilPitch = 0;
    if (Math.abs(this.recoilYaw) < 1e-4) this.recoilYaw = 0;
  }

  _playerInput(dt) {
    const p = this.player;
    if (!p || !p.alive) return;

    const m = this.input.consumeMouse();
    const sens = Settings.get('sensitivity') || 1;
    const sx = (Settings.get('invertX') ? 1 : -1) * 0.0026 * sens;
    const sy = (Settings.get('invertY') ? 1 : -1) * 0.0022 * sens;

    // 滚轮调节第三人称相机偏移（5~10 方块）
    const wheel = this.input.consumeWheel ? this.input.consumeWheel() : 0;
    if (wheel) this.camOffset = Utils.clamp(this.camOffset + Math.sign(wheel), 5, 10);

    if (p.omni) {
      // 机械腿：鼠标直接控制车身朝向（360°）
      if (this.input.locked) this.aimYaw += m.dx * sx;
      this.lookYaw = 0;
      p.heading = this.aimYaw;
      let strafe = this.input.axis(Settings.key('left'), Settings.key('right'));
      if (Settings.get('invertSteer')) strafe = -strafe;
      p.moveX = -strafe;   // 右移（与轮式转向同一方向约定）
      p.moveZ = this.input.axis(Settings.key('back'), Settings.key('forward'));
    } else {
      if (this.input.locked) {
        // 允许 360° 自由视角（可瞄准并射击背后目标）
        this.lookYaw += m.dx * sx;
        while (this.lookYaw > Math.PI) this.lookYaw -= Math.PI * 2;
        while (this.lookYaw < -Math.PI) this.lookYaw += Math.PI * 2;
      }
      p.throttle = this.input.axis(Settings.key('back'), Settings.key('forward'));
      let steer = this.input.axis(Settings.key('left'), Settings.key('right'));   // 右 = +1 -> 右转
      if (Settings.get('invertSteer')) steer = -steer;
      p.steer = steer;
    }
    if (this.input.locked) {
      // 飞行载具：鼠标控制机身俯仰；地面载具也可较大幅度抬/压射界
      const pMin = p.canFly ? -1.15 : -0.5;
      const pMax = p.canFly ? 1.15 : 1.15;
      this.lookPitch = Utils.clamp(this.lookPitch + m.dy * sy, pMin, pMax);
      if (p.canFly) p.pitch = this.lookPitch;
    }

    // 垂直控制：旋翼飞行（升 / 降）或机械腿跳跃
    const down = (c) => (this.input.isDown ? this.input.isDown(c) : false);
    const upKey = down(Settings.key('up'));
    const downKey = down(Settings.key('down')) || down('ShiftRight');
    if (p.canFly) {
      p.moveY = (upKey ? 1 : 0) - (downKey ? 1 : 0);
    } else {
      if (upKey) p.jump();
      if (downKey) p.dashJump();
    }

    // 开火 / 蓄力：充能射线炮按住蓄力、松开发射
    const act = p.activeWeapons();
    const isCharge = act.length > 0 && act[0].charge;
    const left = this.input.mouse.left && this.input.locked;
    if (isCharge) {
      if (left && !p.charging) { if (p.startCharge()) AudioFX.charge(true); }
      else if (!left && p.charging) {
        const fired = p.releaseCharge(this);
        AudioFX.charge(false);
        if (fired) AudioFX.explode();
      }
      p.firing = false;
    } else {
      if (p.charging) { p.releaseCharge(this); AudioFX.charge(false); }
      p.firing = left;
    }
    if (this.input.mouse.left && !this.input.locked) this.input.requestLock();
  }

  _computeCamDir(p) {
    // 叠加后坐力偏移
    const a = p.heading + this.lookYaw + this.recoilYaw;
    const pitch = p.canFly
      ? Utils.clamp(this.lookPitch + this.recoilPitch, -1.25, 1.25)
      : Utils.clamp(this.lookPitch + this.recoilPitch, -0.6, 1.2);
    const cp = Math.cos(pitch);
    this._camDir.set(Math.sin(a) * cp, Math.sin(pitch), Math.cos(a) * cp).normalize();
  }

  /** 准星目标列表：地形外的掩体 + 敌方载具（不含友军，避免准星被挡） */
  _aimTargets() {
    const list = this.arena && this.arena.coverMeshes ? this.arena.coverMeshes.slice() : [];
    for (const v of this.vehicles) {
      if (!v.alive || v.side === SIDE.PLAYER) continue;
      list.push(v.group);
    }
    return list;
  }

  /**
   * 玩家瞄准：从相机沿视线（准星中心）发射射线，取最近命中点作为瞄准点，
   * 子弹再由炮口射向该点 —— 保证准星与命中位置一致。
   */
  _updatePlayerAim() {
    const p = this.player;
    if (!p || !p.alive || !this.arena) return;

    this.camera.getWorldDirection(this._camForward);
    const origin = this.camera.position;
    const MAX = 900;

    let best = this.arena.rayDistance(origin, this._camForward, MAX);  // 地形

    this._raycaster.set(origin, this._camForward);
    this._raycaster.far = MAX;
    const hits = this._raycaster.intersectObjects(this._aimTargets(), true);
    if (hits.length && (best < 0 || hits[0].distance < best)) best = hits[0].distance;

    // 射程内取落点；超过射程或无命中则取最大射程处的点，保证弹道仍在准星线上
    const maxRange = p.weapons.length ? Math.max.apply(null, p.weapons.map((w) => w.range)) : 200;
    const dist = best > 0 ? Math.min(best, maxRange) : maxRange;
    p.aimPoint.copy(origin).addScaledVector(this._camForward, dist);
  }

  /** 开镜时把玩家自身载具变透明，避免挡住第一人称摄像头 */
  _setPlayerTransparent(on) {
    const p = this.player;
    if (!p || on === this._playerTransparent) return;
    this._playerTransparent = on;
    if (on && !this._ghostMat) {
      this._ghostMat = new THREE.MeshBasicMaterial({
        color: 0xbfe9ff, transparent: true, opacity: 0.1,
        depthWrite: false, blending: THREE.NormalBlending,
      });
    }
    p.group.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (o.userData._origMat === undefined) {
          o.userData._origMat = o.material;
          o.userData._origCast = o.castShadow;
        }
        o.material = this._ghostMat;
        o.castShadow = false;
      } else if (o.userData._origMat !== undefined) {
        o.material = o.userData._origMat;
        o.castShadow = o.userData._origCast;
        delete o.userData._origMat;
        delete o.userData._origCast;
      }
    });
  }

  _updateCamera(dt) {
    const p = this.player;
    if (!p) return;
    this._computeCamDir(p);

    // 开镜（右键）：第一人称放大
    this.ads = !!(this.input.locked && this.input.mouse.right && p.alive);
    this._setPlayerTransparent(this.ads);

    const factor = p.alive ? 0.22 : 0.08;
    if (this.ads) {
      // 第一人称：贴近机体前上方，沿准星方向
      this._camPos.copy(p.position)
        .addScaledVector(this._camDir, (p.halfLength || 4) * 0.55 + 1.5)
        .addScaledVector(GAME_UP, (p.topY || 3) * 0.55 + 0.6);
      this.camera.position.lerp(this._camPos, Math.min(1, 0.5 + dt));
      this._lookAt.copy(this.camera.position).addScaledVector(this._camDir, 100);
      this.camera.lookAt(this._lookAt);
    } else {
      // 第三人称：位于载具 Y/Z 最高点各 +offset 方块处（滚轮在 5~10 方块间调节）
      const off = this.camOffset * CELL;
      const yaw = p.heading + this.lookYaw;
      const backX = Math.sin(yaw), backZ = Math.cos(yaw);
      this._camPos.set(
        p.position.x - backX * ((p.halfLength || 6) + off),
        p.position.y + (p.topY || 3) + off,
        p.position.z - backZ * ((p.halfLength || 6) + off)
      );
      const groundY = this.arena.heightAt(this._camPos.x, this._camPos.z) + 2.4;
      if (this._camPos.y < groundY) this._camPos.y = groundY;
      this.camera.position.lerp(this._camPos, Math.min(1, factor + dt));
      // 视线严格沿 camDir（含俯仰），否则看向机体附近会压低准星仰角
      this._lookAt.copy(this.camera.position).addScaledVector(this._camDir, 60);
      this.camera.lookAt(this._lookAt);
    }

    // 开镜视野缩放
    const targetFov = this.ads ? this.adsFov : this.baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------------- 抛射体 / 特效 ---------------- */

  spawnProjectile(def) {
    const p = new Projectile(def);
    this.scene.add(p.mesh);
    this.projectiles.push(p);

    // 炮口火光（玩家武器全显，附近 AI 武器偶尔显示）
    const near = this.player && def.owner &&
      def.owner.position.distanceToSquared(this.player.position) < 4225;
    if ((def.owner && def.owner.isPlayer) || (near && Math.random() < 0.5)) {
      this.spawnImpact(def.origin, 'muzzle', 0.06);
    }

    if (def.owner && def.owner.isPlayer) {
      AudioFX.shoot();
    } else if (this.player && def.owner &&
      def.owner.position.distanceToSquared(this.player.position) < 3600 &&
      Math.random() < 0.2) {
      AudioFX.shoot();
    }
    return p;
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const status = p.update(dt, this);
      if (status === 'dead') {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  /**
   * 爆炸范围伤害：对爆炸点半径内的敌方零件造成伤害
   * （直击零件由抛射体本身结算，故排除）
   */
  applyExplosion(pos, opts) {
    opts = opts || {};
    const radius = opts.radius || 0;
    const centerDamage = opts.damage || 0;
    const minDamage = opts.minDamage !== undefined ? opts.minDamage : 10;
    const team = opts.team;
    const source = opts.source;
    const excludePart = opts.excludePart || null;
    const wp = new THREE.Vector3();

    for (const v of this.vehicles) {
      if (!v.alive || v.side === team) continue;
      if (v.position.distanceTo(pos) > v.boundingRadius + radius + 1) continue;
      const victims = [];
      for (const part of v.parts.values()) {
        if (part === excludePart) continue;
        part.worldPosition(wp);
        const d = wp.distanceTo(pos);
        if (d <= radius) {
          // 沿半径线性递减：中心 centerDamage -> 最外围 minDamage
          const t = radius > 0 ? Utils.clamp(d / radius, 0, 1) : 0;
          victims.push([part, centerDamage + (minDamage - centerDamage) * t]);
        }
      }
      for (const [part, dmg] of victims) v.hitPart(part, dmg, source);
    }

    this.spawnExplosion(pos, radius);
  }

  /** 充能射线炮：沿光束线段造成伤害（覆盖区 + 中心穿透加成） */
  applyBeam(a, b, radius, areaDmg, centerDmg, team, owner) {
    const tmp = new THREE.Vector3();
    const destroyed = [];
    const rArea = radius + 1.2;
    const rCenter = radius * 0.35 + 0.5;
    // 模式屏障可拦截光束 / 处理基地受击
    if (this.mode.blockBeam(a, b, radius, areaDmg, centerDmg, team, this)) return;
    for (const v of this.vehicles) {
      if (!v.alive || v.side === team) continue;
      for (const part of Array.from(v.parts.values())) {
        part.worldPosition(tmp);
        const d2 = Utils.segmentPointDistSq(a, b, tmp);
        if (d2 > rArea * rArea) continue;
        let dmg = areaDmg;
        if (d2 <= rCenter * rCenter) dmg += centerDmg;
        const lethal = part.hp - dmg <= 0;
        v.hitPart(part, dmg, owner);
        if (lethal && (part.type === 'block' || part.type === 'reinforced')) destroyed.push(tmp.clone());
      }
    }
    // 被破坏的方块有 10% 概率爆炸（3 方块范围，50 点不分敌我伤害）
    for (const p of destroyed) {
      if (Math.random() < 0.1) this.damageAllInRadius(p, 3 * CELL, 50, owner);
    }
  }

  /** 不分敌我的范围伤害 */
  damageAllInRadius(pos, radius, damage, source) {
    const tmp = new THREE.Vector3();
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      for (const part of Array.from(v.parts.values())) {
        part.worldPosition(tmp);
        if (tmp.distanceTo(pos) <= radius) v.hitPart(part, damage, source);
      }
    }
    this.spawnExplosion(pos, radius);
  }

  /** 光束特效：0.3s 淡出的圆柱 */
  spawnBeamVFX(a, b, radius, color) {
    const geo = new THREE.CylinderGeometry(Math.max(0.1, radius), Math.max(0.1, radius), 1, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: color || 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    GameBeam.place(mesh, a, b);
    this.impacts.push({ mesh, life: 0.3, maxLife: 0.3, fixedScale: true });
  }

  spawnImpact(pos, kind, life) {
    const colors = { ground: 0xb08a4a, cover: 0x9aa7b0, part: 0xffd166, muzzle: 0xfff4c2 };
    const baseLife = life || 0.28;
    const isGlow = kind === 'muzzle';
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(isGlow ? 0.7 : 0.5, 8, 6),
      new THREE.MeshBasicMaterial({
        color: colors[kind] || 0xffd166,
        transparent: true,
        opacity: 0.95,
        blending: isGlow ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !isGlow,
      })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.impacts.push({ mesh, life: baseLife, maxLife: baseLife, grow: isGlow ? 1.6 : 1.2 });
  }

  /** 爆炸特效：外扩球体半径与实际 AoE 半径一致，另加碎片 */
  spawnExplosion(pos, radius) {
    radius = Math.max(2, radius || 4);

    // 冲击波球体（从中心向外扩张到实际半径）
    const blast = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    blast.position.copy(pos);
    this.scene.add(blast);
    this.impacts.push({ mesh: blast, life: 0.5, maxLife: 0.5, targetScale: radius });

    // 碎片
    const count = 6;
    for (let i = 0; i < count; i++) {
      const shard = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * 0.14, 0),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff8a3d : 0xffd166, transparent: true, opacity: 0.95 })
      );
      shard.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * radius * 0.5,
        Math.random() * radius * 0.3,
        (Math.random() - 0.5) * radius * 0.5
      ));
      this.scene.add(shard);
      this.impacts.push({ mesh: shard, life: 0.55, maxLife: 0.55, grow: 1.6 });
    }
  }

  _updateImpacts(dt) {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.life -= dt;
      const t = 1 - im.life / im.maxLife;
      if (!im.fixedScale) {
        let s;
        if (im.targetScale) {
          // 冲击波：从 20% 扩张到完整 AoE 半径
          s = im.targetScale * (0.2 + 0.8 * t);
        } else {
          s = 1 + t * (im.grow || 1.2);
        }
        im.mesh.scale.setScalar(s);
      }
      im.mesh.material.opacity = Math.max(0, 1 - t);
      if (im.life <= 0) {
        this.scene.remove(im.mesh);
        im.mesh.geometry.dispose();
        im.mesh.material.dispose();
        this.impacts.splice(i, 1);
      }
    }
  }

  /* ---------------- 胜负 ---------------- */

  aliveCount(side) {
    let n = 0;
    for (const v of this.vehicles) if (v.alive && v.side === side) n++;
    return n;
  }

  _checkEnd() {
    if (this.state !== 'playing') return;
    const winner = this.mode.checkEnd(this);
    if (winner !== null && winner !== undefined) this._end(winner === SIDE.PLAYER);
  }

  _end(win) {
    this.state = 'over';
    this.result = win ? 'win' : 'lose';
    if (this.input.locked) this.input.exitLock();
    Bus.emit(EV.GAME_OVER, { win, result: this.result });
  }

  _emitStatus() {
    const p = this.player;
    let energy = 0;
    let spread = 0;
    let energyValue = 0;
    if (p) {
      energy = p.weaponMaxEnergy > 0 ? p.weaponEnergy / p.weaponMaxEnergy : 0;
      energyValue = p.weaponEnergy;
      for (const w of p.activeWeapons()) if (w.heat > spread) spread = w.heat;
    }
    const names = { 1: '', 2: '', 3: '' };
    const keys = { 1: false, 2: false, 3: false };
    if (p) {
      for (const k of [1, 2, 3]) {
        const list = p.weaponGroups[k] || [];
        if (list.length) {
          names[k] = (PartRegistry.meta[list[0].type] || {}).name || list[0].type;
          keys[k] = true;
        }
      }
      if (p.hasBattery && p.batteryKey) {
        names[p.batteryKey] = '备用能源';
        keys[p.batteryKey] = true;
      }
    }

    // 榴弹“丰”形瞄准镜：当前分组含曲射武器时显示
    let grenadeSight = false;
    if (p && p.alive) {
      grenadeSight = p.activeWeapons().some((x) => x.lobbed && !x.destroyed);
    }

    Bus.emit(EV.GAME_STATUS, {
      blue: this.aliveCount(SIDE.PLAYER),
      red: this.aliveCount(SIDE.ENEMY),
      hp: p ? p.hpRatio() : 0,
      energy,
      energyValue,
      spread,
      cooldown: p ? p.groupCooldownRatio() : 0,
      alive: p ? p.alive : false,
      activeKey: p ? p.activeKey : 1,
      keys,
      weaponNames: names,
      hasBattery: p ? p.hasBattery : false,
      backupReady: p ? (p.hasBattery && p.backupCooldown <= 0) : false,
      backupCooldown: p ? p.backupCooldown : 0,
      hasComputer: p ? (p.energyPenalty > 0) : false,
      grenadeSight,
      mode: this.mode ? this.mode.name : 'tdm',
      capture: this.mode ? this.mode.status().capture : null,
    });
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
