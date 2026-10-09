/* =========================================================
 *  captureMode.js — 夺点模式（实现 GameMode 接口）
 *  三个镜像对称的得分点 + 两个对角基地。
 *  占领得分点为所属阵营累积“结束进度”；占满 3 点解除对方基地护盾，
 *  此后可攻击对方基地八面体倒扣进度（1% = 1000 血）。
 *  规则内包含：10 秒复活于基地、在基地停留 3 秒自动修复。
 * ========================================================= */

const CAPTURE = {
  CAPTURE_TIME: 15,        // 占领耗时（秒）
  RESPAWN_TIME: 10,        // 阵亡复活等待（秒）
  REPAIR_RATE: 20 * 8 * 120, // 出生点治疗射线：工程激光的 20 倍（8发/秒×120治疗）
  UNIT_TIME: 15,           // 每点每 UNIT_TIME 秒 +1% 结束进度
  POINT_RADIUS: 10,        // 得分点半径（格）
  SPAWN_RADIUS: 15,        // 出生点光圈半径（格）
  SHIELD_RADIUS: 30,       // 基地护盾半径（格）
  OCTA_MIN: 3,             // 八面体边长（格）初始
  OCTA_MAX: 8,             // 八面体边长（格）满进度
  HP_PER_PERCENT: 1000,    // 1% 进度 = 1000 血
  HIDDEN_HP: 30000,        // 进度 <=30% 时的隐藏血量
  HIDDEN_UNTIL: 30,
  WIN_PROGRESS: 100,
  MATCH_TIME: 20 * 60,     // 对局时长（秒），倒计时结束按进度判胜
  ALL_HOLD_BONUS: 5,       // 占满 3 点时占领方每单位时间额外 +5% 进度
  BUFF_DMG_OUT: 1.05,      // 被占领方强化：输出伤害 +5%
  BUFF_DMG_IN: 0.95,       // 被占领方强化：受到伤害 -5%
  BUFF_SPEED: 1.05,        // 被占领方强化：移动速度 +5%
  HELPLESS_TIME: 1.5,      // 无助（无法移动+无法攻击）多久后 AI 自毁
  BASE_OFFSET: 0.6,        // 基地距中心的比例（对角）
  NEAR_OFFSET: 0.36,       // 近点/中点距中心的比例
};

class CaptureMode extends GameMode {
  constructor(game) {
    super(game);
    this.name = 'capture';
    this.arena = null;
    this.group = null;
    this.bases = {};
    this.points = [];
    this.baseCenter = {};
    this.winner = null;      // null | SIDE.*
    this.time = 0;
    this.timeLeft = CAPTURE.MATCH_TIME;   // 对局倒计时
    this.allHold = null;     // 占满 3 点的阵营（null | SIDE.*），用于进度加速与落后方强化
    this._respawns = [];     // 复活队列：{ timer, vehicle, bp, side, isPlayer, teamKey, name, skill }
  }

  /** 目标区域（基地/得分点）——供 Arena 生成掩体时排除 */
  arenaExclusions(half) {
    const b = half * CAPTURE.BASE_OFFSET;
    const n = half * CAPTURE.NEAR_OFFSET;
    const baseR = CAPTURE.SPAWN_RADIUS * CELL + 14;
    const ptR = CAPTURE.POINT_RADIUS * CELL + 12;
    return [
      { x: -b, z: -b, r: baseR },
      { x: b, z: b, r: baseR },
      { x: n, z: -n, r: ptR },
      { x: -n, z: -n, r: ptR },
      { x: n, z: n, r: ptR },
    ];
  }

  build(scene, game) {
    this.arena = game.arena;
    this.group = new THREE.Group();
    this.group.name = 'capture';
    scene.add(this.group);
    scene.updateMatrixWorld(true);
    this._build();
  }

  _build() {
    const half = this.arena.half;
    const b = half * CAPTURE.BASE_OFFSET;
    const n = half * CAPTURE.NEAR_OFFSET;

    this.baseCenter[0] = new THREE.Vector3(-b, 0, -b);
    this.baseCenter[1] = new THREE.Vector3(b, 0, b);

    for (const team of [0, 1]) {
      const c = this.baseCenter[team];
      c.y = this.arena.heightAt(c.x, c.z);
      const color = CAP_COLORS[team];

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(CAPTURE.SPAWN_RADIUS * CELL, 0.5 * CELL, 10, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, c.y + 1, c.z);
      this.group.add(ring);

      const octa = new THREE.Mesh(
        new THREE.OctahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      octa.position.set(c.x, c.y + 20, c.z);
      octa.visible = false;
      octa.scale.setScalar(CAPTURE.OCTA_MIN * CELL / Math.SQRT2);
      this.group.add(octa);

      const shield = new Shield({
        center: new THREE.Vector3(c.x, c.y, c.z),
        radius: CAPTURE.SHIELD_RADIUS * CELL,
        team,
      });
      shield.setEnabled(false);
      this.group.add(shield.group);

      this.bases[team] = {
        team, center: c, color, ring, octa, shield,
        progress: 0, owned: 0, everOwned: false,
        hiddenHp: CAPTURE.HIDDEN_HP, destroyed: false, octaRadius: 0,
        repairBeams: new Map(),   // 目标载具 -> 治疗射线网格
      };
    }

    // 三个得分点：镜像对称（两近点互为远点，第三点在中垂线上）
    const pts = [
      new THREE.Vector3(n, 0, -n),
      new THREE.Vector3(-n, 0, -n),
      new THREE.Vector3(n, 0, n),
    ];
    for (const p of pts) {
      p.y = this.arena.heightAt(p.x, p.z);
      const cp = new CapturePoint(p.x, p.y, p.z);
      this.points.push(cp);
      this.group.add(cp.group);
    }
  }

  /** 基地处出生：5 辆沿垂直方向排开，位于基地外侧 */
  spawnPoints(game, side) {
    const c = this.baseCenter[side];
    const out = new THREE.Vector3(Math.sign(c.x) || 1, 0, Math.sign(c.z) || 1).normalize();
    const perp = new THREE.Vector3(-out.z, 0, out.x);
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const p = c.clone().addScaledVector(out, 26).addScaledVector(perp, (i - 2) * 18);
      this.arena.clampToBounds(p);
      p.y = this.arena.heightAt(p.x, p.z) + 1;
      pts.push(p);
    }
    return pts;
  }

  update(dt, game) {
    this.time += dt;

    // 倒计时：时间耗尽按进度判胜（进度相同比占点数，仍相同判玩家胜）
    if (this.winner === null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.winner = this._leader();
    }

    for (const cp of this.points) cp.update(dt, game.vehicles);

    const counts = { 0: 0, 1: 0 };
    for (const cp of this.points) if (cp.owner !== null) counts[cp.owner]++;

    // 占满 3 点：占领方进度加速，被占领方获得机体强化（取回任意一点即失效）
    const allHold = counts[0] === 3 ? 0 : (counts[1] === 3 ? 1 : null);
    if (allHold !== this.allHold) {
      this.allHold = allHold;
      if (allHold === 0) Bus.emit('hud:notice', { text: '已占满全部得分点：结束进度加速', key: 'buff' });
      else if (allHold === 1) Bus.emit('hud:notice', {
        text: '敌方占满得分点：我方强化（伤害+5% 受伤-5% 移速+5%）', key: 'buff',
      });
    }
    for (const v of game.vehicles) {
      const buffed = allHold !== null && v.side !== allHold;
      v.dmgOutMul = buffed ? CAPTURE.BUFF_DMG_OUT : 1;
      v.dmgInMul = buffed ? CAPTURE.BUFF_DMG_IN : 1;
      v.speedBuff = buffed ? CAPTURE.BUFF_SPEED : 1;
    }

    for (const team of [0, 1]) {
      const b = this.bases[team];
      const enemy = team === 0 ? 1 : 0;
      b.owned = counts[team];
      if (counts[team] > 0) b.everOwned = true;

      if (!b.destroyed) {
        const rate = counts[team] + (allHold === team ? CAPTURE.ALL_HOLD_BONUS : 0);
        b.progress = Math.min(CAPTURE.WIN_PROGRESS, b.progress + rate * dt / CAPTURE.UNIT_TIME);
      }

      // 护盾：曾被占领过、且敌方未占满 3 点时才开启（敌方占满 3 点即解除）
      const shieldUp = b.everOwned && counts[enemy] < 3 && !b.destroyed;
      b.shield.setEnabled(shieldUp);
      b.shield.update(dt);

      b.octa.visible = b.everOwned && !b.destroyed;
      const edgeCells = CAPTURE.OCTA_MIN + (CAPTURE.OCTA_MAX - CAPTURE.OCTA_MIN) * (b.progress / CAPTURE.WIN_PROGRESS);
      const scale = edgeCells * CELL / Math.SQRT2;
      b.octa.scale.setScalar(scale);
      b.octa.rotation.y = this.time * 0.8;
      b.octaRadius = scale * 1.15;

      if (b.progress >= CAPTURE.WIN_PROGRESS && this.winner === null) this.winner = team;
      if (b.destroyed && this.winner === null) this.winner = enemy;
    }

    this._applyRespawns(dt, game);
    this._updateRepair(dt, game);
  }

  /* ---------------- 复活 / 修复 ---------------- */

  onVehicleDestroyed(vehicle, game) {
    if (!vehicle) return;
    const ci = game.controllers.findIndex((c) => c.vehicle === vehicle);
    this._respawns.push({
      timer: CAPTURE.RESPAWN_TIME, vehicle,
      side: vehicle.side, isPlayer: !!vehicle.isPlayer,
      bp: vehicle.bp, teamKey: vehicle.teamKey, name: vehicle.name,
      skill: ci >= 0 ? game.controllers[ci].skill : Config.AI_RESPAWN_SKILL,
    });
  }

  /** 选择离敌人最远的出生位，减少复活后被压制的概率 */
  _respawnPoint(game, side) {
    const pts = this.spawnPoints(game, side);
    let best = pts[0], bestD = -1;
    for (const p of pts) {
      let nearest = Infinity;
      for (const v of game.vehicles) {
        if (!v.alive || v.side === side) continue;
        nearest = Math.min(nearest, p.distanceToSquared(v.position));
      }
      if (nearest > bestD) { bestD = nearest; best = p; }
    }
    return best.clone();
  }

  _applyRespawns(dt, game) {
    if (!this._respawns.length) return;
    for (let i = this._respawns.length - 1; i >= 0; i--) {
      const r = this._respawns[i];
      r.timer -= dt;
      if (r.timer > 0) continue;
      this._respawns.splice(i, 1);
      const pos = this._respawnPoint(game, r.side);
      game.replaceVehicle(r.vehicle, r.bp, r.side, {
        isPlayer: r.isPlayer, teamKey: r.teamKey, name: r.name, skill: r.skill,
      }, pos, Math.atan2(-pos.x, -pos.z));
    }
  }

  /** 出生点治疗：半径与护盾一致，由八面体向范围内友军发射 20 倍治疗工程射线（只治疗不攻击） */
  _updateRepair(dt, game) {
    const R = CAPTURE.SHIELD_RADIUS * CELL;
    for (const b of this.basesList()) {
      const origin = b.octa.position;
      const active = new Set();
      for (const v of game.vehicles) {
        if (!v.alive || v.side !== b.team) continue;
        if (v.position.distanceTo(b.center) > R) continue;
        if (!this._needsRepair(v)) continue;
        v.repair(CAPTURE.REPAIR_RATE * dt);   // 20 倍治疗量
        active.add(v);
        this._placeRepairBeam(b, v, origin);
        if (!this._needsRepair(v) && v.isPlayer) {
          Bus.emit('hud:notice', { text: '机体已修复', key: 'repair' });
        }
      }
      // 回收离开范围 / 已修复目标的射线
      for (const [v, mesh] of Array.from(b.repairBeams)) {
        if (!active.has(v)) this._removeRepairBeam(b, v, mesh);
      }
    }
  }

  _needsRepair(v) {
    return v.currentHp() < v.totalMaxHp - 0.5 || v.parts.size < (v._fullParts || v.bp.parts.length);
  }

  /** 八面体 -> 友军的浅绿色治疗射线（世界坐标，挂到模式分组） */
  _placeRepairBeam(b, v, origin) {
    let mesh = b.repairBeams.get(v);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x9dffb0, transparent: true, opacity: 0.45,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      mesh.scale.x = 0.15;
      mesh.scale.z = 0.15;
      this.group.add(mesh);
      b.repairBeams.set(v, mesh);
    }
    const end = this._beamEnd || (this._beamEnd = new THREE.Vector3());
    end.copy(v.position);
    end.y += (v.topY || 3) * 0.5;
    GameBeam.place(mesh, origin, end);
    mesh.scale.x = 0.15;
    mesh.scale.z = 0.15;
    mesh.visible = b.octa.visible;
  }

  _removeRepairBeam(b, v, mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
    b.repairBeams.delete(v);
  }

  /* ---------------- 屏障 / 目标 ---------------- */

  /** 把敌方载具推出已开启的基地护盾（友方可穿过） */
  resolveShields(game) {
    for (const b of this.basesList()) {
      if (!b.shield.enabled) continue;
      for (const v of game.vehicles) {
        if (!v.alive || v.side === b.team) continue;
        if (b.shield.pushOut(v.position, v.side, v.bodyRadius || Config.SEPARATION_RADIUS)) {
          v._applyTransform(game.arena);
        }
      }
    }
  }

  /** 子弹：击中敌方已开启护盾则被拦截；护盾解除后命中八面体则倒扣进度 */
  blockProjectile(p, game) {
    for (const b of this.basesList()) {
      if (b.team === p.team) continue;
      const c = b.shield.center;
      if (b.shield.enabled) {
        if (Utils.segmentPointDistSq(p.prev, p.pos, c) <= b.shield.radius * b.shield.radius) {
          game.spawnImpact(p.pos, 'cover');
          return true;
        }
      } else if (b.everOwned && !b.destroyed) {
        const octaPos = b.octa.position;
        const r = (b.octaRadius || 4) + (p.scale || 1);
        if (Utils.segmentPointDistSq(p.prev, p.pos, octaPos) <= r * r) {
          this.damageBase(b.team, p.damage);
          game.spawnImpact(octaPos, 'part');
          Bus.emit(EV.PROJECTILE_HIT, {
            position: octaPos.clone(), target: null, source: p.owner,
            part: null, damage: p.damage, lethal: false,
          });
          return true;
        }
      }
    }
    return false;
  }

  /** 光束：护盾拦截；护盾解除后扫过八面体则倒扣进度 */
  blockBeam(a, b, radius, areaDmg, centerDmg, team, game) {
    const rArea = radius + 1.2;
    for (const base of this.basesList()) {
      if (base.team === team) continue;
      const c = base.shield.center;
      if (base.shield.enabled) {
        if (Utils.segmentPointDistSq(a, b, c) <= base.shield.radius * base.shield.radius) return true;
      } else if (base.everOwned && !base.destroyed) {
        const r = (base.octaRadius || 4) + rArea;
        if (Utils.segmentPointDistSq(a, b, base.octa.position) <= r * r) {
          this.damageBase(base.team, areaDmg + centerDmg);
        }
      }
    }
    return false;
  }

  /** 射线武器（工程激光）：返回护盾/暴露八面体的拦截距离（最近者） */
  beamStop(origin, dir, maxDist, team, game) {
    let best = null;
    for (const b of this.basesList()) {
      if (b.team === team) continue;
      const shielded = b.shield.enabled;
      const R = shielded ? b.shield.radius
        : ((b.everOwned && !b.destroyed) ? (b.octaRadius || 4) : 0);
      if (!R) continue;
      const target = shielded ? b.shield.center : b.octa.position;
      const ox = target.x - origin.x, oy = target.y - origin.y, oz = target.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0) continue;                       // 屏障在射线后方
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 > R * R) continue;                  // 未与球相交
      const entry = Math.max(0, t - Math.sqrt(R * R - d2));
      if (entry > maxDist) continue;
      if (!best || entry < best.dist) {
        best = shielded ? { dist: entry } : { dist: entry, baseTeam: b.team };
      }
    }
    return best;
  }

  /* ---------------- 进度 / 胜负 ---------------- */

  /** 攻击八面体：进度 <=30 先扣隐藏血量，之后倒扣进度 */
  damageBase(team, dmg) {
    const b = this.bases[team];
    if (!b || b.destroyed || dmg <= 0) return;
    if (b.progress <= CAPTURE.HIDDEN_UNTIL && b.hiddenHp > 0) {
      const used = Math.min(b.hiddenHp, dmg);
      b.hiddenHp -= used;
      dmg -= used;
    }
    if (dmg > 0) {
      b.progress = Math.max(0, b.progress - dmg / CAPTURE.HP_PER_PERCENT);
      if (b.progress <= 0) { b.progress = 0; b.destroyed = true; }
    }
  }

  basesList() { return [this.bases[0], this.bases[1]]; }

  /** 倒计时结束的领先方：进度优先，其次占点数，仍平判玩家胜 */
  _leader() {
    const p0 = this.bases[0].progress, p1 = this.bases[1].progress;
    if (p0 !== p1) return p0 > p1 ? 0 : 1;
    const c0 = this.points.filter((p) => p.owner === 0).length;
    const c1 = this.points.filter((p) => p.owner === 1).length;
    if (c0 !== c1) return c0 > c1 ? 0 : 1;
    return 0;
  }

  /* ---------------- 自毁 ---------------- */

  /** 机体已无战斗能力：无法移动（无机动部件）且无法攻击（无武器） */
  _helpless(v) { return v.moveCount === 0 && v.weapons.length === 0; }

  /** AI：无助超过阈值，或长期卡死在掩体里，自毁回出生点 */
  aiSelfDestruct(v, dt, stuckTime, game) {
    if (!v.alive) return false;
    if (this._helpless(v)) {
      v._helplessTimer = (v._helplessTimer || 0) + dt;
      if (v._helplessTimer >= CAPTURE.HELPLESS_TIME) { v._explode(null); return true; }
      return false;
    }
    v._helplessTimer = 0;
    if (stuckTime >= Config.AI_STUCK_LIMIT) { v._explode(null); return true; }
    return false;
  }

  checkEnd(game) { return this.winner; }

  snapshot() {
    return {
      blue: this.bases[0].progress,
      red: this.bases[1].progress,
      points: this.points.map((p) => p.owner),
      contested: this.points.map((p) => p.contested),
      timeLeft: this.timeLeft,
      allHold: this.allHold,
    };
  }

  status() { return { mode: this.name, capture: this.snapshot() }; }

  /** 夺点模式的暂停菜单带“自毁机体”（可回出生点复活） */
  pauseMenu() {
    return Object.assign(GameMode.prototype.pauseMenu.call(this), {
      sub: '按 ESC 或“继续战斗”回到战场 · 自毁机体可回出生点复活',
      selfDestruct: true,
    });
  }

  /* ---------------- AI 目标 ---------------- */

  /** 优先夺取非我方得分点；三点全归我方则守最近的点 */
  objectiveFor(vehicle) {
    const my = vehicle.side;
    let best = null, bestD = Infinity;
    for (const p of this.points) {
      if (p.owner === my) continue;
      const d = p.position.distanceToSquared(vehicle.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) return best.position;
    for (const p of this.points) {
      const d = p.position.distanceToSquared(vehicle.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? best.position : null;
  }

  /** 残血回出生点修复（带迟滞，回满后离开） */
  repairObjectiveFor(vehicle) {
    const home = this.baseCenter[vehicle.side];
    if (!home) return null;
    if (vehicle._healing) {
      if (vehicle.hpRatio() >= 0.95) { vehicle._healing = false; }
      else return home;
    } else if (vehicle.hpRatio() < 0.55) {
      vehicle._healing = true;
      return home;
    }
    return null;
  }

  dispose() {
    if (!this.bases[0]) return;
    for (const b of this.basesList()) {
      for (const [v, mesh] of Array.from(b.repairBeams)) this._removeRepairBeam(b, v, mesh);
      b.shield.dispose();
    }
    this.game.scene.remove(this.group);
  }
}
