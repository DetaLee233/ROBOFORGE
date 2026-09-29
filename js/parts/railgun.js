/* =========================================================
 *  railgun.js — 充能射线炮（武器）
 *  按住蓄力消耗能量，松开发射射线；冷却 1 秒
 *  · 3 秒蓄满（在有弹道计算机的能量上限下耗尽全部能量）
 *  · 蓄力时炮口射出白色细射线，松手变成圆柱光束并在 0.3s 内淡出
 *  · 圆柱半径随蓄力时间递减（1 方块 → 最小 0.1 方块）
 *  · 命中：光束覆盖区域 100 伤害；射线中心穿过的部位额外 150
 *    伤害随蓄力时间缩短而降低，最低 10 + 15
 *  · 散布由发射瞬间机体的加速度决定（越快越飘）
 *  · 被击毁的方块有 10% 概率爆炸（3 方块范围，50 不分敌我伤害）
 *  造价 300 · 满射速只需 1 把
 * ========================================================= */

const RAILGUN_BASE_GEO = new THREE.BoxGeometry(CELL * 2.6, CELL * 0.5, CELL * 2.6);
const RAILGUN_WALL_GEO = new THREE.BoxGeometry(CELL * 0.5, CELL * 1.1, CELL * 2.6);
const RAILGUN_RAIL_GEO = new THREE.BoxGeometry(CELL * 0.5, CELL * 0.28, CELL * 3.2);
const RAILGUN_SIDE_GEO = new THREE.BoxGeometry(CELL * 1.6, CELL * 0.28, CELL * 0.4);
const RAILGUN_ARC_GEO = new THREE.BoxGeometry(0.12, CELL * 0.7, 0.12);

class Railgun extends Weapon {
  constructor() {
    super('railgun');
    this.maxHp = 2000;
    this.hp = 2000;
    this.mass = 6;
    this.cost = 300;
    this.radius = 2.0;
    this.boxCollider = { x: 2.5, y: 1.5, z: 2.5 };   // 碰撞箱 5×5×3
    this.footprint = Utils.boxFootprint(3);

    this.charge = true;             // 蓄力武器（不走普通齐射）
    this.fireInterval = 1.0;         // 冷却 1 秒
    this.maxCharge = 3.0;            // 3 秒蓄满
    this.chargeDrain = 220;          // 蓄力耗能（/秒，独立于能量池上限）
    this.range = 300;

    this.damage = 400;               // 光束覆盖区伤害（满蓄力）
    this.centerDamage = 600;         // 射线中心额外伤害（满蓄力）
    this.minArea = 10;               // 最低覆盖伤害
    this.minCenter = 15;             // 最低中心附加
    this.baseRadius = CELL * 1.5;    // 满蓄力半径（1.5 方块）
    this.minRadius = CELL * 0.15;    // 短蓄力最小半径（0.15 方块）

    // 散布来自机体加速度
    this.baseSpread = 0.006;
    this.accelSpread = 0.02;

    this.fullRate = 1;
    this.requiredCount = 1;
    this._arcs = [];
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();
    const baseMat = Materials.get('railgun', team);
    const railMat = Materials.get('railgunRail', team);
    const arcMat = Materials.get('railgunArc', team);

    // U 形底座
    const plate = new THREE.Mesh(RAILGUN_BASE_GEO, baseMat);
    plate.position.y = -CELL * 0.7;
    group.add(plate);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(RAILGUN_WALL_GEO, baseMat);
      wall.position.set(s * CELL * 1.05, -CELL * 0.05, 0);
      group.add(wall);
    }

    // 上下两条 U 形轨道（炮管）
    for (const sy of [CELL * 0.35, -CELL * 0.35]) {
      const rail = new THREE.Mesh(RAILGUN_RAIL_GEO, railMat);
      rail.position.set(0, sy, CELL * 0.2);
      group.add(rail);
    }
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(RAILGUN_SIDE_GEO, baseMat);
      side.position.set(s * CELL * 0.55, CELL * 0.02, -CELL * 1.1);
      group.add(side);
    }

    // 轨道间跳动的电弧
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(RAILGUN_ARC_GEO, arcMat);
      arc.position.set((i - 1.5) * CELL * 0.35, 0, CELL * 0.2 + (i % 2 ? 0.3 : -0.3));
      group.add(arc);
      this._arcs.push(arc);
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    // 电弧跳动
    for (const a of this._arcs) {
      a.scale.y = 0.6 + Math.random() * 0.9;
      a.position.x += (Math.random() - 0.5) * 0.05;
    }
  }
}
