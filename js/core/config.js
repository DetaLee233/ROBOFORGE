/* =========================================================
 *  config.js — 全局可调参数（Config）
 *  Vehicle / Game / AI 统一引用，便于集中调参。
 * ========================================================= */

const Config = {
  /* 通用物理 */
  GRAVITY: 60,              // 载具重力（单位/秒²）

  /* 质量 */
  MASS_MIN: 4,              // 载具最小质量

  /* 地面机动（轮/履带） */
  MAX_THRUST: 60,           // 推力系数：driveRating → 加速度
  THRUST_BASE: 38,          // 基础推力
  THRUST_DIV_MIN: 10,       // 加速度公式的质量除数下限
  SPEED_BASE: 17,           // 基础极速
  SPEED_PER_RATING: 3.4,    // 每点驱动等级的极速加成
  SPEED_MIN: 6,
  SPEED_MAX: 72,
  SPEED_MASS_REF: 40,       // 开始计质量惩罚的基准
  SPEED_MASS_SPAN: 420,     // 质量惩罚区间
  SPEED_MASS_PENALTY: 0.32, // 最大质量惩罚
  TURN_BASE: 2.4,           // 基础转向速率
  TURN_NO_WHEEL: 0.35,      // 无驱动轮时的转向系数
  SLOPE_PENALTY: 0.65,      // 上坡速度惩罚（最陡保留 35%）
  DRIVE_ACCEL: 3,           // 油门加速度倍率
  DRIVE_RATE: 1.6,          // 加速速率
  DRIVE_RATE_COAST: 3.2,    // 松油门减速速率

  /* 空中 / 飞行 */
  MAX_AIR: 14,              // 空中最大速度（飞行）
  FLY_ACCEL: 2.2,           // 飞行垂直加速度倍率
  OMNI_ACCEL: 3,            // 全向移动加速度倍率
  AIR_CONTROL: 0.35,        // 空中水平操控衰减

  /* 跳跃 / 冲刺（机械腿） */
  JUMP_CELLS: 10,           // 跳跃最大高度（格）
  JUMP_FACTOR_MIN: 0.2,     // 负重跳跃下限系数
  JUMP_CD: 0.4,             // 跳跃冷却（秒）
  DASH_CELLS: 50,           // 助跑跳水平距离（格）
  DASH_CD: 5,               // 助跑跳冷却（秒）
  LEG_LOAD: 70,             // 单腿承载质量

  /* 载具体积（碰撞/分离） */
  BODY_RADIUS: 2.2,
  SEPARATION_RADIUS: 3,

  /* AI */
  AI_RANGE_BASE: 55,        // 交战距离基准
  AI_RANGE_SPREAD: 35,      // 交战距离随机浮动
  AI_HOLD_DIST: 12,         // 驻守/到位判定距离
  AI_BURST_MIN: 0.9,        // 连射时长下限（秒）
  AI_BURST_VAR: 1.2,        // 连射时长浮动（秒）
  AI_REST_MIN: 0.3,         // 停歇时长下限（秒）
  AI_REST_VAR: 0.7,         // 停歇时长浮动（秒）
  AI_ENERGY_FLOOR: 0.12,    // 能量低于该比例即停火
  AI_STUCK_LIMIT: 8,        // AI 累计卡死超过该时长即自毁重生于基地（夺点）
  AI_SKILL_MIN: 0.6,        // 默认技能下限
  AI_SKILL_SPREAD: 0.4,     // 默认技能浮动
  AI_ALLY_SKILL: 0.6,       // 友军技能下限
  AI_ALLY_SPREAD: 0.3,
  AI_ENEMY_SKILL: 0.55,     // 敌军技能下限
  AI_ENEMY_SPREAD: 0.35,
  AI_RESPAWN_SKILL: 0.7,    // 复活/修复重建时的默认技能
};
