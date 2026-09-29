/* =========================================================
 *  arena.js — 随机生成的 5v5 战场
 *  特点：
 *    · 中心对称地形（f(x,z) == f(-x,-z)），公平对战
 *    · 地形起伏 + 中心平原
 *    · 中心对称随机掩体
 *    · 边界空气墙
 * ========================================================= */

class Arena {
  constructor(scene, opts) {
    opts = opts || {};
    this.scene = scene;
    this.half = opts.half || 180;             // 半径（正方形半边长）
    this.seed = opts.seed !== undefined ? opts.seed : (Math.random() * 100000) | 0;
    this.exclusions = opts.exclusions || null; // 需保持空旷的目标区域
    this.covers = [];
    this.group = new THREE.Group();
    this.group.name = 'arena';
    scene.add(this.group);
    this._e = 1.0;
    this._tmpN = new THREE.Vector3();
    this._buildTerrain();
    this._buildCover();
    this._buildWalls();
  }

  /* ---------------- 地形高度 ---------------- */

  heightAt(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const base = Utils.symFbm(x * 0.011, z * 0.011, this.seed, 4) - 0.5;
    const detail = Utils.symFbm(x * 0.045, z * 0.045, this.seed + 977, 3) - 0.5;
    let h = base * 34 + detail * 5;

    // 中心平原：出生点到中场尽量平缓
    const flat = Utils.smoothstep(0, 55, r);
    h *= flat;

    // 边缘地势抬高，形成天然盆地
    h += Utils.smoothstep(this.half * 0.55, this.half * 0.98, r) * 16;
    return h;
  }

  normalAt(x, z, out) {
    out = out || new THREE.Vector3();
    const e = this._e;
    const nx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const nz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    out.set(nx, 2 * e, nz).normalize();
    return out;
  }

  /* ---------------- 构建地形 ---------------- */

  _buildTerrain() {
    const size = this.half * 2;
    const seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x24313a);
    const cMid = new THREE.Color(0x35544a);
    const cHigh = new THREE.Color(0x6d7f86);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      const t = Utils.clamp((y + 6) / 30, 0, 1);
      if (t < 0.5) tmp.copy(cLow).lerp(cMid, t * 2);
      else tmp.copy(cMid).lerp(cHigh, (t - 0.5) * 2);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrainMesh = mesh;

    // 网格辅助线，增强科技感
    const grid = new THREE.GridHelper(size, 96, 0x1b3546, 0x14232c);
    grid.position.y = 0.3;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    this.group.add(grid);
  }

  /* ---------------- 掩体 ---------------- */

  /** 是否落在需保持空旷的目标区域内 */
  _excluded(x, z) {
    if (!this.exclusions) return false;
    for (const e of this.exclusions) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz < e.r * e.r) return true;
    }
    return false;
  }

  _buildCover() {
    const rng = Utils.mulberry32(this.seed ^ 0x9e3779b9);
    const pairs = Utils.clamp(Math.round((this.half * this.half) / 1200), 30, 80);
    this.coverMeshes = [];

    for (let i = 0; i < pairs; i++) {
      // 在四分之一区域取点，再中心镜像，保证中心对称
      const ang = rng() * Math.PI * 2;
      const rad = 40 + rng() * (this.half - 55);
      let x = Math.cos(ang) * rad;
      let z = Math.sin(ang) * rad;
      if (rad > this.half * 0.9) { x *= 0.85; z *= 0.85; }

      const type = rng() < 0.5 ? 'rock' : (rng() < 0.6 ? 'crate' : 'barrel');
      const scale = 0.8 + rng() * 0.9;

      // 目标区域（得分点/基地）保持空旷
      if (this._excluded(x, z) || this._excluded(-x, -z)) continue;

      this._addCover(x, z, type, scale);
      this._addCover(-x, -z, type, scale);
    }

    this._buildCliffs(rng);
  }

  /** 大型峭壁，作为高掩体（阻挡移动与弹道） */
  _buildCliffs(rng) {
    const pairs = Utils.clamp(Math.round(this.half / 26), 4, 14);
    for (let i = 0; i < pairs; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = this.half * 0.22 + rng() * (this.half * 0.34);
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const scale = 0.8 + rng() * 0.9;
      if (this._excluded(x, z) || this._excluded(-x, -z)) continue;
      this._addCliff(x, z, scale);
      this._addCliff(-x, -z, scale);
    }
  }

  _addCliff(x, z, scale) {
    const baseY = this.heightAt(x, z);
    const w = 20 * scale, d = 20 * scale, h = 32 * scale;
    const rot = (x * 0.21 + z * 0.13) % (Math.PI / 2);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: 0x3c4650 })
    );
    mesh.rotation.y = rot;
    mesh.position.set(x, baseY + h * 0.4, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.coverMeshes.push(mesh);
    this.covers.push({
      x, z, y: baseY, height: h, mesh, type: 'cliff',
      halfX: w / 2, halfZ: d / 2, rot, radius: Math.max(w, d) * 0.5,
    });
  }

  /** 圆形/箱体掩体的推出（箱体用于峭壁，避免穿模） */
  _pushOutCover(pos, c, radius) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    if (Math.abs(pos.y - c.y) > c.height + 3) return;

    if (c.type === 'cliff') {
      const cr = Math.cos(-c.rot), sr = Math.sin(-c.rot);
      const lx = dx * cr - dz * sr;
      const lz = dx * sr + dz * cr;
      const hx = c.halfX, hz = c.halfZ;
      const qx = Utils.clamp(lx, -hx, hx);
      const qz = Utils.clamp(lz, -hz, hz);
      let ox = lx - qx, oz = lz - qz;
      let od = Math.sqrt(ox * ox + oz * oz);
      let nx, nz, push;
      if (od > 1e-4) {
        nx = ox / od; nz = oz / od; push = radius - od;
      } else {
        // 中心在箱体内：沿最小穿透面推出
        const px = hx - Math.abs(lx);
        const pz = hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + radius; }
        else { nx = 0; nz = Math.sign(lz) || 1; push = pz + radius; }
      }
      if (push <= 0) return;
      // 法线转回世界坐标
      const cw = Math.cos(c.rot), sw = Math.sin(c.rot);
      const wx = nx * cw - nz * sw;
      const wz = nx * sw + nz * cw;
      pos.x += wx * push;
      pos.z += wz * push;
      return;
    }

    const minD = c.radius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD * minD && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = minD - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }

  _addCover(x, z, type, scale) {
    const baseY = this.heightAt(x, z);
    let mesh, radius, height;

    if (type === 'rock') {
      radius = 3.2 * scale;
      height = 4.6 * scale;
      const g = new THREE.DodecahedronGeometry(radius, 0);
      g.scale(1, height / radius * 0.6, 1);
      mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x4a5560 }));
      mesh.rotation.y = (x * 13.7) % Math.PI;
      mesh.position.set(x, baseY + height * 0.35, z);
      radius *= 0.95;
    } else if (type === 'crate') {
      radius = 2.6 * scale;
      height = 3.0 * scale;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, height, radius * 2), new THREE.MeshLambertMaterial({ color: 0x6b5a3d }));
      mesh.rotation.y = (z * 7.3) % (Math.PI / 2);
      mesh.position.set(x, baseY + height / 2, z);
    } else {
      radius = 1.6 * scale;
      height = 2.6 * scale;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), new THREE.MeshLambertMaterial({ color: 0x3f5d63 }));
      mesh.position.set(x, baseY + height / 2, z);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.coverMeshes.push(mesh);
    this.covers.push({ x, z, y: baseY, radius, height, mesh, type });
  }

  /* ---------------- 空气墙 ---------------- */

  _buildWalls() {
    const h = 60;
    const size = this.half * 2;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4fd1ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.28 });

    const walls = [
      { p: [0, h / 2, -this.half], r: [0, 0, 0], w: size },
      { p: [0, h / 2, this.half], r: [0, 0, 0], w: size },
      { p: [-this.half, h / 2, 0], r: [0, Math.PI / 2, 0], w: size },
      { p: [this.half, h / 2, 0], r: [0, Math.PI / 2, 0], w: size },
    ];
    for (const w of walls) {
      const g = new THREE.PlaneGeometry(w.w, h);
      const m = new THREE.Mesh(g, mat);
      m.position.fromArray(w.p);
      m.rotation.fromArray(w.r);
      this.group.add(m);

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat);
      edges.position.copy(m.position);
      edges.rotation.copy(m.rotation);
      this.group.add(edges);
    }
  }

  /* ---------------- 查询 / 碰撞 ---------------- */

  clampToBounds(pos) {
    const lim = this.half - 3;
    pos.x = Utils.clamp(pos.x, -lim, lim);
    pos.z = Utils.clamp(pos.z, -lim, lim);
    if (pos.y < -80) pos.y = -80;
  }

  outOfBounds(pos) {
    return Math.abs(pos.x) > this.half + 4 || Math.abs(pos.z) > this.half + 4 || pos.y < -60;
  }

  resolveCover(pos, radius) {
    for (const c of this.covers) this._pushOutCover(pos, c, radius);
  }

  /** 点是否在某掩体内（考虑峭壁箱体） */
  _insideCover(x, y, z, c) {
    if (y < c.y - 0.5 || y > c.y + c.height) return false;
    const dx = x - c.x, dz = z - c.z;
    if (c.type === 'cliff') {
      const cr = Math.cos(-c.rot), sr = Math.sin(-c.rot);
      const lx = dx * cr - dz * sr;
      const lz = dx * sr + dz * cr;
      return Math.abs(lx) <= c.halfX && Math.abs(lz) <= c.halfZ;
    }
    return dx * dx + dz * dz < c.radius * c.radius;
  }

  hitCover(a, b) {
    const steps = 4;
    for (const c of this.covers) {
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        if (this._insideCover(x, y, z, c)) return c;
      }
    }
    return null;
  }

  /**
   * 射线与地形求交：返回命中距离（无命中返回 -1）
   * 用于让准星精确落在真实地表上
   */
  rayDistance(origin, dir, maxDist) {
    const step = 1.4;
    const o = origin;
    const d = dir;
    let t = 0;
    while (t < maxDist) {
      const nt = Math.min(maxDist, t + step);
      const x = o.x + d.x * nt;
      const y = o.y + d.y * nt;
      const z = o.z + d.z * nt;
      if (y <= this.heightAt(x, z)) {
        let lo = t, hi = nt;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) * 0.5;
          const my = o.y + d.y * m;
          if (my <= this.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return (lo + hi) * 0.5;
      }
      if (d.y >= 0 && y > this.heightAt(x, z) + 80) return -1; // 射线飞向天空
      t = nt;
    }
    return -1;
  }

  /* ---------------- 出生点 ---------------- */

  spawnPoints(side) {
    // 地图为中心对称：敌军出生点取友军出生点的中心对称点，
    // 保证双方处于完全相同的地形与掩体环境中。
    const dir = side === SIDE.PLAYER ? 1 : -1;
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const bx = (i - 2) * 24;
      const bz = this.half * 0.62 + (i % 2) * 18;
      const x = bx * dir;
      const z = bz * dir;
      const pt = new THREE.Vector3(x, this.heightAt(x, z) + 1, z);
      // 避免刷在掩体/峭壁内部
      this.clampToBounds(pt);
      this.resolveCover(pt, 6);
      this.resolveCover(pt, 6);
      pt.y = this.heightAt(pt.x, pt.z) + 1;
      pts.push(pt);
    }
    return pts;
  }
}
