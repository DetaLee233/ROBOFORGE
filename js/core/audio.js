/* =========================================================
 *  audio.js — 极简 WebAudio 合成音效（无外部资源）
 * ========================================================= */

const AudioFX = (() => {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(gain || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, gain, filterFreq) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.value = gain || 0.4;
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t);
  }

  let chargeNodes = null;
  function chargeSound(on) {
    if (!enabled || !ensure()) return;
    if (on) {
      if (chargeNodes) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 68;
      const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 136;
      const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
      const lfg = ctx.createGain(); lfg.gain.value = 700;
      lfo.connect(lfg); lfg.connect(filt.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.5);
      osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(master);
      osc.start(t); osc2.start(t); lfo.start(t);
      chargeNodes = { osc, osc2, lfo, g };
    } else if (chargeNodes) {
      const t = ctx.currentTime;
      const n = chargeNodes;
      chargeNodes = null;
      try {
        n.g.gain.cancelScheduledValues(t);
        n.g.gain.setValueAtTime(n.g.gain.value, t);
        n.g.gain.linearRampToValueAtTime(0.0001, t + 0.12);
        setTimeout(() => { try { n.osc.stop(); n.osc2.stop(); n.lfo.stop(); } catch (e) { /* */ } }, 220);
      } catch (e) { /* */ }
    }
  }

  let laserNodes = null;
  /** 工程激光：与射线炮蓄力同款电流声（独立节点，避免与充能互相打断） */
  function laserSound(on) {
    if (!enabled || !ensure()) return;
    if (on) {
      if (laserNodes) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 68;
      const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 136;
      const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
      const lfg = ctx.createGain(); lfg.gain.value = 700;
      lfo.connect(lfg); lfg.connect(filt.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.5);
      osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(master);
      osc.start(t); osc2.start(t); lfo.start(t);
      laserNodes = { osc, osc2, lfo, g };
    } else if (laserNodes) {
      const t = ctx.currentTime;
      const n = laserNodes;
      laserNodes = null;
      try {
        n.g.gain.cancelScheduledValues(t);
        n.g.gain.setValueAtTime(n.g.gain.value, t);
        n.g.gain.linearRampToValueAtTime(0.0001, t + 0.12);
        setTimeout(() => { try { n.osc.stop(); n.osc2.stop(); n.lfo.stop(); } catch (e) { /* */ } }, 220);
      } catch (e) { /* */ }
    }
  }

  return {
    resume,
    setEnabled(v) { enabled = v; },
    shoot() { tone(220, 0.06, 'square', 0.18, 90); noise(0.05, 0.18, 2600); },
    hit() { tone(900, 0.04, 'triangle', 0.22, 500); },
    explode() { noise(0.5, 0.7, 700); tone(90, 0.45, 'sawtooth', 0.35, 35); },
    ui() { tone(660, 0.05, 'sine', 0.15, 880); },
    empty() { tone(140, 0.08, 'square', 0.12, 80); },
    charge(on) { chargeSound(on); },
    laser(on) { laserSound(on); },
  };
})();
