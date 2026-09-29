/* =========================================================
 *  battery.js — 武器备用能源模块（功能模块）
 *  生命值 1000 · 质量 2 · 造价 200
 *  效果（存在至少一台即生效，多台不叠加、不增补能量量）：
 *    · 按下武器切换键时触发：立即 +800 能量
 *    · 随后立刻切回切换前的武器（即本次切换被消耗）
 *    · 冷却 12 秒（整台载具共享）
 * ========================================================= */

const BATTERY_GEO = new THREE.BoxGeometry(CELL * 2.8, CELL * 2.8, CELL * 2.8);
const BATTERY_CELL_GEO = new THREE.BoxGeometry(CELL * 0.4, CELL * 2.0, CELL * 0.18);

class BackupBattery extends Part {
  constructor() {
    super('battery');
    this.maxHp = 1000;
    this.hp = 1000;
    this.mass = 2;
    this.cost = 200;
    this.radius = 1.6;               // 命中碰撞箱 3×3×3
    this.boxCollider = { x: 1.5, y: 1.5, z: 1.5 };
    this.footprint = Utils.boxFootprint(3);   // 放置占用 3×3×3 格
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();

    const body = new THREE.Mesh(BATTERY_GEO, Materials.get('battery', team));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const cellMat = Materials.get('batteryCell', team);
    for (let i = -1; i <= 1; i++) {
      const cell = new THREE.Mesh(BATTERY_CELL_GEO, cellMat);
      cell.position.set(i * CELL * 0.7, 0, CELL * 1.42);
      group.add(cell);
    }
    return group;
  }
}
