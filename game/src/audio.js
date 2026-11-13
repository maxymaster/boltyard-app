/* Boltyard audio — BY.Audio. Pure Web Audio synthesis, no files, no libraries.
 * Public API (SPEC §6.2): unlock(), setEnabled(bool), play(name, opts), handle(events, run).
 * Extras: isEnabled(), names, and underscore-prefixed test hooks (_useContext, _stats, _trace, _state).
 * Never throws, never logs. Safe before unlock(), with no AudioContext, with suspended/closed contexts.
 */
(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};

  var LEVEL = 0.7;            // master gain (compressor + soft clip follow)
  var NOISE_SECONDS = 2.5;
  var MAX_ACTIVE = 140;       // active oscillator/noise voices above which frequent sounds are dropped
  var CALL_BUDGET = 12;       // max frequent combat sounds started per handle() call
  var PICKUP_BUDGET = 8;      // separate allowance for pickup/core/cell so a bolt vacuum is never starved by a kill burst

  var ctx = null, master = null, noiseBuf = null, external = false;
  var enabled = true, pending = 0;
  var ladderIdx = -1, ladderT = -1e9;
  var nextAt = {};
  var curP = 1, curV = 1, curName = '';
  var stats = { sounds: 0, osc: 0, noise: 0, active: 0, dropped: 0, errors: 0, byName: {} };
  var lastError = null;

  /* ---------------------------------------------------------------- helpers */

  function err(e) { stats.errors++; lastError = e && e.message ? String(e.message) : String(e); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function rnd(spread) { return 1 - spread + 2 * spread * Math.random(); }
  function fcl(f, hi) { f = +f; if (!(f > 0)) f = 20; return f < 20 ? 20 : (f > hi ? hi : f); }
  function isOffline(c) { return !!c && typeof c.startRendering === 'function'; }
  function now() { var t = ctx && ctx.currentTime; return (typeof t === 'number' && isFinite(t)) ? t : 0; }

  function clipCurve() {
    var n = 1025, c = new Float32Array(n), d = Math.tanh(1);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x) / d * 0.95;
    }
    return c;
  }

  function makeNoise(c) {
    var sr = c.sampleRate || 44100, len = Math.floor(sr * NOISE_SECONDS);
    var b = c.createBuffer(1, len, sr), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function build(c) {
    var m = c.createGain();
    m.gain.value = enabled ? LEVEL : 0;
    var tail = m;
    try {
      var comp = c.createDynamicsCompressor();
      try { comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; } catch (e) { err(e); }
      try { comp.attack.value = 0.003; comp.release.value = 0.15; } catch (e) { err(e); }
      m.connect(comp); tail = comp;
    } catch (e) { err(e); }
    try {
      var sh = c.createWaveShaper();
      sh.curve = clipCurve();
      tail.connect(sh); tail = sh;
    } catch (e) { err(e); }
    tail.connect(c.destination);
    return m;
  }

  function attach(c, isExternal) {
    try {
      var m = build(c);
      var nb = makeNoise(c);
      ctx = c; master = m; noiseBuf = nb; external = !!isExternal;
      nextAt = {}; pending = 0; ladderIdx = -1; ladderT = -1e9;
      stats.active = 0;
      return true;
    } catch (e) { err(e); ctx = null; master = null; noiseBuf = null; return false; }
  }

  function tryResume() {
    try { var r = ctx.resume(); if (r && typeof r.catch === 'function') r.catch(function () {}); } catch (e) { /* ignore */ }
  }

  function ready() {
    if (!ctx || !master || !noiseBuf) return false;
    var st = ctx.state;
    if (st === 'closed') return false;
    if (!isOffline(ctx) && st !== 'running') {
      tryResume();
      if (++pending > 6) return false;   // context never started: do not pile sounds up
    } else pending = 0;
    return true;
  }

  /* Gain envelope: 0 -> vol (attack) -> [hold] -> exponential decay -> linear to 0. */
  function env(param, t, a, vol, hold, dur) {
    a = Math.max(a || 0.003, 0.0025);
    if (dur < a + 0.012) dur = a + 0.012;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(vol, t + a);
    if (hold && hold > a + 0.001 && hold < dur - 0.004) param.setValueAtTime(vol, t + hold);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
    param.linearRampToValueAtTime(0, t + dur + 0.008);
    return dur + 0.012;
  }

  function release(nodes) {
    return function () {
      stats.active--;
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ignore */ } }
    };
  }

  /* Oscillator voice. o: { a, hold, filt:[type,f0,f1,q], fm:[rate,depth], det } */
  function tone(type, f0, f1, t, dur, vol, o) {
    try {
      o = o || {};
      var osc = ctx.createOscillator(), g = ctx.createGain();
      var nodes = [osc, g];
      f0 = fcl(f0 * curP, 5000);
      f1 = fcl((f1 == null ? f0 / curP : f1) * curP, 5000);
      if (dur < 0.02) dur = 0.02;
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (o.det) osc.detune.value = o.det;
      var last = osc;
      if (o.filt) {
        var fl = ctx.createBiquadFilter();
        fl.type = o.filt[0];
        fl.frequency.setValueAtTime(fcl(o.filt[1] * curP, 9000), t);
        if (o.filt[2] != null && o.filt[2] !== o.filt[1]) fl.frequency.exponentialRampToValueAtTime(fcl(o.filt[2] * curP, 9000), t + dur);
        fl.Q.value = o.filt[3] || 0.7;
        last.connect(fl); last = fl; nodes.push(fl);
      }
      var end = env(g.gain, t, o.a, vol * curV, o.hold, dur);
      last.connect(g); g.connect(master);
      var lfo = null;
      if (o.fm) {
        lfo = ctx.createOscillator();
        var lg = ctx.createGain();
        lfo.frequency.value = o.fm[0]; lg.gain.value = o.fm[1] * curP;
        lfo.connect(lg); lg.connect(osc.frequency);
        nodes.push(lfo, lg);
        lfo.start(t); lfo.stop(t + end);
      }
      osc.onended = release(nodes);
      osc.start(t); osc.stop(t + end);
      stats.osc++; stats.active++;
      if (BY.Audio && BY.Audio._trace) BY.Audio._trace.push({ name: curName, t: t, f: f0 });
    } catch (e) { err(e); }
  }

  /* Filtered noise voice. */
  function noise(t, dur, ftype, f0, f1, q, vol, o) {
    try {
      o = o || {};
      var src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      var nodes = [src, fl, g];
      if (dur < 0.02) dur = 0.02;
      src.buffer = noiseBuf;
      fl.type = ftype;
      fl.frequency.setValueAtTime(fcl(f0 * curP, 9000), t);
      if (f1 != null && f1 !== f0) fl.frequency.exponentialRampToValueAtTime(fcl(f1 * curP, 9000), t + dur);
      fl.Q.value = q || 0.7;
      var end = env(g.gain, t, o.a, vol * curV, o.hold, dur);
      src.connect(fl); fl.connect(g); g.connect(master);
      var off = Math.random() * Math.max(0, NOISE_SECONDS - end - 0.05);
      src.onended = release(nodes);
      src.start(t, off, end);
      stats.noise++; stats.active++;
    } catch (e) { err(e); }
  }

  /* Thump: low sine plus 2x/3x harmonic layers so phone speakers (which roll off < ~150 Hz) still carry it. */
  function bass(t, f0, f1, dur, vol) {
    tone('sine', f0, f1, t, dur, vol, { a: 0.004 });
    tone('triangle', f0 * 2, f1 * 2, t, dur * 0.8, vol * 0.75, { a: 0.004 });
    tone('triangle', f0 * 3, f1 * 3, t, dur * 0.55, vol * 0.45, { a: 0.004 });
  }

  /* ---------------------------------------------------------------- recipes (t = start time) */

  var R = {};
  var LAD = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // major pentatonic, two octaves
  var LAD_BASE = 494;                                  // B4; top rung ~1976 Hz

  R.zap = function (t) {
    var r = rnd(0.07);
    tone('sawtooth', 1000 * r, 280 * r, t, 0.075, 0.14, { filt: ['lowpass', 2600, 900, 0.8] });
    tone('sine', 520 * r, 180 * r, t, 0.06, 0.15);
    noise(t, 0.035, 'highpass', 2600, 1800, 0.7, 0.07);
  };
  R.crit = function (t) {
    var r = rnd(0.04);
    tone('sawtooth', 1500 * r, 420 * r, t, 0.16, 0.14, { filt: ['lowpass', 3600, 1200, 0.9] });
    tone('square', 2200 * r, 900 * r, t, 0.09, 0.05, { filt: ['lowpass', 3000, 3000, 0.7] });
    tone('sine', 1760 * r, 1760 * r, t + 0.02, 0.18, 0.09);
    tone('sine', 200, 90, t, 0.1, 0.12);
    noise(t, 0.06, 'bandpass', 3400, 2400, 1.2, 0.16);
  };
  R.kill = function (t) {
    var r = rnd(0.06), P = [310, 463, 689], i;
    for (i = 0; i < 3; i++) tone('square', P[i] * r, P[i] * r * 0.97, t, 0.14 - i * 0.02, 0.06, { filt: ['lowpass', 1800, 1800, 0.7] });
    noise(t, 0.09, 'bandpass', 1400, 1100, 0.8, 0.16);
    bass(t, 150, 70, 0.12, 0.22);
  };
  R.killBig = function (t) {
    var r = rnd(0.05), P = [180, 271, 410], i;
    bass(t, 110, 48, 0.34, 0.5);
    for (i = 0; i < 3; i++) tone('square', P[i] * r, P[i] * r * 0.95, t, 0.32 - i * 0.04, 0.07, { filt: ['lowpass', 1400, 1400, 0.7] });
    noise(t, 0.32, 'lowpass', 2000, 250, 0.7, 0.3);
    noise(t, 0.08, 'bandpass', 900, 800, 1.2, 0.15);
  };
  R.pickup = function (t) {
    if (t - ladderT > 0.6 || ladderIdx < 0) ladderIdx = 0;
    else ladderIdx = Math.min(ladderIdx + 1, LAD.length - 1);
    ladderT = t;
    var f = LAD_BASE * Math.pow(2, LAD[ladderIdx] / 12);
    tone('sine', f, f * 1.02, t, 0.11, 0.26);
    tone('triangle', f * 2, f * 2, t, 0.06, 0.08);
    noise(t, 0.012, 'highpass', 4000, 4000, 0.7, 0.04);
  };
  R.core = function (t) {
    var i, N = [659, 988];
    for (i = 0; i < 2; i++) {
      var s = t + i * 0.09;
      tone('sine', N[i], N[i], s, 0.38, 0.2, { a: 0.004 });
      tone('sine', N[i] * 2.76, N[i] * 2.76, s, 0.18, 0.05);
      tone('triangle', N[i] * 2, N[i] * 2, s, 0.22, 0.06);
    }
  };
  R.cell = function (t) {
    tone('sine', 300, 1200, t, 0.22, 0.2, { a: 0.01, hold: 0.12 });
    tone('square', 150, 600, t, 0.22, 0.05, { a: 0.01, filt: ['lowpass', 1600, 1600, 0.7] });
    tone('triangle', 1600, 1600, t + 0.16, 0.1, 0.07);
  };
  R.hurt = function (t) {
    tone('sawtooth', 95, 58, t, 0.24, 0.26, { filt: ['lowpass', 420, 220, 1] });
    bass(t, 80, 48, 0.2, 0.3);
    noise(t, 0.12, 'lowpass', 700, 200, 0.7, 0.12);
  };
  R.low = function (t) {
    for (var i = 0; i < 2; i++) {
      var s = t + i * 0.17;
      tone('square', 360, 360, s, 0.1, 0.1, { a: 0.005, hold: 0.07, filt: ['lowpass', 1600, 1600, 0.7] });
      tone('sine', 360, 360, s, 0.1, 0.12, { a: 0.005, hold: 0.07 });
    }
  };
  R.ocStart = function (t) {
    tone('sawtooth', 110, 1100, t, 0.5, 0.14, { a: 0.04, hold: 0.3, filt: ['lowpass', 300, 3500, 1.2] });
    tone('sine', 220, 1320, t, 0.5, 0.14, { a: 0.04, hold: 0.3 });
    noise(t, 0.5, 'bandpass', 400, 3500, 2, 0.14, { a: 0.05, hold: 0.3 });
    tone('triangle', 1568, 1568, t + 0.38, 0.12, 0.08);
  };
  R.ocEnd = function (t) {
    tone('sawtooth', 800, 70, t, 0.5, 0.15, { a: 0.01, filt: ['lowpass', 2200, 180, 1] });
    tone('sine', 400, 60, t, 0.5, 0.14, { a: 0.01 });
    noise(t, 0.3, 'bandpass', 2000, 200, 1.5, 0.08);
  };
  R.combo = function (t) {
    tone('triangle', 640, 960, t, 0.1, 0.2);
    tone('sine', 1280, 1920, t, 0.07, 0.07);
  };
  R.bossWarn = function (t) {
    var seq = [560, 420, 560, 420];
    for (var i = 0; i < 4; i++) {
      var s = t + i * 0.3, f = seq[i];
      tone('square', f, f, s, 0.29, 0.12, { a: 0.01, hold: 0.25, filt: ['lowpass', 2000, 2000, 0.8] });
      tone('sawtooth', f * 0.5, f * 0.5, s, 0.29, 0.1, { a: 0.01, hold: 0.25, filt: ['lowpass', 900, 900, 0.8] });
    }
  };
  R.bossSpawn = function (t) {
    bass(t, 90, 38, 0.6, 0.55);
    noise(t, 0.5, 'lowpass', 1200, 90, 0.8, 0.35);
    tone('sawtooth', 58, 44, t + 0.05, 0.85, 0.26, { a: 0.06, hold: 0.4, filt: ['lowpass', 360, 160, 1.5], fm: [22, 9] });
    tone('square', 116, 88, t + 0.05, 0.8, 0.06, { a: 0.08, hold: 0.35, filt: ['lowpass', 500, 260, 1], fm: [22, 18] });
  };
  R.slam = function (t) {
    bass(t, 120, 42, 0.4, 0.6);
    noise(t, 0.3, 'lowpass', 1800, 180, 0.8, 0.32);
    noise(t, 0.05, 'bandpass', 1000, 900, 1, 0.2);
  };
  R.explode = function (t) {
    noise(t, 0.5, 'lowpass', 3200, 140, 1.1, 0.5);
    bass(t, 100, 44, 0.35, 0.35);
    noise(t, 0.12, 'highpass', 1800, 900, 0.7, 0.15);
  };
  R.shot = function (t) {
    tone('square', 1300, 420, t, 0.11, 0.09, { filt: ['lowpass', 2800, 1200, 0.8] });
    tone('sine', 900, 300, t, 0.1, 0.1);
  };
  R.bossDead = function (t) {
    var i, B = [[0, 0.5], [0.22, 0.45], [0.45, 0.4], [0.75, 0.35], [1.05, 0.3]];
    noise(t, 1.5, 'lowpass', 500, 70, 1.2, 0.5, { a: 0.03, hold: 0.7 });
    tone('sawtooth', 52, 38, t, 1.5, 0.22, { a: 0.05, hold: 0.8, filt: ['lowpass', 300, 150, 1], fm: [17, 7] });
    for (i = 0; i < B.length; i++) {
      bass(t + B[i][0], 100 - i * 9, 42, 0.3, B[i][1]);
      noise(t + B[i][0], 0.08, 'bandpass', 1800, 1200, 1, 0.2);
    }
    var N = [[523, 0, 0.14], [659, 0.15, 0.14], [784, 0.3, 0.75]], s = t + 1.35;
    for (i = 0; i < 3; i++) {
      tone('square', N[i][0], N[i][0], s + N[i][1], N[i][2], 0.1, { a: 0.006, hold: N[i][2] * 0.6, filt: ['lowpass', 2600, 2600, 0.7] });
      tone('triangle', N[i][0] * 2, N[i][0] * 2, s + N[i][1], N[i][2], 0.08, { a: 0.006 });
      tone('sine', N[i][0] * 0.5, N[i][0] * 0.5, s + N[i][1], N[i][2], 0.1, { a: 0.006 });
    }
  };
  R.victory = function (t) {
    var i, N = [[523, 0, 0.12], [523, 0.15, 0.12], [523, 0.3, 0.12], [659, 0.45, 0.28], [784, 0.75, 0.22],
                [659, 0.98, 0.12], [784, 1.12, 0.6], [1047, 1.75, 1.0]];
    for (i = 0; i < N.length; i++) {
      tone('square', N[i][0], N[i][0], t + N[i][1], N[i][2], 0.09, { a: 0.006, hold: N[i][2] * 0.6, filt: ['lowpass', 2600, 2600, 0.7] });
      tone('triangle', N[i][0] * 0.5, N[i][0] * 0.5, t + N[i][1], N[i][2], 0.12, { a: 0.006 });
      tone('sine', N[i][0] * 2, N[i][0] * 2, t + N[i][1], N[i][2], 0.05, { a: 0.006 });
    }
    var C = [523, 659, 784];
    for (i = 0; i < 3; i++) tone('sine', C[i], C[i], t + 1.75, 1.1, 0.07, { a: 0.03, hold: 0.5 });
  };
  R.click = function (t) {
    tone('triangle', 1900, 1300, t, 0.03, 0.12);
    noise(t, 0.015, 'highpass', 3500, 3500, 0.7, 0.04);
  };
  R.buy = function (t) {
    var i, Q = [2400, 2900, 3400], F = [900, 1100, 1300];
    for (i = 0; i < 3; i++) {
      noise(t + i * 0.05, 0.02, 'bandpass', Q[i], Q[i], 5, 0.22);
      tone('square', F[i], F[i], t + i * 0.05, 0.05, 0.05, { filt: ['lowpass', 1800, 1800, 0.7] });
    }
    var c = t + 0.15;
    bass(c, 210, 85, 0.16, 0.4);
    noise(c, 0.08, 'bandpass', 1000, 700, 1.5, 0.2);
    tone('sine', 1320, 1320, c + 0.02, 0.12, 0.08);
  };
  R.deny = function (t) {
    for (var i = 0; i < 2; i++) {
      var s = t + i * 0.13;
      tone('sawtooth', 120, 100, s, 0.1, 0.22, { a: 0.005, hold: 0.07, filt: ['lowpass', 600, 500, 1] });
      tone('square', 180, 150, s, 0.1, 0.06, { a: 0.005, hold: 0.07, filt: ['lowpass', 700, 600, 1] });
    }
  };
  R.clockin = function (t) {
    noise(t, 0.025, 'bandpass', 1800, 1800, 2, 0.25);
    bass(t + 0.07, 170, 70, 0.13, 0.42);
    noise(t + 0.07, 0.05, 'lowpass', 1400, 500, 0.8, 0.2);
    tone('triangle', 520, 1040, t + 0.2, 0.22, 0.2, { a: 0.01, hold: 0.12 });
    tone('sine', 1040, 2080, t + 0.2, 0.2, 0.05, { a: 0.01 });
  };
  R.shiftEnd = function (t) {
    tone('sawtooth', 700, 55, t, 0.6, 0.17, { a: 0.01, filt: ['lowpass', 2400, 150, 1.2] });
    tone('sine', 350, 50, t, 0.6, 0.16, { a: 0.01 });
    bass(t + 0.5, 90, 45, 0.12, 0.2);
  };
  R.unlock = function (t) {
    var N = [523, 659, 784, 1047];
    for (var i = 0; i < 4; i++) {
      var s = t + i * 0.06;
      tone('sine', N[i], N[i], s, 0.18, 0.2, { a: 0.004 });
      tone('triangle', N[i] * 2, N[i] * 2, s, 0.12, 0.06);
    }
  };
  // extras (gameplay information from telegraph / shield events)
  R.telegraph = function (t) {
    tone('sine', 480, 760, t, 0.08, 0.07, { a: 0.005 });
    tone('triangle', 960, 1520, t, 0.06, 0.02);
  };
  R.shield = function (t) {
    tone('sine', 1320, 1330, t, 0.4, 0.07, { a: 0.06, hold: 0.15 });
    tone('sine', 1980, 1995, t, 0.35, 0.04, { a: 0.06, hold: 0.12 });
    tone('triangle', 880, 886, t, 0.4, 0.05, { a: 0.06, hold: 0.15 });
  };
  // Act II (SPEC §11.12)
  R.laser = function (t) {
    tone('sine', 300, 1400, t, 0.3, 0.1, { a: 0.22 });                                   // charging whine swells
    tone('triangle', 1400, 1400, t + 0.28, 0.06, 0.05, { a: 0.003 });                    // lock-on tick
    tone('sawtooth', 190, 160, t + 0.3, 0.34, 0.14, { a: 0.008, filt: ['lowpass', 2400, 900, 1.5] });
    tone('square', 380, 320, t + 0.3, 0.34, 0.05, { a: 0.008, filt: ['bandpass', 1100, 1100, 1.2] });
    noise(t + 0.3, 0.3, 'bandpass', 2600, 1800, 2, 0.08, { a: 0.01 });
  };
  R.storm = function (t) {
    var i, s, r;
    bass(t, 70, 38, 0.6, 0.4);
    noise(t, 0.7, 'lowpass', 900, 160, 0.7, 0.18, { a: 0.05 });
    for (i = 0; i < 9; i++) {                                                            // forked crackles
      r = rnd(0.2);
      s = t + 0.02 + i * 0.06 + Math.random() * 0.03;
      noise(s, 0.05, 'highpass', 2600 * r, 1200, 1.5, 0.2);
      tone('square', 1100 * r, 260 * r, s, 0.045, 0.05, { filt: ['lowpass', 3000, 800, 1] });
    }
  };
  R.well = function (t) {
    tone('sine', 230, 55, t, 0.75, 0.3, { a: 0.05, fm: [5, 28] });                      // low swirl
    tone('triangle', 115, 40, t, 0.75, 0.16, { a: 0.05, fm: [3, 10] });
    noise(t, 0.75, 'bandpass', 1400, 260, 3, 0.16, { a: 0.1 });                          // suck inward
  };
  R.wellBoom = function (t) {
    bass(t, 130, 30, 0.6, 0.6);
    noise(t, 0.45, 'lowpass', 800, 70, 1, 0.45, { a: 0.003 });
    noise(t + 0.02, 0.1, 'bandpass', 1500, 600, 1.2, 0.18);
  };
  R.steal = function (t) {
    noise(t, 0.02, 'highpass', 4000, 4000, 0.7, 0.04);
    tone('square', 1760, 1320, t, 0.08, 0.08, { a: 0.003, filt: ['lowpass', 3000, 3000, 0.7] });
    tone('triangle', 1568, 1100, t + 0.06, 0.1, 0.1, { a: 0.004, hold: 0.03 });
    tone('sine', 1318, 659, t + 0.12, 0.2, 0.1, { a: 0.005 });
    tone('triangle', 1175, 880, t + 0.13, 0.16, 0.06, { a: 0.005, fm: [18, 22] });        // cheeky wobble
  };
  R.refund = function (t) {
    var i, N = [1319, 1568, 1760, 2093, 2637, 2349];
    for (i = 0; i < N.length; i++) {
      var s = t + i * 0.045;
      tone('sine', N[i], N[i], s, 0.16, 0.14, { a: 0.003 });
      tone('triangle', N[i] * 2, N[i] * 2, s, 0.07, 0.035, { a: 0.003 });
    }
  };
  R.intern = function (t) {
    tone('square', 600, 1200, t, 0.06, 0.06, { filt: ['lowpass', 3000, 3000, 0.7] });
    tone('square', 900, 1500, t + 0.07, 0.06, 0.06, { filt: ['lowpass', 3000, 3000, 0.7] });
    tone('triangle', 1200, 1800, t + 0.14, 0.12, 0.12, { a: 0.004, hold: 0.04 });
    tone('sine', 2400, 2400, t + 0.26, 0.1, 0.06, { a: 0.003 });
  };
  R.severance = function (t) {
    noise(t, 0.9, 'lowpass', 3500, 120, 1.0, 0.5, { a: 0.003 });
    bass(t, 90, 30, 0.8, 0.6);
    tone('sawtooth', 140, 40, t, 0.7, 0.18, { a: 0.005, filt: ['lowpass', 1200, 200, 1] });
    var c = t + 0.35;                                                                     // cash register: stamp, drawer bell
    noise(c, 0.03, 'bandpass', 3000, 3000, 4, 0.22);
    tone('square', 2000, 2000, c, 0.05, 0.07, { filt: ['lowpass', 4000, 4000, 0.7] });
    tone('sine', 2637, 2637, c + 0.05, 0.4, 0.14, { a: 0.003 });
    tone('sine', 3951, 3951, c + 0.05, 0.25, 0.05, { a: 0.003 });
  };
  R.overtime = function (t) {
    var i, f, s;
    noise(t, 0.03, 'bandpass', 2200, 2200, 4, 0.3);                                       // punch-clock chunk
    bass(t, 300, 150, 0.06, 0.25);
    for (i = 0; i < 4; i++) {                                                             // rising alarm
      f = 700 + i * 180; s = t + 0.12 + i * 0.13;
      tone('square', f, f, s, 0.12, 0.07, { a: 0.005, hold: 0.08, filt: ['lowpass', 2600, 2600, 0.7] });
      tone('triangle', f * 2, f * 2, s, 0.12, 0.03, { a: 0.005 });
    }
  };
  R.budget = function (t) {
    tone('sawtooth', 110, 108, t, 0.5, 0.12, { a: 0.03, hold: 0.3, filt: ['lowpass', 500, 400, 1] });
    tone('sine', 110, 108, t, 0.5, 0.2, { a: 0.03, hold: 0.3 });
    tone('sawtooth', 98, 96, t + 0.5, 0.9, 0.12, { a: 0.03, hold: 0.5, filt: ['lowpass', 500, 300, 1] });
    tone('sine', 98, 96, t + 0.5, 0.9, 0.2, { a: 0.03, hold: 0.5 });
  };
  R.blink = function (t) {
    tone('sine', 300, 2400, t, 0.12, 0.18, { a: 0.004 });                                // teleport zip
    tone('triangle', 600, 3200, t, 0.1, 0.06, { a: 0.004 });
    noise(t, 0.12, 'bandpass', 800, 4000, 3, 0.12, { a: 0.004 });
    tone('sine', 3000, 1400, t + 0.11, 0.05, 0.1, { a: 0.002 });
  };
  R.print = function (t) {
    noise(t, 0.03, 'bandpass', 900, 900, 2, 0.18, { a: 0.002 });                         // quiet stamp
    tone('triangle', 260, 180, t, 0.05, 0.08, { a: 0.002 });
    noise(t + 0.06, 0.02, 'highpass', 3000, 3000, 0.7, 0.05);
  };
  R.mimic = function (t) {
    noise(t, 0.04, 'bandpass', 1800, 900, 1.5, 0.3, { a: 0.002 });                       // snap
    tone('square', 220, 90, t, 0.07, 0.16, { a: 0.002, filt: ['lowpass', 1400, 500, 1] });
    bass(t + 0.06, 140, 60, 0.07, 0.3);
    noise(t + 0.06, 0.05, 'bandpass', 1200, 700, 2, 0.2);
    noise(t + 0.15, 0.03, 'bandpass', 1500, 800, 2, 0.12);
  };
  R.classified = function (t) {
    noise(t, 0.03, 'bandpass', 1200, 1200, 2, 0.3, { a: 0.002 });                        // rubber stamp
    bass(t, 120, 60, 0.12, 0.4);
    var i, C = [233, 294, 350];                                                           // Bb3 D4 F4, low brass-like
    for (i = 0; i < C.length; i++) {
      tone('sawtooth', C[i], C[i] * 1.004, t + 0.12, 0.9, 0.06, { a: 0.06, hold: 0.5, filt: ['lowpass', 500, 1400, 1.2], fm: [5, 3] });
      tone('square', C[i] * 0.5, C[i] * 0.5, t + 0.12, 0.9, 0.025, { a: 0.06, hold: 0.5, filt: ['lowpass', 600, 600, 0.8] });
    }
  };
  // Act III (SPEC §12.11)
  R.hold = function (t) {
    tone('triangle', 784, 784, t, 0.14, 0.12, { a: 0.005, hold: 0.08 });                  // muzak: two-note "please hold"
    tone('triangle', 659, 659, t + 0.16, 0.22, 0.12, { a: 0.005, hold: 0.12 });
    tone('sine', 1568, 1568, t + 0.16, 0.2, 0.04, { a: 0.005 });
    noise(t + 0.42, 0.04, 'bandpass', 1800, 1800, 3, 0.18, { a: 0.002 });                // soft clamp
    bass(t + 0.42, 140, 70, 0.08, 0.3);
  };
  R.injunction = function (t) {
    bass(t, 110, 40, 0.25, 0.55);                                                         // heavy rubber stamp
    noise(t, 0.04, 'bandpass', 1100, 1100, 2, 0.35, { a: 0.002 });
    noise(t, 0.2, 'lowpass', 500, 120, 1, 0.3, { a: 0.003 });
    tone('square', 220, 150, t, 0.06, 0.06, { a: 0.002, filt: ['lowpass', 900, 500, 1] });
  };
  R.clawback = function (t) {
    var i, f, s;
    for (i = 0; i < 6; i++) {                                                             // coins draining down
      f = 1800 * Math.pow(0.82, i); s = t + i * 0.075;
      tone('square', f, f, s, 0.06, 0.06, { a: 0.002, filt: ['lowpass', 3000, 3000, 0.7] });
      tone('sine', f * 2, f * 2, s, 0.05, 0.04, { a: 0.002 });
    }
    tone('sine', 900, 200, t, 0.55, 0.08, { a: 0.02 });                                   // falling drain
    noise(t, 0.5, 'bandpass', 2500, 600, 2, 0.06, { a: 0.02 });
  };
  R.orbital = function (t) {
    tone('sine', 400, 2200, t, 0.55, 0.08, { a: 0.1 });                                  // thin rising whine
    tone('triangle', 800, 4400, t, 0.55, 0.025, { a: 0.1 });
    noise(t, 0.55, 'highpass', 1500, 3000, 1.5, 0.03, { a: 0.1 });
    var b = t + 0.55;                                                                     // deep beam hit
    bass(b, 90, 35, 0.5, 0.6);
    tone('sawtooth', 110, 40, b, 0.45, 0.14, { a: 0.003, filt: ['lowpass', 600, 150, 1.2] });
    noise(b, 0.35, 'lowpass', 2000, 100, 0.9, 0.35, { a: 0.002 });
  };
  R.burst = function (t) {
    noise(t, 0.05, 'bandpass', 1600, 900, 2.5, 0.35, { a: 0.002 });                        // crunchy pop
    tone('square', 420, 120, t, 0.08, 0.1, { a: 0.002, filt: ['lowpass', 1800, 400, 1.2] });
    noise(t, 0.02, 'highpass', 3500, 3500, 0.7, 0.15);
  };
  R.copy = function (t) {
    noise(t, 0.35, 'bandpass', 600, 3000, 4, 0.07, { a: 0.08, hold: 0.1 });               // quiet scanner sweep
    tone('sine', 700, 2400, t, 0.3, 0.035, { a: 0.06, hold: 0.1 });
  };
  R.memo = function (t) {
    tone('sine', 1319, 1319, t, 0.5, 0.14, { a: 0.004, hold: 0.1 });                     // office chime
    tone('triangle', 2637, 2637, t, 0.3, 0.04, { a: 0.004 });
    tone('sine', 1047, 1047, t + 0.3, 0.7, 0.13, { a: 0.004, hold: 0.2 });
    var o = t + 0.6;                                                                      // then it turns ominous
    tone('sawtooth', 185, 155, o, 1.1, 0.1, { a: 0.08, hold: 0.4, filt: ['lowpass', 700, 300, 1], fm: [5, 4] });
    bass(o, 92, 60, 0.9, 0.3);
  };
  R.founder = function (t) {
    var i, N = [[392, 0, 0.18], [523, 0.2, 0.18], [659, 0.4, 0.18], [784, 0.6, 0.75]];   // triumphant rise
    for (i = 0; i < N.length; i++) {
      tone('square', N[i][0], N[i][0], t + N[i][1], N[i][2], 0.08, { a: 0.005, hold: N[i][2] * 0.6, filt: ['lowpass', 2600, 2600, 0.7] });
      tone('triangle', N[i][0] * 0.5, N[i][0] * 0.5, t + N[i][1], N[i][2], 0.12, { a: 0.005 });
    }
    var s = t + 1.4;                                                                      // then a bit strange: tritone, bass drop
    tone('sawtooth', 740, 740, s, 1.0, 0.06, { a: 0.05, hold: 0.5, filt: ['lowpass', 2000, 800, 1], fm: [6, 8] });
    tone('sawtooth', 523, 523, s, 1.0, 0.05, { a: 0.05, hold: 0.5, filt: ['lowpass', 1500, 700, 1], fm: [4, 6] });
    bass(s, 98, 65, 0.8, 0.5);
    tone('sine', 1047, 1047, s + 0.1, 0.9, 0.05, { a: 0.05, hold: 0.4 });
  };

  /* ---------------------------------------------------------------- firing */

  function fire(name, p, v, t) {
    var r = R[name];
    if (typeof r !== 'function') return false;
    curP = p; curV = v; curName = name;
    try { r(t); } catch (e) { err(e); return false; }
    stats.sounds++;
    stats.byName[name] = (stats.byName[name] || 0) + 1;
    return true;
  }

  function num(x, d, lo, hi) { x = +x; return (x === x && isFinite(x)) ? clamp(x, lo, hi) : d; }
  function pos(x, d, lo, hi) { x = +x; return (x > 0 && isFinite(x)) ? clamp(x, lo, hi) : d; }

  /* ---------------------------------------------------------------- handle() mapping */

  var GATE = {        // name: [min gap seconds, max look-ahead seconds]
    zap: [0.045, 0.09], crit: [0.08, 0.12], kill: [0.04, 0.16], killBig: [0.09, 0.2],
    pickup: [0.03, 0.24], core: [0.08, 0.2], cell: [0.1, 0.2], hurt: [0.15, 0], combo: [0.12, 0.1],
    explode: [0.07, 0.14], shot: [0.08, 0.1], telegraph: [0.15, 0.05], shield: [0.3, 0.05], low: [0.5, 0],
    storm: [0.25, 0], intern: [0.3, 0.1], print: [0.3, 0], burst: [0.12, 0], copy: [0.3, 0]
  };
  var BUDGETED = { zap: 1, crit: 1, kill: 1, killBig: 1, pickup: 1, core: 1, cell: 1, explode: 1, shot: 1, telegraph: 1, shield: 1,
    storm: 1, intern: 1, print: 1, blink: 1, steal: 1, refund: 1 };

  function handleImpl(events, run) {
    if (!events || !events.length || !ready()) return;
    if (run && run.attract) return;
    var base = now() + 0.005, budget = CALL_BUDGET, pbudget = PICKUP_BUDGET, cnt = {}, n = Math.min(events.length, 400);

    function go(name, pitch, vol, delay) {
      var t = base + (delay || 0), g = GATE[name];
      if (g) {
        var s = Math.max(t, nextAt[name] || 0);
        if (s - t > g[1] + 1e-9) { stats.dropped++; return; }
        t = s;
      }
      if (BUDGETED[name]) {
        var pk = (name === 'pickup' || name === 'core' || name === 'cell');
        if ((pk ? pbudget : budget) <= 0 || stats.active > MAX_ACTIVE) { stats.dropped++; return; }
        if (pk) pbudget--; else budget--;
      }
      if (g) nextAt[name] = t + g[0];
      var c = cnt[name] = (cnt[name] || 0) + 1;
      var v = vol * Math.max(0.5, 1 - 0.06 * (c - 1));
      fire(name, pitch, v, t);
    }

    for (var i = 0; i < n; i++) {
      var e = events[i];
      if (!e || typeof e !== 'object') continue;
      switch (e.type) {
        case 'zap':
          if (e.crit) go('crit', e.src === 'chain' ? 0.85 : 1, e.src === 'drone' ? 0.6 : 1);
          else if (e.src === 'drone') go('zap', 1.5, 0.45);
          else if (e.src === 'chain') go('zap', 0.8, 0.8);
          else go('zap', 1, 1);
          break;
        case 'kill':
          if (e.boss) break;                       // bossDead covers it
          if (e.elite || (+e.r >= 20)) go('killBig', 1, 1);
          else go('kill', clamp(1.25 - 0.02 * (+e.r || 12), 0.85, 1.1), 1);
          break;
        case 'explode': go('explode', e.src === 'bomber' ? 1 : 1.15, e.src === 'bomber' ? 1 : 0.8); break;
        case 'pickup':
          if (e.kind === 'core') go('core', 1, 1);
          else if (e.kind === 'cell') go('cell', 1, 1);
          else go('pickup', 1, 1);
          break;
        case 'hurt':
          go('hurt', (e.src === 'slam' || e.src === 'charge') ? 0.85 : 1, clamp(0.6 + 0.08 * (+e.amount || 0), 0.6, 1.2));
          break;
        case 'shot': go('shot', 1, 0.6); break;
        case 'lowBattery': go('low', 1, 1); break;
        case 'spare': go('cell', 1, 1); go('ocStart', 1.2, 0.8, 0.12); break;
        case 'ocStart': go('ocStart', 1, 1); break;
        case 'ocEnd': go('ocEnd', 1, 1); break;
        case 'combo': go('combo', 1 + Math.min(+e.n || 0, 80) / 100, 1); break;
        case 'bossWarn': go('bossWarn', 1, 1); break;
        case 'bossSpawn': go('bossSpawn', 1, 1); break;
        case 'slam': go('slam', 1, 1); break;
        case 'bossDead': go('bossDead', 1, 1); break;
        case 'telegraph': go('telegraph', e.kind === 'charge' ? 1.15 : 0.9, 1); break;
        case 'shield': go('shield', e.on === false ? 0.75 : 1, e.on === false ? 0.7 : 1); break;
        case 'end':
          if (e.reason === 'battery' || e.reason === 'clockout') go('shiftEnd', 1, 1);
          break;
        // Act II (SPEC §11.12). infect, stock, internEnd and classified: no sound from handle()
        case 'laser': go('laser', 1, 1); break;
        case 'storm': go('storm', 1, 1); break;
        case 'wellOpen': go('well', 1, 1); break;
        case 'wellBoom': go('wellBoom', 1, 1); break;
        case 'steal': go('steal', 1, 1); break;
        case 'refund': go('refund', 1, 1); break;
        case 'intern': go('intern', 1, 0.8); break;
        case 'severance': go('severance', 1, 1); break;
        case 'overtime': go('overtime', 1, 1); break;
        case 'budget': if (e.on === true) go('budget', 1, 1); break;
        case 'blink': go('blink', 1, 1); break;
        case 'print': go('print', 1, 0.45); break;
        case 'mimicWake': go('mimic', 1, 1); break;
        // Act III (SPEC §12.11). founder: no sound from handle() (UI plays it on the finale card)
        case 'hold': go('hold', 1, 1); break;
        case 'injunction': go('injunction', 1, 1); break;
        case 'clawback': go('clawback', 1, 1); break;
        case 'orbital': go('orbital', 1, 1); break;
        case 'burst': go('burst', 1, 0.8); break;
        case 'copy': go('copy', 1, 0.5); break;
        default: break;   // pulse, hit, spawn, bossPhase, sectorClear: no sound
      }
    }
  }

  /* ---------------------------------------------------------------- public API */

  var A = BY.Audio = {
    names: Object.keys(R),

    unlock: function () {
      try {
        if (ctx && ctx.state === 'closed' && !external) { ctx = null; master = null; noiseBuf = null; }
        if (!ctx) {
          var AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return false;
          var c;
          try { c = new AC({ latencyHint: 'interactive' }); } catch (e1) { c = new AC(); }
          if (!attach(c, false)) return false;
          try {   // iOS: play a silent buffer inside the gesture
            var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
            s.buffer = b; s.connect(c.destination); s.start(0);
          } catch (e2) { err(e2); }
        }
        if (!isOffline(ctx) && ctx.state !== 'running') tryResume();
        return true;
      } catch (e) { err(e); return false; }
    },

    setEnabled: function (on) {
      try {
        enabled = !!on;
        if (ctx && master) {
          var g = master.gain, t = now();
          try { g.cancelScheduledValues(t); } catch (e1) { /* ignore */ }
          g.setValueAtTime(enabled ? LEVEL : 0, t);
          try { g.value = enabled ? LEVEL : 0; } catch (e2) { /* ignore */ }
        }
        if (!enabled) nextAt = {};
      } catch (e) { err(e); }
    },

    isEnabled: function () { return enabled; },

    play: function (name, opts) {
      try {
        if (!enabled || typeof name !== 'string' || typeof R[name] !== 'function' || !ready()) return;
        var p = pos(opts && opts.pitch, 1, 0.25, 4), v = num(opts && opts.vol, 1, 0, 3);
        var t = now() + 0.005;
        if (opts && typeof opts.at === 'number' && isFinite(opts.at) && opts.at > t) t = opts.at;   // extra: absolute start time (tests)
        if (BUDGETED[name] && stats.active > MAX_ACTIVE) return;
        fire(name, p, v, t);
      } catch (e) { err(e); }
    },

    handle: function (events, run) {
      try { if (enabled) handleImpl(events, run); } catch (e) { err(e); }
    },

    /* test hooks */
    _useContext: function (c) {
      try {
        if (!c) { ctx = null; master = null; noiseBuf = null; external = false; return false; }
        return attach(c, true);
      } catch (e) { err(e); return false; }
    },
    _state: function () { return { hasCtx: !!ctx, state: ctx ? ctx.state : null, external: external, enabled: enabled, lastError: lastError }; },
    _stats: stats,
    _trace: null,
    _resetStats: function () {
      stats.sounds = 0; stats.osc = 0; stats.noise = 0; stats.dropped = 0; stats.errors = 0; stats.byName = {}; lastError = null;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
