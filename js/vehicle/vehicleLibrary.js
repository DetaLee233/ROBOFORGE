/* =========================================================
 *  vehicleLibrary.js — 载具库
 *  · 内置多种基础载具（花费尽量接近 2000 且不超过）
 *  · 支持玩家保存的载具（localStorage 持久化）
 *  · 开局时按“点数接近”为 AI 随机抽取
 * ========================================================= */

const VehicleLibrary = (() => {
  const USER_KEY = 'roboforge.library.v1';
  const TARGET = Blueprint.TARGET;
  const BUDGET = Blueprint.BUDGET;
  const REG = { x0: -6, x1: 6, y0: 0, y1: 2, z0: -8, z1: 8 };

  const BUILDERS = [
    () => Blueprint.buildVehicle({
      name: '突击卡车', moveType: 'wheel', moveZ: [-3, -1, 1, 3],
      weapons: [{ t: 'machinegun', k: 1, count: 5 }, { t: 'grenade', k: 2, count: 2 }],
      modules: ['computer', 'battery'], region: REG,
    }),
    () => Blueprint.buildVehicle({
      name: '极速突击车', moveType: 'wheel', moveZ: [-3, -2, 2, 3],
      weapons: [{ t: 'machinegun', k: 1, count: 6 }, { t: 'grenade', k: 2, count: 1 }],
      modules: ['battery'], region: REG,
    }),
    () => Blueprint.buildVehicle({
      name: '榴弹支援车', moveType: 'wheel', moveZ: [-3, -1, 1, 3],
      weapons: [{ t: 'grenade', k: 1, count: 3 }, { t: 'machinegun', k: 2, count: 4 }],
      modules: ['computer', 'battery'], region: REG,
    }),
    () => Blueprint.buildVehicle({
      name: '重型主战坦克', moveType: 'track', moveZ: [-3, -1, 1, 3],
      weapons: [{ t: 'grenade', k: 1, count: 2 }, { t: 'machinegun', k: 2, count: 5 }],
      modules: ['computer', 'battery'], region: REG,
    }),
    () => Blueprint.buildVehicle({
      name: '履带火力平台', moveType: 'track', moveZ: [-3, -2, 2, 3],
      weapons: [{ t: 'grenade', k: 1, count: 3 }, { t: 'machinegun', k: 2, count: 4 }],
      modules: ['computer', 'battery'], region: REG,
    }),
    () => Blueprint.buildVehicle({
      name: '装甲运兵车', moveType: 'track', moveZ: [-3, -1, 1, 3],
      weapons: [{ t: 'machinegun', k: 1, count: 5 }, { t: 'grenade', k: 2, count: 2 }],
      modules: ['computer', 'battery'], region: REG,
    }),
  ];

  /* ---------------- 玩家载具持久化 ---------------- */

  function loadUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((b) => b && b.name && Array.isArray(b.parts)) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUser(list) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 公共 API ---------------- */

  let _builtins = null;
  function builtinsCanonical() {
    if (!_builtins) _builtins = BUILDERS.map((b) => b());
    return _builtins;
  }

  function builtins() {
    return builtinsCanonical().map((b) => Blueprint.clone(b));
  }

  function all() {
    return builtins().concat(loadUser().map((b) => Blueprint.clone(b)));
  }

  function withCost() {
    return all().map((bp) => ({ bp, cost: Blueprint.computeCost(bp) }));
  }

  function names() {
    return all().map((b) => b.name);
  }

  function isBuiltin(name) {
    return builtinsCanonical().some((b) => b.name === name);
  }

  function get(name) {
    const found = all().find((b) => b.name === name);
    return found ? Blueprint.clone(found) : null;
  }

  /** 保存到载具库；同名时返回 needConfirm */
  function save(name, bp, overwrite) {
    name = (name || '').trim();
    if (!name) return { ok: false, error: '名称不能为空' };
    if (name.length > 24) return { ok: false, error: '名称过长' };

    const validated = Blueprint.validate({ name, parts: bp.parts });
    if (!validated.ok) return { ok: false, error: validated.error };

    const userList = loadUser();
    const exists = userList.some((b) => b.name === name);
    if (!overwrite && (exists || isBuiltin(name))) {
      return { ok: false, needConfirm: true, name };
    }

    const entry = { name, parts: validated.bp.parts };
    const idx = userList.findIndex((b) => b.name === name);
    if (idx >= 0) userList[idx] = entry;
    else userList.push(entry);
    saveUser(userList);
    return { ok: true, name, overwrote: idx >= 0 };
  }

  function remove(name) {
    const userList = loadUser().filter((b) => b.name !== name);
    saveUser(userList);
  }

  function randomNear(targetCost, rng) {
    rng = rng || Math.random;
    const list = withCost().sort(
      (a, b) => Math.abs(a.cost - targetCost) - Math.abs(b.cost - targetCost)
    );
    const top = list.slice(0, Math.min(4, list.length));
    const pick = top[Math.floor(rng() * top.length)] || list[0];
    return Blueprint.clone(pick.bp);
  }

  return {
    TARGET, BUDGET,
    all, builtins, withCost, names, get, isBuiltin,
    save, remove, randomNear,
  };
})();
