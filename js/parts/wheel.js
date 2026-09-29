/* =========================================================
 *  wheel.js — 车轮（运动部件）
 *  生命值 1500 · 质量 2 · 造价 30
 *  速度倍率 2（相对旧版车轮翻倍）
 *  模型与碰撞体向下偏移半格，提升越野通过性
 * ========================================================= */

const WHEEL_RADIUS = CELL * 0.72;   // 轮子外半径
const WHEEL_WIDTH = CELL * 0.62;    // 轮宽
const WHEEL_GEO = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 20);
const WHEEL_TIRE_GEO = new THREE.TorusGeometry(WHEEL_RADIUS * 0.76, WHEEL_RADIUS * 0.22, 10, 20);
const WHEEL_HUB_GEO = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.3, WHEEL_RADIUS * 0.3, WHEEL_WIDTH * 1.05, 12);

class Wheel extends MovementPart {
  constructor() {
    super('wheel');
    this.maxHp = 1500;
    this.hp = 1500;
    this.mass = 2;
    this.cost = 30;
    this.radius = 1.35;
    this.drive = 1;
    this.steer = 1;
    this.speedMul = 2;                        // 速度 ×2
    this.yOffset = -CELL / 2;                 // 下移半格
    this.groundClearance = CELL / 2 + WHEEL_RADIUS;
    this.groundExtend = WHEEL_RADIUS;         // 网格底边之下为轮半径
    this._spin = 0;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();

    const spinner = new THREE.Group();       // 绕 X 轴滚动
    const tire = new THREE.Mesh(WHEEL_GEO, Materials.get('wheel', team));
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    spinner.add(tire);

    const tread = new THREE.Mesh(WHEEL_TIRE_GEO, Materials.get('barrel', team));
    tread.rotation.y = Math.PI / 2;
    spinner.add(tread);

    const hub = new THREE.Mesh(WHEEL_HUB_GEO, Materials.get('barrel', team));
    hub.rotation.z = Math.PI / 2;
    spinner.add(hub);

    group.add(spinner);
    this._spinner = spinner;
    return group;
  }

  update(dt) {
    if (!this.vehicle || !this._spinner) return;
    this._spin -= this.vehicle.speed * dt * 1.4;
    this._spinner.rotation.x = this._spin;
  }
}

Wheel.RADIUS = WHEEL_RADIUS;
