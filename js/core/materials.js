/* =========================================================
 *  materials.js — 共享材质缓存
 *  按 零件种类 + 阵营 缓存，避免重复创建
 * ========================================================= */

const Materials = (() => {
  const cache = new Map();

  const PALETTE = {
    // 普通装甲偏亮，强化装甲明显更暗（灰度上可区分：约 #fff / #ccc）
    block:      { player: 0x8fb6ff, ally: 0x8fb6ff, enemy: 0xffa08f, neutral: 0xffffff },
    reinforced: { player: 0x3f5f8f, ally: 0x3f5f8f, enemy: 0x8f4a42, neutral: 0xcccccc },
    core:       { player: 0xffd166, ally: 0xffd166, enemy: 0xffd166, neutral: 0xffd166 },
    wheel:      { player: 0x2a2f37, ally: 0x2a2f37, enemy: 0x2a2f37, neutral: 0x2a2f37 },
    track:      { player: 0x3a3f47, ally: 0x3a3f47, enemy: 0x3a3f47, neutral: 0x3a3f47 },
    leg:        { player: 0x5b6470, ally: 0x5b6470, enemy: 0x8a5750, neutral: 0x5b6470 },
    rotor:      { player: 0x5a6a78, ally: 0x5a6a78, enemy: 0x8a5a52, neutral: 0x5a6a78 },
    rotorBlade: { player: 0x9fb6c8, ally: 0x9fb6c8, enemy: 0xd8a39a, neutral: 0x9fb6c8 },
    rotorRing:  { player: 0x4fd1ff, ally: 0x4fd1ff, enemy: 0xff8a7a, neutral: 0x4fd1ff },
    trackBelt:  { player: 0x1c2027, ally: 0x1c2027, enemy: 0x1c2027, neutral: 0x1c2027 },
    machinegun: { player: 0x3b4550, ally: 0x3b4550, enemy: 0x3b4550, neutral: 0x3b4550 },
    grenade:    { player: 0x4e6b3a, ally: 0x4e6b3a, enemy: 0x6b4a3a, neutral: 0x4e6b3a },
    railgun:    { player: 0x4b4f6a, ally: 0x4b4f6a, enemy: 0x6a4b4b, neutral: 0x4b4f6a },
    railgunRail:{ player: 0x9fb0d8, ally: 0x9fb0d8, enemy: 0xd8a3a3, neutral: 0x9fb0d8 },
    railgunArc: { player: 0xbfe9ff, ally: 0xbfe9ff, enemy: 0xffd0c0, neutral: 0xbfe9ff },
    computer:   { player: 0x2f6f7a, ally: 0x2f6f7a, enemy: 0x7a3f3f, neutral: 0x2f6f7a },
    computerLens:{ player: 0x7cf5ff, ally: 0x7cf5ff, enemy: 0xffa0a0, neutral: 0x7cf5ff },
    battery:    { player: 0x7a5a2f, ally: 0x7a5a2f, enemy: 0x6b4a3a, neutral: 0x7a5a2f },
    batteryCell:{ player: 0xffd166, ally: 0xffd166, enemy: 0xffd166, neutral: 0xffd166 },
    barrel:     { player: 0x6b7684, ally: 0x6b7684, enemy: 0x6b7684, neutral: 0x6b7684 },
  };

  function get(kind, team) {
    team = team || 'neutral';
    const key = kind + ':' + team;
    if (cache.has(key)) return cache.get(key);
    const group = PALETTE[kind] || {};
    const color = group[team] !== undefined ? group[team] : 0x999999;
    const mat = new THREE.MeshLambertMaterial({ color });
    cache.set(key, mat);
    return mat;
  }

  const edgeCache = new Map();
  function edge(key, color, opacity) {
    key = key || 'default';
    if (edgeCache.has(key)) return edgeCache.get(key);
    const mat = new THREE.LineBasicMaterial({
      color: color === undefined ? 0x05080d : color,
      transparent: true,
      opacity: opacity === undefined ? 0.45 : opacity,
    });
    edgeCache.set(key, mat);
    return mat;
  }

  return { get, edge };
})();
