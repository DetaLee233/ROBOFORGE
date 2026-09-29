/* =========================================================
 *  track.js — 履带（运动部件）
 *  造价 = 车轮 ×1.5 = 45
 *  生命值 = 车轮 ×3 = 4500
 *  速度 = 旧版车轮速度（speedMul = 1，即新轮子的一半）
 *  稳定、耐久、转向略弱
 * ========================================================= */

const TRACK_W = CELL * 0.95;
const TRACK_H = CELL * 0.72;
const TRACK_L = CELL * 1.7;
const TRACK_BODY_GEO = new THREE.BoxGeometry(TRACK_W * 0.72, TRACK_H, TRACK_L);
const TRACK_BELT_GEO = new THREE.BoxGeometry(TRACK_W, TRACK_H * 0.5, TRACK_L * 1.05);
const TRACK_WHEEL_GEO = new THREE.CylinderGeometry(TRACK_H * 0.38, TRACK_H * 0.38, TRACK_W * 0.5, 12);

const TRACK_RADIUS = TRACK_H * 0.5;

class Track extends MovementPart {
  constructor() {
    super('track');
    this.maxHp = 4500;
    this.hp = 4500;
    this.mass = 3;
    this.cost = 45;
    this.radius = 1.45;
    this.drive = 1;
    this.steer = 0.85;                        // 履带转向略弱
    this.speedMul = 1;                        // 旧版车轮速度
    this.pivot = true;                        // 履带可原地转向
    this.yOffset = -CELL / 2;
    this.groundClearance = CELL / 2 + TRACK_RADIUS;
    this.groundExtend = TRACK_H * 0.5;
    this._spin = 0;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();

    const body = new THREE.Mesh(TRACK_BODY_GEO, Materials.get('track', team));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const belt = new THREE.Mesh(TRACK_BELT_GEO, Materials.get('trackBelt', team));
    group.add(belt);

    // 两端滚轮
    const wmat = Materials.get('barrel', team);
    for (const z of [-TRACK_L * 0.42, 0, TRACK_L * 0.42]) {
      const w = new THREE.Mesh(TRACK_WHEEL_GEO, wmat);
      w.rotation.z = Math.PI / 2;
      w.position.z = z;
      group.add(w);
    }
    this._belt = belt;
    return group;
  }

  update(dt) {
    if (!this.vehicle) return;
    // 履带转动无旋转体，用轻微起伏模拟
    this._spin += Math.abs(this.vehicle.speed) * dt;
  }
}

Track.RADIUS = TRACK_RADIUS;
