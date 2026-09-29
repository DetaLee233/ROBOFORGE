/* =========================================================
 *  library.js — 载具库独立页面
 *  展示所有载具缩略图，可选择使用 / 编辑 / 删除（玩家载具）
 * ========================================================= */

class VehicleLibraryPage {
  constructor(renderer, hooks) {
    this.renderer = renderer;
    this.hooks = hooks || {};        // { onUse(bp), onEdit(bp) }
    this.thumb = new Thumbnailer(renderer);
    this.root = document.getElementById('screen-library');
    this.grid = document.getElementById('library-grid');
    this.msgEl = document.getElementById('library-msg');
    document.getElementById('lib-back').addEventListener('click', () => {
      if (this.hooks.onBack) this.hooks.onBack();
    });
    this._built = false;
  }

  refresh() {
    this._built = true;
    this.grid.innerHTML = '';
    const list = VehicleLibrary.all();
    for (const bp of list) {
      this.grid.appendChild(this._card(bp));
    }
  }

  _card(bp) {
    const stats = Blueprint.stats(bp);
    const builtin = VehicleLibrary.isBuiltin(bp.name);

    const card = document.createElement('div');
    card.className = 'lib-card';

    const img = document.createElement('img');
    img.className = 'lib-thumb';
    img.alt = bp.name;
    img.src = this.thumb.get(bp);
    card.appendChild(img);

    const body = document.createElement('div');
    body.className = 'lib-body';
    body.innerHTML =
      `<div class="lib-name">${bp.name}${builtin ? '' : ' <em>自制</em>'}</div>` +
      `<div class="lib-stats">点数 <b>${stats.cost}</b> / ${Blueprint.BUDGET} · 结构 ${stats.hp} HP</div>` +
      `<div class="lib-stats">方块 ${stats.counts.block || 0} · 强化 ${stats.counts.reinforced || 0} · ` +
      `轮 ${stats.counts.wheel || 0} · 履带 ${stats.counts.track || 0}</div>` +
      `<div class="lib-stats">机枪 ${stats.counts.machinegun || 0} · 榴弹 ${stats.counts.grenade || 0} · ` +
      `模块 ${(stats.counts.computer || 0) + (stats.counts.battery || 0)}</div>`;
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'lib-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'btn btn-primary';
    useBtn.textContent = '使用';
    useBtn.addEventListener('click', () => {
      AudioFX.ui();
      if (this.hooks.onUse) this.hooks.onUse(Blueprint.clone(bp));
    });
    actions.appendChild(useBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => {
      AudioFX.ui();
      if (this.hooks.onEdit) this.hooks.onEdit(Blueprint.clone(bp));
    });
    actions.appendChild(editBtn);

    if (!builtin) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        if (!window.confirm('删除自制载具「' + bp.name + '」？')) return;
        VehicleLibrary.remove(bp.name);
        this.refresh();
      });
      actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    return card;
  }

  onEnter() {
    // 每次进入都重建，保证缩略图与实际一致
    this.refresh();
  }

  onExit() { }

  update() { }

  resize() { }
}
