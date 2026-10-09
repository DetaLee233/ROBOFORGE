/* =========================================================
 *  settings.js (UI) — 设置面板
 *  绑定复选框 / 滑块到 Settings 模块；渲染按键映射列表（点击重绑）
 * ========================================================= */

class SettingsPanel {
  constructor() {
    this.root = document.getElementById('screen-settings');
    this.el = {
      invertY: document.getElementById('set-invertY'),
      invertX: document.getElementById('set-invertX'),
      invertSteer: document.getElementById('set-invertSteer'),
      sensitivity: document.getElementById('set-sensitivity'),
      keys: document.getElementById('set-keys'),
    };
    this._listening = null;   // 等待重绑的动作
    this._bind();
    this._renderKeys();
    Bus.on(EV.SETTINGS_CHANGED, (e) => {
      if (!e || !e.key || e.key === 'keys') this._renderKeys();
      this.sync();
    });
    Bus.on('input:keydown', (code) => this._captureKey(code));
    this.sync();
  }

  _bind() {
    this.el.invertY.addEventListener('change', () => Settings.set('invertY', this.el.invertY.checked));
    this.el.invertX.addEventListener('change', () => Settings.set('invertX', this.el.invertX.checked));
    this.el.invertSteer.addEventListener('change', () => Settings.set('invertSteer', this.el.invertSteer.checked));
    this.el.sensitivity.addEventListener('input', () => {
      Settings.set('sensitivity', parseFloat(this.el.sensitivity.value));
    });
    document.getElementById('set-reset').addEventListener('click', () => Settings.reset());
    document.getElementById('set-keys-reset').addEventListener('click', () => Settings.resetKeys());
    document.getElementById('set-close').addEventListener('click', () => this.hide());
  }

  /** 渲染按键映射行 */
  _renderKeys() {
    if (!this.el.keys) return;
    this.el.keys.innerHTML = '';
    for (const a of Settings.KEY_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'setting-row key-row';
      const label = document.createElement('span');
      label.textContent = a.label;
      const btn = document.createElement('button');
      btn.className = 'key-btn';
      btn.dataset.action = a.action;
      const code = Settings.key(a.action);
      const mouse = code.startsWith('Mouse');
      btn.textContent = this._codeName(code);
      if (mouse) btn.classList.add('fixed');
      btn.addEventListener('click', () => {
        if (mouse) return;   // 鼠标输入源暂不可重绑
        this._listening = a.action;
        this._refreshKeys();
      });
      row.appendChild(label);
      row.appendChild(btn);
      this.el.keys.appendChild(row);
    }
  }

  /** 按键 code 的友好名称 */
  _codeName(code) {
    if (!code) return '—';
    if (code.startsWith('Mouse')) return code === 'MouseLeft' ? '鼠标左键' : '鼠标右键';
    const nice = {
      Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift',
      ControlLeft: '左Ctrl', ControlRight: '右Ctrl', AltLeft: '左Alt',
      Escape: 'Esc', Enter: '回车',
    };
    return nice[code] || code.replace('Key', '').replace('Digit', '数字').replace('Arrow', '方向');
  }

  _refreshKeys() {
    if (!this.el.keys) return;
    for (const btn of this.el.keys.querySelectorAll('.key-btn')) {
      const action = btn.dataset.action;
      btn.textContent = this._listening === action ? '按任意键…' : this._codeName(Settings.key(action));
      btn.classList.toggle('listening', this._listening === action);
    }
  }

  /** 正在重绑时捕获下一个按键 */
  _captureKey(code) {
    if (!this.visible || !this._listening || !code) return;
    if (code === 'Escape') { this._listening = null; this._refreshKeys(); return; }
    // 冲突的旧绑定让位（同一 code 只属于一个动作）
    for (const a of Settings.KEY_ACTIONS) {
      if (a.action !== this._listening && Settings.key(a.action) === code) {
        Settings.setKey(a.action, '');
      }
    }
    Settings.setKey(this._listening, code);
    this._listening = null;
    this._refreshKeys();
  }

  /** 用当前设置刷新控件 */
  sync() {
    const s = Settings.all();
    this.el.invertY.checked = !!s.invertY;
    this.el.invertX.checked = !!s.invertX;
    this.el.invertSteer.checked = !!s.invertSteer;
    this.el.sensitivity.value = s.sensitivity;
  }

  show(onClose) {
    this._onClose = onClose;
    this.sync();
    this.root.classList.remove('hidden');
  }

  hide() {
    this._listening = null;
    this.root.classList.add('hidden');
    const cb = this._onClose;
    this._onClose = null;
    if (cb) cb();
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}
