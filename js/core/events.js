/* =========================================================
 *  events.js — 极简事件总线（事件驱动核心）
 *  全局单例 Bus：负责模块间解耦通信
 * ========================================================= */
class EventBus {
  constructor() {
    this._map = new Map();
  }

  /** 订阅，返回取消订阅函数 */
  on(type, fn) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  /** 只触发一次 */
  once(type, fn) {
    const off = this.on(type, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(type, fn) {
    const set = this._map.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler error on "${type}"`, err);
      }
    }
  }

  clear(type) {
    if (type) this._map.delete(type);
    else this._map.clear();
  }
}

const Bus = new EventBus();

/* 全局事件名常量，避免拼写错误 */
const EV = {
  SCREEN_CHANGE: 'screen:change',
  VEHICLE_CHANGED: 'vehicle:changed',     // 载具结构/血量变化
  VEHICLE_DESTROYED: 'vehicle:destroyed',
  PART_DESTROYED: 'part:destroyed',
  PART_DAMAGED: 'part:damaged',
  WEAPON_FIRE: 'weapon:fire',
  PROJECTILE_HIT: 'projectile:hit',
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_STATUS: 'game:status',
  BLUEPRINT_CHANGED: 'blueprint:changed',
  SETTINGS_CHANGED: 'settings:changed',
};
