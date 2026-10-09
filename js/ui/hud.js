/* =========================================================
 *  hud.js — 战斗界面 / 菜单
 * ========================================================= */

class HUD {
  constructor() {
    this.el = {
      scoreBlue: document.getElementById('score-blue'),
      scoreRed: document.getElementById('score-red'),
      hp: document.getElementById('hud-hp'),
      hpText: document.getElementById('hud-hp-text'),
      en: document.getElementById('hud-en'),
      enText: document.getElementById('hud-en-text'),
      objective: document.getElementById('objective'),
      hitmarker: document.getElementById('hitmarker'),
      crosshair: document.getElementById('crosshair'),
      gsight: document.getElementById('grenade-sight'),
      cdRing: document.getElementById('cd-ring'),
      weapons: document.getElementById('hud-weapons'),
      modules: document.getElementById('hud-modules'),
      mode: document.getElementById('hud-mode'),
      capBlue: document.getElementById('cap-blue'),
      capRed: document.getElementById('cap-red'),
      capPoints: document.getElementById('cap-points'),
      capTimer: document.getElementById('cap-timer'),
      notice: document.getElementById('hud-notice'),
      banner: document.getElementById('banner'),
      menu: document.getElementById('game-menu'),
      menuTitle: document.getElementById('gm-title'),
      menuSub: document.getElementById('gm-sub'),
      menuResume: document.getElementById('gm-resume'),
      menuSelfDestruct: document.getElementById('gm-self-destruct'),
    };
    this._slots = {};
    if (this.el.weapons) {
      for (const slot of this.el.weapons.querySelectorAll('.wslot')) {
        this._slots[slot.dataset.key] = slot;
      }
    }
    this._hitTimer = null;
    this._bindEvents();
  }

  _bindEvents() {
    Bus.on(EV.GAME_STATUS, (s) => this._onStatus(s));
    Bus.on(EV.GAME_OVER, (e) => this._onOver(e));
    Bus.on(EV.PROJECTILE_HIT, (e) => {
      if (e.source && e.source.isPlayer) this.hitmarker();
    });
    Bus.on('hud:notice', (e) => this.notice(e && e.text));
  }

  notice(text) {
    if (!this.el.notice || !text) return;
    this.el.notice.textContent = text;
    this.el.notice.classList.remove('show');
    void this.el.notice.offsetWidth;
    this.el.notice.classList.add('show');
  }

  _onStatus(s) {
    this.el.scoreBlue.textContent = s.blue;
    this.el.scoreRed.textContent = s.red;

    const hp = Utils.clamp(s.hp, 0, 1);
    this.el.hp.style.transform = `scaleX(${hp})`;
    this.el.hpText.textContent = Math.round(hp * 100) + '%';

    const en = Utils.clamp(s.energy, 0, 1);
    this.el.en.style.transform = `scaleX(${en})`;
    this.el.enText.textContent = Math.round(en * 1000);

    // 武器槽
    for (const k of ['1', '2', '3']) {
      const slot = this._slots[k];
      if (!slot) continue;
      const has = !!(s.keys && s.keys[k]);
      const active = Number(s.activeKey) === Number(k);
      slot.classList.toggle('has', has);
      slot.classList.toggle('active', active && has);
      const nameEl = slot.querySelector('.wname');
      if (nameEl) nameEl.textContent = (s.weaponNames && s.weaponNames[k]) || (has ? '武器' : '—');
    }

    // 模块状态
    if (this.el.modules) {
      const parts = [];
      if (s.hasComputer) parts.push('<span class="mod on">弹道计算机</span>');
      if (s.hasBattery) {
        if (s.backupReady) parts.push('<span class="mod ready">备用能源 就绪</span>');
        else parts.push(`<span class="mod">备用能源 ${Math.ceil(s.backupCooldown)}s</span>`);
      }
      this.el.modules.innerHTML = parts.join('');
    }

    if (!s.alive) this.el.objective.textContent = '载具已损毁 · 观战中';
    else if (s.mode === 'capture') this.el.objective.textContent = '任务：占领得分点，累积结束进度';

    // 夺点模式：双方进度 + 三个得分点归属
    if (this.el.mode) {
      const cap = s.capture;
      const on = s.mode === 'capture' && !!cap;
      this.el.mode.classList.toggle('hidden', !on);
      if (on) {
        this.el.capBlue.textContent = Math.floor(cap.blue) + '%';
        this.el.capRed.textContent = Math.floor(cap.red) + '%';
        if (!this._capDots) {
          this.el.capPoints.innerHTML = '<i class="hm-dot"></i><i class="hm-dot"></i><i class="hm-dot"></i>';
          this._capDots = this.el.capPoints.querySelectorAll('.hm-dot');
        }
        for (let i = 0; i < this._capDots.length && i < cap.points.length; i++) {
          const owner = cap.points[i];
          this._capDots[i].className = 'hm-dot' +
            (owner === 0 ? ' blue' : owner === 1 ? ' red' : '') +
            (cap.contested[i] ? ' contest' : '');
        }
        if (this.el.capTimer && typeof cap.timeLeft === 'number') {
          const t = Math.max(0, Math.ceil(cap.timeLeft));
          const mm = String(Math.floor(t / 60)).padStart(2, '0');
          const ss = String(t % 60).padStart(2, '0');
          this.el.capTimer.textContent = mm + ':' + ss;
          this.el.capTimer.classList.toggle('urgent', t <= 60);
        }
      }
    }

    // 准星随散布/后坐力扩张
    if (this.el.crosshair) {
      const spread = Utils.clamp(s.spread || 0, 0, 1);
      this.el.crosshair.style.transform =
        `translate(-50%,-50%) scale(${1 + spread * 1.6})`;
      this.el.crosshair.style.opacity = String(0.7 + (1 - spread) * 0.3);
    }

    // 榴弹“丰”形瞄准镜
    if (this.el.gsight) {
      const show = !!s.grenadeSight;
      this.el.gsight.classList.toggle('hidden', !show);
      if (this.el.crosshair) this.el.crosshair.style.visibility = show ? 'hidden' : '';
    }

    // 冷却环形进度：满圈表示就绪
    if (this.el.cdRing) {
      const ready = 1 - Utils.clamp(s.cooldown || 0, 0, 1);
      this.el.cdRing.style.setProperty('--cd', ready.toFixed(3));
    }
  }

  hitmarker() {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  banner(text, cls) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = cls || '';
    b.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.add('hidden'), 2400);
  }

  showMenu(opts) {
    opts = opts || {};
    this.el.menuTitle.textContent = opts.title || '暂停';
    this.el.menuSub.textContent = opts.sub || '';
    this.el.menuResume.style.display = opts.canResume === false ? 'none' : 'block';
    // 夺点模式提供“自毁机体”（无条件，自毁后按复活流程回基地）
    if (this.el.menuSelfDestruct) {
      this.el.menuSelfDestruct.classList.toggle('hidden', opts.selfDestruct !== true);
    }
    this.el.menu.classList.remove('hidden');
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  _onOver(e) {
    if (e.win) {
      this.banner('胜  利', 'win');
      this.showMenu({ title: '战斗胜利', sub: '全部敌军已被摧毁', canResume: false });
    } else {
      this.banner('任务失败', 'lose');
      this.showMenu({ title: '载具损毁', sub: '友军未能守住战场', canResume: false });
    }
  }

  reset() {
    this.hideMenu();
    this.el.banner.classList.add('hidden');
    this.el.objective.textContent = '任务：消灭全部敌军';
    this.el.hp.style.transform = 'scaleX(1)';
    this.el.en.style.transform = 'scaleX(1)';
    if (this.el.crosshair) {
      this.el.crosshair.style.transform = 'translate(-50%,-50%) scale(1)';
      this.el.crosshair.style.opacity = '1';
      this.el.crosshair.style.visibility = '';
    }
    if (this.el.gsight) this.el.gsight.classList.add('hidden');
    if (this.el.mode) this.el.mode.classList.add('hidden');
    if (this.el.cdRing) this.el.cdRing.style.setProperty('--cd', '0');
  }
}
