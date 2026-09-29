/* =========================================================
 *  thumbnails.js — 载具缩略图渲染
 *  复用主渲染器，离屏渲染一帧后截图并缓存
 * ========================================================= */

class Thumbnailer {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 256;
    this.height = 180;
    this.cache = new Map();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1722);

    this.scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x1a2530, 0.95));
    const dir = new THREE.DirectionalLight(0xfff0d0, 1.15);
    dir.position.set(4, 8, 6);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0x4fd1ff, 0.6);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(42, this.width / this.height, 0.1, 500);
  }

  get(bp) {
    let key;
    try { key = bp.name + '|' + JSON.stringify(bp.parts); }
    catch (e) { key = bp.name + '|' + bp.parts.length; }
    if (this.cache.has(key)) return this.cache.get(key);

    let vehicle = null;
    let url = '';
    try {
      vehicle = new Vehicle(bp, SIDE.PLAYER, { teamKey: 'player', heading: 0.7 });
      vehicle.group.position.set(0, 0, 0);
      this.scene.add(vehicle.group);

      const r = Math.max(6, vehicle.boundingRadius);
      const topY = vehicle.topY || 3;
      this.camera.position.set(r * 1.15, r * 0.85 + topY * 0.4, r * 1.5);
      this.camera.lookAt(0, topY * 0.35, 0);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.scene.updateMatrixWorld(true);

      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const ratio = this.renderer.getPixelRatio();
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(this.width, this.height, false);
      this.renderer.render(this.scene, this.camera);
      url = this.renderer.domElement.toDataURL('image/png');
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y, false);
    } catch (e) {
      console.warn('[Thumbnailer]', e);
    } finally {
      if (vehicle) this.scene.remove(vehicle.group);
    }

    this.cache.set(key, url);
    return url;
  }
}
