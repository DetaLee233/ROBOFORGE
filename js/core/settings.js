/* =========================================================
 *  settings.js — 用户设置（持久化）
 *  控制反转 / 灵敏度等
 * ========================================================= */

const Settings = (() => {
  const KEY = 'roboforge.settings.v1';

  /* 操作动作表：action -> 默认按键 code（触屏/手柄适配时替换为虚拟输入源即可） */
  const KEY_ACTIONS = [
    { action: 'forward', label: '前进', code: 'KeyW' },
    { action: 'back', label: '后退', code: 'KeyS' },
    { action: 'left', label: '左移 / 左转', code: 'KeyA' },
    { action: 'right', label: '右移 / 右转', code: 'KeyD' },
    { action: 'up', label: '升空 / 跳跃', code: 'Space' },
    { action: 'down', label: '下降 / 助跑跳', code: 'ShiftLeft' },
    { action: 'fire', label: '开火（鼠标左键）', code: 'MouseLeft' },
    { action: 'aim', label: '瞄准（鼠标右键）', code: 'MouseRight' },
    { action: 'weapon1', label: '武器组 1', code: 'Digit1' },
    { action: 'weapon2', label: '武器组 2', code: 'Digit2' },
    { action: 'weapon3', label: '武器组 3', code: 'Digit3' },
  ];
  const KEY_DEFAULTS = {};
  for (const a of KEY_ACTIONS) KEY_DEFAULTS[a.action] = a.code;

  const DEFAULTS = {
    invertY: false,       // 反转鼠标上下
    invertX: false,       // 反转鼠标左右
    invertSteer: false,   // 反转键盘左右转向（A/D）
    sensitivity: 1.0,     // 鼠标灵敏度倍率
    keys: Object.assign({}, KEY_DEFAULTS),  // 操作按键映射
  };

  let data = Object.assign({}, DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(data, JSON.parse(raw));
  } catch (e) { /* 忽略 */ }
  data.keys = Object.assign({}, KEY_DEFAULTS, data.keys || {});

  function all() {
    return Object.assign({}, data, { keys: Object.assign({}, data.keys) });
  }

  function get(key) {
    return data[key];
  }

  /** 读取动作绑定的按键 code（如 key('forward') -> 'KeyW'；'' 表示未绑定） */
  function key(action) {
    const v = data.keys ? data.keys[action] : undefined;
    return v !== undefined ? v : KEY_DEFAULTS[action];
  }

  function setKey(action, code) {
    if (!data.keys) data.keys = Object.assign({}, KEY_DEFAULTS);
    data.keys[action] = code;
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { key: 'keys', action, code, settings: all() });
  }

  function resetKeys() {
    data.keys = Object.assign({}, KEY_DEFAULTS);
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { key: 'keys', settings: all() });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
  }

  function set(k, value) {
    data[k] = value;
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { key: k, value, settings: all() });
    return value;
  }

  function reset() {
    data = Object.assign({}, DEFAULTS);
    data.keys = Object.assign({}, KEY_DEFAULTS);
    save();
    Bus.emit(EV.SETTINGS_CHANGED, { settings: all() });
  }

  return { all, get, set, key, setKey, resetKeys, reset, KEY_ACTIONS, KEY_DEFAULTS };
})();
