/* =========================================================
 *  leg.js — 机械腿（运动部件）
 *  造价 100 · 生命值 2000
 *  占地：宽 2 × 长 3 × 高 6 格
 *  单个即可前后左右移动（全向），可跳跃；Shift 助跑跳
 *  速度 = 车轮的 80%
 * ========================================================= */

const LEG_W = 2, LEG_L = 3, LEG_H = 6;
const LEG_FOOTPRINT = (() => {
  const fp = [];
  for (let dx = 0; dx < LEG_W; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 0; dy < LEG_H; dy++) fp.push([dx, dy, dz]);
  return fp;
})();

class Leg extends MovementPart {
  constructor() {
    super('leg');
    this.maxHp = 2000;
    this.hp = 2000;
    this.mass = 6;
    this.cost = 100;
    this.radius = 2.4;
    this.drive = 0;
    this.steer = 0;                 // 全向移动，不靠转向
    this.speedMul = 1.6;            // 车轮(2) 的 80%
    this.driveRating = 4;           // 一条腿 ≈ 4 个车轮的驱动当量
    this.pivot = true;
    this.isDrive = false;           // 非轮式
    this.jump = true;
    this.yOffset = 0;
    this.groundClearance = CELL / 2; // 锚点即腿底部
    this.groundExtend = 0;
    this.footprint = LEG_FOOTPRINT;
    this._phase = 0;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();
    const mat = Materials.get('leg', team);
    const joint = Materials.get('barrel', team);
    const box = (w, h, d, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    };

    // 髋部（固定）
    const hip = box(CELL * 1.5, CELL * 1.0, CELL * 2.0, mat);
    hip.position.set(0, CELL * 2.5, 0);
    group.add(hip);

    // 大腿枢轴（绕髋关节摆动）
    const upper = new THREE.Group();
    upper.position.set(0, CELL * 2.2, 0);
    const thigh = box(CELL * 0.8, CELL * 2.2, CELL * 0.9, mat);
    thigh.position.y = -CELL * 1.1;
    upper.add(thigh);

    // 小腿枢轴（绕膝关节摆动）
    const lower = new THREE.Group();
    lower.position.set(0, -CELL * 2.4, 0);
    const knee = box(CELL * 1.0, CELL * 0.8, CELL * 1.0, joint);
    lower.add(knee);
    const shin = box(CELL * 0.6, CELL * 1.8, CELL * 0.7, mat);
    shin.position.y = -CELL * 1.2;
    lower.add(shin);
    const foot = box(CELL * 1.2, CELL * 0.5, CELL * 1.7, joint);
    foot.position.y = -CELL * 2.6;
    lower.add(foot);

    upper.add(lower);
    group.add(upper);
    this._upper = upper;
    this._lower = lower;
    return group;
  }

  update(dt) {
    const v = this.vehicle;
    if (!v || !this._upper || !this._lower) return;

    const offset = (this.grid.x * 1.7 + this.grid.z * 2.3);
    const speed = Math.abs(v.speed || 0);
    this._phase += (speed * 0.35 + 0.6) * dt * 3.2;

    let targetUpper, targetLower;
    if (v.airborne) {
      // 跳跃姿态：收腿
      targetUpper = -0.7;
      targetLower = 1.15;
    } else {
      const moveAmt = Utils.clamp(speed / 8, 0, 1);
      const p = this._phase + offset;
      targetUpper = Math.sin(p) * 0.55 * moveAmt;
      targetLower = (-0.35 + Math.cos(p) * 0.55) * moveAmt;
    }
    const k = Math.min(1, dt * 12);
    this._upper.rotation.x += (targetUpper - this._upper.rotation.x) * k;
    this._lower.rotation.x += (targetLower - this._lower.rotation.x) * k;
  }
}

Leg.FOOTPRINT = LEG_FOOTPRINT;
