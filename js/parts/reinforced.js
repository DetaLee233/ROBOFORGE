/* =========================================================
 *  reinforced.js — 强化装甲方块
 *  造价 3 · 生命值 400（普通方块的 2 倍）
 * ========================================================= */

class ReinforcedBlock extends Block {
  constructor() {
    super();
    this.type = 'reinforced';
    this.maxHp = 400;
    this.hp = 400;
    this.mass = 1.5;
    this.cost = 3;
    this.radius = 1.05;
  }
}
