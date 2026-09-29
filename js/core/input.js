/* =========================================================
 *  input.js — 键盘 / 鼠标输入采集
 *  原始事件通过 Bus 广播，同时提供状态查询接口
 * ========================================================= */

class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, x: 0, y: 0 };
    this.locked = false;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys[e.code]) Bus.emit('input:keydown', e.code);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      Bus.emit('input:keyup', e.code);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      Bus.emit('input:mousedown', e);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      Bus.emit('input:mouseup', e);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      Bus.emit('input:mousemove', e);
    });

    window.addEventListener('wheel', (e) => {
      this.mouse.wheel += e.deltaY;
      Bus.emit('input:wheel', e);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      Bus.emit('input:lockchange', this.locked);
    });
  }

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  isDown(code) {
    return !!this.keys[code];
  }

  axis(neg, pos) {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  /** 读取并清零鼠标增量 */
  consumeMouse() {
    const out = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return out;
  }

  consumeWheel() {
    const w = this.mouse.wheel;
    this.mouse.wheel = 0;
    return w;
  }
}
