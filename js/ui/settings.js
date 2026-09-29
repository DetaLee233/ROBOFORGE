/* =========================================================
 *  settings.js (UI) — 设置面板
 *  绑定复选框 / 滑块到 Settings 模块
 * ========================================================= */

class SettingsPanel {
  constructor() {
    this.root = document.getElementById('screen-settings');
    this.el = {
      invertY: document.getElementById('set-invertY'),
      invertX: document.getElementById('set-invertX'),
      invertSteer: document.getElementById('set-invertSteer'),
      sensitivity: document.getElementById('set-sensitivity'),
    };
    this._bind();
    Bus.on(EV.SETTINGS_CHANGED, () => this.sync());
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
    document.getElementById('set-close').addEventListener('click', () => this.hide());
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
    this.root.classList.add('hidden');
    const cb = this._onClose;
    this._onClose = null;
    if (cb) cb();
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}
