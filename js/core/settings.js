/* =========================================================
 *  settings.js — 用户设置（持久化）
 *  控制反转 / 灵敏度等
 * ========================================================= */

const Settings = (() => {
  const KEY = 'roboforge.settings.v1';

  const DEFAULTS = {
    invertY: false,       // 反转鼠标上下
    invertX: false,       // 反转鼠标左右
    invertSteer: false,   // 反转键盘左右转向（A/D）
    sensitivity: 1.0,     // 鼠标灵敏度倍率
  };

  let data = Object.assign({}, DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(data, JSON.parse(raw));
  } catch (e) { /* 忽略 */ }

  function all() {
    return Object.assign({}, data);
  }

  function get(key) {
    return data[key];
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
  }

  function set(key, value) {
    data[key] = value;
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { key, value, settings: all() });
    return value;
  }

  function reset() {
    data = Object.assign({}, DEFAULTS);
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { settings: all() });
  }

  return { all, get, set, reset, DEFAULTS };
})();
