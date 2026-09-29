/* =========================================================
 *  part.js — 零件基类
 *  所有方块 / 运动部件 / 武器都继承自 Part
 *  职责：网格占位、生命值、世界坐标、可选更新逻辑
 * ========================================================= */

class Part {
  constructor(type) {
    this.type = type;
    this.id = Utils.uid();
    this.grid = { x: 0, y: 0, z: 0 };   // 网格坐标（相对载具核心）
    this.rot = 0;                        // 朝向：0/1/2/3 -> 0/90/180/270°
    this.dir = 0;                        // 安装朝向（本地 +Y 对齐的面法线，0=上）
    this.maxHp = 1;
    this.hp = 1;
    this.mass = 1;
    this.cost = 1;
    this.radius = 1.0;                   // 被弹面积近似半径
    this.boxCollider = null;             // 若设置 {x,y,z} 则用该半边长盒体做碰撞
    this.core = false;
    this.mesh = null;
    this.vehicle = null;
    this.destroyed = false;
    this.footprint = [[0, 0, 0]];        // 占用的网格单元（旋转前）
    this.centerOffset = null;            // 网格占用体的中心偏移（mesh 位置）
    this.isDrive = true;                 // 是否轮式/履带式驱动（机械腿为 false）
  }

  /** 旋转后的网格占用单元（相对锚点的绝对偏移，含安装朝向） */
  footprintCells() {
    const base = Utils.rotateFootprint(this.footprint, this.rot);
    return Utils.orientFootprint(base, this.dir);
  }

  /** 模型安装朝向（本地 +Y 对齐面法线），返回 THREE.Matrix4 或 null */
  orientMatrix() {
    if (!this.dir) return null;
    const m = Utils.FACE_MATS[this.dir] || Utils.FACE_MATS[0];
    const mat = new THREE.Matrix4();
    mat.set(
      m[0], m[1], m[2], 0,
      m[3], m[4], m[5], 0,
      m[6], m[7], m[8], 0,
      0, 0, 0, 1
    );
    return mat;
  }

  /** 多格放置体：把模型底面移动到指定高度（避免模型在占位体内悬空） */
  alignBottomTo(bottomY) {
    if (!this.mesh || this.footprint.length <= 1) return;
    this.mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.mesh);
    this.mesh.position.y += bottomY - bb.min.y;
  }

  /** 子类实现：返回 THREE.Object3D */
  createMesh() {
    throw new Error('Part.createMesh() not implemented for ' + this.type);
  }

  /** 挂载到载具组 */
  mount(parent) {
    this.mesh = this.createMesh();
    this.mesh.userData.part = this;
    parent.add(this.mesh);
    return this.mesh;
  }

  /** 卸载并释放引用 */
  unmount(parent) {
    if (this.mesh && parent) parent.remove(this.mesh);
    this.mesh = null;
  }

  /** 网格坐标 -> 世界坐标 */
  worldPosition(target) {
    target = target || new THREE.Vector3();
    if (this.mesh) this.mesh.getWorldPosition(target);
    return target;
  }

  /** 承受伤害，返回是否被摧毁 */
  takeDamage(amount) {
    if (this.destroyed) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      return true;
    }
    return false;
  }

  /** 每帧更新（默认无） */
  update(dt, ctx) { /* override */ }

  /** 序列化为蓝图条目 */
  toBlueprint() {
    const entry = { t: this.type, x: this.grid.x, y: this.grid.y, z: this.grid.z, r: this.rot };
    if (this.core) entry.core = true;
    if (this.dir) entry.dir = this.dir;
    if (this.type && PartRegistry.isKeyed && PartRegistry.isKeyed(this.type)) {
      entry.k = this.key || 1;
    }
    return entry;
  }
}
