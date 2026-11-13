(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};

  // ===========================================================================
  // BY.Render : the arena canvas. Draws only the canvas; all HUD text is DOM.
  // Pooled FX (typed arrays), no per-frame allocation in the main draw path.
  // ===========================================================================

  var TAU = Math.PI * 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, floor = Math.floor, sqrt = Math.sqrt;
  var FONT = '"Chakra Petch", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

  var INK = '#0e1a21', FLOOR = '#152630';

  // colour table (indexes are used by the particle / ring pools)
  var COLORS = ['#ffffff', '#7fe7ff', '#ffc629', '#e8642c', '#ff9a63', '#c5d0d6', '#7f929c', '#3f6a7c',
                '#ffd75a', '#c792ff', '#7ddc6a', '#93adb9', '#2b4a58', '#e3d6ff', '#8f3a1a', '#e0392a', '#bff6ff'];
  var C_WHITE = 0, C_ARC = 1, C_HAZ = 2, C_RUST = 3, C_RUSTLT = 4, C_STEEL = 5, C_STEELDK = 6, C_TEAL = 7,
      C_GOLD = 8, C_CORE = 9, C_OK = 10, C_DUST = 11, C_TEALDK = 12, C_VIO = 13, C_RUSTDK = 14, C_RED = 15, C_PALE = 16;
  var GLOW_COLORS = { 0: 'rgba(255,255,255,', 1: 'rgba(127,231,255,', 2: 'rgba(255,198,41,', 3: 'rgba(255,120,60,',
                      4: 'rgba(255,154,99,', 8: 'rgba(255,215,90,', 9: 'rgba(199,146,255,', 10: 'rgba(125,220,106,', 15: 'rgba(224,57,42,', 16: 'rgba(191,246,255,' };

  var DEB = {
    scrapling: [7, 6, 12], roller: [5, 6, 2], sparker: [3, 4, 1], shieldbot: [7, 5, 2], hauler: [12, 7, 2],
    splitter: [7, 12, 5], mite: [5, 6, 1], turret: [6, 12, 3], bomber: [3, 14, 2], gilded: [8, 2, 0],
    pylon: [12, 7, 1], compactor: [5, 3, 6], shredder: [6, 3, 5], furnace: [3, 4, 12], foreman: [12, 2, 5],
    overseer: [9, 12, 3]
  };
  var DEB_DEFAULT = [5, 6, 7];

  // caps
  var MAXP = 300, MAXA = 64, MAXN = 30, MAXR = 56, MAXCE = 16, MAXF = 64, MAXLZ = 8, MAXLED = 128, MAXSNAP = 48, MAXFLECK = 72;

  // ---------------------------------------------------------------- state
  var canvas = null, ctx = null;
  var opts = { reducedMotion: false, shake: true };
  var cssW = 0, cssH = 0, dpr = 1, bw = 0, bh = 0;
  var fitW = 0, fitH = 0, fitS = 1, fitOX = 0, fitOY = 0, fitDirty = true;
  var curSector = 0, floorSector = -1, floorCv = null, floorW = 0, floorH = 0;
  var loadout = { arc: 0, chassis: 0, salvage: 0, drones: 0, titan: false };
  var curRun = null;
  var vigGrad = null, warnGrad = null, glowGrad = null, gradW = 0, gradH = 0;
  var glows = {};                 // colour index -> small radial glow canvas

  var fxT = 0, slowT = 0, shakeAmp = 0, shX = 0, shY = 0;
  var pulseFlash = 0, redFlash = 0, whiteFlash = 0, lowKick = 0, ocFlash = 0, warnDark = 0;
  var pFace = 0, lastBossSeen = false, sweepHide = false;

  // particles
  var pN = 0;
  var px = new Float32Array(MAXP), py = new Float32Array(MAXP), pvx = new Float32Array(MAXP), pvy = new Float32Array(MAXP),
      plife = new Float32Array(MAXP), pmax = new Float32Array(MAXP), psize = new Float32Array(MAXP),
      prot = new Float32Array(MAXP), pvr = new Float32Array(MAXP), pfr = new Float32Array(MAXP);
  var pkind = new Uint8Array(MAXP), pcol = new Uint8Array(MAXP);
  // rings
  var rN = 0;
  var rx = new Float32Array(MAXR), ry = new Float32Array(MAXR), r0 = new Float32Array(MAXR), r1 = new Float32Array(MAXR),
      rlife = new Float32Array(MAXR), rmax = new Float32Array(MAXR), rw = new Float32Array(MAXR), ra = new Float32Array(MAXR);
  var rkind = new Uint8Array(MAXR), rcol = new Uint8Array(MAXR);
  // arcs (lightning)
  var aN = 0;
  var ax1 = new Float32Array(MAXA), ay1 = new Float32Array(MAXA), ax2 = new Float32Array(MAXA), ay2 = new Float32Array(MAXA),
      alife = new Float32Array(MAXA), amax = new Float32Array(MAXA), aseed = new Float32Array(MAXA),
      aver = new Int8Array(MAXA);
  var akind = new Uint8Array(MAXA), acrit = new Uint8Array(MAXA), aanch = new Uint8Array(MAXA);
  var apts = [];
  (function () { for (var i = 0; i < MAXA; i++) apts.push(new Float32Array(2 * 18)); })();
  // floating numbers
  var nN = 0;
  var nx = new Float32Array(MAXN), ny = new Float32Array(MAXN), nvy = new Float32Array(MAXN), nlife = new Float32Array(MAXN),
      nmax = new Float32Array(MAXN), nage = new Float32Array(MAXN), nval = new Float32Array(MAXN), neid = new Int32Array(MAXN);
  var nkind = new Uint8Array(MAXN);       // 0 dmg, 1 crit, 2 armored, 3 bolt, 4 core, 5 cell, 6 combo
  var ntext = [];
  (function () { for (var i = 0; i < MAXN; i++) ntext.push(''); })();
  // pending explosion chain (warden death)
  var ceN = 0, ceT = new Float32Array(MAXCE), ceX = new Float32Array(MAXCE), ceY = new Float32Array(MAXCE), ceBig = new Uint8Array(MAXCE);
  // ghost of the dying Warden + last seen Warden snapshot
  var BKEYS = ['id', 'type', 'x', 'y', 'vx', 'vy', 'r', 'hp', 'maxHp', 'armor', 'elite', 'boss', 'hostile', 'invuln', 'flash', 'age', 'facing', 'planted', 'windup', 'phase', 'copy', 'healing'];
  var lastBoss = { id: 0, type: 'compactor', x: 0, y: 0, vx: 0, vy: 0, r: 30, hp: 1, maxHp: 1, armor: 0, elite: false, boss: true, hostile: true, invuln: false, flash: 0, age: 0, facing: 0, planted: false, windup: 0 };
  var haveLastBoss = false;
  var ghost = { id: 0, type: 'compactor', x: 0, y: 0, vx: 0, vy: 0, r: 30, hp: 0, maxHp: 1, armor: 0, elite: false, boss: true, hostile: true, invuln: false, flash: 0, age: 0, facing: 0, planted: false, windup: 0 };
  var ghostT = 0, ghostDur = 0;
  // oc afterimages
  var AI_N = 3, aiX = new Float32Array(AI_N), aiY = new Float32Array(AI_N), aiA = new Float32Array(AI_N), aiFx = new Float32Array(AI_N);
  var aiLast = 0, aiI = 0;
  // bolt popup merge
  var DASH_ARR = [6, 9], NO_DASH = [], DASH_LZ = [8, 7], DASH_LINK = [5, 6];
  // flyers: bolts / sparks that travel to a point or a tracked bot (Repo steal, Severance vacuum)
  var fN = 0;
  var fsx = new Float32Array(MAXF), fsy = new Float32Array(MAXF), ftx = new Float32Array(MAXF), fty = new Float32Array(MAXF),
      fage = new Float32Array(MAXF), fdur = new Float32Array(MAXF), fbend = new Float32Array(MAXF), fcx = new Float32Array(MAXF), fcy = new Float32Array(MAXF);
  var fkind = new Uint8Array(MAXF), fcol = new Uint8Array(MAXF), fobj = [];
  (function () { for (var i = 0; i < MAXF; i++) fobj.push(null); })();
  // laser afterglow slots
  var lzId = new Int32Array(MAXLZ), lzSeen = new Float32Array(MAXLZ), lzX1 = new Float32Array(MAXLZ), lzY1 = new Float32Array(MAXLZ),
      lzX2 = new Float32Array(MAXLZ), lzY2 = new Float32Array(MAXLZ), lzW = new Float32Array(MAXLZ);
  // server-farm LEDs (built with the floor) and a snapshot of floor pickups for the Severance vacuum
  var ledN = 0, ledX = new Float32Array(MAXLED), ledY = new Float32Array(MAXLED), ledP = new Float32Array(MAXLED), ledC = new Uint8Array(MAXLED);
  var snapN = 0, snapX = new Float32Array(MAXSNAP), snapY = new Float32Array(MAXSNAP);
  var nodeTmp = [], stormFlash = 0, budgetA = 0, stockPrev = 1, infectGate = 0, isPaused = false, wellSeen = 0;
  var budGrad = null;
  // Act III: orbital beams, founder phase flash, trading-floor ticker strip, volatility label cache
  var MAXBM = 6, bmN = 0, bmX = new Float32Array(MAXBM), bmY = new Float32Array(MAXBM), bmR = new Float32Array(MAXBM),
      bmL = new Float32Array(MAXBM), bmM = new Float32Array(MAXBM);
  var founderFlash = 0, founderX = 0, founderY = 0, spamGate = 0, tickCv = null, volKey = -1, volTxt = '';
  var NCOL = ['#c5d0d6', '#ffc629', '#7f929c', '#ffd75a', '#c792ff', '#7ddc6a', '#ffc629', '#ff9a63', '#ffc629', '#ffd75a'];

  // ------------------------------------------------------------- helpers
  function rnd() { return Math.random(); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d === undefined ? 0 : d); }
  function mk(w, h) {
    var c = root.document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function reduced() { return opts.reducedMotion; }
  function cnt(n) { return reduced() ? Math.ceil(n * 0.5) : Math.round(n); }

  function fmtNum(v) {
    if (BY.Fmt && BY.Fmt.num) return BY.Fmt.num(v);
    if (!(v > 0)) return '0';
    if (v < 10) return String(Math.round(v * 10) / 10);
    if (v < 1000) return String(Math.round(v));
    var u = ['k', 'M', 'B', 'T', 'Qa', 'Qi'], i = -1;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v < 10 ? (Math.round(v * 10) / 10) : Math.round(v)) + u[i];
  }

  function glowFor(ci) {
    var g = glows[ci];
    if (g) return g;
    if (!root.document) return null;
    var base = GLOW_COLORS[ci] || GLOW_COLORS[0];
    var c = mk(64, 64), x = c.getContext('2d');
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, base + '1)');
    gr.addColorStop(0.35, base + '0.45)');
    gr.addColorStop(1, base + '0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    glows[ci] = c;
    return c;
  }

  // ------------------------------------------------------------ pools : add
  function addP(kind, x, y, vx, vy, life, size, col, vr, fr) {
    var i;
    if (pN < MAXP) i = pN++; else i = (rnd() * MAXP) | 0;
    px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy; plife[i] = life; pmax[i] = life; psize[i] = size;
    pkind[i] = kind; pcol[i] = col; prot[i] = rnd() * TAU; pvr[i] = vr || 0; pfr[i] = fr === undefined ? 0.9 : fr;
  }
  function addRing(kind, x, y, a, b, life, col, w, alpha) {
    var i;
    if (rN < MAXR) i = rN++; else i = 0;
    rx[i] = x; ry[i] = y; r0[i] = a; r1[i] = b; rlife[i] = life; rmax[i] = life; rkind[i] = kind; rcol[i] = col;
    rw[i] = w; ra[i] = alpha;
  }
  function addNum(x, y, text, kind, life, vy, eid, val) {
    var i;
    if (nN < MAXN) i = nN++;
    else {
      // flooded: replace the oldest plain damage number, or give up on this one
      var best = -1, ba = -1;
      for (var k = 0; k < nN; k++) if (nkind[k] === 0 || nkind[k] === 2) { if (nage[k] > ba) { ba = nage[k]; best = k; } }
      if (best < 0) return -1;
      i = best;
    }
    nx[i] = x; ny[i] = y; nvy[i] = vy; nlife[i] = life; nmax[i] = life; nage[i] = 0; nkind[i] = kind; ntext[i] = text;
    neid[i] = eid || 0; nval[i] = val || 0;
    return i;
  }
  function addArc(x1, y1, x2, y2, kind, crit) {
    var i;
    if (aN < MAXA) i = aN++; else i = 0;
    ax1[i] = x1; ay1[i] = y1; ax2[i] = x2; ay2[i] = y2; akind[i] = kind; acrit[i] = crit ? 1 : 0;
    amax[i] = kind === 3 ? 0.30 : (crit ? 0.17 : 0.13); alife[i] = amax[i]; aseed[i] = rnd() * 1000; aver[i] = -1;
    aanch[i] = kind === 0 ? 1 : 0;
  }
  // flyer: from (x0,y0) to a point or a tracked bot; kind 0 hex bolt, 1 spark streak
  function addFly(kind, x0, y0, tx, ty, obj, dur, col, bend) {
    var i;
    if (fN < MAXF) i = fN++; else i = (rnd() * MAXF) | 0;
    fsx[i] = x0; fsy[i] = y0; ftx[i] = tx; fty[i] = ty; fobj[i] = obj || null; fage[i] = 0; fdur[i] = dur;
    fkind[i] = kind; fcol[i] = col; fbend[i] = bend; fcx[i] = x0; fcy[i] = y0;
  }
  var HMAX = 48, hid = new Int32Array(HMAX), hlast = new Float32Array(HMAX), hacc = new Float64Array(HMAX),
      hx = new Float32Array(HMAX), hy = new Float32Array(HMAX), harm = new Uint8Array(HMAX);
  function flushHit(i, W) {
    if (hacc[i] > 0) popDmg(hx[i], hy[i], hacc[i], false, harm[i] === 1, hid[i], W);
    hacc[i] = 0; hlast[i] = fxT;
  }
  // one damage popup: merges into a fresh one on the same bot, else is nudged up until it clears neighbours
  function popDmg(x, y, v, crit, arm, id, W) {
    var i, merged = false;
    if (id) for (i = 0; i < nN; i++) {
      if (neid[i] === id && nage[i] < 0.16 && nkind[i] <= 2 && ((nkind[i] === 1) === crit)) {
        nval[i] += v; ntext[i] = fmtNum(nval[i]); nage[i] = 0; nlife[i] = nmax[i]; return;
      }
    }
    if (!crit && nN > 20) return;
    var px2 = clamp(x + (rnd() - 0.5) * 12, 14, W - 14), py2 = y - 12;
    if (!crit) {
      // a fresh plain number nearby: sum into it instead of stacking
      for (i = 0; i < nN; i++) {
        if (nkind[i] > 2 || nage[i] > 0.15 || nkind[i] === 1) continue;
        if (abs(nx[i] - px2) < 30 && abs(ny[i] - py2) < 14) {
          nval[i] += v; ntext[i] = fmtNum(nval[i]); nage[i] = 0; nlife[i] = nmax[i]; return;
        }
      }
      // otherwise nudge up (alternating a little sideways) until it clears older numbers
      for (var tries = 0; tries < 8; tries++) {
        var hit = false;
        for (i = 0; i < nN; i++) {
          if (nkind[i] > 2) continue;
          if (abs(nx[i] - px2) < 42 && abs(ny[i] - py2) < 12) { hit = true; break; }
        }
        if (!hit) break;
        py2 -= 12; px2 = clamp(px2 + ((tries & 1) ? -9 : 9), 14, W - 14);
      }
    }
    addNum(px2, py2, fmtNum(v), crit ? 1 : (arm ? 2 : 0), crit ? 0.85 : 0.65, crit ? -34 : -26, id, v);
  }
  function byId(run, id) {
    var en = run.enemies;
    for (var i = 0; i < en.length; i++) if (en[i].id === id) return en[i];
    return null;
  }

  function shake(a) {
    if (!opts.shake || opts.reducedMotion) return;
    if (a > shakeAmp) shakeAmp = a;
  }

  // ------------------------------------------------------- burst helpers
  function sparks(x, y, n, col, spd, life) {
    n = cnt(n);
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU, s = spd * (0.4 + rnd() * 0.8);
      addP(0, x, y, cos(a) * s, sin(a) * s, life * (0.6 + rnd() * 0.6), 1.2 + rnd() * 0.8, col, 0, 0.88);
    }
  }
  function sparksMix(x, y, n, colA, colB, spd, life) {
    n = cnt(n);
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU, s = spd * (0.4 + rnd() * 0.8);
      addP(0, x, y, cos(a) * s, sin(a) * s, life * (0.6 + rnd() * 0.6), 1.2 + rnd() * 0.8, rnd() < 0.5 ? colA : colB, 0, 0.88);
    }
  }
  function debris(x, y, n, size, cols, spd, life) {
    n = cnt(n);
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU, s = spd * (0.35 + rnd() * 0.75);
      addP(1, x + cos(a) * 3, y + sin(a) * 3, cos(a) * s, sin(a) * s, life * (0.7 + rnd() * 0.6), size * (0.6 + rnd() * 0.8),
           cols[(rnd() * cols.length) | 0], (rnd() - 0.5) * 14, 0.9);
    }
  }
  function dust(x, y, n, spd, size, life, col) {
    n = cnt(n);
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU, s = spd * (0.3 + rnd() * 0.7);
      addP(2, x + cos(a) * 2, y + sin(a) * 2, cos(a) * s, sin(a) * s, life * (0.7 + rnd() * 0.6), size * (0.7 + rnd() * 0.6), col === undefined ? C_DUST : col, 0, 0.9);
    }
  }
  function dustRing(x, y, rad, n, spd, size, life) {
    n = cnt(n);
    for (var i = 0; i < n; i++) {
      var a = i * TAU / n + rnd() * 0.3;
      addP(2, x + cos(a) * rad, y + sin(a) * rad, cos(a) * spd, sin(a) * spd, life * (0.7 + rnd() * 0.6), size * (0.7 + rnd() * 0.6), C_DUST, 0, 0.9);
    }
  }

  function findBoss(run) {
    if (!run || !run.enemies) return null;
    for (var i = 0; i < run.enemies.length; i++) if (run.enemies[i].boss && !run.enemies[i].dead) return run.enemies[i];
    return null;
  }

  // ---------------------------------------------------------- geometry
  function resize() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    cssW = r.width || canvas.clientWidth || 0;
    cssH = r.height || canvas.clientHeight || 0;
    dpr = min(root.devicePixelRatio || 1, 2);
    bw = max(1, Math.round(cssW * dpr));
    bh = max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    fitDirty = true; floorSector = -1;
  }

  function computeFit(w, h) {
    fitW = w; fitH = h;
    fitS = (cssW > 0 && cssH > 0) ? min(cssW / w, cssH / h) : 1;
    fitOX = (cssW - w * fitS) / 2; fitOY = (cssH - h * fitS) / 2;
    fitDirty = false;
  }

  function arenaSize() {
    var h = 640;
    if (cssW > 0 && cssH > 0) h = clamp(360 * cssH / cssW, 480, 760);
    return { w: 360, h: h };
  }

  function toArena(cx, cy) {
    var rc = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    if (!fitW) { var a = arenaSize(); computeFit(a.w, a.h); }
    return { x: (cx - rc.left - fitOX) / fitS, y: (cy - rc.top - fitOY) / fitS };
  }

  function scale() { if (!fitW) { var a = arenaSize(); computeFit(a.w, a.h); } return fitS; }

  // -------------------------------------------------------------- floor
  function mulberry(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SECT_TINT = [null, null, 'rgba(60,20,10,0.10)', 'rgba(70,24,6,0.12)', 'rgba(8,30,50,0.10)', 'rgba(40,14,70,0.12)',
                   'rgba(66,52,8,0.09)', 'rgba(6,34,60,0.16)', 'rgba(14,52,40,0.10)', 'rgba(70,76,84,0.10)', 'rgba(58,32,14,0.42)', 'rgba(70,24,14,0.34)'];

  // diagonal hazard stripes in a rectangle (docks)
  function hazStripe(f, x, y, w, h, a) {
    f.save(); f.beginPath(); f.rect(x, y, w, h); f.clip();
    f.fillStyle = 'rgba(0,0,0,' + (a * 1.4) + ')'; f.fillRect(x, y, w, h);
    f.fillStyle = 'rgba(255,198,41,' + a + ')'; f.beginPath();
    for (var i = -h; i < w + h; i += 22) { f.moveTo(x + i, y + h); f.lineTo(x + i + 11, y + h); f.lineTo(x + i + 11 + h, y); f.lineTo(x + i + h, y); f.closePath(); }
    f.fill(); f.restore();
  }
  function rrect(f, x, y, w, h, r) {
    f.moveTo(x + r, y); f.lineTo(x + w - r, y); f.quadraticCurveTo(x + w, y, x + w, y + r); f.lineTo(x + w, y + h - r);
    f.quadraticCurveTo(x + w, y + h, x + w - r, y + h); f.lineTo(x + r, y + h); f.quadraticCurveTo(x, y + h, x, y + h - r);
    f.lineTo(x, y + r); f.quadraticCurveTo(x, y, x + r, y); f.closePath();
  }
  // Boardroom (10) and Overtime (11): wood panels, a long table with chairs
  function boardroom(f, w, h, R, over) {
    var i, j, x, y;
    for (x = 0; x < w; x += 36) {
      f.fillStyle = ((x / 36) & 1) ? 'rgba(120,70,30,0.10)' : 'rgba(0,0,0,0.14)';
      f.fillRect(x, 0, 36, h);
      f.fillStyle = 'rgba(0,0,0,0.30)'; f.fillRect(x, 0, 1, h);
    }
    f.lineWidth = 1; f.strokeStyle = over ? 'rgba(210,110,70,0.06)' : 'rgba(200,140,80,0.06)'; f.beginPath();
    for (x = 3; x < w; x += 36) for (j = 0; j < 4; j++) {
      var gx = x + 4 + R() * 26, gy = R() * h, gl = 40 + R() * 120;
      f.moveTo(gx, gy); f.bezierCurveTo(gx + 3, gy + gl * 0.3, gx - 3, gy + gl * 0.7, gx + 1, gy + gl);
    }
    f.stroke();
    // wainscot strips at the sides with a gold line
    f.fillStyle = 'rgba(0,0,0,0.28)'; f.fillRect(0, 0, 12, h); f.fillRect(w - 12, 0, 12, h);
    f.fillStyle = 'rgba(255,198,41,0.16)'; f.fillRect(12, 0, 1.5, h); f.fillRect(w - 13.5, 0, 1.5, h);
    // the long table
    var tw = 118, tl = Math.min(h - 150, 470), tx = (w - tw) / 2, ty = (h - tl) / 2;
    f.beginPath(); rrect(f, tx, ty, tw, tl, 26); f.fillStyle = 'rgba(0,0,0,0.20)'; f.fill();
    f.strokeStyle = over ? 'rgba(235,120,80,0.22)' : 'rgba(220,160,100,0.22)'; f.lineWidth = 2; f.stroke();
    f.beginPath(); rrect(f, tx + 9, ty + 9, tw - 18, tl - 18, 18); f.strokeStyle = 'rgba(255,198,41,0.09)'; f.lineWidth = 1; f.stroke();
    f.setLineDash([6, 8]); f.beginPath(); f.moveTo(w / 2, ty + 22); f.lineTo(w / 2, ty + tl - 22); f.strokeStyle = 'rgba(220,160,100,0.10)'; f.stroke(); f.setLineDash([]);
    // chairs
    f.strokeStyle = 'rgba(220,160,100,0.15)'; f.lineWidth = 1.5; f.beginPath();
    var nc = Math.max(3, Math.floor((tl - 70) / 58));
    for (i = 0; i < nc; i++) {
      y = ty + 38 + i * ((tl - 76) / Math.max(1, nc - 1));
      rrect(f, tx - 22, y - 11, 15, 22, 5); rrect(f, tx + tw + 7, y - 11, 15, 22, 5);
    }
    rrect(f, w / 2 - 14, ty - 22, 28, 16, 6); rrect(f, w / 2 - 14, ty + tl + 6, 28, 16, 6);
    f.stroke();
    // nameplates
    f.fillStyle = 'rgba(255,198,41,0.12)';
    for (i = 0; i < nc; i++) { y = ty + 38 + i * ((tl - 76) / Math.max(1, nc - 1)); f.fillRect(tx + 10, y - 2, 14, 4); f.fillRect(tx + tw - 24, y - 2, 14, 4); }
    if (over) {
      // time clock ticks around the room
      var cx = w / 2, cy = h / 2;
      f.strokeStyle = 'rgba(232,80,50,0.16)'; f.lineWidth = 2; f.beginPath();
      for (i = 0; i < 12; i++) { var an = i * TAU / 12; f.moveTo(cx + cos(an) * 150, cy + sin(an) * 150); f.lineTo(cx + cos(an) * (i % 3 === 0 ? 124 : 136), cy + sin(an) * (i % 3 === 0 ? 124 : 136)); }
      f.stroke();
      f.beginPath(); f.arc(cx, cy, 160, 0, TAU); f.lineWidth = 1.2; f.strokeStyle = 'rgba(232,80,50,0.10)'; f.stroke();
    }
  }

  // ---- Act III sector looks (all drawn once into the cached floor canvas, arena coordinates)
  function lobby(f, w, h, R) {
    var i, j, x, y, T = 60;
    for (j = 0; j * T < h; j++) for (i = 0; i * T < w; i++) {
      f.fillStyle = ((i + j) & 1) ? 'rgba(210,225,235,0.050)' : 'rgba(0,0,0,0.16)';
      f.fillRect(i * T, j * T, T, T);
    }
    f.strokeStyle = 'rgba(200,215,225,0.07)'; f.lineWidth = 1; f.beginPath();
    for (i = 0; i < 26; i++) {
      x = R() * w; y = R() * h; var L = 50 + R() * 90, d = R() < 0.5 ? 1 : -1;
      f.moveTo(x, y); f.bezierCurveTo(x + L * 0.3 * d, y + L * 0.2, x + L * 0.6 * d, y + L * 0.8, x + L * d, y + L);
    }
    f.stroke();
    f.strokeStyle = 'rgba(255,255,255,0.045)'; f.beginPath();
    for (i = 0; i <= w; i += T) { f.moveTo(i + 0.5, 0); f.lineTo(i + 0.5, h); }
    for (j = 0; j <= h; j += T) { f.moveTo(0, j + 0.5); f.lineTo(w, j + 0.5); }
    f.stroke();
    var rw0 = 190, rh0 = Math.min(h - 220, 380), rx0 = (w - rw0) / 2, ry0 = (h - rh0) / 2 + 10;
    f.beginPath(); rrect(f, rx0, ry0, rw0, rh0, 14); f.fillStyle = 'rgba(120,36,36,0.13)'; f.fill();
    f.strokeStyle = 'rgba(255,198,41,0.22)'; f.lineWidth = 2; f.stroke();
    f.beginPath(); rrect(f, rx0 + 8, ry0 + 8, rw0 - 16, rh0 - 16, 9); f.strokeStyle = 'rgba(255,198,41,0.10)'; f.lineWidth = 1; f.stroke();
    var cx = w / 2, cy = ry0 + rh0 / 2;
    f.beginPath(); f.arc(cx, cy, 44, 0, TAU); f.moveTo(cx + 30, cy); f.arc(cx, cy, 30, 0, TAU); f.strokeStyle = 'rgba(255,198,41,0.20)'; f.lineWidth = 1.6; f.stroke();
    f.beginPath();
    for (i = 0; i < 8; i++) { var a = i * TAU / 8 + 0.39; f.moveTo(cx + cos(a) * 12, cy + sin(a) * 12); f.lineTo(cx + cos(a) * (i % 2 ? 28 : 40), cy + sin(a) * (i % 2 ? 28 : 40)); }
    f.stroke();
    f.beginPath(); rrect(f, w / 2 - 74, 24, 148, 22, 10); f.fillStyle = 'rgba(0,0,0,0.30)'; f.fill();
    f.strokeStyle = 'rgba(255,198,41,0.24)'; f.lineWidth = 1.6; f.stroke();
    f.fillStyle = 'rgba(127,231,255,0.10)'; f.fillRect(w / 2 - 22, 28, 12, 6); f.fillRect(w / 2 + 10, 28, 12, 6);
    f.beginPath(); f.arc(w / 2, h - 26, 22, Math.PI, TAU); f.moveTo(w / 2 - 22, h - 26); f.lineTo(w / 2 + 22, h - 26);
    f.moveTo(w / 2, h - 48); f.lineTo(w / 2, h - 26); f.strokeStyle = 'rgba(127,231,255,0.14)'; f.lineWidth = 1.4; f.stroke();
    var pts = [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]];
    for (i = 0; i < 4; i++) {
      f.beginPath(); f.arc(pts[i][0], pts[i][1], 13, 0, TAU); f.fillStyle = 'rgba(0,0,0,0.25)'; f.fill();
      f.beginPath(); f.arc(pts[i][0], pts[i][1], 8, 0, TAU); f.fillStyle = 'rgba(80,170,90,0.20)'; f.fill();
    }
  }

  function legal(f, w, h, R) {
    var i, j, x, y;
    f.fillStyle = 'rgba(110,62,26,0.22)'; f.fillRect(0, 0, w, h);
    var PWd = 82, PHt = 118, gx = 8;
    for (j = 0; j * (PHt + gx) < h + PHt; j++) for (i = 0; i * (PWd + gx) < w + PWd; i++) {
      x = gx + i * (PWd + gx); y = gx + j * (PHt + gx) - 40;
      f.fillStyle = 'rgba(0,0,0,0.20)'; f.fillRect(x, y, PWd, PHt);
      f.strokeStyle = 'rgba(255,200,130,0.10)'; f.lineWidth = 1; f.strokeRect(x + 5.5, y + 5.5, PWd - 11, PHt - 11);
      f.strokeStyle = 'rgba(0,0,0,0.35)'; f.strokeRect(x + 0.5, y + 0.5, PWd - 1, PHt - 1);
    }
    f.strokeStyle = 'rgba(200,140,80,0.07)'; f.beginPath();
    for (i = 0; i < 60; i++) { x = R() * w; y = R() * h; var gl = 30 + R() * 90; f.moveTo(x, y); f.bezierCurveTo(x + 2, y + gl * 0.3, x - 2, y + gl * 0.7, x, y + gl); }
    f.stroke();
    var cols = ['#7a2e2e', '#2e5a7a', '#6d5a2a', '#2e6a4a', '#5a3a6a', '#8a5a2a'];
    for (var side = 0; side < 2; side++) {
      var sx = side ? w - 22 : 0;
      f.fillStyle = 'rgba(0,0,0,0.38)'; f.fillRect(sx, 0, 22, h);
      for (y = 6; y < h - 10; y += 36) {
        f.fillStyle = 'rgba(0,0,0,0.4)'; f.fillRect(sx, y + 28, 22, 3);
        var bx = sx + 2;
        while (bx < sx + 20) {
          var bwid = 2 + R() * 2.4, bh = 16 + R() * 10;
          f.globalAlpha = 0.35; f.fillStyle = cols[(R() * cols.length) | 0]; f.fillRect(bx, y + 28 - bh, bwid, bh); bx += bwid + 0.4;
        }
        f.globalAlpha = 1;
      }
    }
    f.fillStyle = 'rgba(255,198,41,0.15)'; f.fillRect(22, 0, 1.5, h); f.fillRect(w - 23.5, 0, 1.5, h);
    var cx = w / 2, cy = h / 2;
    f.strokeStyle = 'rgba(255,198,41,0.17)'; f.lineWidth = 2; f.lineCap = 'round'; f.beginPath();
    f.arc(cx, cy, 92, 0, TAU); f.moveTo(cx, cy - 60); f.lineTo(cx, cy + 56); f.moveTo(cx - 52, cy - 44); f.lineTo(cx + 52, cy - 44);
    f.moveTo(cx - 52, cy - 44); f.lineTo(cx - 68, cy - 6); f.lineTo(cx - 36, cy - 6); f.closePath();
    f.moveTo(cx + 52, cy - 44); f.lineTo(cx + 68, cy - 6); f.lineTo(cx + 36, cy - 6); f.closePath();
    f.moveTo(cx - 24, cy + 56); f.lineTo(cx + 24, cy + 56); f.stroke();
    f.beginPath(); f.arc(cx, cy - 64, 4, 0, TAU); f.stroke();
    f.fillStyle = 'rgba(0,0,0,0.26)'; f.fillRect(40, 26, w - 80, 14); f.fillRect(40, h - 40, w - 80, 14);
    f.strokeStyle = 'rgba(255,198,41,0.16)'; f.lineWidth = 1.2; f.strokeRect(40.5, 26.5, w - 81, 13); f.strokeRect(40.5, h - 39.5, w - 81, 13);
  }

  function ledger(f, w, h, R) {
    var i, j, x, y;
    f.fillStyle = 'rgba(30,96,60,0.16)'; f.fillRect(0, 0, w, h);
    f.lineWidth = 1; f.strokeStyle = 'rgba(125,220,106,0.075)'; f.beginPath();
    for (x = 0; x <= w; x += 18) { f.moveTo(x + 0.5, 0); f.lineTo(x + 0.5, h); }
    for (y = 0; y <= h; y += 18) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
    f.stroke();
    f.strokeStyle = 'rgba(125,220,106,0.15)'; f.beginPath();
    for (x = 0; x <= w; x += 90) { f.moveTo(x + 0.5, 0); f.lineTo(x + 0.5, h); }
    for (y = 0; y <= h; y += 90) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
    f.stroke();
    f.strokeStyle = 'rgba(232,80,60,0.28)'; f.lineWidth = 1.4; f.beginPath();
    f.moveTo(46.5, 0); f.lineTo(46.5, h); f.moveTo(49.5, 0); f.lineTo(49.5, h); f.moveTo(w - 46.5, 0); f.lineTo(w - 46.5, h); f.stroke();
    f.font = '600 10px ' + FONT; f.textBaseline = 'middle'; f.textAlign = 'right';
    var colsX = [96, 150, 204, 258, 312];
    for (j = 0; j < Math.floor((h - 30) / 36); j++) {
      y = 27 + j * 36 + 9;
      for (i = 0; i < colsX.length; i++) {
        if (R() < 0.35) continue;
        var neg = R() < 0.18, v = Math.round(R() * 99000) / 100;
        f.fillStyle = neg ? 'rgba(232,100,60,0.17)' : 'rgba(125,220,106,0.15)';
        f.fillText(neg ? '(' + v.toFixed(2) + ')' : v.toFixed(2), colsX[i], y);
      }
      if (j % 6 === 5) {
        f.strokeStyle = 'rgba(125,220,106,0.20)'; f.lineWidth = 1; f.beginPath();
        f.moveTo(60, y + 12); f.lineTo(w - 50, y + 12); f.moveTo(60, y + 15); f.lineTo(w - 50, y + 15); f.stroke();
      }
    }
    f.textAlign = 'center'; f.fillStyle = 'rgba(125,220,106,0.12)'; f.font = '700 13px ' + FONT;
    f.fillText('LEDGER', w / 2, 16);
    f.strokeStyle = 'rgba(125,220,106,0.12)'; f.lineWidth = 2; f.strokeRect(10, 10, w - 20, h - 20);
  }

  function trading(f, w, h, R) {
    var i, j, x, y;
    f.fillStyle = 'rgba(10,36,52,0.35)'; f.fillRect(0, 0, w, h);
    var n = 28, cw = w / n, v = h * 0.62;
    for (i = 0; i < n; i++) {
      var o = v, c = v + (R() - 0.52) * 50; v = clamp(c, h * 0.2, h * 0.8);
      var hi = Math.min(o, c) - R() * 18, lo = Math.max(o, c) + R() * 18, up = c < o;
      f.fillStyle = f.strokeStyle = up ? 'rgba(125,220,106,0.13)' : 'rgba(232,100,60,0.13)';
      f.lineWidth = 1; f.beginPath(); f.moveTo(i * cw + cw / 2, hi); f.lineTo(i * cw + cw / 2, lo); f.stroke();
      f.fillRect(i * cw + cw * 0.2, Math.min(o, c), cw * 0.6, Math.max(3, abs(c - o)));
    }
    f.strokeStyle = 'rgba(127,231,255,0.05)'; f.beginPath();
    for (y = 40; y < h; y += 56) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
    f.stroke();
    var cx = w / 2, cy = h / 2;
    for (j = 0; j < 3; j++) {
      f.beginPath();
      for (i = 0; i < 8; i++) { var a = i * TAU / 8 + TAU / 16, rr = 74 + j * 22; f.lineTo(cx + cos(a) * rr, cy + sin(a) * rr); }
      f.closePath(); f.strokeStyle = 'rgba(255,198,41,' + (0.20 - j * 0.05) + ')'; f.lineWidth = 1.6 - j * 0.3; f.stroke();
    }
    for (i = 0; i < 2; i++) for (j = 0; j < 5; j++) {
      x = i ? w - 52 : 30; y = 90 + j * ((h - 200) / 4);
      f.fillStyle = 'rgba(0,0,0,0.30)'; f.fillRect(x, y - 14, 22, 28);
      f.fillStyle = 'rgba(127,231,255,0.18)'; f.fillRect(x + (i ? 3 : 12), y - 10, 7, 8);
      f.fillStyle = R() < 0.5 ? 'rgba(125,220,106,0.25)' : 'rgba(232,100,60,0.25)'; f.fillRect(x + (i ? 3 : 12), y + 2, 7, 6);
    }
    f.fillStyle = 'rgba(0,0,0,0.42)'; f.fillRect(12, 8, w - 24, 22); f.fillRect(12, h - 30, w - 24, 22);
    f.strokeStyle = 'rgba(255,198,41,0.2)'; f.lineWidth = 1; f.strokeRect(12.5, 8.5, w - 25, 21); f.strokeRect(12.5, h - 29.5, w - 25, 21);
    if (root.document) {
      var syms = ['BLT', 'GRN', 'ARC', 'SPK', 'NUT', 'YRD', 'CPX', 'WRD', 'HRQ', 'OTP'], sw = 720;
      if (!tickCv) tickCv = mk(sw, 22);
      var g = tickCv.getContext('2d');
      g.clearRect(0, 0, sw, 22); g.font = '700 11px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
      var tx = 4;
      for (i = 0; tx < sw - 60; i++) {
        var up2 = R() < 0.5, pr = (10 + R() * 990).toFixed(1), tx2 = syms[(R() * syms.length) | 0] + ' ' + pr + (up2 ? ' ▲' : ' ▼');
        g.fillStyle = up2 ? '#7ddc6a' : '#ff9a63'; g.fillText(tx2, tx, 11);
        tx += g.measureText(tx2).width + 16;
      }
      tickCv._len = tx;
    }
  }

  function skyline(f, w, h, R, over) {
    var i, j, x, y;
    f.fillStyle = 'rgba(8,14,44,0.45)'; f.fillRect(0, 0, w, h);
    f.strokeStyle = 'rgba(127,231,255,0.06)'; f.lineWidth = 1; f.beginPath();
    for (x = 0; x <= w; x += 90) { f.moveTo(x + 0.5, 0); f.lineTo(x + 0.5, h); }
    for (y = 0; y <= h; y += 90) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
    f.stroke();
    f.strokeStyle = 'rgba(200,225,255,0.05)'; f.lineWidth = 6; f.beginPath();
    for (i = 0; i < 4; i++) { var dx = R() * (w + h); f.moveTo(dx, 0); f.lineTo(dx - h * 0.6, h); }
    f.stroke();
    f.beginPath(); f.arc(w * 0.78, h * 0.2, 22, 0, TAU); f.fillStyle = 'rgba(227,214,255,0.10)'; f.fill();
    f.beginPath(); f.arc(w * 0.78 + 7, h * 0.2 - 3, 20, 0, TAU); f.fillStyle = 'rgba(8,14,44,0.55)'; f.fill();
    for (var band = 0; band < 2; band++) {
      x = 0;
      while (x < w) {
        var bw2 = 20 + R() * 34, bh2 = 26 + R() * 56, by2 = band ? h - bh2 : 0;
        f.fillStyle = 'rgba(2,6,20,0.62)'; f.fillRect(x, by2, bw2, bh2);
        f.fillStyle = 'rgba(255,215,90,0.28)';
        for (j = 5; j < bh2 - 4; j += 7) for (i = 4; i < bw2 - 3; i += 6) {
          if (R() < 0.36) f.fillRect(x + i, band ? by2 + j : by2 + (bh2 - j) - 3, 2.2, 3);
        }
        x += bw2 + 2 + R() * 4;
      }
    }
    f.strokeStyle = 'rgba(127,231,255,0.14)'; f.lineWidth = 1.4; f.strokeRect(14, 14, w - 28, h - 28);
    var cx = w / 2, cy = h / 2;
    f.beginPath(); f.arc(cx, cy, 82, 0, TAU); f.strokeStyle = 'rgba(255,198,41,0.14)'; f.lineWidth = 2; f.stroke();
    f.beginPath(); f.arc(cx, cy, 70, 0, TAU); f.lineWidth = 1; f.stroke();
    f.font = '700 70px ' + FONT; f.textAlign = 'center'; f.textBaseline = 'middle'; f.fillStyle = 'rgba(255,198,41,0.11)'; f.fillText('B', cx, cy + 4);
    if (over) {
      f.strokeStyle = 'rgba(232,80,50,0.18)'; f.lineWidth = 2; f.beginPath();
      for (i = 0; i < 12; i++) { var an = i * TAU / 12; f.moveTo(cx + cos(an) * 150, cy + sin(an) * 150); f.lineTo(cx + cos(an) * (i % 3 === 0 ? 124 : 136), cy + sin(an) * (i % 3 === 0 ? 124 : 136)); }
      f.stroke();
      f.beginPath(); f.arc(cx, cy, 160, 0, TAU); f.lineWidth = 1.2; f.strokeStyle = 'rgba(232,80,50,0.12)'; f.stroke();
    }
  }

  function buildFloor(w, h, sector) {
    if (!root.document || !bw) return;
    if (!floorCv) floorCv = mk(bw, bh);
    if (floorCv.width !== bw || floorCv.height !== bh) { floorCv.width = bw; floorCv.height = bh; }
    var f = floorCv.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.fillStyle = INK; f.fillRect(0, 0, bw, bh);
    var k = fitS * dpr;
    f.setTransform(k, 0, 0, k, fitOX * dpr, fitOY * dpr);
    f.fillStyle = FLOOR; f.fillRect(0, 0, w, h);
    var R = mulberry(sector * 7919 + 13), i, j, x, y;
    // plates
    var PW = 72, PH = 72;
    for (j = 0; j * PH < h; j++) {
      var off = (j % 2) * (PW / 2);
      for (i = -1; i * PW + off < w; i++) {
        x = i * PW + off; y = j * PH;
        var v = R();
        f.fillStyle = v < 0.5 ? 'rgba(255,255,255,' + (0.004 + v * 0.01) + ')' : 'rgba(0,0,0,' + (0.015 + (v - 0.5) * 0.06) + ')';
        f.fillRect(x, y, PW, PH);
      }
    }
    f.beginPath();
    for (j = 0; j * PH <= h; j++) { f.moveTo(0, j * PH + 0.5); f.lineTo(w, j * PH + 0.5); }
    f.strokeStyle = 'rgba(53,89,110,0.20)'; f.lineWidth = 1; f.stroke();
    f.beginPath();
    for (j = 0; j * PH < h; j++) {
      var o2 = (j % 2) * (PW / 2);
      for (i = -1; i * PW + o2 <= w; i++) { x = i * PW + o2 + 0.5; f.moveTo(x, j * PH); f.lineTo(x, (j + 1) * PH); }
    }
    f.stroke();
    // rivets
    f.fillStyle = 'rgba(147,173,185,0.10)';
    f.beginPath();
    for (j = 0; j * PH <= h; j++) {
      var o3 = (j % 2) * (PW / 2);
      for (i = -1; i * PW + o3 <= w + PW; i++) {
        x = i * PW + o3; y = j * PH;
        f.moveTo(x + 5, y + 5 + 1.3); f.arc(x + 5, y + 5, 1.3, 0, TAU);
        f.moveTo(x + PW - 5 + 1.3, y + 5); f.arc(x + PW - 5, y + 5, 1.3, 0, TAU);
      }
    }
    f.fill();
    // scuffs
    f.strokeStyle = 'rgba(147,173,185,0.07)'; f.lineWidth = 1; f.beginPath();
    for (i = 0; i < 26; i++) { x = R() * w; y = R() * h; var a = R() * TAU, l = 4 + R() * 12; f.moveTo(x, y); f.lineTo(x + cos(a) * l, y + sin(a) * l); }
    f.stroke();
    if (SECT_TINT[sector]) { f.fillStyle = SECT_TINT[sector]; f.fillRect(0, 0, w, h); }

    // sector treatment (static part)
    if (sector === 1) {
      // three belts
      for (i = 0; i < 3; i++) {
        y = h * (0.2 + i * 0.3) - 28;
        f.fillStyle = 'rgba(7,14,19,0.26)'; f.fillRect(0, y, w, 56);
        f.fillStyle = 'rgba(53,89,110,0.30)'; f.fillRect(0, y - 2, w, 2); f.fillRect(0, y + 56, w, 2);
      }
    } else if (sector === 2) {
      // crusher teeth along top & bottom
      f.fillStyle = 'rgba(143,58,26,0.22)';
      f.beginPath();
      for (x = 0; x < w; x += 24) {
        f.moveTo(x, 0); f.lineTo(x + 12, 15); f.lineTo(x + 24, 0);
        f.moveTo(x, h); f.lineTo(x + 12, h - 15); f.lineTo(x + 24, h);
      }
      f.fill();
      f.fillStyle = 'rgba(125,146,156,0.10)'; f.fillRect(0, 0, w, 3); f.fillRect(0, h - 3, w, 3);
      f.fillStyle = 'rgba(7,14,19,0.18)'; f.fillRect(0, 0, 8, h); f.fillRect(w - 8, 0, 8, h);
    } else if (sector === 3) {
      // grates near the hot side
      f.fillStyle = 'rgba(0,0,0,0.25)';
      for (i = 0; i < 4; i++) f.fillRect(10, h * (0.14 + i * 0.22), 34, 54);
      f.strokeStyle = 'rgba(232,100,44,0.16)'; f.lineWidth = 1.5; f.beginPath();
      for (i = 0; i < 4; i++) for (j = 0; j < 5; j++) { f.moveTo(12, h * (0.14 + i * 0.22) + 6 + j * 10); f.lineTo(42, h * (0.14 + i * 0.22) + 6 + j * 10); }
      f.stroke();
    } else if (sector === 4) {
      for (i = 0; i < 2; i++) {
        y = h * (0.28 + i * 0.44);
        f.fillStyle = 'rgba(7,14,19,0.22)'; f.fillRect(0, y - 14, w, 28);
        f.strokeStyle = 'rgba(147,173,185,0.20)'; f.lineWidth = 2;
        f.beginPath(); f.moveTo(0, y - 9); f.lineTo(w, y - 9); f.moveTo(0, y + 9); f.lineTo(w, y + 9); f.stroke();
        f.strokeStyle = 'rgba(53,89,110,0.30)'; f.lineWidth = 3; f.beginPath();
        for (x = 6; x < w; x += 20) { f.moveTo(x, y - 12); f.lineTo(x, y + 12); }
        f.stroke();
      }
    } else if (sector === 5) {
      var cx = w / 2, cy = h / 2, rr = [50, 100, 160, 230, 310, 400];
      f.fillStyle = 'rgba(0,0,0,0.18)'; f.beginPath(); f.arc(cx, cy, 48, 0, TAU); f.fill();
      f.lineWidth = 1.5;
      for (i = 0; i < rr.length; i++) {
        f.strokeStyle = 'rgba(80,100,150,' + (0.22 - i * 0.02) + ')';
        f.beginPath(); f.arc(cx, cy, rr[i], 0, TAU); f.stroke();
      }
      f.strokeStyle = 'rgba(80,100,150,0.16)'; f.beginPath();
      for (i = 0; i < 24; i++) { var an = i * TAU / 24; f.moveTo(cx + cos(an) * 100, cy + sin(an) * 100); f.lineTo(cx + cos(an) * 114, cy + sin(an) * 114); }
      f.stroke();
    } else if (sector === 6) {
      // Loading Dock B
      hazStripe(f, 0, 0, w, 12, 0.17); hazStripe(f, 0, h - 12, w, 12, 0.17);
      f.fillStyle = 'rgba(255,255,255,0.022)';
      for (j = 0; j < 3; j++) f.fillRect(w * 0.5 - 56 + (j % 2 ? 40 : -40) + (j - 1) * 4, h * (0.2 + j * 0.28), 112, 76);
      f.strokeStyle = 'rgba(255,255,255,0.05)'; f.lineWidth = 1; f.beginPath();
      for (j = 0; j < 3; j++) {
        var bx = w * 0.5 - 56 + (j % 2 ? 40 : -40) + (j - 1) * 4, by = h * (0.2 + j * 0.28);
        for (i = 0; i <= 112; i += 14) { f.moveTo(bx + i, by); f.lineTo(bx + i + 22, by + 76); }
      }
      f.stroke();
      f.setLineDash([14, 12]); f.strokeStyle = 'rgba(255,198,41,0.10)'; f.lineWidth = 2; f.beginPath();
      for (i = 1; i < 3; i++) { f.moveTo(w * i / 3, 14); f.lineTo(w * i / 3, h - 14); }
      f.stroke(); f.setLineDash([]);
      // pallets
      f.strokeStyle = 'rgba(197,208,214,0.16)'; f.lineWidth = 1.4; f.beginPath();
      for (i = 0; i < 7; i++) {
        var pxx = 22 + R() * (w - 90), pyy = 30 + R() * (h - 100), horiz = R() < 0.5, pw = horiz ? 46 : 40, ph = horiz ? 40 : 46;
        f.rect(pxx, pyy, pw, ph);
        for (j = 1; j < 4; j++) { if (horiz) { f.moveTo(pxx, pyy + j * ph / 4); f.lineTo(pxx + pw, pyy + j * ph / 4); } else { f.moveTo(pxx + j * pw / 4, pyy); f.lineTo(pxx + j * pw / 4, pyy + ph); } }
        if (i % 3 === 0) f.rect(pxx + 8, pyy + 8, pw - 16, ph - 16);
      }
      f.stroke();
      f.font = '700 22px ' + FONT; f.textAlign = 'center'; f.fillStyle = 'rgba(255,198,41,0.10)';
      f.fillText('BAY B-2', w / 2, h - 26); f.fillText('BAY B-1', w / 2, 40);
    } else if (sector === 7) {
      // Server Farm: rack rows with status LEDs
      ledN = 0;
      var rows = Math.max(3, Math.floor(h / 150));
      for (j = 0; j < rows; j++) {
        y = h * (0.12 + j * 0.76 / (rows - 1)) - 19;
        for (x = 14; x + 26 <= w - 14; x += 28) {
          if (x > w * 0.5 - 30 && x < w * 0.5 + 6 && (j & 1)) continue;      // aisle gap
          f.fillStyle = 'rgba(4,12,20,0.42)'; f.fillRect(x, y, 26, 38);
          f.strokeStyle = 'rgba(80,150,180,0.20)'; f.lineWidth = 1; f.strokeRect(x + 0.5, y + 0.5, 25, 37);
          f.strokeStyle = 'rgba(80,150,180,0.12)'; f.beginPath();
          for (i = 0; i < 4; i++) { f.moveTo(x + 3, y + 14 + i * 6); f.lineTo(x + 17, y + 14 + i * 6); }
          f.stroke();
          f.fillStyle = 'rgba(80,150,180,0.35)';
          if (ledN < MAXLED - 1) {
            ledX[ledN] = x + 21; ledY[ledN] = y + 6; ledP[ledN] = R() * 6; ledC[ledN] = (R() * 3) | 0;
            f.fillRect(ledX[ledN] - 1, ledY[ledN] - 1, 2, 2); ledN++;
            ledX[ledN] = x + 21; ledY[ledN] = y + 11; ledP[ledN] = R() * 6; ledC[ledN] = (R() * 3) | 0;
            f.fillRect(ledX[ledN] - 1, ledY[ledN] - 1, 2, 2); ledN++;
          }
        }
        // cable tray beside the row
        f.setLineDash([3, 5]); f.strokeStyle = 'rgba(127,231,255,0.10)'; f.lineWidth = 1.5; f.beginPath();
        f.moveTo(0, y + 46); f.lineTo(w, y + 46); f.stroke(); f.setLineDash([]);
      }
      f.strokeStyle = 'rgba(127,231,255,0.045)'; f.lineWidth = 1; f.beginPath();
      for (x = 0; x < w; x += 24) { f.moveTo(x + 0.5, 0); f.lineTo(x + 0.5, h); }
      for (y = 0; y < h; y += 24) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
      f.stroke();
    } else if (sector === 8) {
      // Quality Control: inspection grid with passes and rejects
      var cs = 60, gx0 = (w % cs) / 2, gy0 = (h % cs) / 2;
      f.strokeStyle = 'rgba(200,240,255,0.075)'; f.lineWidth = 1; f.beginPath();
      for (x = gx0; x <= w; x += cs) { f.moveTo(x + 0.5, 0); f.lineTo(x + 0.5, h); }
      for (y = gy0; y <= h; y += cs) { f.moveTo(0, y + 0.5); f.lineTo(w, y + 0.5); }
      f.stroke();
      f.lineCap = 'round'; f.lineJoin = 'round'; f.lineWidth = 3;
      for (y = gy0; y + cs <= h + 1; y += cs) for (x = gx0; x + cs <= w + 1; x += cs) {
        var v8 = R();
        if (v8 < 0.30) {
          f.strokeStyle = 'rgba(125,220,106,0.16)'; f.beginPath();
          f.moveTo(x + 20, y + 31); f.lineTo(x + 27, y + 39); f.lineTo(x + 42, y + 21); f.stroke();
        } else if (v8 < 0.46) {
          f.strokeStyle = 'rgba(232,100,44,0.17)'; f.beginPath();
          f.moveTo(x + 21, y + 21); f.lineTo(x + 39, y + 39); f.moveTo(x + 39, y + 21); f.lineTo(x + 21, y + 39); f.stroke();
        }
      }
      f.lineWidth = 1.2; f.strokeStyle = 'rgba(200,240,255,0.08)'; f.beginPath();
      for (i = 0; i < 2; i++) { var qx = w * (i ? 0.7 : 0.28), qy = h * (i ? 0.7 : 0.3); f.moveTo(qx + 26, qy); f.arc(qx, qy, 26, 0, TAU); f.moveTo(qx - 34, qy); f.lineTo(qx + 34, qy); f.moveTo(qx, qy - 34); f.lineTo(qx, qy + 34); }
      f.stroke();
      f.strokeStyle = 'rgba(125,220,106,0.10)'; f.lineWidth = 2; f.strokeRect(10, 10, w - 20, h - 20);
    } else if (sector === 9) {
      // Executive Elevator: brushed metal, door seam, floor dial
      f.lineWidth = 1;
      for (i = 0; i < 150; i++) {
        y = R() * h; x = R() * w; var bl8 = 30 + R() * 170;
        f.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
        f.beginPath(); f.moveTo(x, y + 0.5); f.lineTo(x + bl8, y + 0.5); f.stroke();
      }
      f.fillStyle = 'rgba(0,0,0,0.30)'; f.fillRect(w / 2 - 1.5, 0, 3, h);
      f.fillStyle = 'rgba(255,255,255,0.05)'; f.fillRect(w / 2 + 1.5, 0, 1, h);
      f.strokeStyle = 'rgba(255,198,41,0.15)'; f.lineWidth = 1.6; f.strokeRect(11, 11, w - 22, h - 22);
      f.strokeStyle = 'rgba(255,198,41,0.07)'; f.lineWidth = 1; f.strokeRect(17, 17, w - 34, h - 34);
      // dial: ticks and numerals over a 270 degree sweep
      var dcx = w / 2, dcy = h / 2, a0 = Math.PI * 0.75;
      f.strokeStyle = 'rgba(255,198,41,0.15)'; f.lineWidth = 1.5; f.beginPath(); f.arc(dcx, dcy, 98, a0, a0 + Math.PI * 1.5); f.stroke();
      f.beginPath();
      for (i = 0; i <= 20; i++) { var da = a0 + i * Math.PI * 1.5 / 20, d1 = i % 2 ? 90 : 84; f.moveTo(dcx + cos(da) * 98, dcy + sin(da) * 98); f.lineTo(dcx + cos(da) * d1, dcy + sin(da) * d1); }
      f.stroke();
      f.font = '600 11px ' + FONT; f.textAlign = 'center'; f.textBaseline = 'middle'; f.fillStyle = 'rgba(255,198,41,0.20)';
      for (i = 0; i <= 10; i++) { var na = a0 + i * Math.PI * 1.5 / 10; f.fillText(i === 10 ? 'PH' : String(i + 1), dcx + cos(na) * 70, dcy + sin(na) * 70); }
      f.beginPath(); f.arc(dcx, dcy, 5, 0, TAU); f.fillStyle = 'rgba(255,198,41,0.18)'; f.fill();
    } else if (sector === 10) {
      boardroom(f, w, h, R, false);
    } else if (sector === 11) { lobby(f, w, h, R);
    } else if (sector === 12) { legal(f, w, h, R);
    } else if (sector === 13) { ledger(f, w, h, R);
    } else if (sector === 14) { trading(f, w, h, R);
    } else if (sector >= 15) { skyline(f, w, h, R, sector >= 16);
    }
    // arena rim
    f.strokeStyle = 'rgba(39,71,90,0.9)'; f.lineWidth = 3; f.strokeRect(1.5, 1.5, w - 3, h - 3);
    f.strokeStyle = 'rgba(0,0,0,0.25)'; f.lineWidth = 6; f.strokeRect(6, 6, w - 12, h - 12);
    floorSector = sector; floorW = w; floorH = h;
  }

  function buildGradients(w, h) {
    if (!ctx) return;
    var m = min(w, h), cx = w / 2, cy = h / 2;
    vigGrad = ctx.createRadialGradient(cx, cy, m * 0.30, cx, cy, sqrt(cx * cx + cy * cy) * 0.98);
    vigGrad.addColorStop(0, 'rgba(232,60,30,0)');
    vigGrad.addColorStop(1, 'rgba(232,60,30,0.85)');
    warnGrad = ctx.createLinearGradient(0, 0, 0, 110);
    warnGrad.addColorStop(0, 'rgba(232,100,44,0.85)');
    warnGrad.addColorStop(1, 'rgba(232,100,44,0)');
    glowGrad = ctx.createLinearGradient(0, 0, w * 0.7, 0);
    glowGrad.addColorStop(0, 'rgba(255,110,40,0.20)');
    glowGrad.addColorStop(1, 'rgba(255,110,40,0)');
    budGrad = ctx.createRadialGradient(cx, cy, m * 0.34, cx, cy, sqrt(cx * cx + cy * cy) * 0.98);
    budGrad.addColorStop(0, 'rgba(232,100,44,0)');
    budGrad.addColorStop(0.55, 'rgba(232,100,44,0.25)');
    budGrad.addColorStop(1, 'rgba(200,60,24,0.85)');
    gradW = w; gradH = h;
  }

  function ensureGeom(w, h, sector) {
    if (!bw) resize();
    if (fitDirty || fitW !== w || fitH !== h) { computeFit(w, h); floorSector = -1; }
    if (floorSector !== sector || floorW !== w || floorH !== h) buildFloor(w, h, sector);
    if (gradW !== w || gradH !== h || !vigGrad) buildGradients(w, h);
  }

  // --------------------------------------------------------------- API
  function init(cv, o) {
    canvas = cv;
    ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (o) setOptions(o);
    glowFor(0); glowFor(1); glowFor(3); glowFor(2); glowFor(9);
    resize();
  }

  function setOptions(o) {
    if (!o) return;
    if (o.reducedMotion !== undefined) opts.reducedMotion = !!o.reducedMotion;
    if (o.shake !== undefined) opts.shake = !!o.shake;
    if (opts.reducedMotion || !opts.shake) { shakeAmp = 0; shX = 0; shY = 0; }
  }

  function clearFx() {
    pN = 0; rN = 0; aN = 0; nN = 0; ceN = 0; ghostT = 0; slowT = 0; shakeAmp = 0; shX = 0; shY = 0;
    pulseFlash = 0; redFlash = 0; whiteFlash = 0; lowKick = 0; ocFlash = 0; warnDark = 0; fxT = 0;
    haveLastBoss = false; aiLast = 0; aiI = 0; sweepHide = false;
    for (var hq = 0; hq < HMAX; hq++) { hid[hq] = 0; hacc[hq] = 0; }
    bmN = 0; founderFlash = 0; spamGate = 0; volKey = -1; fN = 0; stormFlash = 0; budgetA = 0; stockPrev = 1; infectGate = 0; snapN = 0; wellSeen = 0;
    for (var q = 0; q < MAXLZ; q++) lzId[q] = 0;
    for (q = 0; q < MAXF; q++) fobj[q] = null;
    for (var i = 0; i < AI_N; i++) aiA[i] = 0;
  }

  function begin(run, save) {
    clearFx();
    curRun = run || null;
    try { loadout = (BY.Engine && save) ? BY.Engine.loadout(save) : loadout; } catch (e) { /* keep */ }
    if (!loadout) loadout = { arc: 0, chassis: 0, salvage: 0, drones: 0, titan: false };
    if (run && run.w > 0 && run.h > 0) {
      curSector = run.sector || 1;
      ensureGeom(run.w, run.h, curSector);
    }
    pFace = 0;
    stockPrev = (run && run.stock && run.stock.mult) ? run.stock.mult : 1;
    isPaused = false;
  }

  // Yard Sweep at shift end: zap the leftovers away (bots and floor bolts vanish in a burst, a cyan-gold wave rolls out)
  function sweep(run) {
    if (!ctx || !run) return;
    var en = run.enemies, pk = run.pickups, p = run.player, i, e, n = 0;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || e.boss || e.type === 'pylon') continue;
      sparksMix(e.x, e.y, 7, C_ARC, C_HAZ, 150, 0.35);
      addRing(1, e.x, e.y, e.r * 0.5, e.r * 2.2, 0.22, C_ARC, 0, 0.9);
    }
    for (i = 0; i < pk.length && n < 24; i++) {
      if (pk[i].kind !== 'bolt') continue;
      sparks(pk[i].x, pk[i].y, 2, C_HAZ, 90, 0.3); n++;
    }
    var big = max(run.w, run.h);
    addRing(0, p.x, p.y, 16, big * 0.8, 0.55, C_HAZ, 5, 0.75);
    addRing(1, p.x, p.y, 16, big * 0.7, 0.4, C_ARC, 0, 0.9);
    sweepHide = true;
  }

  // ------------------------------------------------------------- events
  function handle(events, run) {
    if (!events || !events.length || !ctx) return;
    run = run || curRun;
    if (!run) return;
    var p = run.player || { x: 0, y: 0, r: 12 };
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e) continue;
      try { onEvent(e, run, p); } catch (err) { /* never throw out of the renderer */ }
    }
  }

  function onEvent(e, run, p) {
    var x = num(e.x), y = num(e.y), r, i, b, n;
    switch (e.type) {
      case 'pulse':
        pulseFlash = 1;
        r = num(e.r, 46);
        addRing(0, num(e.x, p.x), num(e.y, p.y), r * 0.5, r, 0.22, C_ARC, 2, 0.55);
        break;
      case 'zap': {
        var src = e.src === 'drone' ? 1 : (e.src === 'chain' ? 2 : 0);
        addArc(num(e.x1), num(e.y1), num(e.x2), num(e.y2), src, e.crit);
        if (src !== 1) addRing(1, num(e.x2), num(e.y2), 4, e.crit ? 22 : 14, 0.12, src === 2 ? C_VIO : C_WHITE, 0, 0.9);
        break;
      }
      case 'hit': {
        var crit = !!e.crit, arm = !!e.armored;
        sparks(x, y, crit ? 8 : 3, arm ? C_STEEL : (crit ? C_HAZ : C_WHITE), crit ? 150 : 100, 0.22);
        if (crit) sparks(x, y, 3, C_WHITE, 120, 0.2);
        var id = e.enemyId || 0, dmg0 = num(e.dmg);
        if (crit) { popDmg(x, y, dmg0, true, arm, id, run.w || 360); break; }
        // plain hits: at most one summed popup per bot every 0.4 s (damage-over-time ticks pile into it)
        var hs = -1, hf = -1;
        for (i = 0; i < HMAX; i++) { if (hid[i] === id && id) { hs = i; break; } if (hf < 0 && hid[i] === 0) hf = i; }
        if (hs < 0) {
          if (hf < 0) { popDmg(x, y, dmg0, false, arm, id, run.w || 360); break; }
          hs = hf; hid[hs] = id; hlast[hs] = -9; hacc[hs] = 0;
        }
        hacc[hs] += dmg0; hx[hs] = x; hy[hs] = y; harm[hs] = arm ? 1 : 0;
        if (fxT - hlast[hs] >= 0.4) flushHit(hs, run.w || 360);
        break;
      }
      case 'kill': {
        if (e.boss) break;                  // bossDead does the big one
        r = num(e.r, 12);
        for (i = 0; i < HMAX; i++) if (hid[i] && hacc[i] > 0 && abs(hx[i] - x) < r + 8 && abs(hy[i] - y) < r + 8) flushHit(i, run.w || 360);
        var big = r >= 18, el = !!e.elite;
        var cols = DEB[e.enemyType] || DEB_DEFAULT;
        debris(x, y, (6 + r * 0.55) * (el ? 1.6 : 1), big ? 3.4 : 2.6, cols, big ? 150 : 120, 0.55);
        sparksMix(x, y, big ? 12 : 7, C_WHITE, el ? C_HAZ : C_ARC, 170, 0.28);
        addRing(0, x, y, r * 0.4, r * (big ? 3.0 : 2.1), 0.26, el ? C_HAZ : C_WHITE, big ? 4 : 2.5, 0.8);
        addRing(1, x, y, r * 0.5, r * (big ? 2.6 : 1.8), 0.14, el ? C_GOLD : C_WHITE, 0, 0.85);
        dust(x, y, big ? 5 : 2, 40, 5, 0.5);
        if (big || el) shake(big ? 2.4 : 1.6);
        break;
      }
      case 'explode': {
        r = num(e.r, 55);
        var ov = e.src === 'overload';
        addRing(0, x, y, r * 0.2, r, 0.34, ov ? C_ARC : C_RUSTLT, 4, 0.9);
        addRing(2, x, y, r, r, 0.22, ov ? C_ARC : C_RUST, 0, ov ? 0.22 : 0.38);
        addRing(1, x, y, r * 0.4, r * 1.1, 0.16, ov ? C_ARC : C_HAZ, 0, ov ? 0.5 : 0.9);
        sparksMix(x, y, 12, C_WHITE, ov ? C_ARC : C_HAZ, 200, 0.35);
        if (!ov) debris(x, y, 8, 3, [C_RUST, C_RUSTDK, C_STEELDK], 140, 0.6);
        dust(x, y, 5, 50, 6, 0.55);
        shake(min(7, r / 12));
        break;
      }
      case 'spawn': {
        var sx = clamp(x, 0, run.w || 360), sy = clamp(y, 0, run.h || 640);
        if (e.enemyType === 'spam') { if (spamGate <= 0) { spamGate = 0.25; sparksMix(sx, sy, 5, C_WHITE, C_ARC, 90, 0.25); addRing(0, sx, sy, 4, 26, 0.3, C_PALE, 2, 0.7); } }
        else dust(sx, sy, 3, 30, 4.5, 0.4);
        if (e.elite) addRing(0, sx, sy, 4, 22, 0.35, C_HAZ, 2, 0.7);
        break;
      }
      case 'pickup': {
        var kind = e.kind || 'bolt', v = num(e.value, 1);
        var px0 = p.x, py0 = p.y - (p.r || 12) * 1.15 - 8;
        if (kind === 'bolt') {
          var found = -1;
          for (i = 0; i < nN; i++) if (nkind[i] === 3 && nage[i] < 0.15) { found = i; break; }
          if (found >= 0) { nval[found] += v; ntext[found] = '+' + fmtNum(nval[found]); nx[found] = px0; }
          else addNum(px0, py0, '+' + fmtNum(v), 3, 0.75, -30, 0, v);
          if (rnd() < 0.5) addP(0, px0 + (rnd() - 0.5) * 16, p.y + (rnd() - 0.5) * 10, 0, -30, 0.2, 1.4, C_HAZ, 0, 0.9);
        } else if (kind === 'core') {
          addNum(px0, py0 - 8, '+' + fmtNum(v) + ' CORE', 4, 1.1, -26, 0, v);
          addRing(0, p.x, p.y, 8, 36, 0.4, C_CORE, 2.5, 0.8);
          sparks(p.x, p.y, 8, C_CORE, 110, 0.35);
        } else {
          addNum(px0, py0 - 8, '+CELL', 5, 0.95, -26, 0, v);
          addRing(0, p.x, p.y, 8, 32, 0.35, C_OK, 2, 0.7);
          sparks(p.x, p.y, 6, C_OK, 100, 0.3);
        }
        break;
      }
      case 'hurt': {
        var amt = num(e.amount), srcH = e.src;
        var contact = srcH === 'contact' || srcH === 'laser';
        sparks(p.x, p.y, contact ? 3 : 8, C_RUSTLT, contact ? 80 : 150, 0.25);
        redFlash = max(redFlash, contact ? 0.25 : 0.7);
        shake(contact ? 1.1 : (srcH === 'shot' ? 3 : (srcH === 'bomb' ? 5 : 6)));
        break;
      }
      case 'shot':
        addRing(1, x, y, 4, 16, 0.12, C_RUSTLT, 0, 0.8);
        sparks(x, y, 4, C_RUSTLT, 70, 0.16);
        break;
      case 'slam': {
        r = num(e.r, 60);
        addRing(2, x, y, r, r, 0.22, C_RUSTLT, 0, 0.55);
        addRing(0, x, y, r * 0.7, r * 1.25, 0.38, C_RUSTLT, 5, 0.9);
        addRing(0, x, y, r * 0.4, r * 0.95, 0.28, C_WHITE, 2, 0.8);
        addRing(1, x, y, r * 0.5, r * 1.1, 0.16, C_RUST, 0, 0.9);
        dustRing(x, y, r * 0.9, 14, 45, 6, 0.55);
        debris(x, y, 6, 2.6, [C_STEELDK, C_RUSTDK, C_TEALDK], 90, 0.5);
        shake(6);
        break;
      }
      case 'shield': {
        b = findBoss(run);
        if (!b) break;
        if (e.on) {
          addRing(0, b.x, b.y, b.r, b.r * 2.2, 0.45, C_ARC, 3, 0.9);
          addRing(1, b.x, b.y, b.r, b.r * 2.4, 0.25, C_ARC, 0, 0.8);
          sparks(b.x, b.y, 14, C_ARC, 160, 0.35);
        } else {
          addRing(0, b.x, b.y, b.r * 1.4, b.r * 2.6, 0.4, C_WHITE, 3, 0.9);
          addRing(1, b.x, b.y, b.r, b.r * 2.2, 0.2, C_ARC, 0, 1);
          sparksMix(b.x, b.y, 18, C_ARC, C_WHITE, 200, 0.4);
          debris(b.x, b.y, 8, 3, [C_ARC, C_STEEL], 150, 0.55);
          shake(3);
        }
        break;
      }
      case 'ocStart':
        addRing(0, p.x, p.y, (p.r || 12), 150, 0.55, C_ARC, 5, 0.9);
        addRing(0, p.x, p.y, (p.r || 12), 90, 0.35, C_WHITE, 2, 0.8);
        addRing(1, p.x, p.y, 20, 110, 0.3, C_ARC, 0, 0.9);
        sparks(p.x, p.y, 16, C_ARC, 180, 0.4);
        ocFlash = 1;
        break;
      case 'ocEnd':
        addRing(0, p.x, p.y, 70, 24, 0.3, C_ARC, 2, 0.5);
        sparks(p.x, p.y, 8, C_ARC, 90, 0.3);
        break;
      case 'spare':
        addRing(0, p.x, p.y, 10, 110, 0.5, C_OK, 5, 0.9);
        addRing(0, p.x, p.y, 10, 70, 0.4, C_HAZ, 3, 0.9);
        addRing(1, p.x, p.y, 20, 100, 0.3, C_OK, 0, 0.9);
        sparksMix(p.x, p.y, 20, C_OK, C_HAZ, 200, 0.5);
        shake(3);
        whiteFlash = max(whiteFlash, reduced() ? 0.1 : 0.3);
        break;
      case 'lowBattery':
        lowKick = 1; shake(2);
        break;
      case 'combo':
        addNum(p.x, p.y - (p.r || 12) * 1.15 - 24, 'x' + num(e.n), 6, 0.9, -28, 0, 0);
        break;
      case 'bossWarn':
        lowKick = max(lowKick, 0.5);
        break;
      case 'bossSpawn': {
        b = findBoss(run);
        var bx = b ? b.x : (run.w || 360) / 2, by = b ? b.y : 60, br = b ? b.r : 32;
        addRing(0, bx, by, br * 0.6, br * 4.2, 0.6, C_RUST, 8, 0.95);
        addRing(0, bx, by, br * 0.4, br * 2.8, 0.45, C_HAZ, 3, 0.9);
        addRing(1, bx, by, br * 0.8, br * 3, 0.3, C_RUST, 0, 0.9);
        dustRing(bx, by, br, 22, 70, 8, 0.8);
        debris(bx, by, 14, 3.4, [C_STEELDK, C_STEEL, C_RUSTDK], 170, 0.7);
        shake(9);
        break;
      }
      case 'bossPhase': {
        b = findBoss(run);
        if (b) {
          addRing(0, b.x, b.y, b.r, b.r * 3, 0.5, C_CORE, 5, 0.9);
          addRing(1, b.x, b.y, b.r, b.r * 2.5, 0.25, C_CORE, 0, 0.9);
          sparks(b.x, b.y, 16, C_CORE, 180, 0.4);
        }
        shake(4);
        break;
      }
      case 'bossDead': {
        var dx = num(e.x, (run.w || 360) / 2), dy = num(e.y, 60);
        // ghost of the Warden keeps the body on screen while it blows up
        if (haveLastBoss) {
          for (i = 0; i < BKEYS.length; i++) ghost[BKEYS[i]] = lastBoss[BKEYS[i]];
        }
        ghost.x = dx; ghost.y = dy; ghost.hp = 0; ghost.windup = 0; ghost.invuln = false;
        ghostDur = reduced() ? 0.9 : 1.3; ghostT = ghostDur;
        if (!reduced()) slowT = 1.3;
        whiteFlash = reduced() ? 0.2 : 0.55;
        var gr = ghost.r || 32, nex = reduced() ? 6 : 10;
        ceN = 0;
        for (i = 0; i < nex && ceN < MAXCE - 1; i++) {
          ceT[ceN] = i * (ghostDur - 0.15) / nex * (0.8 + rnd() * 0.3);
          var a = rnd() * TAU, d = sqrt(rnd()) * gr * 0.85;
          ceX[ceN] = dx + cos(a) * d; ceY[ceN] = dy + sin(a) * d; ceBig[ceN] = 0; ceN++;
        }
        ceT[ceN] = ghostDur; ceX[ceN] = dx; ceY[ceN] = dy; ceBig[ceN] = 1; ceN++;
        // initial punch
        addRing(0, dx, dy, gr * 0.5, gr * 5, 0.7, C_WHITE, 7, 0.95);
        addRing(1, dx, dy, gr, gr * 4.5, 0.4, C_WHITE, 0, 1);
        debris(dx, dy, 22, 3.8, DEB[ghost.type] || DEB_DEFAULT, 230, 0.9);
        sparksMix(dx, dy, 20, C_WHITE, C_HAZ, 260, 0.5);
        shake(14);
        break;
      }

      case 'laser': {
        var ldx = num(e.x2) - x, ldy = num(e.y2) - y, ll = sqrt(ldx * ldx + ldy * ldy) || 1;
        addRing(1, x, y, 6, 34, 0.18, C_WHITE, 0, 0.95);
        sparksMix(x, y, 8, C_WHITE, C_RUSTLT, 150, 0.25);
        addRing(1, num(e.x2), num(e.y2), 4, 26, 0.2, C_RUSTLT, 0, 0.7);
        shake(1.6);
        break;
      }
      case 'telegraph': {
        if (e.kind === 'blink') {
          // the bot vanishes from where it stands: find it through the blink hazard that just opened
          var hzs = run.hazards, hb = null;
          for (i = hzs.length - 1; i >= 0; i--) if (hzs[i].kind === 'blink' && abs(hzs[i].x - x) < 0.5 && abs(hzs[i].y - y) < 0.5) { hb = hzs[i]; break; }
          b = hb ? byId(run, hb.oid) : null;
          if (b) {
            addRing(0, b.x, b.y, b.r * 0.6, b.r * 2.2, 0.3, C_RUSTLT, 3, 0.8);
            addRing(1, b.x, b.y, b.r * 0.6, b.r * 2.0, 0.16, C_WHITE, 0, 0.9);
            sparksMix(b.x, b.y, 10, C_WHITE, C_RUST, 150, 0.3);
          }
        }
        break;
      }
      case 'blink': {
        r = 14;
        b = e.enemyId ? byId(run, e.enemyId) : null;
        if (b) r = b.r;
        addRing(0, x, y, r * 2.4, r * 0.8, 0.22, C_RUSTLT, 3, 0.9);
        addRing(0, x, y, r * 0.8, r * 2.6, 0.36, C_WHITE, 3, 0.85);
        addRing(1, x, y, r * 0.8, r * 2.4, 0.2, C_RUST, 0, 0.9);
        sparksMix(x, y, 12, C_WHITE, C_RUSTLT, 190, 0.32);
        dust(x, y, 3, 40, 5, 0.4);
        if (b && b.boss) shake(3);
        break;
      }
      case 'steal': {
        var sb = e.enemyId ? byId(run, e.enemyId) : null;
        var tx0 = sb ? sb.x : x, ty0 = sb ? sb.y : y;
        n = min(6, 2 + ((num(e.bolts) > 0) ? 3 : 0) + (num(e.bolts) > 50 ? 1 : 0));
        n = cnt(n);
        for (i = 0; i < n; i++) addFly(0, p.x + (rnd() - 0.5) * 14, p.y + (rnd() - 0.5) * 14, tx0, ty0, sb, 0.5 + i * 0.07, C_HAZ, (rnd() - 0.5) * 60);
        addRing(0, p.x, p.y, 8, 34, 0.3, C_RUSTLT, 2.5, 0.8);
        if (num(e.bolts) > 0) addNum(p.x, p.y - (p.r || 12) * 1.15 - 10, '−' + fmtNum(num(e.bolts)), 7, 0.95, -28, 0, 0);
        else addNum(p.x, p.y - (p.r || 12) * 1.15 - 10, 'EMPTY', 7, 0.8, -26, 0, 0);
        shake(1.5);
        break;
      }
      case 'refund': {
        n = cnt(10);
        for (i = 0; i < n; i++) {
          var ra2 = rnd() * TAU, rs = 70 + rnd() * 120;
          addP(1, x, y, cos(ra2) * rs, sin(ra2) * rs, 0.5 + rnd() * 0.35, 2.4 + rnd() * 1.4, rnd() < 0.5 ? C_GOLD : C_HAZ, (rnd() - 0.5) * 18, 0.9);
        }
        sparksMix(x, y, 10, C_GOLD, C_WHITE, 170, 0.35);
        addRing(0, x, y, 6, 42, 0.34, C_GOLD, 3, 0.9);
        addRing(1, x, y, 6, 34, 0.18, C_WHITE, 0, 0.9);
        if (num(e.bolts) > 0) addNum(x, y - 14, '+' + fmtNum(num(e.bolts)), 9, 1.0, -30, 0, 0);
        break;
      }
      case 'print': {
        b = e.enemyId ? byId(run, e.enemyId) : null;
        if (b) {
          addRing(0, b.x, b.y, b.r * 0.5, b.r * 2.0, 0.3, C_STEEL, 2.5, 0.7);
          dust(b.x, b.y, 6, 45, 6, 0.5, C_STEEL);
          sparks(b.x, b.y, 6, C_WHITE, 110, 0.22);
        }
        break;
      }
      case 'mimicWake': {
        b = e.enemyId ? byId(run, e.enemyId) : null;
        x = b ? b.x : p.x; y = b ? b.y : p.y; r = b ? b.r : 10;
        addRing(0, x, y, r * 0.5, r * 3.2, 0.3, C_RUST, 3.5, 0.95);
        addRing(1, x, y, r * 0.5, r * 2.8, 0.16, C_HAZ, 0, 0.9);
        sparksMix(x, y, 12, C_HAZ, C_RUSTLT, 170, 0.3);
        dust(x, y, 3, 40, 5, 0.4);
        addNum(x, y - r - 8, '!', 8, 0.7, -22, 0, 0);
        shake(1.8);
        break;
      }
      case 'infect': {
        if (infectGate > 0) break;
        infectGate = 3;
        b = e.enemyId ? byId(run, e.enemyId) : null;
        if (b) { addRing(0, b.x, b.y, b.r * 0.6, b.r * 1.9, 0.26, C_OK, 1.8, 0.8); sparks(b.x, b.y, 3, C_OK, 70, 0.25); }
        break;
      }
      case 'storm': {
        stormFlash = 1;
        var en2 = run.enemies, cap = reduced() ? 12 : 30, na = 0, W = run.w || 360;
        for (i = 0; i < en2.length && na < cap; i++) {
          b = en2[i];
          if (b.invuln || b.disguised) continue;
          if (b.dead && !b.hit0) { /* still draw: it was just scrapped by the storm */ }
          addArc(clamp(b.x + (rnd() - 0.5) * 70, -20, W + 20), -14, b.x, b.y, 3, false);
          addRing(1, b.x, b.y, 4, 22, 0.16, C_WHITE, 0, 0.9);
          na++;
        }
        if (!na) addArc(p.x, -14, p.x, p.y, 3, false);
        shake(3.5);
        break;
      }
      case 'wellOpen': {
        r = num(e.r, 90);
        addRing(0, x, y, r * 1.3, r * 0.4, 0.5, C_VIO, 3, 0.8);
        addRing(1, x, y, 8, r * 0.6, 0.35, C_CORE, 0, 0.8);
        break;
      }
      case 'wellBoom': {
        r = num(e.r, 90);
        // implosion ring pulling in, then the blast
        addRing(0, x, y, r * 1.1, 6, 0.16, C_WHITE, 5, 0.95);
        addRing(0, x, y, 8, r * 1.15, 0.5, C_VIO, 6, 0.95);
        addRing(0, x, y, 6, r * 0.8, 0.32, C_WHITE, 3, 0.9);
        addRing(1, x, y, 10, r * 1.2, 0.3, C_CORE, 0, 1);
        addRing(2, x, y, r, r, 0.3, C_VIO, 0, 0.30);
        sparksMix(x, y, 20, C_WHITE, C_CORE, 260, 0.45);
        debris(x, y, 6, 2.6, [C_CORE, C_VIO, C_STEEL], 150, 0.5);
        shake(6);
        whiteFlash = max(whiteFlash, reduced() ? 0.08 : 0.2);
        break;
      }
      case 'intern': {
        addRing(0, x, y, 3, 22, 0.35, C_ARC, 2, 0.85);
        addRing(1, x, y, 4, 24, 0.22, C_WHITE, 0, 0.8);
        n = cnt(10);
        for (i = 0; i < n; i++) {
          var ia = rnd() * TAU, isp = 40 + rnd() * 70;
          addP(0, x, y, cos(ia) * isp, sin(ia) * isp - 40, 0.35 + rnd() * 0.3, 1.5 + rnd(), rnd() < 0.5 ? C_ARC : C_WHITE, 0, 0.9);
        }
        break;
      }
      case 'internEnd': {
        dust(x, y, 5, 40, 5.5, 0.5, C_STEEL);
        sparks(x, y, 6, C_ARC, 100, 0.3);
        addRing(0, x, y, 4, 20, 0.25, C_ARC, 1.8, 0.6);
        break;
      }
      case 'severance': {
        r = num(e.r, 140);
        addRing(0, x, y, 10, r, 0.5, C_WHITE, 12, 1);
        addRing(0, x, y, 6, r * 0.8, 0.38, C_WHITE, 6, 0.9);
        addRing(0, x, y, 20, r * 1.12, 0.65, C_ARC, 4, 0.7);
        addRing(1, x, y, 20, r * 0.9, 0.4, C_WHITE, 0, 1);
        addRing(2, x, y, r, r, 0.45, C_WHITE, 0, 0.35);
        sparksMix(x, y, 26, C_WHITE, C_ARC, 300, 0.5);
        shake(11);
        whiteFlash = max(whiteFlash, reduced() ? 0.2 : 0.5);
        // bolts vacuumed in: from where the floor pickups were a moment ago
        n = snapN > 0 ? snapN : 0;
        if (reduced() && n > 12) n = 12;
        for (i = 0; i < n; i++) addFly(0, snapX[i], snapY[i], x, y, p, 0.35 + (i % 8) * 0.045, C_HAZ, (rnd() - 0.5) * 50);
        if (!n) for (i = 0; i < cnt(14); i++) { var va2 = rnd() * TAU; addFly(1, x + cos(va2) * 170, y + sin(va2) * 170, x, y, p, 0.4, C_HAZ, 0); }
        snapN = 0;
        break;
      }
      case 'stock': {
        var dm = num(e.mult, 1) - stockPrev;
        stockPrev = num(e.mult, 1);
        var pct = Math.round(dm * 100);
        if (pct < 1) pct = 1;
        addNum(64, 22, '+' + pct + '%', 8, 1.1, -14, 0, 0);
        sparks(64, 22, 5, C_HAZ, 80, 0.3);
        break;
      }
      case 'budget':
        if (e.on) { lowKick = max(lowKick, 0.4); shake(2); }
        break;
      case 'overtime':
        lowKick = max(lowKick, 0.8); redFlash = max(redFlash, 0.5);
        addRing(0, (run.w || 360) / 2, (run.h || 640) / 2, 10, 260, 0.7, C_RUST, 6, 0.6);
        break;
      case 'hold': {
        var hr = (p.r || 12);
        addRing(0, p.x, p.y, hr * 3.2, hr * 1.3, 0.22, C_ARC, 3, 0.9);
        addRing(1, p.x, p.y, hr * 1.2, hr * 2.4, 0.2, C_PALE, 0, 0.8);
        sparksMix(p.x, p.y, 6, C_ARC, C_WHITE, 110, 0.25);
        shake(1.6);
        break;
      }
      case 'injunction':
        r = num(e.r, 50);
        addRing(0, x, y, r * 1.5, r, 0.26, C_RED, 4, 0.9);
        addRing(1, x, y, r * 0.5, r * 1.1, 0.2, C_RED, 0, 0.8);
        sparksMix(x, y, 6, C_RED, C_RUSTLT, 100, 0.28);
        shake(1.2);
        break;
      case 'clawback': {
        var cb = findBoss(run), cn = cnt(min(9, 3 + (num(e.bolts) > 1e3 ? 2 : 0) + (num(e.bolts) > 1e6 ? 2 : 0) + (num(e.bolts) > 1e9 ? 2 : 0)));
        var cw = run.w || 360;
        for (i = 0; i < cn; i++) addFly(0, 18 + rnd() * 44, 8 + rnd() * 10, cb ? cb.x : cw / 2, cb ? cb.y : 60, cb, 0.55 + i * 0.07, C_HAZ, (rnd() - 0.5) * 70);
        addNum(52, 30, '−' + fmtNum(num(e.bolts)), 7, 1.0, -16, 0, 0);
        lowKick = max(lowKick, 0.18);
        break;
      }
      case 'copy': {
        var cs = byId(run, e.srcId), cc = byId(run, e.enemyId);
        if (cc) {
          addRing(0, cc.x, cc.y, cc.r * 0.6, cc.r * 2.2, 0.28, C_STEEL, 2, 0.8);
          addRing(1, cc.x, cc.y, cc.r * 0.8, cc.r * 2.0, 0.14, C_WHITE, 0, 0.8);
          if (cs) addFly(1, cs.x, cs.y, cc.x, cc.y, cc, 0.22, C_WHITE, 0);
          if (cs) addArc(cs.x, cs.y, cc.x, cc.y, 3, false);
        }
        break;
      }
      case 'orbital': {
        r = num(e.r, 40);
        if (bmN < MAXBM) {
          bmX[bmN] = x; bmY[bmN] = y; bmR[bmN] = r; bmL[bmN] = bmM[bmN] = 0.5; bmN++;
        }
        addRing(0, x, y, r * 0.3, r * 1.3, 0.4, C_WHITE, 4, 0.9);
        addRing(1, x, y, r * 0.4, r * 1.6, 0.26, C_PALE, 0, 1);
        sparksMix(x, y, 12, C_WHITE, C_ARC, 190, 0.4);
        shake(2.4 + min(2, num(e.n) * 0.2));
        break;
      }
      case 'burst': {
        r = num(e.r, 60);
        addRing(0, x, y, r * 0.2, r, 0.3, C_GOLD, 3, 0.85);
        addRing(1, x, y, r * 0.3, r * 1.1, 0.2, C_GOLD, 0, 0.9);
        sparksMix(x, y, 8, C_GOLD, C_WHITE, 170, 0.32);
        shake(1.5);
        break;
      }
      case 'founder': {
        var fb = findBoss(run);
        founderFlash = e.phase > 1 ? 1 : 0.5;
        if (fb) {
          founderX = fb.x; founderY = fb.y;
          addRing(0, fb.x, fb.y, fb.r, fb.r * 5, 0.55, C_GOLD, 5, 0.9);
          addRing(0, fb.x, fb.y, fb.r * 0.6, fb.r * 3, 0.35, C_WHITE, 3, 0.9);
          sparksMix(fb.x, fb.y, 16, C_GOLD, C_WHITE, 220, 0.45);
        }
        if (e.phase > 1) shake(3);
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------- FX update
  function boom(x, y, big) {
    var s = big ? 70 : 30;
    addRing(0, x, y, s * 0.2, s * (big ? 3.4 : 1.6), big ? 0.7 : 0.35, big ? C_WHITE : C_HAZ, big ? 8 : 3, 0.9);
    addRing(1, x, y, s * 0.3, s * (big ? 3.2 : 1.8), big ? 0.4 : 0.2, big ? C_WHITE : C_HAZ, 0, 1);
    if (big) addRing(0, x, y, s * 0.5, s * 2.2, 0.5, C_RUSTLT, 4, 0.8);
    debris(x, y, big ? 34 : 9, big ? 4 : 3, [C_RUST, C_RUSTDK, C_STEELDK, C_STEEL, C_HAZ], big ? 300 : 170, big ? 1.1 : 0.6);
    sparksMix(x, y, big ? 24 : 8, C_WHITE, C_HAZ, big ? 300 : 200, 0.45);
    dust(x, y, big ? 12 : 3, 60, 8, 0.8);
    shake(big ? 12 : 3);
  }

  function updateFx(dt) {
    var i, k;
    fxT += dt;
    // shake
    if (shakeAmp > 0.05) {
      shX = (rnd() * 2 - 1) * shakeAmp; shY = (rnd() * 2 - 1) * shakeAmp;
      shakeAmp *= Math.exp(-dt * 9);
    } else { shakeAmp = 0; shX = 0; shY = 0; }
    var d4 = Math.exp(-dt * 4);
    pulseFlash = max(0, pulseFlash - dt * 4);
    redFlash *= Math.exp(-dt * 5);
    whiteFlash *= Math.exp(-dt * 9);
    if (whiteFlash < 0.01) whiteFlash = 0;
    lowKick = max(0, lowKick - dt * 1.6);
    ocFlash = max(0, ocFlash - dt * 3);
    stormFlash = max(0, stormFlash - dt * 5);
    founderFlash = max(0, founderFlash - dt * 2.2); spamGate -= dt;
    for (i = 0; i < bmN;) { bmL[i] -= dt; if (bmL[i] <= 0) { bmN--; if (i !== bmN) { bmX[i] = bmX[bmN]; bmY[i] = bmY[bmN]; bmR[i] = bmR[bmN]; bmL[i] = bmL[bmN]; bmM[i] = bmM[bmN]; } } else i++; }
    for (i = 0; i < HMAX; i++) {
      if (!hid[i]) continue;
      if (hacc[i] > 0 && fxT - hlast[i] >= 0.4) flushHit(i, curRun && curRun.w ? curRun.w : 360);
      else if (hacc[i] <= 0 && fxT - hlast[i] > 1.2) hid[i] = 0;
    }
    infectGate = max(0, infectGate - dt * 12);

    // particles (swap-remove)
    for (i = 0; i < pN;) {
      plife[i] -= dt;
      if (plife[i] <= 0) {
        k = --pN;
        if (i !== k) {
          px[i] = px[k]; py[i] = py[k]; pvx[i] = pvx[k]; pvy[i] = pvy[k]; plife[i] = plife[k]; pmax[i] = pmax[k];
          psize[i] = psize[k]; prot[i] = prot[k]; pvr[i] = pvr[k]; pfr[i] = pfr[k]; pkind[i] = pkind[k]; pcol[i] = pcol[k];
        }
        continue;
      }
      var fr = Math.pow(pfr[i], dt * 60);
      pvx[i] *= fr; pvy[i] *= fr;
      px[i] += pvx[i] * dt; py[i] += pvy[i] * dt;
      prot[i] += pvr[i] * dt;
      i++;
    }
    // rings
    for (i = 0; i < rN;) {
      rlife[i] -= dt;
      if (rlife[i] <= 0) {
        k = --rN;
        if (i !== k) {
          rx[i] = rx[k]; ry[i] = ry[k]; r0[i] = r0[k]; r1[i] = r1[k]; rlife[i] = rlife[k]; rmax[i] = rmax[k];
          rw[i] = rw[k]; ra[i] = ra[k]; rkind[i] = rkind[k]; rcol[i] = rcol[k];
        }
        continue;
      }
      i++;
    }
    // arcs
    for (i = 0; i < aN;) {
      alife[i] -= dt;
      if (alife[i] <= 0) {
        k = --aN;
        if (i !== k) {
          ax1[i] = ax1[k]; ay1[i] = ay1[k]; ax2[i] = ax2[k]; ay2[i] = ay2[k]; alife[i] = alife[k]; amax[i] = amax[k];
          aseed[i] = aseed[k]; aver[i] = -1; akind[i] = akind[k]; acrit[i] = acrit[k]; aanch[i] = aanch[k];
        }
        continue;
      }
      i++;
    }
    // numbers
    for (i = 0; i < nN;) {
      nlife[i] -= dt; nage[i] += dt;
      if (nlife[i] <= 0) {
        k = --nN;
        if (i !== k) {
          nx[i] = nx[k]; ny[i] = ny[k]; nvy[i] = nvy[k]; nlife[i] = nlife[k]; nmax[i] = nmax[k]; nage[i] = nage[k];
          nval[i] = nval[k]; neid[i] = neid[k]; nkind[i] = nkind[k]; ntext[i] = ntext[k];
        }
        continue;
      }
      ny[i] += nvy[i] * dt; nvy[i] *= Math.exp(-dt * 2.2);
      i++;
    }
    // warden death chain
    if (ghostT > 0) {
      ghostT -= dt;
      for (i = 0; i < ceN;) {
        ceT[i] -= dt;
        if (ceT[i] <= 0) {
          boom(ceX[i], ceY[i], ceBig[i] === 1);
          if (ceBig[i] === 1) { whiteFlash = max(whiteFlash, reduced() ? 0.2 : 0.5); ghostT = 0; }
          k = --ceN;
          if (i !== k) { ceT[i] = ceT[k]; ceX[i] = ceX[k]; ceY[i] = ceY[k]; ceBig[i] = ceBig[k]; }
          continue;
        }
        i++;
      }
    }
    for (i = 0; i < AI_N; i++) aiA[i] = max(0, aiA[i] - dt * 3.4);
    // flyers
    for (i = 0; i < fN;) {
      fage[i] += dt;
      if (fage[i] >= fdur[i]) {
        k = --fN;
        if (fkind[i] === 0 && fobj[i]) sparks(fobj[i].x, fobj[i].y, 1, C_HAZ, 60, 0.18);
        if (i !== k) {
          fsx[i] = fsx[k]; fsy[i] = fsy[k]; ftx[i] = ftx[k]; fty[i] = fty[k]; fage[i] = fage[k]; fdur[i] = fdur[k];
          fbend[i] = fbend[k]; fcx[i] = fcx[k]; fcy[i] = fcy[k]; fkind[i] = fkind[k]; fcol[i] = fcol[k]; fobj[i] = fobj[k];
        }
        fobj[k] = null;
        continue;
      }
      i++;
    }
  }

  // ------------------------------------------------------------- drawing
  function jag(i, ver) {
    // regenerate the jagged polyline for arc i (deterministic from seed + version, no allocation)
    var pts = apts[i], x1 = ax1[i], y1 = ay1[i], x2 = ax2[i], y2 = ay2[i];
    var dx = x2 - x1, dy = y2 - y1, len = sqrt(dx * dx + dy * dy) || 1;
    var nseg = clamp(Math.ceil(len / (akind[i] === 3 ? 22 : 13)), 2, 16);
    var nxn = -dy / len, nyn = dx / len;
    var amp = akind[i] === 3 ? 9 : (akind[i] === 1 ? 3.2 : 5) * (acrit[i] ? 1.25 : 1);
    var s = aseed[i] + ver * 17.31;
    pts[0] = x1; pts[1] = y1;
    for (var k = 1; k < nseg; k++) {
      var t = k / nseg;
      s = (s * 9301 + 49297) % 233280;
      var off = ((s / 233280) * 2 - 1) * amp;
      pts[k * 2] = x1 + dx * t + nxn * off;
      pts[k * 2 + 1] = y1 + dy * t + nyn * off;
    }
    pts[nseg * 2] = x2; pts[nseg * 2 + 1] = y2;
    return nseg;
  }

  var arcSeg = new Int8Array(MAXA);

  function drawArcs(run) {
    if (!aN) return;
    var i, k, p = run.player;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (i = 0; i < aN; i++) {
      var age = amax[i] - alife[i];
      var ver = (age / 0.04) | 0;
      if (aanch[i] && p) { ax1[i] = p.x; ay1[i] = p.y; ver = ver * 7 + 1; aver[i] = -1; }
      if (aver[i] !== ver) { arcSeg[i] = jag(i, ver); aver[i] = ver; }
      var pts = apts[i], ns = arcSeg[i];
      var fade = clamp01(alife[i] / (amax[i] * 0.45));
      var kind = akind[i], crit = acrit[i];
      var wmul = kind === 1 ? 0.62 : 1;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (k = 1; k <= ns; k++) ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
      if (kind === 3 && ns > 2) {
        // fork: a short side branch from the middle of the bolt
        var mk2 = ns >> 1, fx0 = pts[mk2 * 2], fy0 = pts[mk2 * 2 + 1], sg = (((aseed[i] * 7) | 0) & 1) ? 1 : -1;
        ctx.moveTo(fx0, fy0);
        ctx.lineTo(fx0 + sg * 12, fy0 + 10 + (ver & 3) * 2);
        ctx.lineTo(fx0 + sg * 22, fy0 + 26 + (ver & 1) * 4);
        ctx.lineTo(fx0 + sg * 40, fy0 + 36);
      }
      ctx.globalAlpha = fade * (kind === 3 ? 0.7 : (crit ? 0.8 : 0.6));
      ctx.strokeStyle = kind === 3 ? '#9eefff' : (crit ? '#d9faff' : (kind === 2 ? '#d9ccff' : '#7fe7ff'));
      ctx.lineWidth = kind === 3 ? 4.6 : ((crit ? 5.2 : 3.2) * wmul); ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = kind === 3 ? 1.7 : ((crit ? 2.2 : 1.2) * wmul); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- tesla lattice: crackling beams along run.links (no allocation: jitter from a hash)
  function hash2(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) & 1023) / 511.5 - 1;
  }
  function drawLinks(run, t) {
    var L = run.links;
    if (!L || !L.length) return;
    var n = min(L.length, 12), i, k, ver = (t * 22) | 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        var l = L[i], dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = sqrt(dx * dx + dy * dy);
        if (len < 2) continue;
        var seg = clamp(Math.ceil(len / 11), 2, 7), nx2 = -dy / len, ny2 = dx / len, amp = reduced() ? 2.5 : 4;
        ctx.moveTo(l.x1, l.y1);
        for (k = 1; k < seg; k++) {
          var f = k / seg, o = hash2(i * 31 + k, ver) * amp * (0.6 + 0.4 * sin(f * Math.PI));
          ctx.lineTo(l.x1 + dx * f + nx2 * o, l.y1 + dy * f + ny2 * o);
        }
        ctx.lineTo(l.x2, l.y2);
      }
      if (pass === 0) { ctx.globalAlpha = 0.42; ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 3.6; }
      else { ctx.globalAlpha = 0.95; ctx.strokeStyle = '#eafcff'; ctx.lineWidth = 1.1; }
      ctx.stroke();
    }
    // node glints
    var g = glows[1];
    if (g) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
      for (i = 0; i < n && i < 6; i++) ctx.drawImage(g, L[i].x2 - 7, L[i].y2 - 7, 14, 14);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  function drawHazards(run, t) {
    var hz = run.hazards;
    if (!hz || !hz.length) { drawLaserGlow(t); return; }
    for (var i = 0; i < hz.length; i++) {
      var h = hz[i];
      var prog = h.dur > 0 ? clamp01(h.t / h.dur) : 1;
      var blink = prog > 0.78 ? (0.75 + 0.25 * sin(t * 42)) : 1;
      if (h.kind === 'slam') {
        var r = h.r || 60;
        ctx.globalAlpha = 0.12 * blink;
        ctx.fillStyle = '#e8642c';
        ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = (0.20 + 0.34 * prog) * blink;
        ctx.fillStyle = prog > 0.85 ? '#ff9a63' : '#e8642c';
        ctx.beginPath(); ctx.arc(h.x, h.y, r * prog, 0, TAU); ctx.fill();
        ctx.globalAlpha = (0.75 + 0.25 * prog) * blink;
        ctx.strokeStyle = '#e8642c'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.stroke();
        ctx.setLineDash(DASH_ARR);
        ctx.lineDashOffset = -t * 18;
        ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55 * blink;
        ctx.beginPath(); ctx.arc(h.x, h.y, r + 4, 0, TAU); ctx.stroke();
        ctx.setLineDash(NO_DASH);
        // reticle ticks
        ctx.globalAlpha = 0.7 * blink; ctx.strokeStyle = '#ff9a63'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(h.x - 8, h.y); ctx.lineTo(h.x + 8, h.y); ctx.moveTo(h.x, h.y - 8); ctx.lineTo(h.x, h.y + 8);
        ctx.stroke();
      } else if (h.kind === 'charge') {
        var dx = (h.x2 || 0) - h.x, dy = (h.y2 || 0) - h.y, len = sqrt(dx * dx + dy * dy) || 1;
        var wd = h.w || 40;
        ctx.save();
        ctx.translate(h.x, h.y); ctx.rotate(Math.atan2(dy, dx));
        ctx.globalAlpha = 0.13 * blink; ctx.fillStyle = '#e8642c';
        ctx.fillRect(0, -wd / 2, len, wd);
        ctx.globalAlpha = (0.20 + 0.30 * prog) * blink;
        ctx.fillStyle = prog > 0.85 ? '#ff9a63' : '#e8642c';
        ctx.fillRect(0, -wd / 2, len * prog, wd);
        // edges
        ctx.globalAlpha = 0.85 * blink; ctx.strokeStyle = '#e8642c'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -wd / 2); ctx.lineTo(len, -wd / 2); ctx.moveTo(0, wd / 2); ctx.lineTo(len, wd / 2); ctx.stroke();
        // chevrons
        var cs = min(wd * 0.30, 13), sp = cs * 2.6, off = (t * 90) % sp;
        ctx.globalAlpha = (0.45 + 0.4 * prog) * blink; ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (var cx = off + cs; cx < len - cs; cx += sp) {
          ctx.moveTo(cx - cs, -cs); ctx.lineTo(cx, 0); ctx.lineTo(cx - cs, cs);
        }
        ctx.stroke();
        ctx.restore();
      } else if (h.kind === 'laser') {
        drawLaser(h, t, prog);
      } else if (h.kind === 'blink') {
        drawBlinkMark(h, t, prog);
      } else if (h.kind === 'hold') {
        drawHold(h, t, prog, blink);
      } else if (h.kind === 'injunction') {
        drawSeal(h, t, prog);
      }
    }
    ctx.globalAlpha = 1;
    drawLaserGlow(t);
  }

  function lzSlot(id) {
    var f = -1, i;
    for (i = 0; i < MAXLZ; i++) { if (lzId[i] === id) return i; if (f < 0 && lzId[i] === 0) f = i; }
    if (f < 0) {   // recycle the stalest
      f = 0;
      for (i = 1; i < MAXLZ; i++) if (lzSeen[i] < lzSeen[f]) f = i;
    }
    return f;
  }

  function drawLaser(h, t, prog) {
    var dx = (h.x2 || 0) - h.x, dy = (h.y2 || 0) - h.y, len = sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    var wd = h.w || 14, bl;
    ctx.save();
    ctx.translate(h.x, h.y); ctx.rotate(Math.atan2(dy, dx));
    if (!h.firing) {
      bl = prog > 0.72 ? (0.7 + 0.3 * sin(t * 50)) : 1;
      ctx.globalAlpha = (0.07 + 0.08 * prog) * bl; ctx.fillStyle = '#e8642c';
      ctx.fillRect(0, -wd / 2, len, wd);
      // the lane fills from the emitter outward as the windup runs down
      ctx.globalAlpha = (0.18 + 0.30 * prog) * bl; ctx.fillStyle = prog > 0.85 ? '#ff9a63' : '#e8642c';
      ctx.fillRect(0, -wd / 2, len * prog, wd);
      ctx.setLineDash(DASH_LZ); ctx.lineDashOffset = -t * 44;
      ctx.globalAlpha = 0.9 * bl; ctx.strokeStyle = '#e8642c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -wd / 2); ctx.lineTo(len, -wd / 2); ctx.moveTo(0, wd / 2); ctx.lineTo(len, wd / 2); ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.globalAlpha = (0.30 + 0.55 * prog) * bl; ctx.strokeStyle = prog > 0.85 ? '#ffffff' : '#ffc629'; ctx.lineWidth = 0.8 + 2.2 * prog;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
    } else {
      var fp = h.fire > 0 ? clamp01((h.t - h.dur) / h.fire) : 0;
      var env = min(1, fp / 0.07 + 0.25) * (fp > 0.72 ? 1 - (fp - 0.72) / 0.28 * 0.6 : 1) * (0.93 + 0.07 * sin(t * 95));
      var s2 = lzSlot(h.id);
      lzId[s2] = h.id; lzSeen[s2] = t; lzX1[s2] = h.x; lzY1[s2] = h.y; lzX2[s2] = h.x2; lzY2[s2] = h.y2; lzW[s2] = wd;
      ctx.globalAlpha = 0.30; ctx.fillStyle = '#e8642c'; ctx.fillRect(0, -wd * 1.05 * env, len, wd * 2.1 * env);
      ctx.globalAlpha = 0.80; ctx.fillStyle = '#ff9a63'; ctx.fillRect(0, -wd * 0.62 * env, len, wd * 1.24 * env);
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#bff6ff'; ctx.fillRect(0, -wd * 0.36 * env, len, wd * 0.72 * env);
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, -wd * 0.17 * env, len, wd * 0.34 * env);
      // muzzle flare
      var g = glows[0];
      if (g) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9 * env; ctx.drawImage(g, -wd * 1.6, -wd * 1.6, wd * 3.2, wd * 3.2); ctx.globalCompositeOperation = 'source-over'; }
      if (!isPaused && rnd() < (reduced() ? 0.25 : 0.7)) {
        var d0 = rnd() * len, sg = rnd() < 0.5 ? -1 : 1, ca = cos(Math.atan2(dy, dx)), sa = sin(Math.atan2(dy, dx));
        addP(0, h.x + ca * d0, h.y + sa * d0, -sa * sg * (60 + rnd() * 80), ca * sg * (60 + rnd() * 80), 0.22, 1.4, rnd() < 0.5 ? C_WHITE : C_RUSTLT, 0, 0.9);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawLaserGlow(t) {
    for (var i = 0; i < MAXLZ; i++) {
      if (!lzId[i]) continue;
      var age = t - lzSeen[i];
      if (age < 0.0001) continue;                 // still live this frame
      if (age > 0.30) { lzId[i] = 0; continue; }
      var f = 1 - age / 0.30, wd = lzW[i];
      ctx.globalAlpha = 0.55 * f; ctx.strokeStyle = '#ff9a63'; ctx.lineWidth = wd * 0.7 * f + 1; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(lzX1[i], lzY1[i]); ctx.lineTo(lzX2[i], lzY2[i]); ctx.stroke();
      ctx.globalAlpha = 0.9 * f; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = max(1, wd * 0.12 * f);
      ctx.beginPath(); ctx.moveTo(lzX1[i], lzY1[i]); ctx.lineTo(lzX2[i], lzY2[i]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // blink: a rust target reticle where the Warden / Auditor is about to appear
  function drawBlinkMark(h, t, prog) {
    var x = h.x, y = h.y, r = h.r || 24, fl = prog > 0.7 ? (0.65 + 0.35 * sin(t * 48)) : 1;
    ctx.globalAlpha = (0.08 + 0.18 * prog) * fl; ctx.fillStyle = '#e8642c';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.9 * fl; ctx.strokeStyle = '#e8642c'; ctx.lineWidth = 2;
    ctx.setLineDash(DASH_ARR); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.setLineDash(NO_DASH);
    var cr = r * (2.1 - 1.1 * prog) + 4;                       // converging ring
    ctx.globalAlpha = (0.35 + 0.5 * prog) * fl; ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.stroke();
    var b0 = r + 6, b1 = b0 + 9;                              // corner brackets
    ctx.globalAlpha = 0.95 * fl; ctx.strokeStyle = '#ff9a63'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (var q = 0; q < 4; q++) {
      var sx = (q & 1) ? 1 : -1, sy = (q & 2) ? 1 : -1;
      ctx.moveTo(x + sx * b0, y + sy * b1); ctx.lineTo(x + sx * b0, y + sy * b0); ctx.lineTo(x + sx * b1, y + sy * b0);
    }
    ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawWells(run, t) {
    var ws = run.wells;
    if (!ws || !ws.length) return;
    var en = run.enemies, pk = run.pickups, i, k, j, g = glows[9];
    for (i = 0; i < ws.length; i++) {
      var w = ws[i], pull = w.phase === 'pull';
      var gr = pull ? clamp01(w.t / 1.5) : 1, wr = w.r || 90;
      var fade = pull ? 1 : clamp01(1 - w.t / 0.35);
      // range ring
      ctx.setLineDash(DASH_ARR); ctx.lineDashOffset = t * 26;
      ctx.globalAlpha = (0.18 + 0.25 * gr) * fade; ctx.strokeStyle = '#c792ff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(w.x, w.y, wr * (pull ? 1 - 0.06 * gr : 1), 0, TAU); ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // dark core
      var cr = wr * (0.10 + 0.20 * gr);
      ctx.globalAlpha = (0.55 + 0.35 * gr) * fade; ctx.fillStyle = '#0a0612';
      ctx.beginPath(); ctx.arc(w.x, w.y, cr, 0, TAU); ctx.fill();
      // spiral arms (3), tighter and brighter as it grows
      ctx.lineCap = 'round';
      var arms = reduced() ? 2 : 3, spin = t * (3 + 5 * gr);
      ctx.beginPath();
      for (k = 0; k < arms; k++) {
        var a0 = spin + k * TAU / arms;
        for (j = 0; j <= 14; j++) {
          var f = j / 14, rad = cr + (wr * (0.45 + 0.5 * gr) - cr) * f, a = a0 + f * (2.2 + 1.2 * gr);
          if (j) ctx.lineTo(w.x + cos(a) * rad, w.y + sin(a) * rad); else ctx.moveTo(w.x + cos(a) * rad, w.y + sin(a) * rad);
        }
      }
      ctx.globalAlpha = (0.30 + 0.35 * gr) * fade; ctx.strokeStyle = '#c792ff'; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.globalAlpha = (0.5 + 0.4 * gr) * fade; ctx.strokeStyle = '#e3d6ff'; ctx.lineWidth = 1; ctx.stroke();
      if (g) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (0.35 + 0.5 * gr) * fade;
        var gs = cr * 3.2; ctx.drawImage(g, w.x - gs, w.y - gs, gs * 2, gs * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (pull) {
        // streaks: bots and pickups in range are dragged along visibly
        ctx.beginPath();
        var ns = 0;
        for (k = 0; k < en.length && ns < 30; k++) {
          var e = en[k];
          if (e.dead || e.boss || e.type === 'pylon' || e.disguised) continue;
          var dx = w.x - e.x, dy = w.y - e.y, d = sqrt(dx * dx + dy * dy);
          if (d > wr + e.r || d < 4) continue;
          ctx.moveTo(e.x - dx / d * (e.r + 2), e.y - dy / d * (e.r + 2)); ctx.lineTo(e.x - dx / d * (e.r + 16), e.y - dy / d * (e.r + 16));
          ns++;
        }
        for (k = 0; k < pk.length && ns < 60; k++) {
          var q = pk[k], dx2 = w.x - q.x, dy2 = w.y - q.y, d2 = sqrt(dx2 * dx2 + dy2 * dy2);
          if (d2 > wr * 1.5 || d2 < 4) continue;
          ctx.moveTo(q.x - dx2 / d2 * 5, q.y - dy2 / d2 * 5); ctx.lineTo(q.x - dx2 / d2 * 14, q.y - dy2 / d2 * 14);
          ns++;
        }
        ctx.globalAlpha = 0.55; ctx.strokeStyle = '#e3d6ff'; ctx.lineWidth = 1.4; ctx.stroke();
        // inward sparks off the rim
        if (!isPaused && rnd() < (reduced() ? 0.3 : 0.9)) {
          var ra = rnd() * TAU, rr0 = wr * (0.9 + 0.2 * rnd());
          addP(0, w.x + cos(ra) * rr0, w.y + sin(ra) * rr0, -cos(ra) * rr0 * 2.2, -sin(ra) * rr0 * 2.2, 0.38, 1.6, rnd() < 0.5 ? C_VIO : C_CORE, 0, 0.99);
        }
      } else {
        ctx.globalAlpha = fade * 0.9; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(w.x, w.y, wr * 0.3 * (1 - fade) + 4, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Firewall Node links: thin cyan lines from each node to every bot it shields
  function drawNodeLinks(run, t) {
    var en = run.enemies, n = en.length, nn = 0, i, j, e;
    for (i = 0; i < n; i++) { e = en[i]; if (!e.dead && e.type === 'firenode') nodeTmp[nn++] = e; }
    if (!nn) return;
    var any = false;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      e = en[i];
      if (e.dead || e.shieldedBy === null || e.shieldedBy === undefined) continue;
      for (j = 0; j < nn; j++) if (nodeTmp[j].id === e.shieldedBy) {
        ctx.moveTo(nodeTmp[j].x, nodeTmp[j].y); ctx.lineTo(e.x, e.y); any = true; break;
      }
    }
    if (any) {
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.16; ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash(DASH_LINK); ctx.lineDashOffset = -t * 24;
      ctx.globalAlpha = 0.85; ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // data pulses running node -> bot
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        e = en[i];
        if (e.dead || e.shieldedBy === null || e.shieldedBy === undefined) continue;
        for (j = 0; j < nn; j++) if (nodeTmp[j].id === e.shieldedBy) {
          var f = (t * 0.9 + e.id * 0.371) % 1, nx0 = nodeTmp[j].x, ny0 = nodeTmp[j].y;
          var qx = nx0 + (e.x - nx0) * f, qy = ny0 + (e.y - ny0) * f;
          ctx.moveTo(qx + 2, qy); ctx.arc(qx, qy, 2, 0, TAU);
          break;
        }
      }
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#eafcff'; ctx.fill();
    }
    nodeTmp.length = 0;
    ctx.globalAlpha = 1;
  }

  // nanites: a couple of green flecks orbiting each infected bot (hard cap on the total drawn)
  function drawInfected(run, t) {
    var en = run.enemies, n = en.length, i, e, drawn = 0, cap = reduced() ? MAXFLECK >> 1 : MAXFLECK;
    ctx.beginPath();
    for (i = 0; i < n && drawn < cap; i++) {
      e = en[i];
      if (e.dead || !(e.infected > 0)) continue;
      var a = t * 3.6 + e.id * 1.7, rr = e.r + 3.5 + sin(t * 5 + e.id) * 1.2;
      ctx.moveTo(e.x + cos(a) * rr + 1.9, e.y + sin(a) * rr); ctx.arc(e.x + cos(a) * rr, e.y + sin(a) * rr, 1.9, 0, TAU);
      a += 3.14159;
      ctx.moveTo(e.x + cos(a) * rr + 1.2, e.y + sin(a) * rr); ctx.arc(e.x + cos(a) * rr, e.y + sin(a) * rr, 1.2, 0, TAU);
      drawn += 2;
    }
    if (drawn) { ctx.globalAlpha = 0.95; ctx.fillStyle = '#7ddc6a'; ctx.fill(); }
    // faint green rim on up to 24 of them
    ctx.beginPath(); var rims = 0;
    for (i = 0; i < n && rims < 24; i++) {
      e = en[i];
      if (e.dead || !(e.infected > 0)) continue;
      ctx.moveTo(e.x + e.r + 1.5, e.y); ctx.arc(e.x, e.y, e.r + 1.5, 0, TAU); rims++;
    }
    if (rims) { ctx.globalAlpha = 0.35; ctx.strokeStyle = '#7ddc6a'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  function drawInterns(run, t) {
    var it = run.interns;
    if (!it || !it.length) return;
    var g = glows[1];
    for (var i = 0; i < it.length; i++) {
      var a = it[i], left = (a.life || 6) - (a.age || 0);
      if (left < 0.8 && ((t * 14) | 0) % 2) continue;       // blinks out
      var boot = clamp01((a.age || 0) / 0.25);
      if (g) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35; ctx.drawImage(g, a.x - 15, a.y - 12, 30, 30); ctx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = 0.4 + 0.6 * boot;
      BY.Sprites.intern(ctx, a.x, a.y, 9 * (0.6 + 0.4 * boot), t + a.id);
    }
    ctx.globalAlpha = 1;
  }

  function drawFlyers(t) {
    if (!fN) return;
    for (var i = 0; i < fN; i++) {
      var f = clamp01(fage[i] / fdur[i]), e = f * f * (3 - 2 * f);
      var tx = fobj[i] ? fobj[i].x : ftx[i], ty = fobj[i] ? fobj[i].y : fty[i];
      var bend = fbend[i] * sin(f * Math.PI);
      var dx = tx - fsx[i], dy = ty - fsy[i], len = sqrt(dx * dx + dy * dy) || 1;
      var x = fsx[i] + dx * e - dy / len * bend, y = fsy[i] + dy * e + dx / len * bend;
      var tr = fkind[i] === 0 ? 0.35 : 0.5;
      ctx.globalAlpha = 0.55 * (1 - f * 0.4); ctx.strokeStyle = COLORS[fcol[i]]; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (x - fcx[i]) * tr * 6, y - (y - fcy[i]) * tr * 6); ctx.stroke();
      fcx[i] = x; fcy[i] = y;
      ctx.globalAlpha = 1;
      if (fkind[i] === 0) {
        ctx.beginPath(); hexPath(x, y, 4.6, f * 9); ctx.fillStyle = '#7f929c'; ctx.fill();
        ctx.beginPath(); hexPath(x - 0.2, y - 0.3, 3.6, f * 9); ctx.fillStyle = '#ffd75a'; ctx.fill();
      } else {
        ctx.fillStyle = COLORS[fcol[i]]; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRings() {
    var i, p, a;
    if (!rN) return;
    for (i = 0; i < rN; i++) {
      if (rkind[i] === 1) continue;
      p = 1 - rlife[i] / rmax[i];
      var e = 1 - (1 - p) * (1 - p);
      if (rkind[i] === 2) {
        ctx.globalAlpha = ra[i] * (1 - p);
        ctx.fillStyle = COLORS[rcol[i]];
        ctx.beginPath(); ctx.arc(rx[i], ry[i], r1[i], 0, TAU); ctx.fill();
      } else {
        ctx.globalAlpha = ra[i] * (1 - p);
        ctx.strokeStyle = COLORS[rcol[i]];
        ctx.lineWidth = max(0.5, rw[i] * (1 - p * 0.6));
        ctx.beginPath(); ctx.arc(rx[i], ry[i], max(0.5, r0[i] + (r1[i] - r0[i]) * e), 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawGlowRings() {
    var i, p, g, rad;
    if (!rN) return;
    var any = false;
    for (i = 0; i < rN; i++) if (rkind[i] === 1) { any = true; break; }
    if (!any) return;
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < rN; i++) {
      if (rkind[i] !== 1) continue;
      p = 1 - rlife[i] / rmax[i];
      g = glows[rcol[i]] || glows[0];
      if (!g) continue;
      rad = min(70, r0[i] + (r1[i] - r0[i]) * p);
      ctx.globalAlpha = ra[i] * (1 - p);
      ctx.drawImage(g, rx[i] - rad, ry[i] - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    var i, col = -1, kind;
    if (!pN) return;
    for (i = 0; i < pN; i++) {
      kind = pkind[i];
      var lf = plife[i] / pmax[i];
      if (pcol[i] !== col) { col = pcol[i]; ctx.fillStyle = COLORS[col]; ctx.strokeStyle = COLORS[col]; }
      if (kind === 0) {
        ctx.globalAlpha = clamp01(lf * 1.6);
        ctx.lineWidth = psize[i] * (0.5 + 0.5 * lf);
        var vx = pvx[i] * 0.045, vy = pvy[i] * 0.045;
        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i] - vx - 0.01, py[i] - vy); ctx.stroke();
      } else if (kind === 1) {
        ctx.globalAlpha = clamp01(lf * 2.2);
        var s = psize[i], c = cos(prot[i]) * s, sn = sin(prot[i]) * s;
        ctx.beginPath();
        ctx.moveTo(px[i] + c, py[i] + sn);
        ctx.lineTo(px[i] - sn * 0.7, py[i] + c * 0.7);
        ctx.lineTo(px[i] - c, py[i] - sn);
        ctx.lineTo(px[i] + sn * 0.7, py[i] - c * 0.7);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.globalAlpha = 0.34 * lf;
        var rr = psize[i] * (1.6 - lf * 0.6);
        ctx.beginPath(); ctx.arc(px[i], py[i], rr, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function setFont(kind) {
    if (kind === 0) ctx.font = '600 11px ' + FONT;
    else if (kind === 1) ctx.font = '700 15px ' + FONT;
    else ctx.font = '700 12px ' + FONT;
  }

  function drawNumbers() {
    if (!nN) return;
    var pass, i;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (pass = 0; pass < 3; pass++) {
      // pass 0: plain damage / armored, 1: crits, 2: pickups & combo
      setFont(pass);
      for (i = 0; i < nN; i++) {
        var k = nkind[i];
        var grp = (k === 0 || k === 2) ? 0 : (k === 1 ? 1 : 2);
        if (grp !== pass) continue;
        var lf = nlife[i] / nmax[i];
        var a = lf < 0.4 ? lf / 0.4 : 1;
        var pop = nage[i] < 0.1 ? 1 + (0.1 - nage[i]) * (k === 1 ? 5 : 3) : 1;
        ctx.globalAlpha = a;
        var tx = clamp(nx[i], 22, (curRun && curRun.w ? curRun.w : 360) - 22), ty = ny[i];
        if (pop !== 1) { ctx.save(); ctx.translate(tx, ty); ctx.scale(pop, pop); tx = 0; ty = 0; }
        ctx.fillStyle = 'rgba(8,16,22,0.9)';
        ctx.fillText(ntext[i], tx + 0.9, ty + 0.9);
        ctx.fillText(ntext[i], tx - 0.9, ty + 0.9);
        ctx.fillStyle = NCOL[k] || '#ffc629';
        ctx.fillText(ntext[i], tx, ty);
        if (pop !== 1) ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHpBars(run) {
    var en = run.enemies, st = run.stats || {}, dm = num(st.damage, 1) || 1;
    for (var i = 0; i < en.length; i++) {
      var e = en[i];
      if (e.dead || e.boss || e.disguised || !(e.hp < e.maxHp)) continue;
      var per = dm * (e.armor > 0 ? (1 - e.armor) : 1);
      if (e.hp <= per * 1.001) continue;      // one hit left: no bar
      var w = clamp(e.r * 1.8, 16, 34), x = e.x - w / 2, y = e.y - e.r * (e.elite ? 1.5 : 1.25) - 5;
      ctx.fillStyle = 'rgba(8,16,22,0.8)'; ctx.fillRect(x - 1, y - 1, w + 2, 4.5);
      ctx.fillStyle = e.hostile ? '#e8642c' : '#c5d0d6';
      ctx.fillRect(x, y, w * clamp01(e.hp / e.maxHp), 2.5);
    }
  }

  function drawSprocket(run, dt) {
    var p = run.player, st = run.stats || {}, oc = p.oc || {};
    var spd2 = p.vx * p.vx + p.vy * p.vy;
    var tf = spd2 > 100 ? clamp(p.vx / 160, -1, 1) : 0;
    pFace += (tf - pFace) * min(1, dt * 10 + 0.02);
    var facing = Math.acos(clamp(pFace, -1, 1));
    var hurtF = clamp01(1 - num(p.hurt, 99) / 0.25);
    var rad = (p.r || 12) * (p.magnate ? 1.4 : (p.colossus ? 1.3 : (p.titan ? 1.15 : 1)));
    var fieldR = num(st.radius, 46);
    var ocOn = !!oc.active;

    // reach ring
    var pf = pulseFlash;
    ctx.beginPath(); ctx.arc(p.x, p.y, fieldR, 0, TAU);
    if (p.enjoined) {
      ctx.globalAlpha = 0.03; ctx.fillStyle = '#7f929c'; ctx.fill();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#7f929c'; ctx.lineWidth = 1.2; ctx.setLineDash(DASH_ARR); ctx.stroke(); ctx.setLineDash(NO_DASH);
    } else if (ocOn) {
      ctx.globalAlpha = 0.07 + 0.04 * sin(fxT * 10); ctx.fillStyle = '#7fe7ff'; ctx.fill();
      ctx.globalAlpha = 0.55 + 0.25 * pf; ctx.strokeStyle = '#bff6ff'; ctx.lineWidth = 1.8 + pf * 1.2; ctx.stroke();
    } else {
      ctx.globalAlpha = 0.035 + 0.06 * pf; ctx.fillStyle = '#7fe7ff'; ctx.fill();
      ctx.globalAlpha = 0.30 + 0.5 * pf; ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 1.2 + pf * 1.4; ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // overclock aura + afterimages
    if (ocOn && !reduced()) {
      if (fxT - aiLast > 0.05) {
        aiLast = fxT; aiX[aiI] = p.x; aiY[aiI] = p.y; aiA[aiI] = 1; aiI = (aiI + 1) % AI_N;
      }
    }
    var g = glows[1];
    if (ocOn && g) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7 + 0.2 * sin(fxT * 12);
      var gs = rad * 5;
      ctx.drawImage(g, p.x - gs, p.y - gs, gs * 2, gs * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (!reduced()) {
      for (var i = 0; i < AI_N; i++) {
        if (aiA[i] <= 0.02) continue;
        ctx.globalAlpha = aiA[i] * 0.28;
        BY.Sprites.player(ctx, aiX[i], aiY[i], rad, { t: fxT, facing: facing, loadout: loadout, oc: true, hurt: 0, pulse: 1, titan: p.titan, colossus: !!p.colossus, magnate: !!p.magnate });
      }
      ctx.globalAlpha = 1;
    }

    // tesla lattice under the drones
    drawLinks(run, fxT);
    // drones
    var dr = run.drones;
    if (dr) for (var j = 0; j < dr.length; j++) BY.Sprites.drone(ctx, dr[j].x, dr[j].y, fxT + j);

    // Sprocket
    BY.Sprites.player(ctx, p.x, p.y, rad, { t: fxT, facing: facing, loadout: loadout, oc: ocOn, hurt: hurtF, pulse: clamp01(p.pulse), titan: !!p.titan, colossus: !!p.colossus, magnate: !!p.magnate });
    if (p.held > 0) drawHeldClamp(p, rad, fxT);
    if (p.enjoined) drawEnjoined(p, rad);

    // overclock charge arc
    if (oc.unlocked && !ocOn && oc.charge > 0.001) {
      var ar = rad + 7;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25; ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, ar, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.strokeStyle = oc.charge > 0.85 ? '#ffffff' : '#7fe7ff'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, ar, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(oc.charge)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // many pickups: small bolts are batched into three fills; cores, cells and big bolts keep the real sprite
  function hexPath(x, y, r, rot) {
    for (var k = 0; k < 6; k++) {
      var a = rot + k * TAU / 6, hx = x + cos(a) * r, hy = y + sin(a) * r;
      if (k) ctx.lineTo(hx, hy); else ctx.moveTo(hx, hy);
    }
    ctx.closePath();
  }
  function drawPickups(pk, t) {
    var i, n = pk.length, q, rr;
    snapN = 0;
    if (n) { var st2 = n > MAXSNAP ? n / MAXSNAP : 1; for (i = 0; i < MAXSNAP && (i * st2) < n; i++) { q = pk[(i * st2) | 0]; snapX[i] = q.x; snapY[i] = q.y; snapN++; } }
    if (n <= 40) { for (i = 0; i < n; i++) BY.Sprites.pickup(ctx, pk[i], t); return; }
    ctx.beginPath();
    for (i = 0; i < n; i++) { q = pk[i]; if (q.kind === 'bolt' && !(q.value >= 50) && !(q.age > 12 && ((q.age * 7) | 0) % 2)) hexPath(q.x, q.y, q.value >= 10 ? 6.2 : 5.2, q.age * 2.2); }
    ctx.fillStyle = '#7f929c'; ctx.fill();
    ctx.beginPath();
    for (i = 0; i < n; i++) { q = pk[i]; if (q.kind === 'bolt' && !(q.value >= 50) && !(q.age > 12 && ((q.age * 7) | 0) % 2)) hexPath(q.x - 0.2, q.y - 0.3, q.value >= 10 ? 5.1 : 4.2, q.age * 2.2); }
    ctx.fillStyle = '#c5d0d6'; ctx.fill();
    ctx.beginPath();
    for (i = 0; i < n; i++) { q = pk[i]; if (q.kind === 'bolt' && !(q.value >= 50) && !(q.age > 12 && ((q.age * 7) | 0) % 2)) { rr = q.value >= 10 ? 2.2 : 1.8; ctx.moveTo(q.x + rr, q.y); ctx.arc(q.x, q.y, rr, 0, TAU); } }
    ctx.fillStyle = '#152630'; ctx.fill();
    for (i = 0; i < n; i++) { q = pk[i]; if (q.kind !== 'bolt' || q.value >= 50) BY.Sprites.pickup(ctx, q, t); }
  }

  function drawReticle(rt) {
    var x = rt.x, y = rt.y;
    ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU);
    ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12);
    ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // sector dynamic treatments (low contrast, drawn over the cached floor)
  function drawSectorDynamic(run, t) {
    var w = run.w, h = run.h, sec = run.sector, i, x, y;
    if (sec === 1) {
      ctx.strokeStyle = '#93adb9'; ctx.lineWidth = 2; ctx.globalAlpha = 0.07; ctx.lineCap = 'butt';
      ctx.beginPath();
      for (i = 0; i < 3; i++) {
        y = h * (0.2 + i * 0.3);
        var dir = (i % 2) ? -1 : 1, sp = 44;
        var off = ((t * 14 * dir) % sp + sp) % sp;
        for (x = -sp + off; x < w + sp; x += sp) {
          if (dir > 0) { ctx.moveTo(x - 7, y - 10); ctx.lineTo(x, y); ctx.lineTo(x - 7, y + 10); }
          else { ctx.moveTo(x + 7, y - 10); ctx.lineTo(x, y); ctx.lineTo(x + 7, y + 10); }
        }
      }
      ctx.stroke();
    } else if (sec === 3) {
      ctx.globalAlpha = 0.85 + 0.15 * sin(t * 2.3) * sin(t * 0.7 + 1);
      ctx.fillStyle = glowGrad; ctx.fillRect(0, 0, w, h);
    } else if (sec === 5) {
      ctx.setLineDash(DASH_ARR); ctx.lineDashOffset = -t * 6;
      ctx.strokeStyle = '#8fa4ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.10;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 130, 0, TAU); ctx.stroke();
      ctx.lineDashOffset = t * 5;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 270, 0, TAU); ctx.stroke();
      ctx.setLineDash(NO_DASH);
    } else if (sec === 6) {
      // dock lights: a slow amber beacon sweep along the top bay
      var bx = ((t * 40) % (w + 80)) - 40;
      ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffc629'; ctx.fillRect(bx - 18, 0, 36, 12);
    } else if (sec === 7) {
      // blinking status LEDs, batched into three fills
      for (var c = 0; c < 3; c++) {
        ctx.beginPath();
        for (i = 0; i < ledN; i++) {
          if (ledC[i] !== c) continue;
          var on = c === 1 ? sin(t * (2.2 + ledP[i] * 0.3) + ledP[i] * 9) > 0.1 : (c === 2 ? sin(t * 7 + ledP[i] * 11) > 0.55 : sin(t * 0.7 + ledP[i]) > -0.6);
          if (on) ctx.rect(ledX[i] - 1.1, ledY[i] - 1.1, 2.2, 2.2);
        }
        ctx.globalAlpha = 0.85; ctx.fillStyle = c === 0 ? '#7ddc6a' : (c === 1 ? '#7fe7ff' : '#ffc629'); ctx.fill();
      }
    } else if (sec === 8) {
      // inspection beam sweeping down the floor
      y = ((t * 46) % (h + 60)) - 30;
      ctx.globalAlpha = 0.05; ctx.fillStyle = '#7ddc6a'; ctx.fillRect(0, y - 14, w, 28);
      ctx.globalAlpha = 0.12; ctx.fillRect(0, y - 0.75, w, 1.5);
    } else if (sec === 9) {
      // floor dial needle rides up and down the sweep
      var dcx = w / 2, dcy = h / 2, ang = Math.PI * 0.75 + (0.5 + 0.5 * sin(t * 0.55)) * Math.PI * 1.5;
      ctx.globalAlpha = 0.22; ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dcx, dcy); ctx.lineTo(dcx + cos(ang) * 88, dcy + sin(ang) * 88); ctx.stroke();
    } else if (sec === 14 && tickCv) {
      // trading floor: two ticker strips scrolling in opposite directions
      var tl = tickCv._len || 600, to = (t * 34) % tl;
      ctx.globalAlpha = 0.62;
      ctx.save(); ctx.beginPath(); ctx.rect(14, 9, w - 28, 20); ctx.clip();
      for (x = -to; x < w; x += tl) ctx.drawImage(tickCv, 0, 0, tl, 22, 14 + x, 8, tl, 22);
      ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(14, h - 29, w - 28, 20); ctx.clip();
      for (x = to - tl; x < w; x += tl) ctx.drawImage(tickCv, 0, 0, tl, 22, 14 + x, h - 30, tl, 22);
      ctx.restore();
    } else if (sec === 15 || sec === 16) {
      // aircraft beacon on the tallest tower
      ctx.globalAlpha = 0.25 + 0.5 * (sin(t * 3) > 0.7 ? 1 : 0); ctx.fillStyle = '#ff5a3a';
      ctx.beginPath(); ctx.arc(w * 0.12, 8, 2.2, 0, TAU); ctx.fill();
      if (sec === 16) overtimeTint(run, t);
    }
    ctx.globalAlpha = 1;
  }

  function overtimeTint(run, t) {
    var w = run.w, h = run.h;
    if (true) {
      // the time clock: red tint that runs hotter every Overtime level, with a sweeping second hand
      var heat = clamp01((run.overtime || 1) / 9);
      var ta = 0.04 + 0.12 * heat + (0.015 + 0.02 * heat) * (reduced() ? 0 : sin(t * (1.6 + heat * 4)));
      ctx.globalAlpha = ta; ctx.fillStyle = '#d82a18'; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.12 + 0.12 * heat; ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      var sa = t * TAU / 6 - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + cos(sa) * 148, h / 2 + sin(sa) * 148); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------- Act III drawing
  // HR heal links: soft green dashes with a plus at the healed bot
  function drawHeals(run, t) {
    var hl = run.heals, n = hl ? min(hl.length, 40) : 0, i, s;
    if (!n) return;
    ctx.lineCap = 'round';
    ctx.setLineDash(DASH_LINK); ctx.lineDashOffset = -t * 14;
    ctx.globalAlpha = 0.34; ctx.strokeStyle = '#7ddc6a'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (i = 0; i < n; i++) { s = hl[i]; ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 0.7; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      s = hl[i];
      var k = ((t * 1.3 + i * 0.37) % 1), bx = s.x1 + (s.x2 - s.x1) * k, by = s.y1 + (s.y2 - s.y1) * k;
      ctx.moveTo(bx - 2.5, by); ctx.lineTo(bx + 2.5, by); ctx.moveTo(bx, by - 2.5); ctx.lineTo(bx, by + 2.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // orbital markers: thin crosshair ring that tightens, a faint column appears just before the beam lands
  function drawStrikes(run, t) {
    var ss = run.strikes, n = ss ? ss.length : 0, i;
    for (i = 0; i < n; i++) {
      var sk = ss[i], pr = clamp01(num(sk.t) / (num(sk.dur) || 1)), r = num(sk.r, 40), a = 0.45 + 0.4 * pr;
      ctx.strokeStyle = '#bff6ff'; ctx.lineCap = 'butt'; ctx.lineWidth = 1.2; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(sk.x, sk.y, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = a * 0.6;
      ctx.beginPath(); ctx.arc(sk.x, sk.y, r * (1 + 0.7 * (1 - pr)), 0, TAU); ctx.stroke();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(sk.x - r - 7, sk.y); ctx.lineTo(sk.x - r * 0.35, sk.y); ctx.moveTo(sk.x + r * 0.35, sk.y); ctx.lineTo(sk.x + r + 7, sk.y);
      ctx.moveTo(sk.x, sk.y - r - 7); ctx.lineTo(sk.x, sk.y - r * 0.35); ctx.moveTo(sk.x, sk.y + r * 0.35); ctx.lineTo(sk.x, sk.y + r + 7);
      ctx.stroke();
      if (pr > 0.8) {
        ctx.globalAlpha = (pr - 0.8) * 2.2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sk.x, 0); ctx.lineTo(sk.x, sk.y - r); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBeams() {
    if (!bmN) return;
    for (var i = 0; i < bmN; i++) {
      var f = clamp01(bmL[i] / bmM[i]), w1 = bmR[i] * 1.3 * f, y = bmY[i];
      ctx.globalAlpha = 0.5 * f; ctx.fillStyle = '#7fe7ff'; ctx.fillRect(bmX[i] - w1, 0, w1 * 2, y);
      ctx.globalAlpha = 0.95 * f; ctx.fillStyle = '#ffffff'; ctx.fillRect(bmX[i] - w1 * 0.4, 0, w1 * 0.8, y);
    }
    ctx.globalAlpha = 1;
  }

  // hold: rust telegraph (hourglass + filling sweep); injunction: red wax-seal
  function drawHold(h, t, prog, blink) {
    var r = num(h.r, 40);
    ctx.globalAlpha = (0.10 + 0.14 * prog) * blink; ctx.fillStyle = '#e8642c';
    ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = (0.20 + 0.22 * prog) * blink; ctx.fillStyle = '#ff9a63';
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.arc(h.x, h.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.85 * blink; ctx.strokeStyle = '#e8642c'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.8 * blink; ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(h.x - 7, h.y - 9); ctx.lineTo(h.x + 7, h.y - 9); ctx.lineTo(h.x - 7, h.y + 9); ctx.lineTo(h.x + 7, h.y + 9); ctx.closePath();
    ctx.stroke();
  }

  function drawSeal(h, t, prog) {
    var r = num(h.r, 50), act = h.active || h.t >= h.dur, i, a;
    if (!act) {
      var blink = prog > 0.78 ? (0.75 + 0.25 * sin(t * 42)) : 1;
      ctx.globalAlpha = (0.08 + 0.10 * prog) * blink; ctx.fillStyle = '#e0392a';
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
      ctx.setLineDash(DASH_ARR); ctx.lineDashOffset = -t * 20;
      ctx.globalAlpha = 0.8 * blink; ctx.strokeStyle = '#e0392a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // the stamp comes down: a ring closing in
      ctx.globalAlpha = 0.6 * prog; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(h.x, h.y, r * (1 + 0.7 * (1 - prog)), 0, TAU); ctx.stroke();
      return;
    }
    var left = h.life > 0 ? clamp01((num(h.dur) + h.life - h.t) / 0.8) : 1;
    var pu = reduced() ? 1 : (0.85 + 0.15 * sin(t * 4 + h.x));
    ctx.globalAlpha = 0.20 * left * pu; ctx.fillStyle = '#b8231a';
    ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
    // scalloped wax edge
    ctx.beginPath();
    for (i = 0; i <= 36; i++) { a = i * TAU / 36; var rr = r * (i & 1 ? 0.96 : 1.04); if (i === 0) ctx.moveTo(h.x + rr, h.y); else ctx.lineTo(h.x + cos(a) * rr, h.y + sin(a) * rr); }
    ctx.closePath();
    ctx.globalAlpha = 0.85 * left; ctx.strokeStyle = '#e0392a'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.globalAlpha = 0.5 * left; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(h.x, h.y, r * 0.7, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.55 * left; ctx.fillStyle = '#ff9a8a'; ctx.font = '700 ' + Math.round(r * 0.7) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('§', h.x, h.y + 1);
  }

  // Sprocket status: "on hold" clamp, enjoined badge
  function drawHeldClamp(p, rad, t) {
    var cr = rad + 9, i, a;
    ctx.globalAlpha = 0.12 + 0.05 * sin(t * 14); ctx.fillStyle = '#7fe7ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, cr, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt'; ctx.strokeStyle = '#bff6ff'; ctx.lineWidth = 3.2; ctx.globalAlpha = 0.95;
    ctx.beginPath();
    for (i = 0; i < 4; i++) { a = i * Math.PI / 2 + Math.PI / 4; ctx.moveTo(p.x + cos(a - 0.4) * cr, p.y + sin(a - 0.4) * cr); ctx.arc(p.x, p.y, cr, a - 0.4, a + 0.4); }
    ctx.stroke();
    ctx.lineWidth = 1.2; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, cr + 4, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawEnjoined(p, rad) {
    var y = p.y - rad - 13;
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e0392a'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(p.x, y, 5.5, 0, TAU); ctx.moveTo(p.x - 3.4, y + 3.4); ctx.lineTo(p.x + 3.4, y - 3.4); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // under the bots: the Founder's aura ring
  function drawAura(run, t) {
    var b = run.boss, e = b && b.aura > 0 ? findBoss(run) : null;
    if (!e) return;
    var r = num(b.aura), pu = reduced() ? 0.5 : (0.5 + 0.5 * sin(t * 3));
    ctx.globalAlpha = 0.05 + 0.04 * pu; ctx.fillStyle = '#e8642c';
    ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.fill();
    ctx.setLineDash(DASH_ARR); ctx.lineDashOffset = -t * 24;
    ctx.globalAlpha = 0.5 + 0.2 * pu; ctx.strokeStyle = '#ff9a63'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ffc629'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * (0.55 + 0.45 * ((t * 0.7) % 1)), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // over the Market: the volatility ticker
  function drawVolatility(run, t) {
    var b = run.boss, m = b ? num(b.vol, 1) : 1;
    if (!b || m === 1 || b.id !== 'market') return;
    var e = findBoss(run);
    if (!e) return;
    var key = Math.round(m * 20) + (m >= 1 ? 1000 : 0);
    if (key !== volKey) { volKey = key; volTxt = (m >= 1 ? '▲ ×' : '▼ ×') + fmtNum(m); }
    var y = e.y - e.r - 20, up = m >= 1;
    ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var wd = ctx.measureText(volTxt).width + 14;
    ctx.globalAlpha = 0.78; ctx.fillStyle = '#0a1319';
    ctx.beginPath(); rrect(ctx, e.x - wd / 2, y - 9, wd, 18, 7); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = up ? '#7ddc6a' : '#ff9a63'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = up ? '#7ddc6a' : '#ff9a63';
    ctx.fillText(volTxt, e.x, y + 1);
  }

  function drawCourierStreak(e) {
    var vx = num(e.vx), vy = num(e.vy), s = sqrt(vx * vx + vy * vy);
    if (s < 20) return;
    var ux = vx / s, uy = vy / s, nx2 = -uy, ny2 = ux, r = e.r || 10;
    ctx.lineCap = 'round'; ctx.strokeStyle = '#ffd75a';
    for (var k = -1; k <= 1; k++) {
      ctx.globalAlpha = k === 0 ? 0.5 : 0.28; ctx.lineWidth = k === 0 ? 2.4 : 1.4;
      var L = k === 0 ? 62 : 40;
      ctx.beginPath(); ctx.moveTo(e.x - ux * r + nx2 * k * r * 0.6, e.y - uy * r + ny2 * k * r * 0.6);
      ctx.lineTo(e.x - ux * (r + L) + nx2 * k * r * 0.6, e.y - uy * (r + L) + ny2 * k * r * 0.6); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw(run, dt, o) {
    if (!ctx) return;
    o = o || {};
    if (!bw) resize();
    if (!(dt > 0)) dt = 0.0167;
    if (dt > 0.1) dt = 0.1;
    var paused = !!o.paused;
    isPaused = paused;

    if (!run || !(run.w > 0)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = INK; ctx.fillRect(0, 0, bw, bh);
      return;
    }
    if (run !== curRun) { curRun = run; curSector = run.sector || 1; }
    ensureGeom(run.w, run.h, run.sector || 1);

    // fx clock
    var dtFx = 0;
    if (!paused) {
      var sc = 1;
      if (slowT > 0) {
        var kk = slowT / 1.3;
        sc = kk > 0.55 ? 0.25 : 0.25 + 0.75 * (1 - kk / 0.55);
        slowT -= dt;
      }
      dtFx = dt * sc;
      updateFx(dtFx);
      // warn darkening (state driven)
      var wt = (run.boss && run.boss.state === 'warning') ? 1 : 0;
      warnDark += (wt - warnDark) * min(1, dt * 5);
      budgetA += ((run.player && run.player.budget && !run.over) ? 1 - budgetA : -budgetA) * min(1, dt * 4);
    }
    var t = fxT;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = INK; ctx.fillRect(0, 0, bw, bh);
    var k = fitS * dpr;
    var sx = shX * fitS, sy = shY * fitS;
    ctx.drawImage(floorCv, sx * dpr, sy * dpr);
    ctx.setTransform(k, 0, 0, k, (fitOX + sx) * dpr, (fitOY + sy) * dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, run.w, run.h); ctx.clip();

    drawSectorDynamic(run, t);
    if (warnDark > 0.01) { ctx.globalAlpha = 0.28 * warnDark; ctx.fillStyle = '#05090c'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }

    if (stormFlash > 0.02) { ctx.globalAlpha = stormFlash * (reduced() ? 0.12 : 0.26); ctx.fillStyle = '#7fe7ff'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }

    // hazards
    drawHazards(run, t);
    drawAura(run, t);
    drawStrikes(run, t);
    drawWells(run, t);
    drawNodeLinks(run, t);
    drawHeals(run, t);

    // pickups
    var pk = run.pickups, i;
    if (pk && !sweepHide) drawPickups(pk, t);

    // bots
    var en = run.enemies, bossLive = false;
    if (en) {
      for (i = 0; i < en.length; i++) {
        var e = en[i];
        if (e.dead) continue;
        if (sweepHide && !e.boss && e.type !== 'pylon') continue;
        if (e.type === 'courier') drawCourierStreak(e);
        if (e.copy) ctx.globalAlpha = 0.66;
        if (e.blinking) {
          ctx.globalAlpha = 0.18 + 0.22 * (0.5 + 0.5 * sin(t * 55));
          BY.Sprites.enemy(ctx, e, t);
          ctx.globalAlpha = 1;
        } else BY.Sprites.enemy(ctx, e, t);
        if (e.copy) ctx.globalAlpha = 1;
        if (e.boss) {
          bossLive = true;
          for (var q = 0; q < BKEYS.length; q++) lastBoss[BKEYS[q]] = e[BKEYS[q]];
          haveLastBoss = true;
        }
      }
      if (!sweepHide) { drawInfected(run, t); drawHpBars(run); }
    }
    drawInterns(run, t);
    drawVolatility(run, t);
    // dying warden
    if (ghostT > 0) {
      var gp = 1 - ghostT / ghostDur;
      ghost.flash = (gp < 0.6 && ((t * 12) | 0) % 3 === 0) ? 1 : 0;
      var jx = ghost.x, jy = ghost.y;
      ghost.x = jx + (rnd() - 0.5) * 5 * (1 - gp); ghost.y = jy + (rnd() - 0.5) * 5 * (1 - gp);
      ctx.globalAlpha = gp > 0.8 ? clamp01((1 - gp) / 0.2) : 1;
      BY.Sprites.enemy(ctx, ghost, t);
      ctx.globalAlpha = 1;
      ghost.x = jx; ghost.y = jy;
    }

    // shots
    var sh = run.shots;
    if (sh) for (i = 0; i < sh.length; i++) BY.Sprites.shot(ctx, sh[i], t);

    // Sprocket, field, drones
    drawSprocket(run, dtFx > 0 ? dtFx : 0.0167);

    // effects on top
    drawBeams();
    drawRings();
    drawFlyers(t);
    drawParticles();
    drawGlowRings();
    drawArcs(run);
    drawNumbers();
    if (o.reticle) drawReticle(o.reticle);

    // screen-space overlays inside the arena
    var pl = run.player;
    var ratio = pl.maxBattery > 0 ? pl.battery / pl.maxBattery : 1;
    var low = !run.attract && !run.over && ratio < 0.25 && ratio > 0;
    var va = 0;
    if (low) va = (0.20 + 0.18 * (0.5 + 0.5 * sin(t * 7))) * (reduced() ? 0.6 : 1) * (0.7 + 0.3 * (1 - ratio / 0.25));
    va = max(va, lowKick * 0.45, redFlash * 0.55);
    if (va > 0.005) { ctx.globalAlpha = clamp01(va); ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }
    if (budgetA > 0.01) {
      var bp = reduced() ? 0.7 : (0.62 + 0.38 * sin(t * 2.4));
      ctx.globalAlpha = clamp01(budgetA * (0.34 + 0.36 * bp)); ctx.fillStyle = budGrad; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1;
    }
    if (warnDark > 0.01) {
      var pulse = reduced() ? 0.7 : (0.55 + 0.45 * sin(t * 9));
      ctx.globalAlpha = clamp01(warnDark * pulse); ctx.fillStyle = warnGrad; ctx.fillRect(0, 0, run.w, 110); ctx.globalAlpha = 1;
    }
    if (ocFlash > 0.01 && pl.oc && pl.oc.active) {
      ctx.globalAlpha = ocFlash * (reduced() ? 0.12 : 0.28); ctx.fillStyle = '#7fe7ff'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1;
    } else if (pl.oc && pl.oc.active) {
      ctx.globalAlpha = 0.09; ctx.fillStyle = '#7fe7ff'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1;
    }
    if (founderFlash > 0.02) { ctx.globalAlpha = founderFlash * (reduced() ? 0.10 : 0.22); ctx.fillStyle = '#ffd75a'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }
    if (whiteFlash > 0.01) { ctx.globalAlpha = clamp01(whiteFlash); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }
    if (paused) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#0a1319'; ctx.fillRect(0, 0, run.w, run.h); ctx.globalAlpha = 1; }

    ctx.restore();
  }

  function stats() {
    return { particles: pN, rings: rN, arcs: aN, numbers: nN, shake: shakeAmp, css: [cssW, cssH], dpr: dpr, fit: [fitS, fitOX, fitOY] };
  }

  BY.Render = {
    init: init, setOptions: setOptions, resize: resize, arenaSize: arenaSize, toArena: toArena, scale: scale,
    begin: begin, handle: handle, draw: draw, sweep: sweep,
    stats: stats   // extra (tools): FX pool occupancy
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
