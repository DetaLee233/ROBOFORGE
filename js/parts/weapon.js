/* =========================================================
 *  weapon.js — 武器基类
 *  所有武器继承此类；新增武器只需新建一个 js 文件：
 *     class Xxx extends Weapon { ... }
 *  能量机制：总量 1000，每秒恢复 100，射击消耗 energyCost
 * ========================================================= */

class Weapon extends Part {
  constructor(type) {
    super(type);
    // 能量
    this.maxEnergy = 1000;
    this.energy = 1000;
    this.regen = 100;        // 每秒恢复
    this.energyCost = 20;    // 每次射击消耗
    // 射击
    this.damage = 50;
    this.fireInterval = 0.05; // 50ms 连射间隔
    this.range = 170;
    this.projectileSpeed = 150;
    this.cooldown = 0;
    this.wantFire = false;    // 是否请求开火（由输入 / AI 设置）
    this.muzzleObj = null;
    this._muzzleLocal = new THREE.Vector3(0, 0, CELL * 0.9);

    // 后坐力 / 散布
    this.recoil = 0.008;      // 每发对视角的后坐力（弧度）
    this.baseSpread = 0.003;  // 基础散布（弧度）
    this.heat = 0;            // 连射热度 0..1
    this.heatPerShot = 0.03;  // 每发热度
    this.heatSpread = 0.05;   // 满热度额外散布
    this.coolRate = 0.6;      // 每秒冷却

    // 弹丸特性（供子类覆写）
    this.projectileGravity = BALLISTIC_GRAVITY;
    this.projectileShape = 'tracer';  // 'tracer' | 'shell'
    this.projectileScale = 1;
    this.aoeDamage = 0;               // 爆炸范围伤害
    this.aoeRadius = 0;               // 爆炸半径（世界单位）

    this.key = 1;                     // 武器按键分组：1 / 2 / 3
    this.fullRate = 20;               // 满射速（发/秒）
    this.requiredCount = 1;           // 达到满射速所需数量
  }

  createMesh() {
    throw new Error('Weapon.createMesh() not implemented for ' + this.type);
  }

  /** 当前散布角（弧度） */
  getSpread() {
    return this.baseSpread + this.heat * this.heatSpread;
  }

  /**
   * 通用炮体 + 枪管
   * opts: { kind, body, barrelLen, barrelR, barrelY }
   * 炮口位于 (0, barrelY, body/2 + barrelLen)
   */
  buildGunMesh(opts) {
    opts = (typeof opts === 'string') ? { kind: opts } : (opts || {});
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const group = new THREE.Group();

    const bs = opts.body || CELL * 0.8;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bs, bs * 0.9, bs),
      Materials.get(opts.kind || 'machinegun', team)
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const bl = opts.barrelLen || CELL * 0.9;
    const br = opts.barrelR || CELL * 0.12;
    const by = opts.barrelY || 0;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(br * 0.85, br, bl, 12),
      Materials.get('barrel', team)
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, by, bs / 2 + bl / 2);
    barrel.castShadow = true;
    group.add(barrel);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, by, bs / 2 + bl);
    group.add(muzzle);
    this.muzzleObj = muzzle;

    return group;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.heat > 0) this.heat = Math.max(0, this.heat - this.coolRate * dt);
    // 无载具时（测试/独立使用）才在武器自身回能；有载具时由载具统一回能
    if (!this.vehicle && this.energy < this.maxEnergy) {
      this.energy = Math.min(this.maxEnergy, this.energy + this.regen * dt);
    }
  }

  canFire() {
    if (this.destroyed || this.cooldown > 0) return false;
    const pool = this.vehicle ? this.vehicle.weaponEnergy : this.energy;
    return pool >= this.energyCost;
  }

  /** 扣冷却与能量（真正开火时调用；有载具时从共享能量池扣除） */
  consumeShot() {
    if (this.vehicle) {
      this.vehicle.weaponEnergy = Math.max(0, this.vehicle.weaponEnergy - this.energyCost);
    } else {
      this.energy = Math.max(0, this.energy - this.energyCost);
    }
    this.cooldown = this.fireInterval;
    this.heat = Math.min(1, this.heat + this.heatPerShot);
  }

  energyRatio() {
    if (this.vehicle) return this.vehicle.weaponMaxEnergy > 0 ? this.vehicle.weaponEnergy / this.vehicle.weaponMaxEnergy : 0;
    return this.maxEnergy > 0 ? this.energy / this.maxEnergy : 0;
  }

  getMuzzleWorld(target) {
    target = target || new THREE.Vector3();
    if (this.muzzleObj) this.muzzleObj.getWorldPosition(target);
    else this.worldPosition(target);
    return target;
  }
}
