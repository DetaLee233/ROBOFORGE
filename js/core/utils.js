/* =========================================================
 *  utils.js — 数学 / 噪声 / 网格工具（函数式工具集）
 * ========================================================= */

const CELL = 2;              // 一个方块/零件占用的世界单位边长
const BALLISTIC_GRAVITY = 22; // 弹药重力（单位/秒²），用于弹道下坠
const GRID_NEIGHBORS = [     // 六向邻接
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

const Utils = {
  clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  },

  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  smoothstep(edge0, edge1, x) {
    const t = Utils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  },

  /** 确定性伪随机（可复现地图） */
  mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  uid() {
    return 'p' + (Utils._uid = (Utils._uid || 0) + 1) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  },

  key(x, y, z) {
    return x + ',' + y + ',' + z;
  },

  /** 整数哈希 -> [0,1) */
  hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  /** 双线性平滑值噪声 */
  valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = Utils.hash2(xi, yi, seed);
    const b = Utils.hash2(xi + 1, yi, seed);
    const c = Utils.hash2(xi, yi + 1, seed);
    const d = Utils.hash2(xi + 1, yi + 1, seed);
    return Utils.lerp(Utils.lerp(a, b, u), Utils.lerp(c, d, u), v);
  },

  fbm(x, y, seed, octaves) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < (octaves || 4); i++) {
      sum += amp * Utils.valueNoise(x * freq, y * freq, seed + i * 17);
      norm += amp;
      freq *= 2;
      amp *= 0.5;
    }
    return sum / norm;
  },

  /**
   * 中心对称噪声： f(x,z) == f(-x,-z)
   * 用于生成 180° 旋转对称的地图（公平的 5v5 战场）
   */
  symNoise(x, z, seed) {
    return (Utils.valueNoise(x, z, seed) + Utils.valueNoise(-x, -z, seed)) * 0.5;
  },

  symFbm(x, z, seed, octaves) {
    return (Utils.fbm(x, z, seed, octaves) + Utils.fbm(-x, -z, seed, octaves)) * 0.5;
  },

  /** 点到线段最短距离的平方 */
  segmentPointDistSq(a, b, p) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const abLenSq = abx * abx + aby * aby + abz * abz;
    let t = abLenSq > 1e-8 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  },

  /** 角度差归一化到 [-PI, PI] */
  angleDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  },

  /** 网格单元绕 Y 轴旋转 r×90°（返回 [dx,dz]） */
  rotCell(dx, dz, r) {
    switch (((r % 4) + 4) % 4) {
      case 1: return [dz, -dx];
      case 2: return [-dx, -dz];
      case 3: return [-dz, dx];
      default: return [dx, dz];
    }
  },

  /** 旋转一个 footprint（[[dx,dy,dz],...]） */
  rotateFootprint(fp, r) {
    const out = [];
    for (const c of fp) {
      const [x, z] = Utils.rotCell(c[0], c[2], r);
      out.push([x, c[1], z]);
    }
    return out;
  },

  /** 求 footprint 镜像（关于 x=0）后的等价旋转角 */
  mirrorRotation(fp, r) {
    const sig = (list) => list.map((c) => c[0] + ',' + c[1] + ',' + c[2]).sort().join('|');
    const target = sig(Utils.rotateFootprint(fp, r).map((c) => [-c[0], c[1], c[2]]));
    for (let rp = 0; rp < 4; rp++) {
      if (sig(Utils.rotateFootprint(fp, rp)) === target) return rp;
    }
    return 0;
  },

  /** 二维线段-线段最近点（用于载具间的胶囊体分离） */  closestSegSeg2D(p1, p2, q1, q2) {
    const d1x = p2.x - p1.x, d1z = p2.z - p1.z;
    const d2x = q2.x - q1.x, d2z = q2.z - q1.z;
    const rx = p1.x - q1.x, rz = p1.z - q1.z;
    const a = d1x * d1x + d1z * d1z;
    const e = d2x * d2x + d2z * d2z;
    const f = d2x * rx + d2z * rz;
    let s, t;
    if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
    else if (a <= 1e-9) { s = 0; t = Utils.clamp(f / e, 0, 1); }
    else {
      const c = d1x * rx + d1z * rz;
      if (e <= 1e-9) { t = 0; s = Utils.clamp(-c / a, 0, 1); }
      else {
        const b = d1x * d2x + d1z * d2z;
        const denom = a * e - b * b;
        s = denom > 1e-9 ? Utils.clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Utils.clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = Utils.clamp((b - c) / a, 0, 1); }
      }
    }
    return {
      ax: p1.x + d1x * s, az: p1.z + d1z * s,
      bx: q1.x + d2x * t, bz: q1.z + d2z * t,
    };
  },

  /** 从网格坐标生成 mesh 局部坐标 */
  gridToLocal(gx, gy, gz, ox, oy, oz, target) {
    target = target || new THREE.Vector3();
    return target.set((gx - ox) * CELL, (gy - oy) * CELL, (gz - oz) * CELL);
  },

  /** 线段与轴对齐盒（半边长 hx/hy/hz，中心原点）求交，返回进入参数 t∈[0,1]，不相交返回 -1 */
  segmentAABB(a, b, hx, hy, hz) {
    let tmin = 0, tmax = 1;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const o = [a.x, a.y, a.z];
    const h = [hx, hy, hz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (Math.abs(o[i]) > h[i]) return -1;
      } else {
        let t1 = (-h[i] - o[i]) / d[i];
        let t2 = (h[i] - o[i]) / d[i];
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  },

  /** 生成 n×n×n 的占用单元：XZ 居中、Y 从底面向上（锚点=底面中心） */
  boxFootprint(n) {
    const half = Math.floor(n / 2);
    const fp = [];
    for (let dx = -half; dx <= half; dx++)
      for (let dy = 0; dy < n; dy++)
        for (let dz = -half; dz <= half; dz++) fp.push([dx, dy, dz]);
    return fp;
  },

  /** 安装朝向矩阵（整数旋转矩阵，把本地 +Y 对齐到某个面法线） */
  FACE_MATS: [
    [1, 0, 0, 0, 1, 0, 0, 0, 1],     // 0 +Y
    [1, 0, 0, 0, -1, 0, 0, 0, -1],   // 1 -Y
    [0, 1, 0, -1, 0, 0, 0, 0, 1],    // 2 +X
    [0, -1, 0, 1, 0, 0, 0, 0, 1],    // 3 -X
    [1, 0, 0, 0, 0, -1, 0, 1, 0],    // 4 +Z
    [1, 0, 0, 0, 0, 1, 0, -1, 0],    // 5 -Z
  ],

  /** 用朝向矩阵变换 footprint 偏移 */
  orientFootprint(fp, dir) {
    const m = Utils.FACE_MATS[dir | 0] || Utils.FACE_MATS[0];
    const out = [];
    for (const c of fp) {
      out.push([
        m[0] * c[0] + m[1] * c[1] + m[2] * c[2],
        m[3] * c[0] + m[4] * c[1] + m[5] * c[2],
        m[6] * c[0] + m[7] * c[1] + m[8] * c[2],
      ]);
    }
    return out;
  },

  /** 镜像（关于 x=0）后的等价安装朝向 */
  mirrorDir(dir) {
    const m = Utils.FACE_MATS[dir | 0] || Utils.FACE_MATS[0];
    // M' = S·M·S，S = diag(-1,1,1)：翻转第 0 行与第 0 列
    const mp = [
      m[0], -m[1], -m[2],
      -m[3], m[4], m[5],
      -m[6], m[7], m[8],
    ];
    for (let i = 0; i < Utils.FACE_MATS.length; i++) {
      const f = Utils.FACE_MATS[i];
      if (f[0] === mp[0] && f[1] === mp[1] && f[2] === mp[2] &&
          f[3] === mp[3] && f[4] === mp[4] && f[5] === mp[5] &&
          f[6] === mp[6] && f[7] === mp[7] && f[8] === mp[8]) return i;
    }
    return 0;
  },

  /** 蜂窝（六边形）排列的偏移点，按到中心距离取前 n 个并居中，用于面杀伤布点 */
  hexOffsets(n, spacing) {
    if (n <= 0) return [];
    const s = spacing || 1;
    const ring = Math.max(1, Math.ceil((Math.sqrt(n) - 1) / 2) + 1);
    const pts = [];
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        const x = s * (q + r / 2);
        const z = s * (r * Math.sqrt(3) / 2);
        pts.push({ x, z, d: Math.hypot(x, z) });
      }
    }
    pts.sort((a, b) => a.d - b.d);
    const chosen = pts.slice(0, n);
    let cx = 0, cz = 0;
    for (const p of chosen) { cx += p.x; cz += p.z; }
    cx /= n; cz /= n;
    return chosen.map((p) => ({ x: p.x - cx, z: p.z - cz }));
  },

  /**
   * 弹道反解：已知炮口 p0、目标 target、初速 speed、重力 gravity，
   * 求能把弹丸正好送到目标点的发射方向（低伸弹道）。
   * 无解（超出射程）时退化为直射方向并返回 false。
   */
  solveBallistic(p0, target, speed, gravity, out) {
    out = out || new THREE.Vector3();
    const dx = target.x - p0.x;
    const dy = target.y - p0.y;
    const dz = target.z - p0.z;
    const h = Math.sqrt(dx * dx + dz * dz);

    if (gravity <= 0) {
      out.set(dx, dy, dz).normalize();
      return true;
    }
    if (h < 1e-4) {                    // 目标几乎在正上/正下方
      out.set(0, dy >= 0 ? 1 : -1, 0);
      return true;
    }

    const v2 = speed * speed;
    const disc = v2 * v2 - gravity * (gravity * h * h + 2 * dy * v2);
    if (disc < 0) {                    // 初速不足以命中该点
      out.set(dx, dy, dz).normalize();
      return false;
    }

    const tanTheta = (v2 - Math.sqrt(disc)) / (gravity * h); // 低伸解
    const inv = 1 / Math.sqrt(1 + tanTheta * tanTheta);
    out.set((dx / h) * inv, tanTheta * inv, (dz / h) * inv).normalize();
    return true;
  },
};

/* 把圆柱网格摆放到 a->b 之间（圆柱轴为本地 +Y，高度 1） */
const GameBeam = {
  _up: new THREE.Vector3(0, 1, 0),
  place(mesh, a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1e-4;
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(GameBeam._up, dir.normalize());
  },
};
