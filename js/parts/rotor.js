/* =========================================================
 *  rotor.js — 旋翼（运动部件）
 *  占地：宽 5 × 长 5 × 高 1 格（碰撞体 5×5×1）
 *  连接点位于 5×5 平面外圈
 *  共轴上下两层十字桨叶高速反向旋转
 *  至少两个旋翼载具才可控；移动方式同机械腿（全向）+ 空格升高 / Shift 降低
 * ========================================================= */

const ROTOR_W = 5, ROTOR_L = 5, ROTOR_H = 1;
const ROTOR_FOOTPRINT = (() => {
  const fp = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) fp.push([dx, 0, dz]);
  return fp;
})();

class Rotor extends MovementPart {
  constructor() {
    super('rotor');
    this.maxHp = 1500;
    this.hp = 1500;
    this.mass = 3;
    this.cost = 80;
    this.radius = 2.8;
    this.drive = 0;
    this.steer = 0;
    this.speedMul = 1.6;            // 与机械腿一致
    this.driveRating = 4;
    this.pivot = false;
    this.isDrive = false;
    this.flying = true;             // 提供升力
    this.jump = false;
    this.yOffset = 0;
    this.groundClearance = CELL / 2;
    this.groundExtend = 0;
    this.footprint = ROTOR_FOOTPRINT;
    this._spin = 0;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();
    const hubMat = Materials.get('rotor', team);
    const bladeMat = Materials.get('rotorBlade', team);

    const makeCross = (y) => {
      const g = new THREE.Group();
      const armA = new THREE.Mesh(new THREE.BoxGeometry(CELL * 4.6, 0.22, 0.7), bladeMat);
      const armB = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, CELL * 4.6), bladeMat);
      armA.castShadow = true; armB.castShadow = true;
      g.add(armA); g.add(armB);
      g.position.y = y;
      return g;
    };
    const top = makeCross(0.45);
    const bottom = makeCross(-0.45);
    group.add(top); group.add(bottom);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), hubMat);
    hub.castShadow = true;
    group.add(hub);

    // 外圈连接环（5×5 外沿），提示连接点
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(CELL * 2.2, 0.08, 6, 24),
      Materials.get('rotorRing', team)
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    this._top = top;
    this._bottom = bottom;
    return group;
  }

  update(dt) {
    const spin = 42;
    if (this._top) this._top.rotation.y += spin * dt;
    if (this._bottom) this._bottom.rotation.y -= spin * dt;
  }
}

Rotor.FOOTPRINT = ROTOR_FOOTPRINT;
