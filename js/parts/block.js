/* =========================================================
 *  block.js — 方块（基础结构零件）
 *  生命值 200 · 质量 1 · 造价 1
 *  满格尺寸（无缝隙）；仅渲染暴露在外的面（内部面剔除）以优化性能
 * ========================================================= */

const BLOCK_FACES = [
  { bit: 1, n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { bit: 2, n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { bit: 4, n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { bit: 8, n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { bit: 16, n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { bit: 32, n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

const _blockGeoCache = new Map();
function culledBoxGeometry(mask, half) {
  const key = mask + ':' + half;
  if (_blockGeoCache.has(key)) return _blockGeoCache.get(key);
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const f of BLOCK_FACES) {
    if (!(mask & f.bit)) continue;
    for (const v of f.v) {
      pos.push(v[0] * half, v[1] * half, v[2] * half);
      nor.push(f.n[0], f.n[1], f.n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  _blockGeoCache.set(key, g);
  return g;
}

class Block extends Part {
  constructor() {
    super('block');
    this.maxHp = 200;
    this.hp = 200;
    this.mass = 1;
    this.cost = 1;
    this.radius = 1.05;
  }

  /** 当前应显示的面掩码（仅与相邻装甲方块贴合的面被剔除） */
  _faceMask() {
    let mask = 63;
    if (this.vehicle && this.vehicle.gridIndex) {
      mask = 0;
      // 侧面安装的方块整体被旋转，法线需按安装矩阵转到世界方向再查邻居
      const m = this.dir ? (Utils.FACE_MATS[this.dir] || Utils.FACE_MATS[0]) : null;
      for (const f of BLOCK_FACES) {
        let nx = f.n[0], ny = f.n[1], nz = f.n[2];
        if (m) {
          nx = m[0] * f.n[0] + m[1] * f.n[1] + m[2] * f.n[2];
          ny = m[3] * f.n[0] + m[4] * f.n[1] + m[5] * f.n[2];
          nz = m[6] * f.n[0] + m[7] * f.n[1] + m[8] * f.n[2];
        }
        const nb = this.vehicle.gridIndex.get(
          Utils.key(this.grid.x + nx, this.grid.y + ny, this.grid.z + nz)
        );
        const cull = nb && (nb instanceof Block);
        if (!cull) mask |= f.bit;
      }
    }
    return mask;
  }

  createMesh() {
    const team = this.vehicle ? this.vehicle.teamKey : 'neutral';
    const mat = this.core ? Materials.get('core', team) : Materials.get(this.type, team);
    const mesh = new THREE.Mesh(culledBoxGeometry(this._faceMask(), CELL / 2), mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** 结构变化后重新计算暴露面（机体破坏时暴露新的面） */
  refreshFaces() {
    if (!this.mesh || this.destroyed) return;
    this.mesh.geometry = culledBoxGeometry(this._faceMask(), CELL / 2);
  }
}
