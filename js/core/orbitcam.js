/* =========================================================
 *  orbitcam.js — 轻量轨道相机（无外部依赖）
 *  用于机库展示与载具编辑器
 * ========================================================= */

class OrbitCam {
  constructor(camera, dom, opts) {
    opts = opts || {};
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, opts.targetY || 2, 0);
    this.dist = opts.dist || 34;
    this.minDist = opts.minDist || 8;
    this.maxDist = opts.maxDist || 140;
    this.yaw = opts.yaw !== undefined ? opts.yaw : 0.7;
    this.pitch = opts.pitch !== undefined ? opts.pitch : 0.55;
    this.minPitch = 0.08;
    this.maxPitch = 1.45;
    this.rotateButton = opts.rotateButton !== undefined ? opts.rotateButton : 0;
    this.panButton = opts.panButton !== undefined ? opts.panButton : 1;
    this.panSpeed = opts.panSpeed || 26;
    this.rotateSpeed = opts.rotateSpeed || 0.006;
    this.autoRotate = !!opts.autoRotate;
    this.autoRotateSpeed = opts.autoRotateSpeed || 0.25;
    this.enabled = true;
    this._dragging = null;
    this._last = { x: 0, y: 0 };
    this._keys = opts.keys || null;
    this._bind();
  }

  _bind() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === this.rotateButton || e.button === this.panButton) {
        this._dragging = e.button;
        this._last.x = e.clientX;
        this._last.y = e.clientY;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.enabled || this._dragging === null) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last.x = e.clientX;
      this._last.y = e.clientY;

      if (this._dragging === this.rotateButton) {
        this.yaw -= dx * this.rotateSpeed * 2.4;
        this.pitch = Utils.clamp(this.pitch + dy * this.rotateSpeed * 2.4, this.minPitch, this.maxPitch);
        this.autoRotate = false;
      } else if (this._dragging === this.panButton) {
        const scale = this.dist * 0.0016;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        this.target.addScaledVector(right, -dx * scale);
        this.target.addScaledVector(up, dy * scale);
      }
    });
    window.addEventListener('pointerup', () => { this._dragging = null; });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.dist = Utils.clamp(this.dist + e.deltaY * 0.02, this.minDist, this.maxDist);
    }, { passive: true });
  }

  update(dt) {
    if (this._keys) {
      const speed = this.panSpeed * dt * (this.dist / 34);
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      if (this._keys.isDown('KeyW')) this.target.addScaledVector(fwd, speed);
      if (this._keys.isDown('KeyS')) this.target.addScaledVector(fwd, -speed);
      if (this._keys.isDown('KeyA')) this.target.addScaledVector(right, -speed);
      if (this._keys.isDown('KeyD')) this.target.addScaledVector(right, speed);
      if (this._keys.isDown('KeyQ')) this.target.y -= speed * 0.5;
      if (this._keys.isDown('KeyE')) this.target.y += speed * 0.5;
    }

    if (this.autoRotate) this.yaw += this.autoRotateSpeed * dt;

    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist
    );
    this.camera.lookAt(this.target);
  }
}
