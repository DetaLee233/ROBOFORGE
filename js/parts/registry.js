/* =========================================================
 *  registry.js — 零件注册表
 *  编辑器 / 载具工厂通过类型字符串创建零件
 *  新增零件：新建 js 文件后，在此登记即可
 * ========================================================= */

const PartRegistry = {
  classes: {
    block: Block,
    reinforced: ReinforcedBlock,
    wheel: Wheel,
    track: Track,
    leg: Leg,
    rotor: Rotor,
    machinegun: MachineGun,
    grenade: GrenadeLauncher,
    railgun: Railgun,
    laser: EngineeringLaser,
    computer: BallisticsComputer,
    battery: BackupBattery,
  },

  meta: {
    block:      { name: '装甲方块',   cost: 1,   hp: 200,  mass: 1,   category: 'structure', swatch: '#ffffff', desc: '基础结构' },
    reinforced: { name: '强化装甲',   cost: 3,   hp: 400,  mass: 1.5, category: 'structure', swatch: '#cccccc', desc: '2 倍血量' },
    wheel:      { name: '车轮',       cost: 30,  hp: 1500, mass: 2,   category: 'movement',  swatch: '#2a2f37', desc: '高速机动' },
    track:      { name: '履带',       cost: 45,  hp: 4500, mass: 3,   category: 'movement',  swatch: '#3a3f47', desc: '重装·可原地转向' },
    leg:        { name: '机械腿',     cost: 100, hp: 2000, mass: 6,   category: 'movement',  swatch: '#4a4f57', desc: '全向移动·跳跃（2×3×6）', footprint: LEG_FOOTPRINT },
    rotor:      { name: '旋翼',       cost: 80,  hp: 1500, mass: 3,   category: 'movement',  swatch: '#5a6a78', desc: '飞行·≥2 可控（5×5×1）', footprint: ROTOR_FOOTPRINT },
    machinegun: { name: '机枪',       cost: 80,  hp: 4000, mass: 3,   category: 'weapon',    swatch: '#5b6673', desc: '连射武器', footprint: Utils.boxFootprint(3) },
    grenade:    { name: '榴弹炮',     cost: 240, hp: 4800, mass: 5,   category: 'weapon',    swatch: '#4e6b3a', desc: '爆炸溅射', footprint: Utils.boxFootprint(3) },
    railgun:    { name: '充能射线炮', cost: 300, hp: 2000, mass: 6,   category: 'weapon',    swatch: '#6a5acd', desc: '蓄力光束·穿透', footprint: Utils.boxFootprint(3) },
    laser:      { name: '工程激光',   cost: 100, hp: 4000, mass: 3,   category: 'weapon',    swatch: '#8affa0', desc: '射线·伤敌 80/疗友 150 每发', footprint: Utils.boxFootprint(3) },
    computer:   { name: '弹道计算机', cost: 100, hp: 500,  mass: 1,   category: 'module',    swatch: '#2f6f7a', desc: '能量-200 / 后坐·散布-50%', footprint: Utils.boxFootprint(3) },
    battery:    { name: '备用能源',   cost: 200, hp: 1000, mass: 2,   category: 'module',    keyed: true, swatch: '#7a5a2f', desc: '按键触发 +800 能量（带按键）', footprint: Utils.boxFootprint(3) },
  },

  order: ['block', 'reinforced', 'wheel', 'track', 'leg', 'rotor', 'machinegun', 'grenade', 'railgun', 'laser', 'computer', 'battery'],

  categories: [
    { id: 'structure', name: '结构' },
    { id: 'movement',  name: '运动部件' },
    { id: 'weapon',    name: '武器' },
    { id: 'module',    name: '功能模块' },
  ],

  has(type) {
    return !!this.classes[type];
  },

  costOf(type) {
    const m = this.meta[type];
    return m ? m.cost : 0;
  },

  hpOf(type) {
    const m = this.meta[type];
    return m ? m.hp : 0;
  },

  categoryOf(type) {
    const m = this.meta[type];
    return m ? m.category : 'structure';
  },

  isWeapon(type) {
    return this.categoryOf(type) === 'weapon';
  },

  /** 带按键的部件（武器，或标记 keyed 的特殊模块，如备用能源） */
  isKeyed(type) {
    const m = this.meta[type];
    return this.isWeapon(type) || !!(m && m.keyed);
  },

  /** 部件占用的网格单元（旋转前）；默认单格 */
  footprint(type) {
    const m = this.meta[type];
    return (m && m.footprint) || [[0, 0, 0]];
  },

  create(type) {
    const Cls = this.classes[type];
    if (!Cls) throw new Error('未知零件类型: ' + type);
    return new Cls();
  },

  /** 编辑器用的调色板数据（按分类分组） */
  palette() {
    return this.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      items: this.order
        .filter((type) => this.meta[type].category === cat.id)
        .map((type) => {
          const m = this.meta[type];
          return { type, name: m.name, cost: m.cost, hp: m.hp, swatch: m.swatch, desc: m.desc };
        }),
    }));
  },
};
