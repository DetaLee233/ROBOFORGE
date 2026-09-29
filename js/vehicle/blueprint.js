/* =========================================================
 *  blueprint.js — 载具蓝图
 *  JSON 结构：
 *  {
 *    "name": "机枪皮卡",
 *    "parts": [ { "t":"block", "x":0, "y":0, "z":0, "r":0, "core":true }, ... ]
 *  }
 *  点数预算 2000（方块1 / 机枪20 / 车轮30）
 * ========================================================= */

const Blueprint = {
  BUDGET: 2000,
  TARGET: 1950,
  STORAGE_KEY: 'roboforge.blueprint.v1',

  /**
   * 通用载具建造器：底盘 + 甲板 + 运动部件 + 武器/模块，
   * 然后用强化装甲向外填充至目标点数（保证结构连通、不超预算）。
   */
  buildVehicle(cfg) {
    const parts = [];
    const add = (t, x, y, z, o) => {
      o = o || {};
      const p = { t, x, y, z, r: 0 };
      if (o.core) p.core = true;
      if (o.k) p.k = o.k;
      parts.push(p);
    };

    for (let x = -2; x <= 2; x++) for (let z = -3; z <= 3; z++) add('block', x, 0, z, { core: x === 0 && z === 0 });
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) add('block', x, 1, z);

    for (const z of cfg.moveZ) {
      add(cfg.moveType, 3, 0, z);
      add(cfg.moveType, -3, 0, z);
    }

    // 挂载点按 3 格间距排列（武器/模块放置占用 3×3×3 格）
    const mounts = [];
    for (const z of [-3, 0, 3]) for (const x of [-3, 0, 3]) mounts.push([x, z]);
    let mi = 0;
    const place = (t, k) => {
      const m = mounts[mi++];
      if (!m) return;
      add('block', m[0], 2, m[1]);
      add(t, m[0], 3, m[1], { k });
    };
    for (const w of (cfg.weapons || [])) for (let i = 0; i < w.count; i++) place(w.t, w.k);

    // 带按键的模块（如备用能源）分配一个空闲按键
    const usedKeys = new Set((cfg.weapons || []).map((w) => w.k).filter(Boolean));
    for (const mod of (cfg.modules || [])) {
      let k;
      if (PartRegistry.isKeyed(mod)) {
        for (const kk of [1, 2, 3]) if (!usedKeys.has(kk)) { k = kk; usedKeys.add(kk); break; }
        if (k === undefined) k = 1;
      }
      place(mod, k);
    }

    this._grow(parts, cfg.region, cfg.fill || 'reinforced', cfg.target || this.TARGET);
    return { name: cfg.name, parts };
  },

  /** 从已有结构向外 BFS 填充，直到接近目标点数（保证连通） */
  _grow(parts, region, blockType, target) {
    const used = new Set(parts.map((p) => Utils.key(p.x, p.y, p.z)));
    const bc = PartRegistry.costOf(blockType);
    let cost = 0;
    for (const p of parts) cost += PartRegistry.costOf(p.t);

    const inR = (x, y, z) =>
      x >= region.x0 && x <= region.x1 &&
      y >= region.y0 && y <= region.y1 &&
      z >= region.z0 && z <= region.z1;

    const queue = [];
    const queued = new Set();
    const push = (x, y, z) => {
      if (!inR(x, y, z)) return;
      const k = Utils.key(x, y, z);
      if (used.has(k) || queued.has(k)) return;
      queued.add(k);
      queue.push([x, y, z]);
    };
    for (const p of parts) for (const [dx, dy, dz] of GRID_NEIGHBORS) push(p.x + dx, p.y + dy, p.z + dz);

    let guard = 0;
    while (queue.length && cost + bc <= target && guard++ < 200000) {
      const [x, y, z] = queue.shift();
      const k = Utils.key(x, y, z);
      if (used.has(k)) continue;
      used.add(k);
      parts.push({ t: blockType, x, y, z });
      cost += bc;
      for (const [dx, dy, dz] of GRID_NEIGHBORS) push(x + dx, y + dy, z + dz);
    }
    return cost;
  },

  /** 默认载具：制式装甲车（接近 2000 点） */
  createDefault() {
    return this.buildVehicle({
      name: '制式装甲车',
      moveType: 'wheel',
      moveZ: [-3, -1, 1, 3],
      weapons: [{ t: 'machinegun', k: 1, count: 5 }, { t: 'grenade', k: 2, count: 2 }],
      modules: ['computer', 'battery'],
      region: { x0: -6, x1: 6, y0: 0, y1: 2, z0: -8, z1: 8 },
    });
  },

  clone(bp) {
    return JSON.parse(JSON.stringify(bp));
  },

  /** 统计信息 */
  stats(bp) {
    const counts = { block: 0, machinegun: 0, wheel: 0 };
    let cost = 0, hp = 0, mass = 0;
    const seen = new Set();
    for (const p of bp.parts || []) {
      if (!PartRegistry.has(p.t)) continue;
      const k = Utils.key(p.x | 0, p.y | 0, p.z | 0);
      if (seen.has(k)) continue;
      seen.add(k);
      counts[p.t] = (counts[p.t] || 0) + 1;
      cost += PartRegistry.costOf(p.t);
      hp += PartRegistry.hpOf(p.t);
      mass += (PartRegistry.meta[p.t] || {}).mass || 1;
    }
    return { counts, cost, hp, mass, cellCount: seen.size };
  },

  computeCost(bp) {
    return this.stats(bp).cost;
  },

  /** 校验并规范化 */
  validate(bp) {
    if (!bp || typeof bp !== 'object') return { ok: false, error: '数据为空' };
    if (!Array.isArray(bp.parts)) return { ok: false, error: '缺少 parts 数组' };
    if (bp.parts.length === 0) return { ok: false, error: '载具至少需要一个零件' };

    const cells = new Map();
    let coreFound = false;
    for (const raw of bp.parts) {
      if (!raw || !PartRegistry.has(raw.t)) continue;
      const x = Math.round(+raw.x || 0);
      const y = Math.round(+raw.y || 0);
      const z = Math.round(+raw.z || 0);
      const key = Utils.key(x, y, z);
      const entry = { t: raw.t, x, y, z, r: ((+raw.r || 0) % 4 + 4) % 4 };
      if (+raw.dir) entry.dir = Utils.clamp(Math.round(+raw.dir), 0, 5);
      if (PartRegistry.isKeyed(raw.t)) entry.k = Utils.clamp(Math.round(+raw.k || 1), 1, 3);
      if (raw.core && (raw.t === 'block' || raw.t === 'reinforced')) { entry.core = true; coreFound = coreFound || !cells.has(key); }
      cells.set(key, entry);   // 同格后者覆盖前者
    }

    let parts = Array.from(cells.values());
    if (parts.length === 0) return { ok: false, error: '没有有效的零件' };

    // 去除占用重叠的零件（多格部件）
    const occ = new Set();
    const kept = [];
    for (const p of parts) {
      const fp = Utils.orientFootprint(Utils.rotateFootprint(PartRegistry.footprint(p.t), p.r || 0), p.dir || 0);
      let overlap = false;
      for (const [dx, dy, dz] of fp) {
        if (occ.has(Utils.key(p.x + dx, p.y + dy, p.z + dz))) { overlap = true; break; }
      }
      if (overlap) continue;
      for (const [dx, dy, dz] of fp) occ.add(Utils.key(p.x + dx, p.y + dy, p.z + dz));
      kept.push(p);
    }
    parts = kept;

    this._resolveKeys(parts);

    // 确保有且仅有一个核心
    let cores = parts.filter((p) => p.core);
    if (cores.length === 0) {
      const firstBlock = parts.find((p) => p.t === 'block' || p.t === 'reinforced');
      if (!firstBlock) return { ok: false, error: '载具需要一个方块作为核心' };
      firstBlock.core = true;
      cores = [firstBlock];
    } else if (cores.length > 1) {
      for (let i = 1; i < cores.length; i++) delete cores[i].core;
    }

    const cost = parts.reduce((s, p) => s + PartRegistry.costOf(p.t), 0);
    if (cost > this.BUDGET) return { ok: false, error: `超出点数预算（${cost}/${this.BUDGET}）`, bp: { name: bp.name || '自制载具', parts } };

    return { ok: true, bp: { name: bp.name || '自制载具', parts }, cost };
  },

  /** 按键分配：一个按键只放一种部件类型（武器/带按键模块） */
  _resolveKeys(parts) {
    const orderList = [];
    const desired = {};
    for (const p of parts) {
      if (!PartRegistry.isKeyed(p.t)) { delete p.k; continue; }
      if (desired[p.t] === undefined) {
        desired[p.t] = Utils.clamp(Math.round(+p.k || 1), 1, 3);
        orderList.push(p.t);
      }
    }

    const keyType = { 1: null, 2: null, 3: null };
    const typeKey = {};

    // 第一遍：优先满足互不冲突的目标键位
    for (const type of orderList) {
      const d = desired[type];
      if (!keyType[d]) { keyType[d] = type; typeKey[type] = d; }
    }
    // 第二遍：冲突的类型分配到空闲键位
    for (const type of orderList) {
      if (typeKey[type] != null) continue;
      let k = 0;
      for (const kk of [1, 2, 3]) if (!keyType[kk]) { k = kk; break; }
      if (!k) k = desired[type];
      keyType[k] = type;
      typeKey[type] = k;
    }
    // 回写
    for (const p of parts) {
      if (PartRegistry.isKeyed(p.t) && typeKey[p.t] != null) p.k = typeKey[p.t];
    }
  },

  toJSON(bp) {
    return JSON.stringify(bp, null, 2);
  },

  fromJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败: ' + e.message };
    }
    return this.validate(parsed);
  },

  saveLocal(bp) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(bp));
      return true;
    } catch (e) {
      return false;
    }
  },

  loadLocal() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      const res = this.fromJSON(raw);
      return res.ok ? res.bp : null;
    } catch (e) {
      return null;
    }
  },
};
