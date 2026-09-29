/* =========================================================
 *  capture.js — 夺点模式
 *  三个镜像对称的得分点 + 两个对角基地。
 *  占领得分点为所属阵营累积“结束进度”；占满 3 点解除对方基地护盾，
 *  此后可攻击对方基地八面体倒扣进度（1% = 1000 血）。
 * ========================================================= */

const CAPTURE = {
  CAPTURE_TIME: 15,        // 占领耗时（秒）
  RESPAWN_TIME: 10,        // 阵亡复活等待（秒）
  REPAIR_TIME: 3,          // 回到出生点修复耗时（秒）
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
  BASE_OFFSET: 0.6,        // 基地距中心的比例（对角）
  NEAR_OFFSET: 0.36,       // 近点/中点距中心的比例
};

const CAP_COLORS = { 0: 0x4fd1ff, 1: 0xff5a4a };
const CAP_WHITE = 0xffffff;

/* ---------------- 得分点 ---------------- */

class CapturePoint {
  constructor(x, y, z) {
    this.position = new THREE.Vector3(x, y, z);
    this.radius = CAPTURE.POINT_RADIUS * CELL;
    this.owner = null;          // null | SIDE.*
    this.progress = 0;          // 0..1
    this.progressTeam = null;
    this.presentCount = 0;
    this.contested = false;

    this.group = new THREE.Group();
    this._rings = [];
    for (let i = 0; i < 3; i++) {
      const r = this.radius * (0.55 + i * 0.22);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.3 * CELL, 8, 40),
        new THREE.MeshBasicMaterial({ color: CAP_WHITE, transparent: true, opacity: 0.45, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.8 + i * 0.2;
      this.group.add(ring);
      this._rings.push(ring);
    }

    this.arcMat = new THREE.MeshBasicMaterial({
      color: CAP_WHITE, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false,
    });
    this.arc = new THREE.Mesh(this._arcGeo(0.001), this.arcMat);
    this.arc.rotation.x = -Math.PI / 2;
    this.arc.position.y = 1.5;
    this.group.add(this.arc);

    this.group.position.copy(this.position);
    this._lastArc = -1;
    this._lastColor = -1;
  }

  _arcGeo(len) {
    return new THREE.RingGeometry(this.radius * 0.72, this.radius * 0.92, 40, 1, Math.PI / 2, len);
  }

  update(dt, vehicles) {
    const present = new Set();
    for (const v of vehicles) {
      if (!v.alive) continue;
      const dx = v.position.x - this.position.x;
      const dy = v.position.y - this.position.y;
      const dz = v.position.z - this.position.z;
      if (dx * dx + dy * dy + dz * dz <= this.radius * this.radius) present.add(v.side);
    }
    this.presentCount = present.size;
    this.contested = present.size > 1;

    let team = null;
    if (present.size === 1) team = present.values().next().value;

    if (team !== null && this.owner !== team) {
      if (this.progressTeam === team) {
        this.progress += dt / CAPTURE.CAPTURE_TIME;
        if (this.progress >= 1) { this.progress = 1; this.owner = team; }
      } else {
        // 先中立化原有归属，再开始占领
        this.progress = Math.max(0, this.progress - dt / CAPTURE.CAPTURE_TIME);
        if (this.progress <= 0) this.progressTeam = team;
      }
    } else if (team !== null && this.owner === team) {
      this.progress = 1;
    } else if (present.size === 0 && this.owner === null && this.progress > 0) {
      this.progress = Math.max(0, this.progress - dt / (CAPTURE.CAPTURE_TIME * 4));
      if (this.progress <= 0) this.progressTeam = null;
    }

    this._visual();
  }

  _visual() {
    const capped = this.owner !== null && this.progress >= 1;
    const procColor = this.progressTeam !== null ? CAP_COLORS[this.progressTeam] : CAP_WHITE;

    for (const ring of this._rings) {
      ring.material.color.setHex(capped ? CAP_COLORS[this.owner] : CAP_WHITE);
      ring.material.opacity = capped ? 0.75 : 0.4;
    }

    // 未完全归属（占领中 / 被中立化中）时显示环形进度
    this.arc.visible = !capped && this.progress > 0.01;
    if (this.arc.visible &&
        (Math.abs(this.progress - this._lastArc) > 0.01 || procColor !== this._lastColor)) {
      this._lastArc = this.progress;
      this._lastColor = procColor;
      this.arc.geometry.dispose();
      this.arc.geometry = this._arcGeo(Math.max(0.001, this.progress * Math.PI * 2));
      this.arc.material.color.setHex(procColor);
    }
  }
}

/* ---------------- 夺点模式管理 ---------------- */

class CaptureMode {
  constructor(game) {
    this.game = game;
    this.arena = game.arena;
    this.group = new THREE.Group();
    this.group.name = 'capture';
    game.scene.add(this.group);

    this.bases = {};
    this.points = [];
    this.baseCenter = {};
    this.winner = null;
    this.time = 0;
    this._build();
  }

  /** 目标区域（基地/得分点）——供 Arena 生成掩体时排除 */
  static zones(half) {
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
  spawnPoints(team) {
    const c = this.baseCenter[team];
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

  update(dt, vehicles) {
    this.time += dt;
    for (const cp of this.points) cp.update(dt, vehicles);

    const counts = { 0: 0, 1: 0 };
    for (const cp of this.points) if (cp.owner !== null) counts[cp.owner]++;

    for (const team of [0, 1]) {
      const b = this.bases[team];
      const enemy = team === 0 ? 1 : 0;
      b.owned = counts[team];
      if (counts[team] > 0) b.everOwned = true;

      if (!b.destroyed) {
        b.progress = Math.min(CAPTURE.WIN_PROGRESS, b.progress + counts[team] * dt / CAPTURE.UNIT_TIME);
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
  }

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

  /** 供 Game 做护盾/八面体判定 */
  basesList() { return [this.bases[0], this.bases[1]]; }

  snapshot() {
    return {
      blue: this.bases[0].progress,
      red: this.bases[1].progress,
      points: this.points.map((p) => p.owner),
      contested: this.points.map((p) => p.contested),
    };
  }

  dispose() {
    this.bases[0].shield.dispose();
    this.bases[1].shield.dispose();
    this.game.scene.remove(this.group);
  }
}
