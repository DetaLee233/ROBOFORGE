/* =========================================================
 *  movementPart.js — 运动部件基类
 *  在 Part 基础上增加驱动 / 转向能力
 *  · speedMul：速度倍率（车轮=2，履带=1 即旧车轮速度）
 *  · yOffset：模型与碰撞体相对格心的竖直偏移（-半格，提升越野）
 *  · groundClearance：从格心到底面的距离，用于计算离地高度
 * ========================================================= */

class MovementPart extends Part {
  constructor(type) {
    super(type);
    this.drive = 1;                 // 驱动力贡献（保留）
    this.steer = 1;                 // 转向贡献
    this.speedMul = 1;              // 速度倍率
    this.driveRating = 1;           // 驱动当量（约等于多少个车轮）
    this.yOffset = -CELL / 2;       // 向下偏移半格
    this.groundClearance = 0;       // 格心到触地面距离
    this.groundExtend = 0;          // 网格底边之下延伸的（半）高度，用于贴地计算
    this.pivot = false;             // 能否原地转向（履带/车轮）
    this.pivotRate = 0;             // 原地转向速度系数（履带 0.85，车轮为其 80%）
    this.flying = false;            // 是否提供升力（旋翼）
    this.onGround = false;
  }
}
