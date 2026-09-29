/* =========================================================
 *  aiController.js — 敌方 / 友军 AI 驾驶与射击
 *  行为：选目标 -> 保持交战距离 -> 转向 -> 点射 -> 避障
 *  战术：规避来袭弹道、利用掩体、间歇使用榴弹、用模块
 *  机动：机械腿跳跃、旋翼飞行、武器分组切换
 * ========================================================= */

class AIController {
  constructor(vehicle, game, opts) {
    opts = opts || {};
    this.vehicle = vehicle;
    this.game = game;
    this.target = null;
    this.retargetTimer = 0;
    this.burstTimer = 0;
    this.restTimer = 0;
    this.jumpTimer = 2 + Math.random() * 4;
    this.grenadeCd = Math.random() * 2;
    this.underFire = false;
    this.underFireTimer = 0;
    this.dodge = 0;
    this.stuck = 0;
    this.unstickT = 0;
    this.unstickDir = 1;
    this.aimPart = null;
    this.aimPartTimer = 0;
    this.cover = null;
    this.coverTimer = 0;
    this._lastHp = 1;
    this.preferredRange = opts.preferredRange || (Config.AI_RANGE_BASE + Math.random() * Config.AI_RANGE_SPREAD);
    this.skill = opts.skill !== undefined ? opts.skill : (Config.AI_SKILL_MIN + Math.random() * Config.AI_SKILL_SPREAD);
    this._tmp = new THREE.Vector3();
    this._t2 = new THREE.Vector3();
  }

  update(dt) {
    const v = this.vehicle;
    if (!v.alive) return;

    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 || !this.target || !this.target.alive) {
      this.target = this._nearestEnemy();
      this.retargetTimer = 1.2 + Math.random() * 1.2;
    }
    if (this.grenadeCd > 0) this.grenadeCd -= dt;

    if (!this.target) {
      v.throttle = 0; v.steer = 0; v.moveX = 0; v.moveZ = 0; v.firing = false;
      return;
    }

    const t = this.target;
    const dx = t.position.x - v.position.x;
    const dz = t.position.z - v.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const desired = Math.atan2(dx, dz);
    const angle = Utils.angleDelta(v.heading, desired);

    this._useModules();
    this._assessThreat(dt);
    this._pickCover(dist);

    const los = this._hasLineOfSight();
    // 仅在真正被压制（打不到/低血）时才躲掩体；能打就打
    const seekingCover = !!this.cover && (v.hpRatio() < 0.5 || (this.underFire && !los));

    // 夺点模式：无掩体需求时朝目标机动；受伤则回出生点修复
    let navX = 0, navZ = 0, nav = seekingCover, hold = false;
    if (seekingCover) { navX = this.cover.x; navZ = this.cover.z; }
    else if (this.game.capture) {
      const obj = this._objectivePoint();
      if (obj) {
        const od = Math.hypot(obj.x - v.position.x, obj.z - v.position.z);
        navX = obj.x; navZ = obj.z; nav = true;
        hold = od <= Config.AI_HOLD_DIST;   // 已到位：驻守/修复
      }
    }

    if (v.omni) {
      v.heading = desired;              // 车体始终朝向目标（便于开火）
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
      let mx = 0, mz = 0;
      if (nav && !hold) {
        const a = Math.atan2(navX - v.position.x, navZ - v.position.z);
        const d = Math.hypot(navX - v.position.x, navZ - v.position.z);
        if (d > 3) {
          const wx = Math.sin(a), wz = Math.cos(a);
          mz = wx * fx + wz * fz;
          mx = wx * rx + wz * rz;
        }
      } else if (!nav) {
        mz = dist > this.preferredRange ? 1 : (dist < this.preferredRange * 0.7 ? -1 : 0);
      }
      v.moveZ = mz;
      v.moveX = Utils.clamp(mx + this.dodge, -1, 1);
      v.steer = 0; v.throttle = 0; v.moveY = 0;
    } else {
      let steer = Utils.clamp(-angle * 2.4, -1, 1) + this._avoidSteer() + this.dodge * 0.7;
      let throttle;
      if (seekingCover) {
        const cd = Math.hypot(this.cover.x - v.position.x, this.cover.z - v.position.z);
        if (cd > 3) {
          const a = Math.atan2(this.cover.x - v.position.x, this.cover.z - v.position.z);
          steer = Utils.clamp(-Utils.angleDelta(v.heading, a) * 2.4, -1, 1);
          throttle = 1;
        } else {
          steer = Utils.clamp(-angle * 2.4, -1, 1) + this._avoidSteer();
          throttle = 0;   // 抵达掩体后停住，转身对目标开火
        }
      } else if (hold) {
        throttle = 0;     // 驻守得分点 / 出生点修复
      } else if (nav) {
        const a = Math.atan2(navX - v.position.x, navZ - v.position.z);
        steer = Utils.clamp(-Utils.angleDelta(v.heading, a) * 2.4, -1, 1);
        throttle = 1;
      } else {
        if (dist > this.preferredRange) throttle = 1;
        else if (dist < this.preferredRange * 0.6) throttle = -0.6;
        else throttle = 0.3;
      }
      v.steer = Utils.clamp(steer, -1, 1);
      v.throttle = throttle;
      v.moveY = 0;
    }

    if (v.canFly) this._fly(dt);
    if (v.canJump) this._legs(dt);
    this._unstick(dt);

    // 选择武器分组
    const key = this._chooseKey(dist);
    if (key) v.activeKey = key;
    const act = v.activeWeapons();
    const projSpeed = act.length ? act[0].projectileSpeed : 165;
    const maxRange = act.length ? Math.max.apply(null, act.map((w) => w.range)) : 150;

    // 瞄准：优先攻击关键部位的零件（而非模型中心）
    this.aimPartTimer -= dt;
    if (this.aimPartTimer <= 0 || !this.aimPart || this.aimPart.destroyed || !t.parts.has(this.aimPart.id)) {
      this.aimPart = this._selectAimPart(t);
      this.aimPartTimer = 0.4;
    }
    const aimPos = this._t2;
    if (this.aimPart) this.aimPart.worldPosition(aimPos);
    else aimPos.copy(t.position);

    const lead = dist / projSpeed;
    v.aimPoint.copy(aimPos);
    v.aimPoint.addScaledVector(t.velocity, lead);
    const spread = (1 - this.skill) * dist * 0.05;
    v.aimPoint.x += (Math.random() - 0.5) * spread;
    v.aimPoint.y += (Math.random() - 0.5) * spread;
    v.aimPoint.z += (Math.random() - 0.5) * spread;

    // 开火 / 蓄力
    const inRange = dist < maxRange * 0.95;
    const aimed = Math.abs(angle) < 2.2;
    const isCharge = act.length > 0 && act[0].charge;
    if (isCharge) {
      this._aiCharge(dt, inRange, aimed, los, t);
    } else {
      if (this.restTimer > 0) {
        this.restTimer -= dt;
        v.firing = false;
      } else {
        v.firing = inRange && aimed && los;
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          this.burstTimer = 0.9 + Math.random() * 1.2;
          this.restTimer = 0.3 + Math.random() * 0.7;
        }
      }
      if (v.weaponEnergy < v.weaponMaxEnergy * 0.12) v.firing = false;
    }
  }

  /** 充能射线炮：瞄准后蓄力一定时间再松开 */
  _aiCharge(dt, inRange, aimed, los, t) {
    const v = this.vehicle;
    v.firing = false;
    if (!v.charging) {
      if (inRange && los && v.weaponEnergy > v.weaponMaxEnergy * 0.25) {
        if (v.startCharge()) this.chargeGoal = 1.2 + this.skill * 1.6;
      }
    } else {
      const enough = v.chargeTime >= (this.chargeGoal || 2);
      const lost = !t || !los || (this.aimPart && this.aimPart.destroyed);
      if (enough || lost || v.weaponEnergy <= 0) v.releaseCharge(this.game);
    }
  }

  /** 备用能源 */
  _useModules() {
    const v = this.vehicle;
    if (v.hasBattery && v.backupCooldown <= 0 &&
        v.weaponEnergy < v.weaponMaxEnergy * 0.4 && v.activeWeapons().length) {
      v.useBackupEnergy();
    }
  }

  /** 评估是否被瞄准，并计算横向规避方向 */
  _assessThreat(dt) {
    const v = this.vehicle, g = this.game;
    if (!g.projectiles || !g.projectiles.length) {
      this.dodge = 0;
      if (this.underFire) this.underFireTimer -= dt;
      if (this.underFireTimer <= 0) this.underFire = false;
      return;
    }
    const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
    let lateral = 0, danger = false;
    for (const p of g.projectiles) {
      if (p.team === v.side) continue;
      const toV = this._tmp.subVectors(v.position, p.pos);
      const d = toV.length();
      if (d > 50 || d < 0.5) continue;
      if (p.dir.dot(toV) <= 0) continue;           // 正在远离
      danger = true;
      const lat = rx * toV.x + rz * toV.z;         // 威胁在左/右
      lateral += (lat >= 0 ? -1 : 1);
    }
    this.dodge = Utils.clamp(lateral, -1, 1) * 0.9;
    if (danger) this.underFireTimer = 1.2;
    else if (this.underFireTimer > 0) this.underFireTimer -= dt;
    this.underFire = this.underFireTimer > 0;
  }

  /** 选取「可侧身输出」的掩体机动点（掩体侧面，且对目标有通视） */
  _pickCover(dist) {
    const v = this.vehicle, g = this.game, t = this.target;
    const arena = g.arena;
    if (!arena) { this.cover = null; return; }
    if (dist < 30) { this.cover = null; return; }
    if (this.coverTimer > 0) { this.coverTimer -= 1 / 60; return; }

    const pad = (v.bodyRadius || 3) + 3;
    const tx = t.position.x, tz = t.position.z;
    const vy = v.position.y + 1.4, ty = t.position.y + 1.4;
    let best = null, bestScore = Infinity;

    for (const c of arena.covers) {
      const dirx = c.x - tx, dirz = c.z - tz;
      const len = Math.hypot(dirx, dirz) || 1;
      const px = -dirz / len, pz = dirx / len;   // 垂直于目标方向
      for (const s of [1, -1]) {
        const ox = c.x + px * s * (c.radius + pad);
        const oz = c.z + pz * s * (c.radius + pad);
        const dv = Math.hypot(ox - v.position.x, oz - v.position.z);
        if (dv > 65) continue;
        const dT = Math.hypot(ox - tx, oz - tz);
        // 站位需能打到目标（否则躲在后面只能挨打）
        if (arena.hitCover({ x: ox, y: vy, z: oz }, { x: tx, y: ty, z: tz })) continue;
        const score = dv - Math.min(dT, 140) * 0.3;
        if (score < bestScore) { bestScore = score; best = { x: ox, z: oz }; }
      }
    }
    this.cover = best;
    this.coverTimer = 1.0;
  }

  _fly(dt) {
    const v = this.vehicle;
    const arena = this.game.arena;
    if (!arena) return;
    const ground = arena.heightAt(v.position.x, v.position.z);
    const cruise = 10 + this.skill * 6;
    v.moveY = Utils.clamp(((ground + cruise) - v.position.y) * 0.25, -1, 1);
  }

  _legs(dt) {
    const v = this.vehicle;
    if (v.airborne) return;
    this.jumpTimer -= dt;
    if (this.jumpTimer <= 0) {
      v.dashJump();
      this.jumpTimer = 3 + Math.random() * 4;
    }
  }

  /** 长时间原地不动则倒车/侧移脱困 */
  _unstick(dt) {
    const v = this.vehicle;
    const moving = v.omni ? (Math.abs(v.moveX) + Math.abs(v.moveZ) > 0.1) : (v.throttle !== 0);
    if (Math.abs(v.speed) < 0.6 && moving) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 1.5) { this.stuck = 0; this.unstickT = 0.9; this.unstickDir = Math.random() < 0.5 ? -1 : 1; }
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      if (v.omni) { v.moveZ = -1; v.moveX = this.unstickDir; }
      else { v.throttle = -1; v.steer = this.unstickDir; }
    }
  }

  /** 分组选择：默认机枪，间歇近距离改用榴弹 */
  _chooseKey(dist) {
    const v = this.vehicle;
    let he = null, mg = null;
    for (const k of [1, 2, 3]) {
      const list = v.weaponGroups[k];
      if (!list || !list.length) continue;
      let range = 0, isHE = false;
      for (const w of list) { range = Math.max(range, w.range); if (w.type === 'grenade') isHE = true; }
      if (isHE) { if (!he || range > he.range) he = { k, range }; }
      else if (!mg || range > mg.range) mg = { k, range };
    }
    // 榴弹：中近距离、冷却就绪时偶尔使用（避免持续面杀伤对拼）
    if (he && this.grenadeCd <= 0 && dist > 70 && dist < 200 && he.range >= dist * 0.8) {
      this.grenadeCd = 2.5 + Math.random() * 2;
      return he.k;
    }
    if (mg) return mg.k;
    return he ? he.k : null;
  }

  /** 依据目标血量分布决定优先攻击的零件类别 */
  _aimCategory(t) {
    let struct = 0, weapon = 0, move = 0;
    for (const part of t.parts.values()) {
      const ty = part.type;
      if (ty === 'machinegun' || ty === 'grenade') weapon += part.hp;
      else if (ty === 'wheel' || ty === 'track' || ty === 'leg' || ty === 'rotor') move += part.hp;
      else if (ty === 'block' || ty === 'reinforced') struct += part.hp;
    }
    if (t.hpRatio() < 0.4) return 'any';                         // 残血：随便打，尽快击毁
    if (t.wheels.length > 0 && t.wheels.length <= 2 && move > 0) return 'movement'; // 机动部件少：先断腿
    if (struct > weapon) return 'weapon';                        // 血量主要在方块：拆武器
    return 'structure';                                          // 血量主要在武器：打机体
  }

  /** 选取优先攻击的具体零件 */
  _selectAimPart(t) {
    const cat = this._aimCategory(t);
    const vy = this.vehicle.position;
    const buckets = { structure: [], weapon: [], movement: [], any: [] };
    for (const part of t.parts.values()) {
      const ty = part.type;
      if (ty === 'machinegun' || ty === 'grenade') buckets.weapon.push(part);
      else if (ty === 'wheel' || ty === 'track' || ty === 'leg' || ty === 'rotor') buckets.movement.push(part);
      else if (ty === 'block' || ty === 'reinforced') buckets.structure.push(part);
      buckets.any.push(part);
    }
    const order = cat === 'any' ? ['any'] : [cat, 'structure', 'any'];
    const tmp = this._t2;
    for (const name of order) {
      const list = buckets[name];
      if (!list || !list.length) continue;
      // 残血优先打最脆弱的零件，其余选离自己最近的
      let best = null, bestVal = cat === 'any' ? Infinity : Infinity;
      for (const part of list) {
        part.worldPosition(tmp);
        const val = cat === 'any' ? part.hp : tmp.distanceToSquared(vy);
        if (val < bestVal) { bestVal = val; best = part; }
      }
      if (best) return best;
    }
    return null;
  }

  _nearestEnemy() {
    let best = null, bestD = Infinity;
    for (const other of this.game.vehicles) {
      if (!other.alive || other.side === this.vehicle.side) continue;
      const d = other.position.distanceToSquared(this.vehicle.position);
      // 残血目标优先（距离 × 血量权重）
      const score = d * (0.55 + 0.45 * other.hpRatio());
      if (score < bestD) { bestD = score; best = other; }
    }
    return best;
  }

  /** 夺点模式目标点：残血回出生点修复；否则优先夺取非我方得分点，全归我方则守最近点 */
  _objectivePoint() {
    const cap = this.game.capture;
    if (!cap) return null;
    const my = this.vehicle.side;
    const home = cap.baseCenter[my];

    // 残血回出生点修复（带迟滞，回满后离开）
    if (home) {
      if (this._healing) {
        if (this.vehicle.hpRatio() >= 0.95) this._healing = false;
        else return home;
      } else if (this.vehicle.hpRatio() < 0.55) {
        this._healing = true;
        return home;
      }
    }

    let best = null, bestD = Infinity;
    for (const p of cap.points) {
      if (p.owner === my) continue;
      const d = p.position.distanceToSquared(this.vehicle.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) return best.position;
    for (const p of cap.points) {
      const d = p.position.distanceToSquared(this.vehicle.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? best.position : null;
  }

  _avoidSteer() {
    const v = this.vehicle;
    const arena = this.game.arena;
    if (!arena) return 0;
    const aheadDist = 10 + (v.halfLength || 4);
    const ahead = this._tmp.set(
      v.position.x + Math.sin(v.heading) * aheadDist,
      v.position.y,
      v.position.z + Math.cos(v.heading) * aheadDist
    );
    let steer = 0;
    for (const c of arena.covers) {
      const dx = ahead.x - c.x, dz = ahead.z - c.z;
      const d2 = dx * dx + dz * dz;
      const margin = c.radius + (v.bodyRadius || 2.5) + 2;
      if (d2 < margin * margin) {
        const side = (dx * Math.cos(v.heading) - dz * Math.sin(v.heading)) > 0 ? -0.9 : 0.9;
        steer += side;
      }
    }
    const edge = arena.half - 14;
    if (Math.abs(v.position.x) > edge || Math.abs(v.position.z) > edge) {
      const toCenter = Math.atan2(-v.position.x, -v.position.z);
      const a = Utils.angleDelta(v.heading, toCenter);
      steer += Utils.clamp(-a * 1.5, -1, 1);
    }
    return Utils.clamp(steer, -1, 1);
  }

  _hasLineOfSight() {
    const arena = this.game.arena;
    if (!arena || !this.target) return true;
    const a = this.vehicle.position;
    const b = this.target.position;
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t + 1.4;
      if (y < arena.heightAt(x, z)) return false;
    }
    const seg = { x: a.x, y: a.y + 1.4, z: a.z };
    const seg2 = { x: b.x, y: b.y + 1.4, z: b.z };
    return !arena.hitCover(seg, seg2);
  }
}
