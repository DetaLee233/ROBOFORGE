/* =========================================================
 *  editor.js — 载具编辑器
 *  体素式搭建：左键放置 / 右键移除 / 拖拽旋转视角
 *  预算 2000 点；对称建造；带按键部件（武器 / 备用能源）按键绑定
 *  支持多格部件（机械腿 2×3×6）
 * ========================================================= */

/* 由安装朝向构建旋转矩阵（供幽灵预览使用） */
function edDirMatrix(dir) {
  const m = Utils.FACE_MATS[dir | 0] || Utils.FACE_MATS[0];
  return new THREE.Matrix4().set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1
  );
}

class Editor {  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;
    this.active = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f16);
    this.scene.fog = new THREE.Fog(0x0a0f16, 90, 260);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);

    this.controls = new OrbitCam(this.camera, renderer.domElement, {
      dist: 46,
      targetY: 2,
      yaw: 0.75,
      pitch: 0.5,
      rotateButton: 2,     // 右键拖拽旋转
      panButton: 1,        // 中键拖拽平移
      keys: input,
      minDist: 12,
      maxDist: 160,
    });

    this.cells = new Map();     // key -> {t,x,y,z,r,core,k}
    this.selectedType = 'block';
    this.symmetry = false;                                  // 对称建造开关
    this.bindings = { 1: null, 2: null, 3: null };          // 按键 -> 部件类型
    this.cost = 0;

    this.buildGroup = new THREE.Group();
    this.scene.add(this.buildGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hover = null;
    this._dragging = { active: false, x: 0, y: 0, button: -1, moved: false };

    this._onExit = null;
    this._buildScene();
    this._buildGhost();
    this._bindPointer();
    this._bindUI();
  }

  /* ---------------- 场景 ---------------- */

  _buildScene() {
    this.scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x1a2530, 0.95));
    const dir = new THREE.DirectionalLight(0xfff0d0, 1.0);
    dir.position.set(30, 50, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const d = 60;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0x334455, 0.5));

    const grid = new THREE.GridHelper(80, 40, 0x1d4358, 0x122531);
    grid.position.y = -CELL / 2;
    this.scene.add(grid);

    // 拾取平面（地面层）
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.pickPlane.name = 'pickPlane';
    this.scene.add(this.pickPlane);

    // 原点标记
    const origin = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide })
    );
    origin.rotation.x = -Math.PI / 2;
    origin.position.y = 0.02;
    this.scene.add(origin);
  }

  _buildGhost() {
    const makeGhost = (opacity) => {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: opacity, depthWrite: false });
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.9 });
      const geo = new THREE.BoxGeometry(CELL * 0.96, CELL * 0.96, CELL * 0.96);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      group.add(mesh);
      group.visible = false;
      this.scene.add(group);
      return { group, mat, edgeMat, mesh };
    };
    const g1 = makeGhost(0.32);
    this.ghostGroup = g1.group; this.ghostMat = g1.mat; this.ghostEdgeMat = g1.edgeMat; this._ghostMesh = g1.mesh;
    const g2 = makeGhost(0.18);
    this.ghostMirror = g2.group; this.ghostMirrorMat = g2.mat; this.ghostMirrorEdge = g2.edgeMat; this._ghostMirrorMesh = g2.mesh;
  }

  /* ---------------- 蓝图载入 / 提交 ---------------- */

  load(bp, onExit) {
    this._onExit = onExit || this._onExit;
    this.bpName = bp.name || '自制载具';
    this.cells.clear();
    for (const p of bp.parts) {
      this.cells.set(Utils.key(p.x, p.y, p.z), {
        t: p.t, x: p.x, y: p.y, z: p.z, r: p.r || 0, dir: p.dir || 0, core: !!p.core,
        k: PartRegistry.isKeyed(p.t) ? (p.k || 1) : undefined,
      });
    }
    this.selectedType = 'block';
    this._rebuild();
    this._updatePaletteSelection();
    this._setStatus();
  }

  commit() {
    const parts = [];
    for (const c of this.cells.values()) {
      const p = { t: c.t, x: c.x, y: c.y, z: c.z, r: c.r || 0 };
      if (c.dir) p.dir = c.dir;
      if (c.core) p.core = true;
      if (PartRegistry.isKeyed(c.t)) p.k = c.k || 1;
      parts.push(p);
    }
    // 确保存在核心
    if (!parts.some((p) => p.core)) {
      const b = parts.find((p) => PartRegistry.categoryOf(p.t) === 'structure');
      if (b) b.core = true;
    }
    return { name: this.bpName || '自制载具', parts };
  }

  /* ---------------- 网格操作 ---------------- */

  _key(x, y, z) { return Utils.key(x, y, z); }

  _adjacent(x, y, z) {
    for (const [dx, dy, dz] of GRID_NEIGHBORS) {
      if (this.cells.has(this._key(x + dx, y + dy, z + dz))) return true;
    }
    return false;
  }

  _recomputeCost() {
    this.cost = 0;
    for (const c of this.cells.values()) this.cost += PartRegistry.costOf(c.t);
  }

  /* ---------------- 占用 / 放置校验 ---------------- */

  _typeFootprint(type, r, dir) {
    const base = Utils.rotateFootprint(PartRegistry.footprint(type), r || 0);
    return Utils.orientFootprint(base, dir || 0);
  }

  /** 已放置零件占用的网格单元 -> 锚点键 */
  _occupiedMap() {
    const m = new Map();
    for (const [ak, c] of this.cells) {
      for (const [dx, dy, dz] of this._typeFootprint(c.t, c.r || 0, c.dir || 0)) {
        m.set(this._key(c.x + dx, c.y + dy, c.z + dz), ak);
      }
    }
    return m;
  }

  /** 计算本次放置的锚点（含对称镜像，footprint 与安装朝向都镜像） */
  _anchorsFor(cell, type) {
    const anchors = [{ x: cell.x, y: cell.y, z: cell.z, r: (cell.r || 0), dir: (cell.dir || 0) }];
    if (this.symmetry && cell.x !== 0) {
      const base = PartRegistry.footprint(type);
      const rp = Utils.mirrorRotation(base, cell.r || 0);
      anchors.push({ x: -cell.x, y: cell.y, z: cell.z, r: rp, dir: Utils.mirrorDir(cell.dir || 0) });
    }
    return anchors;
  }

  _validatePlacement(anchors, type, occ) {
    const first = this.cells.size === 0;
    const used = new Set();
    for (const a of anchors) {
      for (const [dx, dy, dz] of this._typeFootprint(type, a.r, a.dir)) {
        const k = this._key(a.x + dx, a.y + dy, a.z + dz);
        if (occ.has(k) || used.has(k)) return { ok: false, reason: '该位置已被占用' };
        used.add(k);
      }
    }
    if (first) {
      if (PartRegistry.categoryOf(type) !== 'structure') return { ok: false, reason: '第一个零件必须是结构方块（核心）' };
    } else {
      let connected = false;
      for (const a of anchors) {
        for (const [dx, dy, dz] of this._typeFootprint(type, a.r, a.dir)) {
          for (const [nx, ny, nz] of GRID_NEIGHBORS) {
            if (occ.has(this._key(a.x + dx + nx, a.y + dy + ny, a.z + dz + nz))) { connected = true; break; }
          }
          if (connected) break;
        }
        if (connected) break;
      }
      if (!connected) return { ok: false, reason: '必须与已有零件相邻' };
    }
    if (this.cost + PartRegistry.costOf(type) * anchors.length > Blueprint.BUDGET) {
      return { ok: false, reason: '点数不足：' + PartRegistry.meta[type].name + ' 需要 ' + PartRegistry.costOf(type) + ' 点' };
    }
    return { ok: true };
  }

  _place(cell, type, keyOverride) {
    const isKeyed = PartRegistry.isKeyed(type);
    const bindKey = keyOverride || this._typeKey(type) || 1;

    // 一个按键只允许一种带按键部件
    if (isKeyed) {
      const existing = this.bindings[bindKey];
      if (existing && existing !== type) {
        this._msg('按键 ' + bindKey + ' 已绑定「' + PartRegistry.meta[existing].name + '」', true);
        return false;
      }
    }

    const anchors = this._anchorsFor(cell, type);
    const occ = this._occupiedMap();
    const res = this._validatePlacement(anchors, type, occ);
    if (!res.ok) { this._msg(res.reason, true); return false; }

    const first = this.cells.size === 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const entry = { t: type, x: a.x, y: a.y, z: a.z, r: a.r, dir: a.dir };
      if (first && i === 0) entry.core = true;
      if (isKeyed) entry.k = bindKey;
      if (!entry.dir) delete entry.dir;
      this.cells.set(this._key(a.x, a.y, a.z), entry);
    }
    this._rebuild();
    AudioFX.ui();
    this._msg('');
    return true;
  }

  _removeAt(cell) {
    const targets = [{ x: cell.x, y: cell.y, z: cell.z }];
    if (this.symmetry && cell.x !== 0) targets.push({ x: -cell.x, y: cell.y, z: cell.z });
    let removed = false;
    for (const t of targets) {
      const k = this._key(t.x, t.y, t.z);
      const c = this.cells.get(k);
      if (!c) continue;
      const wasCore = c.core;
      this.cells.delete(k);
      if (wasCore) this._reassignCore();
      removed = true;
    }
    if (!removed) return false;
    this._rebuild();
    AudioFX.ui();
    return true;
  }

  /* ---------------- 按键绑定 ---------------- */

  /** 依据已放置的带按键部件推导 按键 -> 类型 */
  _recomputeBindings() {
    this.bindings = { 1: null, 2: null, 3: null };
    for (const c of this.cells.values()) {
      if (!PartRegistry.isKeyed(c.t)) continue;
      const k = c.k || 1;
      if (!this.bindings[k]) this.bindings[k] = c.t;
    }
  }

  /** 部件类型当前绑定的按键（0 = 未绑定） */
  _typeKey(type) {
    for (const k of [1, 2, 3]) if (this.bindings[k] === type) return k;
    return 0;
  }

  /** 将所有该类型部件重新绑定到指定按键 */
  _rebindType(type, key) {
    for (const c of this.cells.values()) {
      if (c.t === type) c.k = key;
    }
  }

  /** 拖动交换/移动两个按键槽的绑定 */
  _moveBinding(fromKey, toKey) {
    if (fromKey === toKey) return;
    const from = this.bindings[fromKey];
    if (!from) return;
    const to = this.bindings[toKey];
    if (!to || to === from) {
      this._rebindType(from, toKey);
    } else {
      this._rebindType(from, toKey);
      this._rebindType(to, fromKey);
    }
    this._rebuild();
    this._msg('已更新按键绑定');
  }

  _reassignCore() {
    let best = null, bestScore = -1;
    for (const c of this.cells.values()) {
      if (PartRegistry.categoryOf(c.t) !== 'structure') continue;
      let score = 0;
      for (const [dx, dy, dz] of GRID_NEIGHBORS) {
        if (this.cells.has(this._key(c.x + dx, c.y + dy, c.z + dz))) score++;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) best.core = true;
  }

  _rebuild() {
    while (this.buildGroup.children.length) this.buildGroup.remove(this.buildGroup.children[0]);
    for (const c of this.cells.values()) {
      let part;
      try { part = PartRegistry.create(c.t); } catch (e) { continue; }
      part.core = !!c.core;
      part.grid.x = c.x; part.grid.y = c.y; part.grid.z = c.z;
      part.rot = c.r || 0;
      part.dir = c.dir || 0;
      if (PartRegistry.isKeyed(c.t)) part.key = c.k || 1;
      part.mount(this.buildGroup);
      const box = this._ghostBox(c.t, c.r || 0, c.dir || 0);
      part.mesh.position.set(
        c.x * CELL + box.cx,
        c.y * CELL + box.cy + (part.yOffset || 0),
        c.z * CELL + box.cz
      );
      if (part.dir) {
        const om = part.orientMatrix();
        if (om) part.mesh.quaternion.setFromRotationMatrix(om);
      }
      if (part.rot) part.mesh.rotateY(part.rot * Math.PI / 2);
      if (!part.dir) part.alignBottomTo(c.y * CELL - CELL / 2 + (part.yOffset || 0));
    }
    this._recomputeCost();
    this._recomputeBindings();
    this._refreshSlots();
    this._setStatus();
  }

  /* ---------------- 指针交互 ---------------- */

  _bindPointer() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this._dragging = { active: true, x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.active || !this._dragging.active) return;
      const dx = e.clientX - this._dragging.x;
      const dy = e.clientY - this._dragging.y;
      const moved = dx * dx + dy * dy > 25;
      const button = this._dragging.button;
      this._dragging.active = false;
      if (moved) return;               // 拖拽视为操作相机

      if (button === 0) this._tryPlace();
      else if (button === 2) this._tryRemove();
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._updateHover();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.hover && this.hover.hitPart) this._removeAt(this.hover.hitPart.grid);
        else if (this.hover) this._removeAt(this.hover.placeCell);
      }
    });
  }

  _partOf(obj) {
    let o = obj;
    while (o) {
      if (o.userData && o.userData.part) return o.userData.part;
      o = o.parent;
    }
    return null;
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.buildGroup.children, true);
    const solid = hits.filter((h) => h.face && h.object.isMesh);
    if (solid.length) {
      const h = solid[0];
      const part = this._partOf(h.object);
      if (part && h.face) {
        const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
        const n = h.face.normal.clone().applyMatrix3(nm).normalize();
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        const off = { x: 0, y: 0, z: 0 };
        let dir = 0;
        if (ax >= ay && ax >= az) { off.x = Math.sign(n.x); dir = n.x >= 0 ? 2 : 3; }
        else if (ay >= az) { off.y = Math.sign(n.y); dir = n.y >= 0 ? 0 : 1; }
        else { off.z = Math.sign(n.z); dir = n.z >= 0 ? 4 : 5; }
        // 命中点最近的占用单元（支持多格部件，如机械腿顶面）
        let cell = [part.grid.x, part.grid.y, part.grid.z];
        let bestD = Infinity;
        for (const [dx, dy, dz] of part.footprintCells()) {
          const wx = (part.grid.x + dx) * CELL, wy = (part.grid.y + dy) * CELL, wz = (part.grid.z + dz) * CELL;
          const d = (wx - h.point.x) ** 2 + (wy - h.point.y) ** 2 + (wz - h.point.z) ** 2;
          if (d < bestD) { bestD = d; cell = [part.grid.x + dx, part.grid.y + dy, part.grid.z + dz]; }
        }
        return {
          hitPart: part,
          placeCell: { x: cell[0] + off.x, y: cell[1] + off.y, z: cell[2] + off.z, dir },
        };
      }
    }
    const plane = this.raycaster.intersectObject(this.pickPlane, false)[0];
    if (plane) {
      return {
        hitPart: null,
        placeCell: {
          x: Math.round(plane.point.x / CELL),
          y: 0,
          z: Math.round(plane.point.z / CELL),
          dir: 0,
        },
      };
    }
    return null;
  }

  _updateHover() {
    const pick = this._pick();
    this.hover = pick;
    if (!pick) { this.ghostGroup.visible = false; this.ghostMirror.visible = false; return; }

    const cell = pick.placeCell;
    const anchors = this._anchorsFor(cell, this.selectedType);
    const occ = this._occupiedMap();
    const res = this._validatePlacement(anchors, this.selectedType, occ);
    const valid = res.ok;

    const applyGhost = (group, mesh, mat, edge, gx, gy, gz, b, dir) => {
      group.visible = true;
      group.position.set(gx * CELL, gy * CELL, gz * CELL);
      mesh.scale.set(b.sx / 0.96, b.sy / 0.96, b.sz / 0.96);
      mesh.position.set(b.cx, b.cy, b.cz);
      mesh.quaternion.identity();
      if (dir) mesh.quaternion.setFromRotationMatrix(edDirMatrix(dir));
      mat.color.setHex(valid ? 0x4fd1ff : 0xff5c5c);
      edge.color.setHex(valid ? 0x9fe9ff : 0xffb0b0);
    };
    const dir = cell.dir || 0;
    const box = this._ghostBox(this.selectedType, cell.r || 0, dir);
    applyGhost(this.ghostGroup, this._ghostMesh, this.ghostMat, this.ghostEdgeMat, cell.x, cell.y, cell.z, box, dir);

    // 对称镜像预览（footprint 与朝向都镜像）
    if (this.symmetry && cell.x !== 0) {
      const rp = Utils.mirrorRotation(PartRegistry.footprint(this.selectedType), cell.r || 0);
      const md = Utils.mirrorDir(dir);
      const mbox = this._ghostBox(this.selectedType, rp, md);
      applyGhost(this.ghostMirror, this._ghostMirrorMesh, this.ghostMirrorMat, this.ghostMirrorEdge, -cell.x, cell.y, cell.z, mbox, md);
    } else {
      this.ghostMirror.visible = false;
    }
    this.hover.valid = valid;
  }

  /** 零件占用体包围盒（格数与中心偏移，含安装朝向） */
  _ghostBox(type, r, dir) {
    const fp = this._typeFootprint(type, r || 0, dir || 0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [dx, dy, dz] of fp) {
      x0 = Math.min(x0, dx); x1 = Math.max(x1, dx);
      y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
      z0 = Math.min(z0, dz); z1 = Math.max(z1, dz);
    }
    return {
      sx: x1 - x0 + 1, sy: y1 - y0 + 1, sz: z1 - z0 + 1,
      cx: ((x0 + x1) / 2) * CELL, cy: ((y0 + y1) / 2) * CELL, cz: ((z0 + z1) / 2) * CELL,
    };
  }

  _tryPlace() {
    if (!this.hover) return;
    const type = this.selectedType;
    // 带按键部件（武器 / 备用能源）：首次使用需选择按键
    if (PartRegistry.isKeyed(type) && this._typeKey(type) === 0) {
      this._openBind(type, this.hover.placeCell);
      return;
    }
    this._place(this.hover.placeCell, type);
    this._updateHover();
  }

  _tryRemove() {
    if (!this.hover) return;
    if (this.hover.hitPart) this._removeAt(this.hover.hitPart.grid);
    this._updateHover();
  }

  /* ---------------- 界面 ---------------- */

  _bindUI() {
    this.elStatus = document.getElementById('editor-status');
    this.elBudget = document.getElementById('budget');
    this.elJson = document.getElementById('ed-json');
    this.elMsg = document.getElementById('ed-json-msg');

    const palette = document.getElementById('palette');
    palette.innerHTML = '';
    this._palButtons = {};
    for (const group of PartRegistry.palette()) {
      const title = document.createElement('div');
      title.className = 'pal-group';
      title.textContent = group.name;
      palette.appendChild(title);
      for (const item of group.items) {
        const div = document.createElement('div');
        div.className = 'pal-item';
        div.innerHTML =
          `<span class="pal-swatch" style="background:${item.swatch}"></span>` +
          `<span class="pal-meta"><span class="pm-name">${item.name}</span>` +
          `<span class="pm-cost">${item.cost} 点 · ${item.hp} HP</span></span>`;
        div.addEventListener('click', () => {
          this.selectedType = item.type;
          this._updatePaletteSelection();
          this._updateHover();
        });
        palette.appendChild(div);
        this._palButtons[item.type] = div;
      }
    }

    // 对称建造开关
    this.elSym = document.getElementById('sym-toggle');
    if (this.elSym) {
      this.elSym.addEventListener('click', () => {
        this.symmetry = !this.symmetry;
        this.elSym.textContent = this.symmetry ? '开' : '关';
        this.elSym.classList.toggle('on', this.symmetry);
        this._msg(this.symmetry ? '对称建造：开' : '对称建造：关');
        this._updateHover();
      });
    }

    // 按键槽（可拖动交换）
    this.elSlots = document.getElementById('key-slots');
    this._slotEls = {};
    if (this.elSlots) {
      this.elSlots.innerHTML = '';
      for (const k of [1, 2, 3]) {
        const slot = document.createElement('div');
        slot.className = 'key-slot';
        slot.draggable = true;
        slot.dataset.key = String(k);
        slot.innerHTML = `<span class="ks-key">${k}</span><span class="ks-name">空</span>`;
        slot.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(k));
          e.dataTransfer.effectAllowed = 'move';
          slot.classList.add('dragging');
        });
        slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
        slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
        slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
        slot.addEventListener('drop', (e) => {
          e.preventDefault();
          slot.classList.remove('drag-over');
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (from) this._moveBinding(from, k);
        });
        this.elSlots.appendChild(slot);
        this._slotEls[k] = slot;
      }
    }

    // 按键绑定选择框
    this.elBindModal = document.getElementById('bind-modal');
    this.elBindOptions = document.getElementById('bind-options');
    this.elBindSub = document.getElementById('bind-sub');
    this.elBindTitle = document.getElementById('bind-title');
    if (this.elBindModal) {
      document.getElementById('bind-cancel').addEventListener('click', () => this._closeBind());
    }

    // 载具库
    const lib = document.getElementById('vehicle-library');
    if (lib) {
      lib.innerHTML = '';
      for (const bp of VehicleLibrary.all()) {
        const b = document.createElement('button');
        b.className = 'btn lib-btn';
        b.textContent = bp.name;
        b.addEventListener('click', () => {
          this.load(bp, this._onExit);
          this._msg('已载入：' + bp.name);
        });
        lib.appendChild(b);
      }
    }

    document.getElementById('ed-default').addEventListener('click', () => {
      const bp = Blueprint.createDefault();
      this.load(bp, this._onExit);
      this._msg('已载入基础载具');
    });
    document.getElementById('ed-clear').addEventListener('click', () => {
      this.cells.clear();
      this._rebuild();
      this._msg('已清空');
    });
    document.getElementById('ed-save').addEventListener('click', () => {
      this._openSave();
    });
    document.getElementById('ed-export').addEventListener('click', () => {
      const bp = this.commit();
      const json = Blueprint.toJSON(bp);
      this.elJson.value = json;
      this._download(json);
      this._msg('已导出 JSON');
    });
    document.getElementById('ed-copy').addEventListener('click', () => {
      this.elJson.value = Blueprint.toJSON(this.commit());
      this.elJson.select();
      this._msg('已生成 JSON，可复制');
    });
    document.getElementById('ed-import').addEventListener('click', () => {
      const res = Blueprint.fromJSON(this.elJson.value);
      if (!res.ok) { this._msg('导入失败：' + res.error, true); return; }
      this.load(res.bp, this._onExit);
      this._msg('导入成功');
    });
    document.getElementById('ed-back').addEventListener('click', () => {
      const bp = this.commit();
      const res = Blueprint.validate(bp);
      if (!res.ok) { this._msg('无法完成：' + res.error, true); return; }
      if (this._onExit) this._onExit(res.bp);
    });

    // 保存命名框
    this.elSaveModal = document.getElementById('save-modal');
    this.elSaveName = document.getElementById('save-name');
    this.elSaveMsg = document.getElementById('save-msg');
    this.elSaveTitle = document.getElementById('save-title');
    this.elSaveConfirm = document.getElementById('save-confirm');
    this._pendingName = null;
    if (this.elSaveModal) {
      document.getElementById('save-cancel').addEventListener('click', () => this._closeSave());
      this.elSaveConfirm.addEventListener('click', () => this._doSave());
      this.elSaveName.addEventListener('input', () => {
        this._pendingName = null;
        this.elSaveConfirm.textContent = '保存';
        this.elSaveMsg.textContent = '';
        this.elSaveMsg.classList.remove('err');
      });
      this.elSaveName.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') this._doSave();
        if (e.code === 'Escape') this._closeSave();
      });
    }
  }

  _openSave() {
    if (!this.elSaveModal) return;
    this._pendingName = null;
    this.elSaveConfirm.textContent = '保存';
    this.elSaveMsg.textContent = '';
    this.elSaveMsg.classList.remove('err');
    this.elSaveTitle.textContent = '保存到载具库';
    this.elSaveName.value = this.bpName || '自制载具';
    this.elSaveModal.classList.remove('hidden');
    this.elSaveName.focus();
    this.elSaveName.select();
  }

  _closeSave() {
    if (this.elSaveModal) this.elSaveModal.classList.add('hidden');
    this._pendingName = null;
  }

  _doSave() {
    const name = (this.elSaveName.value || '').trim();
    const overwrite = (this._pendingName === name);
    const res = VehicleLibrary.save(name, this.commit(), overwrite);
    if (res.ok) {
      this.bpName = res.name;
      this._closeSave();
      this._msg((res.overwrote ? '已覆盖：' : '已保存到载具库：') + res.name);
      Bus.emit('library:changed');
      AudioFX.ui();
    } else if (res.needConfirm) {
      this._pendingName = res.name;
      this.elSaveTitle.textContent = '覆盖载具';
      this.elSaveConfirm.textContent = '覆盖保存';
      this.elSaveMsg.textContent = '已存在同名载具「' + res.name + '」，再次点击以确认覆盖';
      this.elSaveMsg.classList.remove('err');
    } else {
      this.elSaveMsg.textContent = res.error || '保存失败';
      this.elSaveMsg.classList.add('err');
    }
  }

  _updatePaletteSelection() {
    for (const type in this._palButtons) {
      this._palButtons[type].classList.toggle('active', type === this.selectedType);
    }
  }

  _refreshSlots() {
    if (!this._slotEls) return;
    for (const k of [1, 2, 3]) {
      const el = this._slotEls[k];
      if (!el) continue;
      const type = this.bindings[k];
      const nameEl = el.querySelector('.ks-name');
      el.classList.toggle('occupied', !!type);
      if (nameEl) {
        if (type) {
          const meta = PartRegistry.meta[type] || {};
          let n = 0;
          for (const c of this.cells.values()) if (c.t === type) n++;
          nameEl.textContent = (meta.name || type) + ' ×' + n;
        } else {
          nameEl.textContent = '空';
        }
      }
    }
  }

  /** 打开按键绑定选择框；pendingCell 存在时选择后立即放置 */
  _openBind(type, pendingCell) {
    if (!this.elBindModal) {
      for (const k of [1, 2, 3]) if (!this.bindings[k]) { this._place(pendingCell, type, k); return; }
      return;
    }
    this._pendingBind = { type, cell: pendingCell || null };
    const meta = PartRegistry.meta[type] || {};
    this.elBindTitle.textContent = '选择「' + (meta.name || type) + '」的按键';
    this.elBindSub.textContent = '一个按键只放一种带按键部件；被占用的按键不可选';
    this.elBindOptions.innerHTML = '';
    for (const k of [1, 2, 3]) {
      const occupied = this.bindings[k];
      const disabled = occupied && occupied !== type;
      const btn = document.createElement('div');
      btn.className = 'bind-opt' + (disabled ? ' disabled' : '');
      const occMeta = occupied ? (PartRegistry.meta[occupied] || {}) : null;
      btn.innerHTML = `<b>${k}</b>${disabled ? (occMeta.name || occupied) : '选择'}` +
        `<small>${disabled ? '已占用' : (occupied ? '同类' : '空位')}</small>`;
      if (!disabled) btn.addEventListener('click', () => this._chooseBind(k));
      this.elBindOptions.appendChild(btn);
    }
    this.elBindModal.classList.remove('hidden');
  }

  _chooseBind(key) {
    const pending = this._pendingBind;
    this._closeBind();
    if (!pending) return;
    if (pending.cell) {
      this._place(pending.cell, pending.type, key);
      this._updateHover();
    } else {
      this._msg('部件将绑定到按键 ' + key);
    }
  }

  _closeBind() {
    this._pendingBind = null;
    if (this.elBindModal) this.elBindModal.classList.add('hidden');
  }

  _setStatus() {
    this._recomputeCost();
    const used = this.cost;
    const over = used > Blueprint.BUDGET;
    let blocks = 0, wheels = 0, weapons = 0, modules = 0;
    for (const c of this.cells.values()) {
      const cat = PartRegistry.categoryOf(c.t);
      if (cat === 'structure') blocks++;
      else if (cat === 'movement') wheels++;
      else if (cat === 'weapon') weapons++;
      else if (cat === 'module') modules++;
    }
    if (this.elStatus) {
      this.elStatus.innerHTML =
        `点数 <b>${used}</b> / ${Blueprint.BUDGET}　·　方块 ${blocks}　运动 ${wheels}　武器 ${weapons}　模块 ${modules}`;
    }
    if (this.elBudget) {
      this.elBudget.innerHTML =
        `已用：<span class="${over ? 'over' : 'used'}">${used}</span> / ${Blueprint.BUDGET}<br>` +
        `剩余：${Blueprint.BUDGET - used}<br>` +
        `方块 ${blocks} · 运动 ${wheels} · 武器 ${weapons} · 模块 ${modules}`;
    }
  }

  _msg(text, isError) {
    if (!this.elMsg) return;
    this.elMsg.textContent = text || '';
    this.elMsg.classList.toggle('err', !!isError);
  }

  _download(text) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'roboforge-vehicle.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 生命周期 ---------------- */

  onEnter() { this.active = true; this.controls.enabled = true; }
  onExit() { this.active = false; this.controls.enabled = false; this.ghostGroup.visible = false; this.ghostMirror.visible = false; }

  update(dt) {
    if (this.active) this.controls.update(dt);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
