/* =========================================================
 *  laser.js — 工程激光（武器）
 *  生命值 4000 · 质量 3 · 造价 100
 *  能耗与机枪相同（5.8/发）；每把 8 发/秒，多把线性叠加（4 把 = 32 发/秒）
 *  持续照射淡绿色射线：命中敌军 64 伤害/发（512 DPS/把），命中友军 120 治疗/发
 *  命中目标时射线加粗；无后坐力；音效为电流声
 *  模型：浅红色底座 + 十字交叉的两根长方体炮管
 * ========================================================= */

class EngineeringLaser extends Weapon {
  constructor() {
    super('laser');
    this.maxHp = 4000;
    this.hp = 4000;
    this.mass = 3;
    this.cost = 100;
    this.radius = 1.6;              // 命中碰撞箱 3×3×3
    this.boxCollider = { x: 1.5, y: 1.5, z: 1.5 };
    this.footprint = Utils.boxFootprint(3);

    // 射线：直伤 / 治疗（每发）
    this.damage = 64;               // 原 80 × 0.8
    this.healAmount = 120;          // 原 150 × 0.8
    this.beam = true;               // 射线类武器：走 _fireLasers 持续照射路径
    this.beamColor = 0x9dffb0;      // 浅绿色
    this.beamRadius = CELL * 0.06;  // 细指示线（命中目标时加粗）

    // 能量 / 射速（与机枪同能耗；每把 8 发/秒，线性叠加）
    this.energyCost = 5.8;
    this.fireInterval = 0.125;
    this.maxEnergy = 1000;
    this.energy = 1000;
    this.regen = 100;
    this.range = 400;
    this.projectileSpeed = 2000;    // 近似即时命中（供 AI 预判提前量）

    // 射线无散布、无后坐力，仅极小的热量累积
    this.recoil = 0;
    this.baseSpread = 0;
    this.heatPerShot = 0.005;
    this.heatSpread = 0;
    this.coolRate = 0.6;
    this.fullRate = 8;              // 单武器 8 发/秒
    this.ratePerGun = 8;            // 每把贡献 8 发/秒（线性叠加）
    this.requiredCount = 1;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const bs = CELL * 1.5;          // 底座 1.5 格
    const bl = CELL * 2.2;          // 炮管长 2.2 格
    const bt = CELL * 0.16;         // 杆厚

    const group = this.buildGunMesh({ kind: 'laser', body: bs, barrelLen: bl, noBarrel: true });

    // 十字交叉的两根长方体炮管（正视呈 + 形）
    const mk = (rotZ) => {
      const rod = new THREE.Mesh(
        new THREE.BoxGeometry(bt, bt, bl),
        Materials.get('barrel', team)
      );
      rod.rotation.z = rotZ;
      rod.position.set(0, 0, bs / 2 + bl / 2);
      rod.castShadow = true;
      group.add(rod);
      return rod;
    };
    mk(0);          // 横杆
    mk(Math.PI / 2); // 竖杆

    // 炮口十字准星环（发光点缀）
    const tip = new THREE.Mesh(
      new THREE.TorusGeometry(bt * 2.2, bt * 0.4, 6, 12),
      Materials.get('laser', team)
    );
    tip.position.set(0, 0, bs / 2 + bl);
    group.add(tip);

    return group;
  }
}
