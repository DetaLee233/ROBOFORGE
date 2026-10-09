/* =========================================================
 *  gameMode.js — 对局模式基类（策略接口）
 *  Game 只负责通用对局服务；模式差异由子类（TdmMode / CaptureMode）实现。
 *  所有钩子都有默认实现，子类按需覆盖。
 * ========================================================= */

class GameMode {
  constructor(game) {
    this.game = game;
    this.name = 'mode';
  }

  /** 生成 Arena 时需排除的区域（如目标区），返回 [{x,z,r}] 或 null */
  arenaExclusions(half) { return null; }

  /** 生成模式专属实体/网格（此时 game.arena 已就绪） */
  build(scene, game) {}

  /** 清理模式资源 */
  dispose() {}

  /** 某阵营出生位（默认用 Arena 出生点） */
  spawnPoints(game, side) { return game.arena.spawnPoints(side); }

  /** 每帧模式逻辑 */
  update(dt, game) {}

  /** 载具被摧毁（用于复活队列等） */
  onVehicleDestroyed(vehicle, game) {}

  /** 载具与模式屏障（护盾）的碰撞推出 */
  resolveShields(game) {}

  /** 子弹与模式屏障/目标的交互，返回 true 表示子弹被消耗 */
  blockProjectile(projectile, game) { return false; }

  /** 光束与模式屏障/目标的交互，返回 true 表示光束被拦截 */
  blockBeam(a, b, radius, areaDmg, centerDmg, team, game) { return false; }

  /**
   * 射线类武器（工程激光）的屏障检测。
   * 返回 null 表示畅通；否则 { dist, baseTeam? } —— 射线止于 dist 处，
   * baseTeam 存在表示该处是暴露的敌方基地八面体（由调用方结算伤害）。
   */
  beamStop(origin, dir, maxDist, team, game) { return null; }

  /** 返回获胜阵营 SIDE，或 null 表示未结束 */
  checkEnd(game) { return null; }

  /** 传入 HUD 的状态片段 */
  status() { return { mode: this.name, capture: null }; }

  /** AI 的战术目标点（默认无） */
  objectiveFor(vehicle) { return null; }

  /** AI 需要回出生点修复时返回该点，否则 null */
  repairObjectiveFor(vehicle) { return null; }

  /**
   * ESC 暂停菜单配置（各模式可覆写，HUD 按此显示按钮）。
   * 返回 { title, sub, canResume, selfDestruct, ... }；新模式可增删自己的按钮。
   */
  pauseMenu() {
    return {
      title: '暂停',
      sub: '按 ESC 或“继续战斗”回到战场',
      canResume: true,
      selfDestruct: false,
    };
  }

  /**
   * AI 自毁询问：无助（无法移动+无法攻击）或长期卡死时自毁重生于基地。
   * 返回 true 表示已执行。
   */
  aiSelfDestruct(vehicle, dt, stuckTime, game) { return false; }
}
