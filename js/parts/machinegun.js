/* =========================================================
 *  machinegun.js — 机枪（武器）
 *  生命值 1000 · 质量 3 · 造价 20
 *  能量 1000 / 每次射击 20 / 每 50ms 一发 / 命中 50 伤害
 * ========================================================= */

class MachineGun extends Weapon {
  constructor() {
    super('machinegun');
    this.maxHp = 4000;              // hp x4
    this.hp = 4000;
    this.mass = 3;
    this.cost = 80;                 // 花费 x4
    this.radius = 1.6;              // 命中碰撞箱 3×3×3
    this.boxCollider = { x: 1.5, y: 1.5, z: 1.5 };
    this.footprint = Utils.boxFootprint(3);   // 放置占用 3×3×3 格
    this.damage = 200;              // 直击伤害
    this.energyCost = 5.8;          // 满射速下净耗能 ~16/s（满能量约 60 秒耗尽）
    this.aoeDamage = 10;            // 命中爆炸：范围伤害
    this.aoeMinDamage = 10;         // 爆炸为固定伤害
    this.aoeRadius = 0.75 * CELL;   // 爆炸半径 0.75 方块
    this.fireInterval = 0.05;
    this.maxEnergy = 1000;
    this.energy = 1000;
    this.regen = 100;
    this.range = 400;
    this.projectileSpeed = 400;      // 弹速翻倍

    // 后坐力 / 散布
    this.recoil = 0.012;
    this.baseSpread = 0.004;
    this.heatPerShot = 0.032;
    this.heatSpread = 0.055;
    this.coolRate = 0.55;
    this.fullRate = 80 / 3;        // ≈26.7 发/秒（4 把满射速；3 把仍 ~20/s，顶配射速 +33%）
    this.requiredCount = 4;         // 满射速需 4 把
  }

  createMesh() {
    return this.buildGunMesh({
      kind: 'machinegun',
      body: CELL * 1.5,          // 1.5×1.5×1.5 格
      barrelLen: CELL * 2.4,     // 枪管延长
      barrelR: CELL * 0.13,
      barrelY: CELL * 0.12,
    });
  }
}
