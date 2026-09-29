/* =========================================================
 *  shield.js — 球形能量护盾（独立可复用类）
 *  阵营屏障：友方载具/子弹可穿透，敌方被挡在球面外。
 *  后续可作为模块挂到载具上（只需传入 center/team）。
 * ========================================================= */

class Shield {
  constructor(opts) {
    opts = opts || {};
    this.team = opts.team;
    this.radius = opts.radius || 30 * CELL;
    this.center = (opts.center || new THREE.Vector3()).clone();
    this.color = opts.color !== undefined
      ? opts.color
      : (this.team === SIDE.PLAYER ? 0x4fd1ff : 0xff5a4a);
    this.enabled = true;

    this.group = new THREE.Group();
    this.group.name = 'shield';

    const geo = new THREE.SphereGeometry(this.radius, 28, 18);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: this.color, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false,
    }));
    this.group.add(this.mesh, this.wire);
    this.group.position.copy(this.center);
    this._pulse = 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
  }

  /** 是否阻挡某阵营的物体（友方穿透） */
  blocks(pos, team) {
    if (!this.enabled || team === this.team) return false;
    const dx = pos.x - this.center.x;
    const dy = pos.y - this.center.y;
    const dz = pos.z - this.center.z;
    return dx * dx + dy * dy + dz * dz < this.radius * this.radius;
  }

  /** 将物体沿法线推到护盾表面外（返回是否推挤） */
  pushOut(pos, team, pad) {
    if (!this.enabled || team === this.team) return false;
    pad = pad || 0;
    const dx = pos.x - this.center.x;
    const dy = pos.y - this.center.y;
    const dz = pos.z - this.center.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const r = this.radius + pad;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-4) {           // 恰好位于中心：沿 +Y 推出
      pos.y += r;
      return true;
    }
    const k = r / d;
    pos.x = this.center.x + dx * k;
    pos.y = this.center.y + dy * k;
    pos.z = this.center.z + dz * k;
    return true;
  }

  update(dt) {
    this._pulse += dt;
    const p = 0.5 + 0.5 * Math.sin(this._pulse * 2.2);
    this.mesh.material.opacity = 0.06 + p * 0.06;
    this.wire.material.opacity = 0.11 + p * 0.09;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.wire.material.dispose();
  }
}
