/* =========================================================
 *  computer.js — 弹道计算机（功能模块）
 *  生命值 500 · 质量 1 · 造价 100
 *  效果（存在至少一台即生效，多台不叠加）：
 *    · 武器能量上限 -200
 *    · 后坐力 -50%
 *    · 弹道散布 -50%
 *  全部被摧毁后效果消失。
 * ========================================================= */

const COMPUTER_GEO = new THREE.BoxGeometry(CELL * 2.8, CELL * 2.8, CELL * 2.8);
const COMPUTER_LENS_GEO = new THREE.CylinderGeometry(CELL * 0.6, CELL * 0.6, CELL * 0.25, 16);

class BallisticsComputer extends Part {
  constructor() {
    super('computer');
    this.maxHp = 500;
    this.hp = 500;
    this.mass = 1;
    this.cost = 100;
    this.radius = 1.6;               // 命中碰撞箱 3×3×3
    this.boxCollider = { x: 1.5, y: 1.5, z: 1.5 };
    this.footprint = Utils.boxFootprint(3);   // 放置占用 3×3×3 格
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();

    const body = new THREE.Mesh(COMPUTER_GEO, Materials.get('computer', team));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lens = new THREE.Mesh(COMPUTER_LENS_GEO, Materials.get('computerLens', team));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, CELL * 0.3, CELL * 1.35);
    group.add(lens);

    return group;
  }
}
