/* =========================================================
 *  tdmMode.js — 团队死斗模式
 *  规则：Arena 默认出生点，无屏障/无复活/无修复；
 *        一方全灭（或玩家阵亡）即结束。
 * ========================================================= */

class TdmMode extends GameMode {
  constructor(game) {
    super(game);
    this.name = 'tdm';
  }

  checkEnd(game) {
    if (game.aliveCount(SIDE.ENEMY) === 0) return SIDE.PLAYER;
    if (game.aliveCount(SIDE.PLAYER) === 0 ||
        (game.player && !game.player.alive)) return SIDE.ENEMY;
    return null;
  }
}
