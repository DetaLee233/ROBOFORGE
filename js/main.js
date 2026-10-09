/* =========================================================
 *  main.js — 应用入口
 *  管理渲染器、输入、各“屏幕”（机库 / 编辑器 / 战斗）
 * ========================================================= */

(function () {
  'use strict';

  const loading = document.getElementById('loading');

  if (typeof THREE === 'undefined') {
    loading.textContent = 'Three.js 加载失败，请检查网络后刷新（需要访问 CDN）';
    return;
  }

  /* ---------------- 渲染器 ---------------- */

  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const input = new Input(canvas);

  /* ---------------- 屏幕 ---------------- */

  const hangar = new Hangar(renderer, input);
  const editor = new Editor(renderer, input);
  const game = new Game(renderer, input);
  const hud = new HUD();
  const settingsPanel = new SettingsPanel();

  let blueprint = Blueprint.loadLocal() || VehicleLibrary.randomNear(VehicleLibrary.TARGET);

  function applyBlueprint(bp) {
    blueprint = bp;
    Blueprint.saveLocal(bp);
    hangar.setBlueprint(bp);
    updateHangarInfo(bp);
  }

  const libraryPage = new VehicleLibraryPage(renderer, {
    onUse(bp) { applyBlueprint(bp); show('hangar'); },
    onEdit(bp) {
      editor.load(bp, (out) => {
        applyBlueprint(out);
        show('hangar');
      });
      show('editor');
    },
    onBack() { show('hangar'); },
  });

  const screens = {
    hangar: { obj: hangar, el: document.getElementById('screen-hangar') },
    editor: { obj: editor, el: document.getElementById('screen-editor') },
    library: { obj: libraryPage, el: document.getElementById('screen-library') },
    game: { obj: game, el: document.getElementById('screen-game') },
  };

  let current = 'hangar';

  function show(name) {
    for (const key in screens) {
      screens[key].el.classList.toggle('hidden', key !== name);
      if (key !== name && screens[key].obj.onExit) screens[key].obj.onExit();
    }
    current = name;
    const screen = screens[name];
    if (screen.obj.onEnter) screen.obj.onEnter();
    screen.obj.resize(window.innerWidth, window.innerHeight);
    if (name !== 'game' && input.locked) input.exitLock();
    Bus.emit(EV.SCREEN_CHANGE, { screen: name });
  }

  function currentObj() {
    return screens[current].obj;
  }

  /* ---------------- 蓝图 ---------------- */

  function updateHangarInfo(bp) {
    const s = Blueprint.stats(bp);
    let weapons = 0, modules = 0;
    for (const t in s.counts) {
      const cat = PartRegistry.categoryOf(t);
      if (cat === 'weapon') weapons += s.counts[t];
      else if (cat === 'module') modules += s.counts[t];
    }
    document.getElementById('hi-name').textContent = bp.name || '自制载具';
    document.getElementById('hi-blocks').textContent = (s.counts.block || 0) + (s.counts.reinforced || 0);
    document.getElementById('hi-guns').textContent = weapons;
    document.getElementById('hi-wheels').textContent = (s.counts.wheel || 0) + (s.counts.track || 0);
    const modEl = document.getElementById('hi-modules');
    if (modEl) modEl.textContent = modules;
    document.getElementById('hi-hp').textContent = s.hp;
    document.getElementById('hi-cost').textContent = s.cost + ' / ' + Blueprint.BUDGET;
  }

  hangar.setBlueprint(blueprint);
  updateHangarInfo(blueprint);

  /* ---------------- 按钮 ---------------- */

  const modeModal = document.getElementById('mode-modal');
  let lastMode = 'tdm';

  function startGame(mode) {
    lastMode = mode || 'tdm';
    AudioFX.resume();
    hud.reset();
    game.start(blueprint, lastMode);
    show('game');
  }

  document.getElementById('btn-start').addEventListener('click', () => {
    AudioFX.resume();
    modeModal.classList.remove('hidden');
  });

  if (modeModal) {
    for (const btn of modeModal.querySelectorAll('.mode-btn')) {
      btn.addEventListener('click', () => {
        modeModal.classList.add('hidden');
        startGame(btn.dataset.mode);
      });
    }
    document.getElementById('mode-cancel').addEventListener('click', () => {
      modeModal.classList.add('hidden');
    });
  }

  document.getElementById('btn-edit').addEventListener('click', () => {
    AudioFX.resume();
    editor.load(blueprint, (bp) => {
      applyBlueprint(bp);
      show('hangar');
    });
    show('editor');
  });

  document.getElementById('btn-library').addEventListener('click', () => {
    AudioFX.resume();
    show('library');
  });

  Bus.on('library:changed', () => {
    if (current === 'library') libraryPage.refresh();
  });

  // 设置面板：从机库或暂停菜单打开，关闭时回到原状态
  document.getElementById('btn-settings-hangar').addEventListener('click', () => {
    settingsPanel.show();
  });
  document.getElementById('gm-settings').addEventListener('click', () => {
    settingsPanel.show();
  });

  document.getElementById('gm-resume').addEventListener('click', () => {
    game.paused = false;
    hud.hideMenu();
    input.requestLock();
  });

  // 自毁机体（夺点模式）：无条件自毁，走复活流程回出生点
  document.getElementById('gm-self-destruct').addEventListener('click', () => {
    if (game.modeName !== 'capture') return;
    const p = game.player;
    if (!p || !p.alive) return;
    game.paused = false;
    hud.hideMenu();
    if (input.locked) input.exitLock();
    p._explode(null);
  });

  document.getElementById('gm-restart').addEventListener('click', () => {
    startGame(lastMode);
  });

  document.getElementById('gm-exit').addEventListener('click', () => {
    game.paused = true;
    game.state = 'idle';
    hud.hideMenu();
    show('hangar');
  });

  /* ---------------- 全局按键 ---------------- */

  Bus.on('input:keydown', (code) => {
    if (code === 'Escape') {
      if (settingsPanel.visible) { settingsPanel.hide(); return; }
      if (current === 'game' && game.state === 'playing') {
        game.paused = !game.paused;
        if (game.paused) {
          if (input.locked) input.exitLock();
          hud.showMenu({
            title: '暂停', sub: '按 ESC 或“继续战斗”回到战场', canResume: true,
            selfDestruct: game.modeName === 'capture',
          });
        } else {
          hud.hideMenu();
        }
      }
    }
    if (code === 'KeyR' && current === 'game' &&
        (game.state === 'playing' || game.state === 'over') &&
        game.player && !game.player.alive) {
      hud.reset();
      game.start(blueprint, lastMode);
    }
  });

  Bus.on('input:mousedown', () => AudioFX.resume());

  /* ---------------- 自适应 ---------------- */

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    for (const key in screens) screens[key].obj.resize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();   // 首帧前按真实窗口尺寸设置各相机 aspect，避免拉伸

  /* ---------------- 主循环 ---------------- */

  let last = performance.now();
  let started = false;

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // 限制单帧步长，避免卡顿后穿模

    const obj = currentObj();
    try {
      obj.update(dt);
    } catch (err) {
      console.error('[update]', err);
    }
    renderer.render(obj.scene || game.scene, obj.camera || game.camera);

    if (!started) {
      started = true;
      loading.classList.add('hide');
      setTimeout(() => loading.remove(), 600);
    }
  }

  requestAnimationFrame(loop);

  // 暴露到全局便于调试
  window.RoboForge = {
    renderer, input, hangar, editor, game, hud, settingsPanel,
    Blueprint, Settings, PartRegistry, VehicleLibrary, THREE,
    get blueprint() { return blueprint; },
  };
})();
