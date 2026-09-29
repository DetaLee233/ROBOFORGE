/* =========================================================
 *  grenade.js — 榴弹炮（武器）
 *  生命值 4800 · 质量 5 · 造价 240
 *  能量 1000 / 每发 75 / 每 250ms 一发
 *  命中后爆炸：直击 800 伤害，9.6 方块半径内 93 范围伤害（外围 3）
 *  弹速高、下坠弱；有弹道计算机时自动反解，无则由玩家按仰角估算射程
 * ========================================================= */

class GrenadeLauncher extends Weapon {
  constructor() {
    super('grenade');
    this.maxHp = 4800;              // hp x4
    this.hp = 4800;
    this.mass = 5;
    this.cost = 240;                // 花费 x4
    this.radius = 1.6;              // 命中碰撞箱 3×3×3
    this.boxCollider = { x: 1.5, y: 1.5, z: 1.5 };
    this.footprint = Utils.boxFootprint(3);   // 放置占用 3×3×3 格

    // 伤害（x4；爆炸按半径递减，最外围仅 10）
    this.damage = 1600 / 2;         // 直击伤害（砍半，原 1600）
    this.aoeDamage = 280 / 3;       // 爆炸中心伤害（原 1/3）
    this.aoeMinDamage = 10 / 3;     // 爆炸最外围伤害（原 1/3）
    this.aoeRadius = CELL * 16 * 0.6;  // 爆炸范围缩至原 60%（16 格 -> 9.6 格）

    // 能量 / 射速
    this.maxEnergy = 1000;
    this.energy = 1000;
    this.regen = 100;
    this.energyCost = 75;           // 能耗砍半（原 150）
    this.fireInterval = 0.25;       // 射速翻倍（原 0.5s）

    // 弹道：中高速 + 中等重力 -> 平射可及远、抬升增程
    this.range = 720;               // 满地图（障碍无阻时可贯穿整场）
    this.projectileSpeed = 200;     // 弹速大幅提高（原 80）
    this.projectileGravity = 26;    // 下坠减弱（原 38）
    this.projectileShape = 'shell';
    this.projectileScale = 1.2;
    this.lobbed = true;             // 曲射：瞄准点按抛物线落向地面

    // 后坐力 / 散布
    this.recoil = 0.03;
    this.baseSpread = 0.002;
    this.heatPerShot = 0.1;
    this.heatSpread = 0.03;
    this.coolRate = 0.5;
    this.fullRate = 4;              // 满射速 4 发/秒（单枪满速；≥2 把达到）
    this.requiredCount = 2;         // 至少 2 把达到满射速
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = this.buildGunMesh({
      kind: 'grenade',
      body: CELL * 2.5,            // 2.5×2.5×2.5 格
      barrelLen: CELL * 1.8,
      barrelR: CELL * 0.26,        // 枪管加粗
      barrelY: 0,
    });

    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.5, CELL * 0.5, CELL * 0.4, 12),
      Materials.get('barrel', team)
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -CELL * 0.2, -CELL * 0.35);
    drum.castShadow = true;
    group.add(drum);

    return group;
  }
}
