/* =========================================================
 *  capturePoint.js — 得分点（夺点模式）
 *  半径10格球形判定圈；独占时 15 秒占领，双方在场则暂停；
 *  已被占领的点可被中立化后重新占领；环形进度条显示归属进度。
 * ========================================================= */

const CAP_COLORS = { 0: 0x4fd1ff, 1: 0xff5a4a };
const CAP_WHITE = 0xffffff;

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
