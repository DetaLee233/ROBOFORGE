/* =========================================================
 *  hangar.js — 机库（主页面）
 *  展示当前载具，可旋转缩放
 * ========================================================= */

class Hangar {
  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c12);
    this.scene.fog = new THREE.Fog(0x080c12, 60, 160);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    this.camera.position.set(24, 16, 24);

    this.controls = new OrbitCam(this.camera, renderer.domElement, {
      dist: 38,
      targetY: 3,
      yaw: 0.8,
      pitch: 0.5,
      autoRotate: true,
      autoRotateSpeed: 0.22,
      rotateButton: 0,
      minDist: 14,
      maxDist: 120,
    });

    this.vehicle = null;
    this.platformAngle = 0;
    this._build();
  }

  _build() {
    this.scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x1a2530, 0.9));
    const dir = new THREE.DirectionalLight(0xfff0d0, 1.1);
    dir.position.set(18, 30, 12);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const d = 30;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    this.scene.add(dir);

    const rim = new THREE.DirectionalLight(0x4fd1ff, 0.7);
    rim.position.set(-20, 12, -16);
    this.scene.add(rim);

    // 平台
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 15, 1.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x18222e, metalness: 0.5, roughness: 0.6 })
    );
    platform.position.y = -0.6;
    platform.receiveShadow = true;
    this.scene.add(platform);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(14, 0.16, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.ring = ring;

    const grid = new THREE.GridHelper(120, 40, 0x17303f, 0x0e1a22);
    grid.position.y = -1.25;
    this.scene.add(grid);

    this.vehicleGroup = new THREE.Group();
    this.scene.add(this.vehicleGroup);
  }

  setBlueprint(bp) {
    this.bp = bp;
    if (this.vehicle) {
      this.vehicle.dispose(this.vehicleGroup);
      this.vehicle = null;
    }
    // 清空旧内容
    while (this.vehicleGroup.children.length) this.vehicleGroup.remove(this.vehicleGroup.children[0]);

    this.vehicle = new Vehicle(bp, SIDE.PLAYER, { isPlayer: true, teamKey: 'player', heading: Math.PI * 0.15 });
    this.vehicleGroup.add(this.vehicle.group);
  }

  onEnter() {
    this.controls.autoRotate = true;
  }

  update(dt) {
    this.controls.update(dt);
    if (this.ring) this.ring.rotation.z += dt * 0.35;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
