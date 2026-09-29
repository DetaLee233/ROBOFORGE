/* =========================================================
 *  projectile.js — 抛射体（机枪弹）
 *  带重力下坠；使用线段检测避免高速穿透
 * ========================================================= */

const PROJECTILE_GEO = new THREE.BoxGeometry(0.34, 0.34, 4.6);
const PROJECTILE_MATS = {
  0: new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  1: new THREE.MeshBasicMaterial({ color: 0xffab5e, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
};
// 曳光弹内部的高亮核心，使弹道在明亮/昏暗背景下都清晰可见
const PROJECTILE_CORE_GEO = new THREE.BoxGeometry(0.16, 0.16, 5.0);
const PROJECTILE_CORE_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const PROJ_Z = new THREE.Vector3(0, 0, 1);
const PROJ_FWD = new THREE.Vector3();

// 榴弹弹体（发光球）
const SHELL_GEO = new THREE.IcosahedronGeometry(0.8, 1);
const SHELL_MATS = {
  0: new THREE.MeshBasicMaterial({ color: 0xa8f0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  1: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
};

class Projectile {
  constructor(def) {
    this.origin = def.origin.clone();
    this.pos = def.origin.clone();
    this.prev = def.origin.clone();
    this.dir = def.dir.clone().normalize();
    this.speed = def.speed || 160;
    this.damage = def.damage || 50;
    this.team = def.team;
    this.owner = def.owner;
    this.range = def.range || 170;
    this.gravity = def.gravity || 0;
    this.aoeDamage = def.aoeDamage || 0;
    this.aoeMinDamage = def.aoeMinDamage || 10;
    this.aoeRadius = def.aoeRadius || 0;
    this.shape = def.shape || 'tracer';
    this.scale = def.scale || 1;

    // 用速度向量推进，便于施加重力
    this.vel = this.dir.clone().multiplyScalar(this.speed);

    this.traveled = 0;
    this.dead = false;
    this.age = 0;

    if (this.shape === 'shell') {
      this.mesh = new THREE.Mesh(SHELL_GEO, SHELL_MATS[this.team] || SHELL_MATS[1]);
      this.mesh.scale.setScalar(this.scale);
    } else {
      this.mesh = new THREE.Mesh(PROJECTILE_GEO, PROJECTILE_MATS[this.team] || PROJECTILE_MATS[1]);
      this.core = new THREE.Mesh(PROJECTILE_CORE_GEO, PROJECTILE_CORE_MAT);
      this.mesh.add(this.core);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.setFromUnitVectors(PROJ_Z, this.dir);
  }

  /**
   * @returns 'alive' | 'dead'
   */
  update(dt, game) {
    if (this.dead) return 'dead';

    this.age += dt;

    // 半隐式积分：先施加重力，再推进（弹道下坠）
    if (this.gravity) this.vel.y -= this.gravity * dt;

    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    this.traveled += this.vel.length() * dt;

    this.mesh.position.copy(this.pos);
    PROJ_FWD.copy(this.vel).normalize();
    this.mesh.quaternion.setFromUnitVectors(PROJ_Z, PROJ_FWD);

    const arena = game.arena;

    // 地形命中
    if (this.pos.y <= arena.heightAt(this.pos.x, this.pos.z)) {
      return this._impact(game, 'ground');
    }
    // 出界 / 空气墙
    if (arena.outOfBounds(this.pos)) {
      this.dead = true;
      return 'dead';
    }
    // 掩体命中
    if (arena.hitCover(this.prev, this.pos)) {
      return this._impact(game, 'cover');
    }
    // 基地护盾拦截 / 八面体受击
    if (game.projectileBarrier && game.projectileBarrier(this)) {
      this.dead = true;
      return 'dead';
    }
    // 载具命中
    for (const v of game.vehicles) {
      if (!v.alive || v.side === this.team) continue;
      const hit = v.collideSegment(this.prev, this.pos);
      if (hit) {
        const wp = new THREE.Vector3();
        hit.part.worldPosition(wp);
        const lethal = hit.part.hp - this.damage <= 0;
        v.hitPart(hit.part, this.damage, this.owner);
        Bus.emit(EV.PROJECTILE_HIT, {
          position: wp.clone(),
          target: v,
          source: this.owner,
          part: hit.part,
          damage: this.damage,
          lethal,
        });
        if (this.owner && this.owner.isPlayer) AudioFX.hit();
        return this._impact(game, 'part', hit.part);
      }
    }

    if (this.traveled >= this.range || this.age > 8) {
      this.dead = true;
      return 'dead';
    }
    return 'alive';
  }

  _impact(game, kind, excludePart) {
    this.dead = true;
    if (this.aoeRadius > 0 && game && game.applyExplosion) {
      game.applyExplosion(this.pos, {
        team: this.team,
        damage: this.aoeDamage,
        minDamage: this.aoeMinDamage,
        radius: this.aoeRadius,
        source: this.owner,
        excludePart: excludePart || null,
      });
    } else if (game && game.spawnImpact) {
      game.spawnImpact(this.pos, kind);
    }
    return 'dead';
  }
}
