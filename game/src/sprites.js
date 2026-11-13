(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};

  var P = {
    ink: '#0e1a21', floor: '#152630', plate: '#1d3441', plateHi: '#27475a', line: '#35596e',
    text: '#eaf2f4', textDim: '#93adb9', hazard: '#ffc629', hazardInk: '#1a1300',
    arc: '#7fe7ff', rust: '#e8642c', core: '#c792ff', ok: '#7ddc6a', steel: '#c5d0d6',
    // tints and shades
    steelDk: '#7f929c', steelDkr: '#4d6370', tealDk: '#2b4a58', tealMid: '#3f6a7c',
    rustDk: '#8f3a1a', rustLt: '#ff9a63', arcDk: '#2fa9c9', white: '#ffffff',
    gold: '#ffd75a', goldDk: '#b8860b', goldLt: '#fff3b0', coreDk: '#6d3fb0', shadow: 'rgba(5,12,16,0.35)'
  };

  var TAU = Math.PI * 2;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs;

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function poly(ctx, pts) {
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function hex(ctx, x, y, r, rot) {
    for (var i = 0; i < 6; i++) {
      var a = rot + i * TAU / 6;
      if (i) ctx.lineTo(x + cos(a) * r, y + sin(a) * r); else ctx.moveTo(x + cos(a) * r, y + sin(a) * r);
    }
    ctx.closePath();
  }
  function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function fill(ctx, c) { ctx.fillStyle = c; ctx.fill(); }
  function stroke(ctx, c, w) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); }
  function fp(ctx, c) { ctx.beginPath(); return c; }
  // quick shapes: begin, build, fill
  function F(ctx, color, fn) { ctx.beginPath(); fn(ctx); ctx.fillStyle = color; ctx.fill(); }
  function S(ctx, color, w, fn) { ctx.beginPath(); fn(ctx); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // ============================================================ PLAYER
  // Drawn in a unit space where body radius = 1 (scaled by r).
  function player(ctx, x, y, r, o) {
    o = o || {};
    var t = o.t || 0, lo = o.loadout || {}, mag = !!(o.magnate || lo.magnate), col = !!(o.colossus || lo.colossus || mag), titan = !!(o.titan || lo.titan || col);
    var arc = lo.arc || 0, ch = lo.chassis || 0, sa = lo.salvage || 0;
    var oc = !!o.oc, hurt = clamp01(o.hurt || 0), pulse = clamp01(o.pulse || 0);
    var face = o.facing || 0;
    var fx = cos(face), lean = fx * 0.12;
    var bob = sin(t * 3.2) * 0.04;
    var blink = (t % 3.4) > 3.28;
    var body = oc ? '#9fe9ff' : P.steel, bodyDk = oc ? '#4fb6d6' : P.steelDk;
    if (mag) { body = oc ? '#4a5058' : '#232830'; bodyDk = oc ? '#2c3138' : '#0f1216'; }
    if (hurt > 0) { body = mix(body, P.rustLt, hurt * 0.75); bodyDk = mix(bodyDk, P.rust, hurt * 0.75); }
    var glow = oc ? 1 : (0.35 + 0.65 * pulse);

    ctx.save();
    ctx.translate(x, y + bob * r);
    ctx.scale(r, r);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var K = col ? 1.4 : titan ? 1.18 : 1; // titan / colossus overall bulk
    // ground shadow
    F(ctx, P.shadow, function (c) { c.ellipse(0, col ? 1.2 : 0.95, 0.95 * K, 0.22, 0, 0, TAU); });
    if (oc) {
      F(ctx, 'rgba(127,231,255,0.18)', function (c) { circle(c, 0, 0, 1.55 * K); });
      F(ctx, 'rgba(255,198,41,0.14)', function (c) { circle(c, 0, 0, 1.25 * K); });
    }
    ctx.rotate(lean);

    // ---- back: battery pack (chassis)
    if (ch >= 1 || titan) {
      var bw = titan ? 0.5 : 0.28 + ch * 0.08, bh = titan ? 1.0 : 0.5 + ch * 0.12;
      F(ctx, P.tealDk, function (c) { rr(c, -0.95 * K - bw * 0.35, -bh * 0.5 + 0.05, bw, bh, 0.1); });
      F(ctx, oc ? P.arc : P.ok, function (c) { rr(c, -0.95 * K - bw * 0.35 + 0.07, -bh * 0.5 + 0.12, bw - 0.14, 0.12, 0.04); });
      if (col) S(ctx, P.gold, 0.06, function (c) { rr(c, -0.95 * K - bw * 0.35, -bh * 0.5 + 0.05, bw, bh, 0.1); });
      if (ch >= 2 || titan) F(ctx, oc ? P.arc : P.ok, function (c) { rr(c, -0.95 * K - bw * 0.35 + 0.07, -bh * 0.5 + 0.32, bw - 0.14, 0.12, 0.04); });
      if (ch >= 3 || titan) { // thruster nozzles
        F(ctx, P.steelDkr, function (c) { rr(c, -1.12 * K - bw * 0.35, 0.28, 0.22, 0.34, 0.06); });
        F(ctx, P.hazard, function (c) { c.moveTo(-1.12 * K - bw * 0.35, 0.34); c.lineTo(-1.12 * K - bw * 0.35 - 0.26 - 0.1 * sin(t * 30), 0.45); c.lineTo(-1.12 * K - bw * 0.35, 0.56); c.closePath(); });
      }
    }
    // ---- treads
    var tw = 1.7 * K, ty = col ? 0.68 : 0.52, th = col ? 0.6 : 0.5;
    F(ctx, P.tealDk, function (c) { rr(c, -tw / 2, ty, tw, th, 0.25); });
    S(ctx, col ? P.gold : P.line, 0.07, function (c) { rr(c, -tw / 2, ty, tw, th, 0.25); });
    for (var i = -2; i <= 2; i++) F(ctx, col ? P.gold : P.steelDkr, function (c) { circle(c, i * 0.3 * K, ty + th / 2, 0.07); });
    // ---- body
    var bwid = 1.55 * K, bhei = 1.2 * (col ? 1.22 : titan ? 1.08 : 1);
    F(ctx, body, function (c) { rr(c, -bwid / 2, -0.62, bwid, bhei, 0.34); });
    F(ctx, bodyDk, function (c) { rr(c, -bwid / 2 + 0.05, col ? 0.5 : 0.28, bwid - 0.1, 0.28, 0.14); });
    if (col) S(ctx, P.gold, 0.08, function (c) { rr(c, -bwid / 2, -0.62, bwid, bhei, 0.34); });
    if (titan) { // shoulders
      F(ctx, P.steelDk, function (c) { rr(c, -bwid / 2 - 0.22, -0.55, 0.42, 0.55, 0.14); });
      F(ctx, P.steelDk, function (c) { rr(c, bwid / 2 - 0.2, -0.55, 0.42, 0.55, 0.14); });
      F(ctx, P.hazard, function (c) { rr(c, -bwid / 2 - 0.14, -0.4, 0.26, 0.1, 0.03); });
      F(ctx, P.hazard, function (c) { rr(c, bwid / 2 - 0.12, -0.4, 0.26, 0.1, 0.03); });
      F(ctx, P.tealDk, function (c) { rr(c, -0.5, 0.38, 1.0, 0.14, 0.05); });
    }
    if (col) { // pauldrons, chest plate and emblem in gold
      F(ctx, P.steelDkr, function (c) { rr(c, -bwid / 2 - 0.5, -0.78, 0.7, 0.85, 0.2); rr(c, bwid / 2 - 0.2, -0.78, 0.7, 0.85, 0.2); });
      S(ctx, P.gold, 0.09, function (c) { rr(c, -bwid / 2 - 0.5, -0.78, 0.7, 0.85, 0.2); rr(c, bwid / 2 - 0.2, -0.78, 0.7, 0.85, 0.2); });
      F(ctx, P.gold, function (c) { rr(c, -bwid / 2 - 0.4, -0.5, 0.5, 0.12, 0.03); rr(c, bwid / 2 - 0.1, -0.5, 0.5, 0.12, 0.03); });
      if (mag) { // pinstripes + tie-shaped heat vent
        S(ctx, P.goldDk, 0.03, function (c) { for (var q = -5; q <= 5; q++) { if (q === 0) continue; c.moveTo(q * 0.11 * (bwid / 1.55), -0.06); c.lineTo(q * 0.11 * (bwid / 1.55), 0.5); } });
        F(ctx, P.gold, function (c) { poly(c, [-0.12, 0.0, 0.12, 0.0, 0.08, 0.13, -0.08, 0.13]); });
        F(ctx, P.ink, function (c) { poly(c, [-0.08, 0.14, 0.08, 0.14, 0.17, 0.42, 0, 0.56, -0.17, 0.42]); });
        S(ctx, oc ? P.white : P.hazard, 0.05, function (c) { c.moveTo(-0.08, 0.24); c.lineTo(0.08, 0.24); c.moveTo(-0.1, 0.33); c.lineTo(0.1, 0.33); c.moveTo(-0.05, 0.42); c.lineTo(0.05, 0.42); });
        S(ctx, P.gold, 0.05, function (c) { poly(c, [-0.08, 0.14, 0.08, 0.14, 0.17, 0.42, 0, 0.56, -0.17, 0.42]); });
      } else {
      F(ctx, P.goldDk, function (c) { rr(c, -0.6, 0.12, 1.2, 0.32, 0.08); });
      F(ctx, P.gold, function (c) { hex(c, 0, 0.28, 0.2, 0); });
      F(ctx, P.goldDk, function (c) { circle(c, 0, 0.28, 0.08); });
      }
    }
    // ---- visor
    var vw = 1.12 * (col ? 1.15 : K), vh = 0.7;
    F(ctx, P.ink, function (c) { rr(c, -vw / 2 + 0.05 + fx * 0.06, -0.5, vw, vh, 0.3); });
    if (col) S(ctx, P.gold, 0.07, function (c) { rr(c, -vw / 2 + 0.05 + fx * 0.06, -0.5, vw, vh, 0.3); });
    var ex = fx * 0.1 + (0.0), ey = -0.15;
    if (!blink) {
      var ec = hurt > 0.3 ? P.rustLt : P.arc;
      F(ctx, ec, function (c) { circle(c, ex, ey, 0.27); });
      F(ctx, P.white, function (c) { circle(c, ex + 0.07 + fx * 0.07, ey - 0.08, 0.1); });
    } else {
      S(ctx, P.arc, 0.1, function (c) { c.moveTo(ex - 0.25, ey); c.lineTo(ex + 0.25, ey); });
    }
    // ---- salvage: magnet antenna / horseshoe arm / hopper
    if (sa >= 1 || titan) {
      var side = bwid / 2;
      S(ctx, P.steelDk, 0.09, function (c) { c.moveTo(side - 0.05, -0.3); c.lineTo(side + 0.22, -0.7); });
      F(ctx, P.rust, function (c) { circle(c, side + 0.22, -0.74, 0.1); });
    }
    if (sa >= 2 || titan) { // horseshoe magnet arm
      var mx = bwid / 2 + 0.1, my = 0.12;
      S(ctx, P.steelDk, 0.1, function (c) { c.moveTo(mx - 0.1, my); c.lineTo(mx + 0.1, my); });
      S(ctx, P.rust, 0.2, function (c) { c.arc(mx + 0.25, my, 0.25, Math.PI * 0.5, Math.PI * 1.5, true); });
      F(ctx, P.steel, function (c) { c.rect(mx + 0.18, my - 0.37, 0.14, 0.1); c.rect(mx + 0.18, my + 0.27, 0.14, 0.1); });
    }
    if (sa >= 3 || titan) { // scrap hopper bin on the back shoulder
      var hx = -bwid / 2 - 0.12;
      F(ctx, P.steel, function (c) { hex(c, hx + 0.05, -0.98, 0.13, 0.3); });
      F(ctx, P.hazard, function (c) { hex(c, hx + 0.3, -0.92, 0.1, 0.1); });
      F(ctx, P.tealMid, function (c) { poly(c, [hx - 0.1, -0.9, hx + 0.5, -0.9, hx + 0.42, -0.42, hx - 0.02, -0.42]); });
      S(ctx, P.hazard, 0.06, function (c) { c.moveTo(hx - 0.02, -0.68); c.lineTo(hx + 0.46, -0.68); });
    }
    // ---- arc coil on top
    var cx = 0, cy = -0.62;
    var cg = P.arc;
    if (col) {
      F(ctx, P.goldDk, function (c) { rr(c, -0.9, cy - 0.06, 1.8, 0.2, 0.06); });
      coil(ctx, -0.8, cy, 1.15, 3, t, glow, oc, cg); coil(ctx, 0.8, cy, 1.15, 3, t + 1, glow, oc, cg);
      F(ctx, P.gold, function (c) { rr(c, -0.99, cy - 0.28, 0.38, 0.1, 0.03); rr(c, 0.61, cy - 0.28, 0.38, 0.1, 0.03); });
      F(ctx, P.gold, function (c) { poly(c, [-0.28, cy - 0.04, -0.2, cy - 0.34, -0.08, cy - 0.14, 0, cy - 0.42, 0.08, cy - 0.14, 0.2, cy - 0.34, 0.28, cy - 0.04]); });
    } else if (titan) { coil(ctx, -0.46, cy, 1.0, 3, t, glow, oc, cg); coil(ctx, 0.46, cy, 1.0, 3, t + 1, glow, oc, cg); }
    else coil(ctx, cx, cy, 0.7 + arc * 0.17, arc, t, glow, oc, cg);
    // oc heat glint
    if (oc) F(ctx, 'rgba(255,198,41,0.5)', function (c) { circle(c, -0.5, -0.1, 0.12); });
    ctx.restore();
  }

  function coil(ctx, x, y, s, tier, t, glow, oc, cg) {
    // mast
    var h = 0.22 + 0.075 * tier * s;
    F(ctx, P.steelDk, function (c) { rr(c, x - 0.1, y - 0.14, 0.2, 0.2, 0.04); });
    if (tier === 0) { // stub antenna
      S(ctx, P.steelDk, 0.07, function (c) { c.moveTo(x, y - 0.1); c.lineTo(x, y - 0.4); });
      F(ctx, P.steelDk, function (c) { circle(c, x, y - 0.44, 0.08); });
      return;
    }
    var w = 0.17 + 0.05 * tier;
    // windings
    var top = y - 0.12 - h;
    F(ctx, P.tealDk, function (c) { rr(c, x - w, top, w * 2, h, 0.06); });
    var n = 2 + tier;
    for (var i = 0; i < n; i++) {
      var yy = top + (i + 0.5) * h / n;
      S(ctx, tier >= 2 ? cg : P.hazard, 0.06, function (c) { c.moveTo(x - w, yy); c.lineTo(x + w, yy); });
    }
    // prongs
    if (tier >= 2) {
      S(ctx, P.steel, 0.07, function (c) { c.moveTo(x - w, top + 0.04); c.lineTo(x - w - 0.14, top - 0.18); c.moveTo(x + w, top + 0.04); c.lineTo(x + w + 0.14, top - 0.18); });
    }
    if (tier >= 3) S(ctx, P.steel, 0.07, function (c) { c.moveTo(x, top); c.lineTo(x, top - 0.28); });
    // glow orb
    var gr = 0.1 + 0.03 * tier + 0.06 * glow;
    var oy = top - (tier >= 3 ? 0.3 : 0.12);
    F(ctx, oc ? 'rgba(255,255,255,0.35)' : 'rgba(127,231,255,0.28)', function (c) { circle(c, x, oy, gr * 2); });
    F(ctx, cg, function (c) { circle(c, x, oy, gr); });
    F(ctx, P.white, function (c) { circle(c, x, oy, gr * 0.45); });
    if (tier >= 2 && (glow > 0.8)) {
      var a = t * 9;
      S(ctx, P.arc, 0.05, function (c) { c.moveTo(x - w - 0.14, top - 0.18); c.lineTo(x - 0.05 + sin(a) * 0.04, top - 0.3); c.lineTo(x + w + 0.14, top - 0.18); });
    }
  }

  // colour mix (hex strings) cached
  var mixCache = {};
  function mix(a, b, k) {
    k = Math.round(k * 20) / 20;
    var key = a + b + k, v = mixCache[key];
    if (v) return v;
    var A = pc(a), B = pc(b);
    v = 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * k) + ',' + Math.round(A[1] + (B[1] - A[1]) * k) + ',' + Math.round(A[2] + (B[2] - A[2]) * k) + ')';
    return mixCache[key] = v;
  }
  function pc(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

  // ============================================================ ENEMIES
  var FLASH = false, SILC = null, COPY = false;
  function cc(c) { return SILC || (FLASH ? fl(c) : (COPY && c.charAt(0) === '#' ? mix(c, '#7f929c', 0.5) : c)); }
  function fl(c) { return c.charAt(0) === '#' ? mix(c, '#ffffff', 0.85) : c; }
  function EF(ctx, color, fn) { ctx.beginPath(); fn(ctx); ctx.fillStyle = cc(color); ctx.fill(); }
  function ES(ctx, color, w, fn) { ctx.beginPath(); fn(ctx); ctx.strokeStyle = cc(color); ctx.lineWidth = w; ctx.stroke(); }
  function EYE(ctx, x, y, rad, col) {
    EF(ctx, FLASH ? '#fff' : P.ink, function (c) { circle(c, x, y, rad * 1.25); });
    EF(ctx, col, function (c) { circle(c, x, y, rad); });
    if (!FLASH) EF(ctx, P.white, function (c) { circle(c, x - rad * 0.3, y - rad * 0.3, rad * 0.35); });
  }

  var DRAW = {};

  DRAW.scrapling = function (ctx, e, t) {
    var a = e.age, sc = sin(a * 9) * 0.1;
    ES(ctx, P.steelDkr, 0.1, function (c) {
      for (var i = -1; i <= 1; i += 2) for (var j = 0; j < 2; j++) { c.moveTo(i * 0.4, 0.3 + j * 0.2); c.lineTo(i * (0.9 + (j ? sc : -sc)), 0.7 + j * 0.2); }
    });
    EF(ctx, P.steelDk, function (c) { poly(c, [-0.95, 0.55, -0.7, -0.1, -0.35, -0.55, 0.1, -0.8, 0.55, -0.4, 0.95, 0.1, 0.85, 0.6]); });
    EF(ctx, P.tealMid, function (c) { poly(c, [-0.85, 0.5, -0.62, -0.05, -0.3, -0.45, 0.1, -0.68, 0.5, -0.33, 0.82, 0.12, 0.74, 0.52]); });
    EF(ctx, P.tealDk, function (c) { poly(c, [-0.6, 0.5, -0.45, 0.0, -0.1, -0.35, 0.2, -0.1, 0.1, 0.5]); });
    EF(ctx, P.steelDk, function (c) { rr(c, 0.2, -0.5, 0.45, 0.22, 0.05); });
    EF(ctx, P.tealMid, function (c) { c.rect(-0.8, 0.15, 0.3, 0.14); });
    EYE(ctx, 0.12, 0.12, 0.2, '#6c8a68');
  };

  DRAW.roller = function (ctx, e, t) {
    var dir = (e.vx || 0) >= 0 ? 1 : -1, ang = e.age * 7 * dir;
    EF(ctx, P.tealDk, function (c) { circle(c, 0, 0, 1); });
    ES(ctx, P.steel, 0.2, function (c) { circle(c, 0, 0, 0.84); });
    ES(ctx, P.steelDk, 0.12, function (c) {
      for (var i = 0; i < 3; i++) { var a = ang + i * TAU / 3; c.moveTo(0, 0); c.lineTo(cos(a) * 0.8, sin(a) * 0.8); }
    });
    // tread nubs
    EF(ctx, P.hazard, function (c) { for (var i = 0; i < 6; i++) { var a = ang + i * TAU / 6; hex(c, cos(a) * 0.98, sin(a) * 0.98, 0.1, a); } });
    EF(ctx, P.steelDkr, function (c) { circle(c, 0, 0, 0.36); });
    EYE(ctx, 0, 0, 0.2, P.hazard);
  };

  DRAW.sparker = function (ctx, e, t) {
    var a = e.age;
    EF(ctx, P.rustDk, function (c) {
      var n = 8; for (var i = 0; i < n * 2; i++) { var ang = i * Math.PI / n + a * 1.5, rad = i % 2 ? 0.6 : 1.0; var px = cos(ang) * rad, py = sin(ang) * rad; if (i) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath();
    });
    EF(ctx, P.rust, function (c) { circle(c, 0, 0, 0.62); });
    ES(ctx, P.arc, 0.09, function (c) {
      var k = (a * 14) | 0; for (var i = 0; i < 2; i++) { var ang = (k * 1.7 + i * 3.1); c.moveTo(cos(ang) * 0.6, sin(ang) * 0.6); c.lineTo(cos(ang + 0.2) * 0.85, sin(ang + 0.2) * 0.85); c.lineTo(cos(ang - 0.1) * 1.05, sin(ang - 0.1) * 1.05); }
    });
    EF(ctx, P.ink, function (c) { rr(c, -0.4, -0.2, 0.8, 0.36, 0.1); });
    EF(ctx, P.hazard, function (c) { poly(c, [-0.32, -0.12, -0.05, -0.02, -0.32, 0.1]); poly(c, [0.32, -0.12, 0.05, -0.02, 0.32, 0.1]); });
  };

  DRAW.shieldbot = function (ctx, e, t) {
    var f = e.facing || 0;
    EF(ctx, P.tealDk, function (c) { rr(c, -0.85, -0.65, 1.7, 1.3, 0.3); });
    EF(ctx, P.tealMid, function (c) { rr(c, -0.7, -0.5, 1.4, 0.7, 0.2); });
    EYE(ctx, 0, -0.1, 0.22, P.arc);
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.75, 0.3, 0.5, 0.3, 0.08); rr(c, 0.25, 0.3, 0.5, 0.3, 0.08); });
    // front plate on facing side
    ctx.save(); ctx.rotate(f);
    EF(ctx, P.steel, function (c) { c.arc(0, 0, 1.1, -0.85, 0.85); c.arc(0, 0, 0.7, 0.85, -0.85, true); c.closePath(); });
    ES(ctx, P.hazard, 0.11, function (c) { c.arc(0, 0, 1.1, -0.85, 0.85); });
    EF(ctx, P.steelDkr, function (c) { circle(c, 0.9, -0.4, 0.07); circle(c, 0.9, 0.4, 0.07); circle(c, 1.0, 0, 0.07); });
    ctx.restore();
  };

  DRAW.hauler = function (ctx, e, t) {
    var sh = sin(e.age * 5) * 0.02;
    EF(ctx, P.steelDkr, function (c) { rr(c, -1, 0.38, 2, 0.6, 0.3); });
    ES(ctx, P.line, 0.07, function (c) { for (var i = -3; i <= 3; i++) { c.moveTo(i * 0.28, 0.46); c.lineTo(i * 0.28, 0.9); } });
    EF(ctx, P.tealDk, function (c) { rr(c, -0.95, -0.2, 1.9, 0.7, 0.12); });
    // cab
    EF(ctx, P.tealMid, function (c) { rr(c, 0.3, -0.62, 0.62, 0.55, 0.1); });
    EF(ctx, P.ink, function (c) { rr(c, 0.4, -0.54, 0.4, 0.26, 0.06); });
    EF(ctx, P.hazard, function (c) { circle(c, 0.62, -0.41, 0.09); });
    // loaded bin w/ scrap
    EF(ctx, P.plateHi, function (c) { poly(c, [-0.95, -0.15, -0.8, -0.55, 0.2, -0.55, 0.2, -0.15]); });
    EF(ctx, P.steelDk, function (c) { poly(c, [-0.8, -0.55, -0.55, -0.85 + sh, -0.3, -0.6, 0, -0.9 - sh, 0.2, -0.55]); });
    EF(ctx, P.steel, function (c) { hex(c, -0.45, -0.7, 0.14, 0.4); });
    EF(ctx, P.hazard, function (c) { hex(c, -0.05, -0.74, 0.12, 0.1); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.9, 0.05, 0.5, 0.12); });
  };

  DRAW.splitter = function (ctx, e, t) {
    var w = sin(e.age * 4) * 0.03;
    var pts = [[-0.5, 0.35 + w], [0.5, 0.35 - w], [0, -0.45]];
    ES(ctx, P.hazard, 0.12, function (c) { c.moveTo(-0.5, 0.35); c.lineTo(0.5, 0.35); c.lineTo(0, -0.45); c.closePath(); });
    for (var i = 0; i < 3; i++) {
      var px = pts[i][0], py = pts[i][1];
      EF(ctx, i === 2 ? P.tealMid : P.tealDk, function (c) { circle(c, px, py, 0.5); });
      ES(ctx, P.steel, 0.07, function (c) { circle(c, px, py, 0.5); });
      EYE(ctx, px, py, 0.14, i === 2 ? P.arc : P.steelDk);
    }
    EF(ctx, P.steel, function (c) { circle(c, 0, 0.35, 0.08); circle(c, -0.25, -0.05, 0.07); circle(c, 0.25, -0.05, 0.07); });
  };

  DRAW.mite = function (ctx, e, t) {
    var l = sin(e.age * 25) * 0.18;
    ES(ctx, P.steelDk, 0.14, function (c) {
      for (var i = -1; i <= 1; i += 2) for (var j = -1; j <= 1; j++) { c.moveTo(i * 0.3, j * 0.35); c.lineTo(i * (1.0 + l * j), j * 0.7 + l); }
    });
    EF(ctx, P.steel, function (c) { c.ellipse(0, 0, 0.62, 0.78, 0, 0, TAU); });
    EF(ctx, P.tealMid, function (c) { c.ellipse(0, 0.15, 0.4, 0.4, 0, 0, TAU); });
    EYE(ctx, 0, -0.25, 0.28, P.hazard);
  };

  DRAW.turret = function (ctx, e, t) {
    var f = e.facing || 0, pl = !!e.planted, sp = pl ? 1.05 : 0.6;
    ES(ctx, P.steelDkr, 0.17, function (c) {
      c.moveTo(0, 0); c.lineTo(-sp, 0.9); c.moveTo(0, 0); c.lineTo(sp, 0.9); c.moveTo(0, 0); c.lineTo(0, pl ? -1 : 0.95);
    });
    if (pl) EF(ctx, P.hazard, function (c) { c.rect(-sp - 0.15, 0.85, 0.3, 0.1); c.rect(sp - 0.15, 0.85, 0.3, 0.1); });
    EF(ctx, P.tealDk, function (c) { circle(c, 0, 0, 0.62); });
    ctx.save(); ctx.rotate(f);
    EF(ctx, P.rustDk, function (c) { rr(c, 0.15, -0.2, 1.0, 0.4, 0.08); });
    EF(ctx, P.rust, function (c) { rr(c, 1.0, -0.26, 0.22, 0.52, 0.05); });
    EF(ctx, P.ink, function (c) { circle(c, 1.22, 0, 0.1); });
    ctx.restore();
    EF(ctx, P.steelDk, function (c) { circle(c, 0, 0, 0.48); });
    EYE(ctx, cos(f) * 0.14, sin(f) * 0.14, 0.2, pl ? P.rustLt : P.hazard);
  };

  DRAW.bomber = function (ctx, e, t) {
    var rate = 5 + Math.min(10, e.age * 1.2), on = sin(e.age * rate * 2) > 0;
    ES(ctx, P.steel, 0.1, function (c) { c.moveTo(0.1, -0.85); c.quadraticCurveTo(0.4, -1.1, 0.7, -0.95); });
    EF(ctx, P.rustDk, function (c) { circle(c, 0, 0.1, 0.9); });
    EF(ctx, P.rust, function (c) { circle(c, -0.1, 0.0, 0.7); });
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.2, -1.0, 0.45, 0.28, 0.06); });
    if (on) { EF(ctx, 'rgba(255,198,41,0.4)', function (c) { circle(c, 0.7, -0.95, 0.4); }); }
    EF(ctx, on ? P.hazard : P.rustDk, function (c) { circle(c, 0.7, -0.95, 0.17); });
    EF(ctx, P.ink, function (c) { poly(c, [-0.55, 0.0, -0.1, 0.1, -0.55, 0.2]); poly(c, [0.45, 0.0, 0.1, 0.1, 0.45, 0.2]); });
    EF(ctx, P.hazard, function (c) { poly(c, [-0.45, 0.04, -0.2, 0.1, -0.45, 0.14]); poly(c, [0.35, 0.04, 0.2, 0.1, 0.35, 0.14]); });
    ES(ctx, P.hazard, 0.1, function (c) { c.moveTo(-0.4, 0.55); c.lineTo(-0.2, 0.45); c.lineTo(0, 0.55); c.lineTo(0.2, 0.45); c.lineTo(0.4, 0.55); });
  };

  DRAW.gilded = function (ctx, e, t) {
    var g = (e.age * 2.3) % 1;
    EF(ctx, P.goldDk, function (c) { rr(c, -0.95, -0.7, 1.9, 1.5, 0.45); });
    EF(ctx, P.gold, function (c) { rr(c, -0.85, -0.82, 1.7, 1.3, 0.4); });
    EF(ctx, P.goldLt, function (c) { rr(c, -0.6, -0.7, 0.9, 0.22, 0.1); });
    EF(ctx, P.goldDk, function (c) { rr(c, -0.55, -0.35, 1.1, 0.55, 0.22); });
    EYE(ctx, 0, -0.08, 0.2, P.white);
    EF(ctx, P.goldDk, function (c) { rr(c, -0.8, 0.5, 0.5, 0.3, 0.1); rr(c, 0.3, 0.5, 0.5, 0.3, 0.1); });
    // glints
    var k = 0.3 + 0.7 * abs(sin(e.age * 6)), gx = 0.7, gy = -0.8;
    EF(ctx, P.white, function (c) { poly(c, [gx, gy - 0.5 * k, gx + 0.1, gy - 0.1, gx + 0.5 * k, gy, gx + 0.1, gy + 0.1, gx, gy + 0.5 * k, gx - 0.1, gy + 0.1, gx - 0.5 * k, gy, gx - 0.1, gy - 0.1]); });
    if (g < 0.5) { var q = 1 - abs(g - 0.25) * 4; EF(ctx, P.white, function (c) { circle(c, -0.7, 0.3, 0.1 * q); circle(c, -0.2, -0.9, 0.08 * q); }); }
  };

  DRAW.pylon = function (ctx, e, t) {
    var p = 0.5 + 0.5 * sin(e.age * 4);
    EF(ctx, P.steelDkr, function (c) { poly(c, [-0.9, 0.95, -0.55, 0.55, 0.55, 0.55, 0.9, 0.95]); });
    EF(ctx, P.tealDk, function (c) { rr(c, -0.32, -0.55, 0.64, 1.15, 0.12); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.32, 0.1, 0.64, 0.14); });
    EF(ctx, P.tealMid, function (c) { rr(c, -0.5, -0.8, 1.0, 0.3, 0.1); });
    EF(ctx, 'rgba(127,231,255,' + (0.2 + 0.2 * p) + ')', function (c) { circle(c, 0, -1.0, 0.55); });
    EF(ctx, P.arc, function (c) { circle(c, 0, -1.0, 0.3); });
    EF(ctx, P.white, function (c) { circle(c, 0, -1.0, 0.12); });
    ES(ctx, P.arc, 0.07, function (c) { c.ellipse(0, -0.65, 0.8, 0.2, 0, 0, TAU); });
  };

  // ------------------------------------------------------------ WARDENS
  DRAW.compactor = function (ctx, e, t) {
    var w = e.windup || 0, lift = 0.05 + 0.3 * w, a = e.age;
    // pistons
    EF(ctx, P.steelDkr, function (c) { c.rect(-0.86, -1.0 - lift, 0.14, 0.5 + lift); c.rect(0.72, -1.0 - lift, 0.14, 0.5 + lift); c.rect(-0.86, 0.5, 0.14, 0.5 + lift); c.rect(0.72, 0.5, 0.14, 0.5 + lift); });
    // cab
    EF(ctx, P.rustDk, function (c) { rr(c, -0.75, -0.55, 1.5, 1.1, 0.14); });
    EF(ctx, P.rust, function (c) { rr(c, -0.65, -0.45, 1.3, 0.5, 0.1); });
    EF(ctx, P.ink, function (c) { rr(c, -0.5, -0.32, 1.0, 0.3, 0.08); });
    EF(ctx, w > 0.3 ? P.white : P.hazard, function (c) { rr(c, -0.42, -0.24, 0.3, 0.14, 0.04); rr(c, 0.12, -0.24, 0.3, 0.14, 0.04); });
    EF(ctx, P.hazard, function (c) { for (var i = -2; i <= 2; i++) poly(c, [i * 0.25 - 0.1, 0.5, i * 0.25 + 0.05, 0.5, i * 0.25 + 0.15, 0.3, i * 0.25, 0.3]); });
    // jaws
    EF(ctx, P.steel, function (c) { rr(c, -1.05, -1.0 - lift, 2.1, 0.38, 0.06); });
    EF(ctx, P.steel, function (c) { rr(c, -1.05, 0.62 + lift, 2.1, 0.38, 0.06); });
    EF(ctx, P.steelDk, function (c) { for (var i = 0; i < 5; i++) { var x = -0.9 + i * 0.42; poly(c, [x, -0.62 - lift, x + 0.3, -0.62 - lift, x + 0.15, -0.38 - lift * 0.4]); poly(c, [x, 0.62 + lift, x + 0.3, 0.62 + lift, x + 0.15, 0.38 + lift * 0.4]); } });
    EF(ctx, P.hazard, function (c) { c.rect(-1.0, -0.96 - lift, 0.5, 0.1); c.rect(0.5, -0.96 - lift, 0.5, 0.1); });
  };

  DRAW.shredder = function (ctx, e, t) {
    var w = e.windup || 0, spin = e.age * (3 + w * 10);
    EF(ctx, P.rustDk, function (c) { circle(c, 0, 0, 1.08); });
    EF(ctx, P.ink, function (c) { circle(c, 0, 0, 0.95); });
    ctx.save(); ctx.rotate(spin);
    EF(ctx, P.steel, function (c) {
      for (var i = 0; i < 12; i++) { var a = i * TAU / 12; poly(c, [cos(a - 0.14) * 0.78, sin(a - 0.14) * 0.78, cos(a + 0.1) * 0.78, sin(a + 0.1) * 0.78, cos(a + 0.16) * 1.1, sin(a + 0.16) * 1.1]); }
    });
    EF(ctx, P.steelDk, function (c) { circle(c, 0, 0, 0.8); });
    ES(ctx, P.steelDkr, 0.1, function (c) { for (var i = 0; i < 4; i++) { var a = i * TAU / 4; c.moveTo(cos(a) * 0.25, sin(a) * 0.25); c.lineTo(cos(a) * 0.78, sin(a) * 0.78); } });
    ctx.restore();
    EF(ctx, P.rust, function (c) { circle(c, 0, 0, 0.36); });
    EYE(ctx, 0, 0, 0.2, w > 0.3 ? P.white : P.hazard);
    ES(ctx, P.rust, 0.1, function (c) { c.arc(0, 0, 1.12, -2.6, -0.5); });
  };

  DRAW.furnace = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age, heat = 0.5 + 0.2 * sin(a * 3) + 0.5 * w;
    // stacks + smoke
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.7, -1.15, 0.28, 0.6, 0.05); rr(c, 0.42, -1.15, 0.28, 0.6, 0.05); });
    EF(ctx, 'rgba(147,173,185,0.35)', function (c) { circle(c, -0.56 + sin(a * 2) * 0.1, -1.3 - ((a * 0.6) % 0.4), 0.18); circle(c, 0.56 + sin(a * 2 + 1) * 0.1, -1.3 - ((a * 0.6 + 0.2) % 0.4), 0.15); });
    EF(ctx, P.rustDk, function (c) { circle(c, 0, 0.05, 1.0); });
    EF(ctx, P.rust, function (c) { c.arc(0, 0.05, 0.9, Math.PI * 1.05, Math.PI * 1.95); c.closePath(); });
    // vents
    EF(ctx, P.ink, function (c) { for (var i = -1; i <= 1; i++) rr(c, i * 0.3 - 0.1, -0.62, 0.2, 0.26, 0.04); });
    EF(ctx, 'rgba(255,198,41,' + (0.3 + heat * 0.5) + ')', function (c) { for (var i = -1; i <= 1; i++) c.rect(i * 0.3 - 0.06, -0.58, 0.12, 0.18); });
    // eyes
    EF(ctx, P.ink, function (c) { rr(c, -0.55, -0.28, 1.1, 0.24, 0.1); });
    EF(ctx, P.hazard, function (c) { circle(c, -0.25, -0.16, 0.08); circle(c, 0.25, -0.16, 0.08); });
    // molten belly
    EF(ctx, P.ink, function (c) { circle(c, 0, 0.45, 0.5); });
    EF(ctx, P.rust, function (c) { circle(c, 0, 0.45, 0.43 + 0.05 * heat); });
    EF(ctx, P.hazard, function (c) { circle(c, 0, 0.45, 0.28 * (0.6 + heat * 0.5)); });
    EF(ctx, P.goldLt, function (c) { circle(c, 0, 0.45, 0.12 * (0.5 + heat)); });
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.85, 0.82, 0.5, 0.24, 0.06); rr(c, 0.35, 0.82, 0.5, 0.24, 0.06); });
  };

  DRAW.foreman = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age, sir = (sin(a * (4 + w * 14)) > 0);
    // clipboard arm (left of unit)
    var up = w * 0.3;
    ES(ctx, P.steelDkr, 0.18, function (c) { c.moveTo(-0.55, 0.0); c.lineTo(-0.95, 0.15 - up); });
    EF(ctx, P.steel, function (c) { rr(c, -1.3, -0.35 - up, 0.62, 0.8, 0.05); });
    EF(ctx, P.plate, function (c) { c.rect(-1.24, -0.22 - up, 0.5, 0.64); });
    ES(ctx, P.hazard, 0.06, function (c) { for (var i = 0; i < 4; i++) { c.moveTo(-1.18, -0.12 - up + i * 0.14); c.lineTo(-0.8 - (i === 3 ? 0.18 : 0), -0.12 - up + i * 0.14); } });
    // other arm
    ES(ctx, P.steelDkr, 0.18, function (c) { c.moveTo(0.55, 0.0); c.lineTo(0.95, 0.35); });
    EF(ctx, P.rust, function (c) { circle(c, 0.98, 0.4, 0.17); });
    // body
    EF(ctx, P.tealDk, function (c) { rr(c, -0.65, -0.2, 1.3, 1.0, 0.2); });
    EF(ctx, P.hazard, function (c) { poly(c, [-0.65, 0.5, -0.3, 0.5, -0.5, 0.8, -0.65, 0.8]); poly(c, [-0.05, 0.5, 0.3, 0.5, 0.1, 0.8, -0.25, 0.8]); });
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.5, 0.82, 0.35, 0.2, 0.05); rr(c, 0.15, 0.82, 0.35, 0.2, 0.05); });
    // head + visor
    EF(ctx, P.steelDk, function (c) { rr(c, -0.5, -0.55, 1.0, 0.5, 0.18); });
    EF(ctx, P.ink, function (c) { rr(c, -0.4, -0.45, 0.8, 0.28, 0.1); });
    EF(ctx, P.rust, function (c) { circle(c, -0.2, -0.31, 0.09); circle(c, 0.2, -0.31, 0.09); });
    // hard hat
    EF(ctx, P.hazard, function (c) { c.arc(0, -0.55, 0.62, Math.PI, 0); c.closePath(); });
    EF(ctx, P.hazard, function (c) { rr(c, -0.8, -0.58, 1.6, 0.14, 0.05); });
    EF(ctx, P.goldDk, function (c) { c.rect(-0.07, -1.17, 0.14, 0.6); });
    // siren
    EF(ctx, sir ? 'rgba(232,100,44,0.5)' : 'rgba(0,0,0,0)', function (c) { circle(c, 0, -1.2, 0.42); });
    EF(ctx, sir ? P.rustLt : P.rustDk, function (c) { rr(c, -0.14, -1.35, 0.28, 0.2, 0.08); });
  };

  DRAW.overseer = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age;
    // crane arms
    for (var i = 0; i < 4; i++) {
      var sd = i % 2 ? 1 : -1, up = i < 2 ? -1 : 1, ph = sin(a * 1.3 + i * 1.7) * 0.15 - w * 0.2;
      var jx = sd * 1.0, jy = up * 0.5 + ph, ex = sd * 1.35, ey = up * (1.0 + ph);
      ES(ctx, P.steelDkr, 0.22, function (c) { c.moveTo(sd * 0.7, up * 0.3); c.lineTo(jx, jy); c.lineTo(ex, ey); });
      ES(ctx, P.steel, 0.08, function (c) { c.moveTo(sd * 0.7, up * 0.3); c.lineTo(jx, jy); c.lineTo(ex, ey); });
      EF(ctx, P.rust, function (c) { circle(c, jx, jy, 0.12); poly(c, [ex, ey, ex + sd * 0.25, ey + up * 0.0 - 0.14, ex + sd * 0.25, ey + 0.14]); });
    }
    // core body
    EF(ctx, P.coreDk, function (c) { circle(c, 0, 0, 0.98); });
    EF(ctx, P.ink, function (c) { circle(c, 0, 0, 0.84); });
    ES(ctx, P.core, 0.07, function (c) { circle(c, 0, 0, 0.9); });
    // small eyes ring
    for (var j = 0; j < 8; j++) {
      var an = j * TAU / 8 + a * 0.3, on = sin(a * 2 + j * 2.1) > -0.3;
      EF(ctx, on ? P.core : P.coreDk, function (c) { circle(c, cos(an) * 0.62, sin(an) * 0.62, 0.1); });
    }
    // big eye
    var lx = cos(e.facing || 0) * 0.08, ly = sin(e.facing || 0) * 0.08;
    EF(ctx, P.rustDk, function (c) { circle(c, 0, 0, 0.36); });
    EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, 0, 0, 0.28); });
    EF(ctx, P.ink, function (c) { rr(c, lx - 0.06, ly - 0.2, 0.12, 0.4, 0.05); });
    // crown
    EF(ctx, P.steelDk, function (c) { poly(c, [-0.3, -0.92, -0.15, -1.2, 0, -0.95, 0.15, -1.2, 0.3, -0.92]); });
    EF(ctx, P.hazard, function (c) { circle(c, 0, -1.02, 0.07); });
  };

  // ------------------------------------------------------------ ACT II BOTS
  var SACK = '#8a6a3a', SACKDK = '#5e4724', LEATHER = '#16282f';

  DRAW.repo = function (ctx, e, t) {
    var a = e.age || 0, dir = (e.vx || 0) >= 0 ? 1 : -1, bump = sin(a * 14) * 0.03;
    ctx.scale(dir, 1);
    ctx.translate(0, bump);
    // wheels
    EF(ctx, P.ink, function (c) { circle(c, -0.6, 0.62, 0.36); circle(c, 0.62, 0.62, 0.36); });
    EF(ctx, P.steelDk, function (c) { circle(c, -0.6, 0.62, 0.16); circle(c, 0.62, 0.62, 0.16); });
    // tow boom + hook at the back
    ES(ctx, P.steelDkr, 0.22, function (c) { c.moveTo(-0.85, 0.1); c.lineTo(-1.15, -0.8); });
    ES(ctx, P.steel, 0.05, function (c) { c.moveTo(-1.15, -0.8); c.lineTo(-1.15, -0.4); });
    ES(ctx, P.hazard, 0.12, function (c) { c.arc(-1.05, -0.32, 0.1, Math.PI, Math.PI * 0.25, true); });
    // body + cab
    EF(ctx, P.rustDk, function (c) { rr(c, -1.0, -0.05, 2.0, 0.78, 0.14); });
    EF(ctx, P.rust, function (c) { rr(c, -0.92, -0.05, 1.84, 0.5, 0.12); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.95, 0.5, 1.2, 0.12); });
    EF(ctx, P.rust, function (c) { rr(c, 0.05, -0.7, 0.9, 0.7, 0.14); });
    EF(ctx, P.ink, function (c) { rr(c, 0.2, -0.6, 0.6, 0.4, 0.08); });
    EYE(ctx, 0.5, -0.4, 0.16, P.hazard);
    // front claw
    ES(ctx, P.steel, 0.12, function (c) { c.moveTo(0.95, 0.35); c.lineTo(1.3, 0.35); c.lineTo(1.3, 0.05); });
    // beacon
    var on = sin(a * 12) > 0;
    EF(ctx, on ? P.hazard : P.rustDk, function (c) { rr(c, 0.4, -0.88, 0.2, 0.18, 0.06); });
    if (e.stolen > 0) {
      var sw = sin(a * 14) * 0.04;
      EF(ctx, SACKDK, function (c) { circle(c, -0.3, -0.5 + sw, 0.62); poly(c, [-0.5, -1.05, -0.1, -1.05, -0.3, -0.75]); });
      EF(ctx, SACK, function (c) { circle(c, -0.34, -0.55 + sw, 0.52); });
      ES(ctx, P.steelDk, 0.1, function (c) { c.moveTo(-0.5, -1.0); c.lineTo(-0.1, -1.0); });
      EF(ctx, P.hazard, function (c) { hex(c, -0.34, -0.5 + sw, 0.24, 0.3); });
      EF(ctx, SACKDK, function (c) { circle(c, -0.34, -0.5 + sw, 0.09); });
      EF(ctx, P.steel, function (c) { hex(c, -0.78, -0.95, 0.1, 0.2); hex(c, 0.0, -0.98, 0.09, 0.5); });
    }
  };

  DRAW.printer = function (ctx, e, t) {
    var a = e.age || 0, ph = a % 4, hot = ph < 0.5 || ph > 3.5, nx = sin(a * 2.2) * 0.42;
    // pallet feet
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.0, 0.78, 2.0, 0.24, 0.05); });
    EF(ctx, P.ink, function (c) { c.rect(-0.7, 0.8, 0.14, 0.2); c.rect(-0.07, 0.8, 0.14, 0.2); c.rect(0.56, 0.8, 0.14, 0.2); });
    // hopper
    EF(ctx, P.steelDk, function (c) { poly(c, [-0.45, -0.72, 0.45, -0.72, 0.25, -1.05, -0.25, -1.05]); });
    EF(ctx, hot ? P.hazard : P.rustDk, function (c) { circle(c, 0.0, -0.9, 0.09); });
    // frame
    EF(ctx, P.tealDk, function (c) { rr(c, -0.92, -0.78, 1.84, 1.6, 0.1); });
    ES(ctx, P.steelDk, 0.08, function (c) { rr(c, -0.92, -0.78, 1.84, 1.6, 0.1); });
    // print window
    EF(ctx, P.ink, function (c) { rr(c, -0.68, -0.58, 1.36, 0.78, 0.06); });
    ES(ctx, P.steelDkr, 0.07, function (c) { c.moveTo(-0.68, -0.38); c.lineTo(0.68, -0.38); });
    EF(ctx, P.hazard, function (c) { poly(c, [nx - 0.12, -0.42, nx + 0.12, -0.42, nx, -0.16]); });
    if (hot) EF(ctx, 'rgba(255,198,41,0.5)', function (c) { circle(c, nx, -0.16, 0.2); });
    // part being printed (a little mite body)
    EF(ctx, P.steelDk, function (c) { rr(c, -0.28, 0.0, 0.56, 0.2, 0.06); });
    ES(ctx, P.hazard, 0.04, function (c) { c.moveTo(-0.26, 0.06); c.lineTo(0.26, 0.06); c.moveTo(-0.26, 0.13); c.lineTo(0.26, 0.13); });
    // armor plate (always: armor 0.5)
    EF(ctx, P.steel, function (c) { rr(c, -1.0, 0.24, 2.0, 0.56, 0.1); });
    ES(ctx, P.hazard, 0.09, function (c) { rr(c, -1.0, 0.24, 2.0, 0.56, 0.1); });
    EF(ctx, P.steelDkr, function (c) { circle(c, -0.82, 0.36, 0.06); circle(c, 0.82, 0.36, 0.06); circle(c, -0.82, 0.68, 0.06); circle(c, 0.82, 0.68, 0.06); });
    EF(ctx, P.hazard, function (c) { for (var i = -1; i <= 1; i++) poly(c, [i * 0.5 - 0.16, 0.74, i * 0.5 - 0.02, 0.74, i * 0.5 + 0.12, 0.3, i * 0.5 - 0.02, 0.3]); });
  };

  DRAW.laser = function (ctx, e, t) {
    var a = e.age || 0, f = e.facing || 0, pl = !!e.planted;
    EF(ctx, P.shadow, function (c) { c.ellipse(0, 1.05, 0.7, 0.14, 0, 0, TAU); });
    if (pl) ES(ctx, 'rgba(232,100,44,0.55)', 0.07, function (c) { c.moveTo(cos(f) * 1.3, sin(f) * 1.3); c.lineTo(cos(f) * 2.7, sin(f) * 2.7); });
    ctx.rotate(f);
    // rotors
    var sp = a * 40;
    ES(ctx, P.steelDk, 0.06, function (c) { circle(c, -0.62, -0.78, 0.3); circle(c, -0.62, 0.78, 0.3); });
    ES(ctx, P.steel, 0.1, function (c) {
      for (var i = -1; i <= 1; i += 2) { var q = sp * i; c.moveTo(-0.62 + cos(q) * 0.3, i * 0.78 + sin(q) * 0.3); c.lineTo(-0.62 - cos(q) * 0.3, i * 0.78 - sin(q) * 0.3); }
    });
    ES(ctx, P.steelDkr, 0.1, function (c) { c.moveTo(-0.3, -0.2); c.lineTo(-0.62, -0.78); c.moveTo(-0.3, 0.2); c.lineTo(-0.62, 0.78); });
    // delta body
    EF(ctx, P.rustDk, function (c) { poly(c, [1.2, 0, -0.55, -0.7, -0.25, 0, -0.55, 0.7]); });
    EF(ctx, P.rust, function (c) { poly(c, [0.95, 0, -0.4, -0.52, -0.12, 0, -0.4, 0.52]); });
    EF(ctx, P.ink, function (c) { circle(c, 0.3, 0, 0.36); });
    EF(ctx, pl ? P.white : P.rustLt, function (c) { circle(c, 0.3, 0, 0.24); });
    EF(ctx, P.rust, function (c) { circle(c, 0.3, 0, 0.1); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.5, -0.06, 0.28, 0.12); });
  };

  DRAW.firenode = function (ctx, e, t) {
    var a = e.age || 0, fl2 = 0.5 + 0.5 * sin(a * 9);
    // aura
    EF(ctx, 'rgba(127,231,255,0.10)', function (c) { circle(c, 0, 0, 1.28); });
    ES(ctx, P.arc, 0.08, function (c) { for (var i = 0; i < 8; i++) { var s = a * 0.8 + i * TAU / 8; c.moveTo(cos(s) * 1.28, sin(s) * 1.28); c.arc(0, 0, 1.28, s, s + 0.45); } });
    // base
    EF(ctx, P.steelDkr, function (c) { poly(c, [-0.8, 0.9, -0.55, 0.6, 0.55, 0.6, 0.8, 0.9]); });
    // brick pillar
    EF(ctx, P.tealMid, function (c) { rr(c, -0.55, -0.45, 1.1, 1.1, 0.06); });
    ES(ctx, P.ink, 0.06, function (c) {
      for (var i = 1; i < 4; i++) { var y = -0.45 + i * 0.275; c.moveTo(-0.55, y); c.lineTo(0.55, y); }
      for (var j = 0; j < 4; j++) { var yy = -0.45 + j * 0.275; for (var k = 0; k < 2; k++) { var x = -0.55 + (k + 0.5 + (j % 2) * 0.5) * 0.37 + (j % 2 ? 0 : 0.0); if (x > -0.55 && x < 0.55) { c.moveTo(x, yy); c.lineTo(x, yy + 0.275); } } }
    });
    EF(ctx, P.hazard, function (c) { c.rect(-0.6, -0.55, 1.2, 0.14); });
    // flame emitter
    var h = 0.55 + 0.2 * fl2;
    EF(ctx, P.arcDk, function (c) { c.moveTo(0, -0.55 - h - 0.15); c.quadraticCurveTo(0.5, -0.8, 0.32, -0.55); c.lineTo(-0.32, -0.55); c.quadraticCurveTo(-0.5, -0.8, 0, -0.55 - h - 0.15); });
    EF(ctx, P.arc, function (c) { c.moveTo(0, -0.55 - h + 0.05); c.quadraticCurveTo(0.3, -0.78, 0.2, -0.55); c.lineTo(-0.2, -0.55); c.quadraticCurveTo(-0.3, -0.78, 0, -0.55 - h + 0.05); });
    EF(ctx, P.white, function (c) { circle(c, 0, -0.68, 0.1); });
  };

  DRAW.auditor = function (ctx, e, t) {
    var a = e.age || 0, hv = sin(a * 3) * 0.05;
    EF(ctx, P.shadow, function (c) { c.ellipse(0, 1.05, 0.55, 0.12, 0, 0, TAU); });
    ctx.translate(0, hv);
    // clipboard
    EF(ctx, P.steel, function (c) { rr(c, -1.05, -0.05, 0.46, 0.62, 0.05); });
    EF(ctx, P.plate, function (c) { c.rect(-1.0, 0.05, 0.36, 0.46); });
    ES(ctx, P.hazard, 0.05, function (c) { c.moveTo(-0.95, 0.15); c.lineTo(-0.7, 0.15); c.moveTo(-0.95, 0.27); c.lineTo(-0.7, 0.27); c.moveTo(-0.95, 0.39); c.lineTo(-0.8, 0.39); });
    // suit body
    EF(ctx, P.tealDk, function (c) { poly(c, [-0.62, -0.1, 0.62, -0.1, 0.46, 0.9, -0.46, 0.9]); });
    EF(ctx, P.steel, function (c) { poly(c, [-0.2, -0.1, 0.2, -0.1, 0, 0.35]); });
    EF(ctx, P.rust, function (c) { poly(c, [0, 0.0, 0.1, 0.15, 0.06, 0.65, 0, 0.78, -0.06, 0.65, -0.1, 0.15]); });
    // stamp arm (raised)
    var up = sin(a * 3 + 1) * 0.06;
    ES(ctx, P.steelDkr, 0.17, function (c) { c.moveTo(0.55, 0.05); c.lineTo(0.95, -0.35 + up); });
    ES(ctx, P.steel, 0.12, function (c) { c.moveTo(0.95, -0.35 + up); c.lineTo(0.95, -0.85 + up); });
    EF(ctx, P.rust, function (c) { rr(c, 0.62, -1.1 + up, 0.66, 0.3, 0.06); });
    EF(ctx, P.rustDk, function (c) { c.rect(0.66, -0.86 + up, 0.58, 0.07); });
    // head
    EF(ctx, P.steelDk, function (c) { rr(c, -0.52, -0.92, 1.04, 0.74, 0.18); });
    EF(ctx, P.ink, function (c) { rr(c, -0.42, -0.82, 0.84, 0.5, 0.12); });
    EF(ctx, P.rustLt, function (c) { circle(c, -0.2, -0.57, 0.08); });
    ES(ctx, P.hazard, 0.1, function (c) { circle(c, 0.16, -0.57, 0.27); });
    EF(ctx, P.rust, function (c) { circle(c, 0.16, -0.57, 0.14); });
    EF(ctx, 'rgba(255,198,41,0.18)', function (c) { circle(c, 0.16, -0.57, 0.25); });
  };

  DRAW.mimic = function (ctx, e, t) {
    var a = e.age || 0;
    if (e.disguised) {
      // a bolt pickup (value >= 10) at 1.3x: same layers, slow wobble, one tell (the eye slit in the hole)
      var k = 1.3 / (e.r || 10), big = 6.2;
      ctx.scale(k, k);
      ctx.rotate(sin(a * 1.1) * 0.35);
      ctx.scale(1, 0.9 + 0.1 * cos(a * 1.9));
      EF(ctx, 'rgba(255,198,41,0.10)', function (c) { circle(c, 0, 0, big + 1.6); });
      EF(ctx, P.steelDk, function (c) { hex(c, 0, 0, big, 0); });
      EF(ctx, P.steel, function (c) { hex(c, -0.2, -0.3, big * 0.82, 0); });
      EF(ctx, P.floor, function (c) { circle(c, 0, 0, big * 0.36); });
      EF(ctx, P.hazard, function (c) { c.moveTo(big * 0.2, -big * 0.95); c.lineTo(big * 0.82, -big * 0.5); c.lineTo(big * 0.55, -big * 0.38); c.lineTo(big * 0.15, -big * 0.7); c.closePath(); });
      var ph = (a + 0.4) % 2.7;
      if (ph < 0.32) {
        EF(ctx, P.rust, function (c) { rr(c, -1.5, -0.55, 3.0, 1.1, 0.55); });
        EF(ctx, P.hazard, function (c) { c.rect(-0.25, -0.45, 0.5, 0.9); });
      } else if (ph < 0.42) {
        EF(ctx, P.rustDk, function (c) { c.rect(-1.5, -0.2, 3.0, 0.4); });
      }
      return;
    }
    var open = 0.5 + 0.5 * sin(a * 9), ry = 0.14 + 0.2 * open, my = 0.32;
    ES(ctx, P.steelDkr, 0.16, function (c) {
      for (var i = -1; i <= 1; i += 2) { var s = sin(a * 14 + i) * 0.12; c.moveTo(i * 0.55, 0.7); c.lineTo(i * 0.9, 1.0 + s); c.moveTo(i * 0.25, 0.8); c.lineTo(i * 0.38, 1.12 - s); }
    });
    EF(ctx, P.rustDk, function (c) { hex(c, 0, -0.05, 1.05, 0); });
    EF(ctx, P.rust, function (c) { hex(c, 0, -0.1, 0.88, 0); });
    EF(ctx, P.ink, function (c) { c.ellipse(0, my, 0.7, ry, 0, 0, TAU); });
    EF(ctx, P.white, function (c) {
      for (var i = 0; i < 4; i++) { var x = -0.5 + i * 0.33; poly(c, [x - 0.12, my - ry + 0.02, x + 0.12, my - ry + 0.02, x, my - ry + 0.26]); }
      for (var j = 0; j < 3; j++) { var x2 = -0.33 + j * 0.33; poly(c, [x2 - 0.11, my + ry - 0.02, x2 + 0.11, my + ry - 0.02, x2, my + ry - 0.24]); }
    });
    EYE(ctx, -0.36, -0.45, 0.2, P.hazard);
    EYE(ctx, 0.36, -0.45, 0.2, P.hazard);
    ES(ctx, P.ink, 0.1, function (c) { c.moveTo(-0.62, -0.78); c.lineTo(-0.12, -0.62); c.moveTo(0.62, -0.78); c.lineTo(0.12, -0.62); });
  };

  // ------------------------------------------------------------ ACT II WARDENS
  DRAW.forklift = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, dir = (e.vx || 0) >= 0 ? 1 : -1, lift = 0.1 + 0.5 * w;
    ctx.scale(dir, 1);
    // exhaust
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.98, -1.25, 0.14, 0.8, 0.04); });
    EF(ctx, 'rgba(147,173,185,0.35)', function (c) { circle(c, -0.92 + sin(a * 2) * 0.1, -1.35 - ((a * 0.7) % 0.4), 0.16); });
    // mast + forks
    EF(ctx, P.steelDkr, function (c) { rr(c, 0.98, -1.05, 0.16, 2.0, 0.04); rr(c, 1.16, -1.05, 0.1, 2.0, 0.03); });
    EF(ctx, P.steel, function (c) { rr(c, 1.02, 0.55 - lift, 0.92, 0.14, 0.03); rr(c, 1.02, 0.78 - lift, 0.92, 0.12, 0.03); });
    EF(ctx, P.rust, function (c) { poly(c, [1.7, 0.55 - lift, 1.98, 0.62 - lift, 1.7, 0.69 - lift]); });
    // counterweight + body
    EF(ctx, P.rustDk, function (c) { rr(c, -1.2, -0.1, 0.55, 1.0, 0.1); });
    EF(ctx, P.hazard, function (c) { rr(c, -0.75, -0.12, 1.75, 1.0, 0.14); });
    EF(ctx, P.ink, function (c) { for (var i = 0; i < 4; i++) poly(c, [-0.55 + i * 0.4, 0.62, -0.38 + i * 0.4, 0.62, -0.18 + i * 0.4, 0.86, -0.35 + i * 0.4, 0.86]); });
    // wheels
    EF(ctx, P.ink, function (c) { circle(c, -0.4, 0.82, 0.46); circle(c, 0.68, 0.88, 0.34); });
    EF(ctx, P.steelDk, function (c) { circle(c, -0.4, 0.82, 0.2); circle(c, 0.68, 0.88, 0.15); });
    // cage + driver
    ES(ctx, P.steelDkr, 0.1, function (c) { c.moveTo(-0.55, -0.1); c.lineTo(-0.55, -0.92); c.lineTo(0.5, -0.92); c.lineTo(0.5, -0.1); });
    EF(ctx, P.steelDk, function (c) { rr(c, -0.3, -0.72, 0.62, 0.5, 0.15); });
    EF(ctx, P.ink, function (c) { rr(c, -0.22, -0.64, 0.46, 0.26, 0.08); });
    EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, -0.07, -0.51, 0.08); circle(c, 0.12, -0.51, 0.08); });
    EF(ctx, (a * 6) % 2 > 1 ? P.rustLt : P.rustDk, function (c) { rr(c, -0.07, -1.08, 0.2, 0.16, 0.06); });
    EF(ctx, P.rustLt, function (c) { circle(c, 0.9, 0.18, 0.1); });
  };

  DRAW.firewall = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, hot = 0.45 + 0.25 * w;
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.2, 0.78, 2.4, 0.26, 0.04); });
    EF(ctx, P.rustDk, function (c) { rr(c, -1.12, -0.45, 2.24, 1.3, 0.05); });
    EF(ctx, P.rust, function (c) { rr(c, -1.06, -0.4, 2.12, 1.2, 0.04); });
    ES(ctx, P.rustDk, 0.07, function (c) {
      for (var i = 1; i < 4; i++) { var y = -0.4 + i * 0.3; c.moveTo(-1.06, y); c.lineTo(1.06, y); }
      for (var j = 0; j < 4; j++) { var yy = -0.4 + j * 0.3; for (var k = 0; k < 5; k++) { var x = -1.06 + k * 0.44 + (j % 2) * 0.22; if (x > -1.04) { c.moveTo(x, yy); c.lineTo(x, yy + 0.3); } } }
    });
    // battlements
    EF(ctx, P.rust, function (c) { for (var i = -2; i <= 2; i++) rr(c, i * 0.46 - 0.17, -0.72, 0.34, 0.34, 0.03); });
    EF(ctx, P.rustDk, function (c) { for (var i = -2; i <= 2; i++) c.rect(i * 0.46 - 0.17, -0.5, 0.34, 0.1); });
    // flames
    for (var f = -2; f <= 2; f++) {
      var fh = (0.34 + 0.12 * sin(a * 8 + f * 1.7) + 0.35 * w), fx = f * 0.46;
      EF(ctx, P.hazard, function (c) { c.moveTo(fx - 0.14, -0.72); c.quadraticCurveTo(fx - 0.08, -0.72 - fh * 0.6, fx, -0.72 - fh); c.quadraticCurveTo(fx + 0.1, -0.72 - fh * 0.5, fx + 0.14, -0.72); c.closePath(); });
      EF(ctx, P.rustLt, function (c) { c.moveTo(fx - 0.07, -0.72); c.quadraticCurveTo(fx - 0.03, -0.72 - fh * 0.4, fx, -0.72 - fh * 0.62); c.quadraticCurveTo(fx + 0.05, -0.72 - fh * 0.3, fx + 0.07, -0.72); c.closePath(); });
    }
    // scanner eye strip
    EF(ctx, P.ink, function (c) { rr(c, -0.85, -0.12, 1.7, 0.34, 0.12); });
    var sx = sin(a * 1.6) * 0.62;
    EF(ctx, 'rgba(127,231,255,' + (0.2 + hot * 0.4) + ')', function (c) { rr(c, -0.8, -0.08, 1.6, 0.26, 0.1); });
    EF(ctx, w > 0.3 ? P.white : P.arc, function (c) { rr(c, sx - 0.17, -0.09, 0.34, 0.28, 0.08); });
    EF(ctx, P.arc, function (c) { circle(c, -0.95, 0.05, 0.06); circle(c, 0.95, 0.05, 0.06); });
    EF(ctx, P.hazard, function (c) { for (var i = -2; i <= 2; i++) poly(c, [i * 0.4 - 0.14, 0.75, i * 0.4 + 0.02, 0.75, i * 0.4 + 0.14, 0.45, i * 0.4 - 0.02, 0.45]); });
  };

  DRAW.inspector = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, lx = -0.1, ly = -0.35, lr = 0.82;
    // hover jets + body
    EF(ctx, 'rgba(127,231,255,0.25)', function (c) { c.ellipse(-0.35, 1.05, 0.6, 0.12, 0, 0, TAU); });
    EF(ctx, P.tealDk, function (c) { rr(c, -0.95, 0.4, 1.2, 0.62, 0.14); });
    EF(ctx, P.rust, function (c) { rr(c, -0.8, 0.52, 0.5, 0.2, 0.04); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.2, 0.55, 0.3, 0.1); });
    // clipboard
    EF(ctx, P.steel, function (c) { rr(c, -1.3, -0.1, 0.46, 0.64, 0.05); });
    EF(ctx, P.plate, function (c) { c.rect(-1.26, 0.0, 0.38, 0.46); });
    ES(ctx, P.rustLt, 0.06, function (c) { c.moveTo(-1.2, 0.1); c.lineTo(-0.95, 0.35); c.moveTo(-0.95, 0.1); c.lineTo(-1.2, 0.35); });
    // handle
    ES(ctx, P.steelDkr, 0.3, function (c) { c.moveTo(lx + 0.6, ly + 0.58); c.lineTo(1.0, 0.86); });
    ES(ctx, P.rust, 0.12, function (c) { c.moveTo(lx + 0.78, ly + 0.74); c.lineTo(0.92, 0.8); c.moveTo(lx + 0.92, ly + 0.88); c.lineTo(1.04, 0.92); });
    EF(ctx, P.hazard, function (c) { circle(c, 1.05, 0.92, 0.17); });
    // lens
    EF(ctx, P.steelDk, function (c) { circle(c, lx, ly, lr + 0.1); });
    EF(ctx, P.ink, function (c) { circle(c, lx, ly, lr); });
    EF(ctx, w > 0.3 ? 'rgba(255,255,255,0.4)' : 'rgba(127,231,255,0.2)', function (c) { circle(c, lx, ly, lr - 0.05); });
    ES(ctx, w > 0.3 ? P.white : P.arc, 0.05, function (c) {
      for (var i = -2; i <= 2; i++) { c.moveTo(lx + i * 0.3, ly - 0.64); c.lineTo(lx + i * 0.3, ly + 0.64); c.moveTo(lx - 0.64, ly + i * 0.3); c.lineTo(lx + 0.64, ly + i * 0.3); }
    });
    ES(ctx, P.rust, 0.09, function (c) { c.moveTo(lx - 0.22, ly); c.lineTo(lx + 0.22, ly); c.moveTo(lx, ly - 0.22); c.lineTo(lx, ly + 0.22); });
    var sa = a * 1.4;
    ES(ctx, P.white, 0.05, function (c) { c.moveTo(lx, ly); c.lineTo(lx + cos(sa) * 0.78, ly + sin(sa) * 0.78); });
    ES(ctx, P.hazard, 0.1, function (c) { c.arc(lx, ly, lr + 0.1, -2.9, -1.3); });
  };

  DRAW.vp = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, fl3 = sin(a * 5) * 0.06 + w * 0.08;
    // briefcase arm + case
    ES(ctx, P.steelDkr, 0.2, function (c) { c.moveTo(0.85, 0.0); c.lineTo(1.1, 0.62); });
    EF(ctx, SACKDK, function (c) { rr(c, 0.78, 0.6, 0.62, 0.45, 0.06); });
    EF(ctx, SACK, function (c) { rr(c, 0.82, 0.64, 0.54, 0.16, 0.04); });
    EF(ctx, P.hazard, function (c) { c.rect(1.03, 0.66, 0.12, 0.2); });
    ES(ctx, P.steelDkr, 0.2, function (c) { c.moveTo(-0.85, 0.0); c.lineTo(-1.1, 0.62); });
    EF(ctx, P.steelDk, function (c) { circle(c, -1.1, 0.68, 0.16); });
    // suit
    EF(ctx, P.plate, function (c) { poly(c, [-1.08, -0.2, -0.62, -0.5, 0.62, -0.5, 1.08, -0.2, 0.88, 0.98, -0.88, 0.98]); });
    EF(ctx, P.plateHi, function (c) { poly(c, [-0.62, -0.5, -0.28, -0.5, 0.08, 0.5, -0.45, 0.98, -0.7, 0.98]); poly(c, [0.62, -0.5, 0.28, -0.5, -0.08, 0.5, 0.45, 0.98, 0.7, 0.98]); });
    EF(ctx, P.steel, function (c) { poly(c, [-0.3, -0.5, 0.3, -0.5, 0, 0.35]); });
    EF(ctx, P.rust, function (c) { poly(c, [-0.12, -0.38, 0.12, -0.38, 0.08, -0.22, 0.2 + fl3, 0.55, 0.0 + fl3, 0.95, -0.2 + fl3, 0.55, -0.08, -0.22]); });
    EF(ctx, P.gold, function (c) { circle(c, -0.6, -0.12, 0.09); circle(c, 0.55, 0.8, 0.07); });
    // head
    EF(ctx, P.steelDk, function (c) { rr(c, -0.5, -1.22, 1.0, 0.76, 0.2); });
    EF(ctx, P.steelDkr, function (c) { poly(c, [-0.5, -1.1, -0.2, -1.32, 0.45, -1.26, 0.5, -1.1]); });
    EF(ctx, P.ink, function (c) { rr(c, -0.4, -1.1, 0.8, 0.5, 0.12); });
    EF(ctx, P.hazard, function (c) { circle(c, -0.2, -0.85, 0.09); });
    ES(ctx, P.goldDk, 0.06, function (c) { rr(c, -0.4, -1.1, 0.8, 0.5, 0.12); });
    EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, 0.2, -0.85, 0.12 + 0.07 * w); });
  };

  DRAW.chairman = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, blk = (a % 4) > 3.85;
    // star base + casters
    ES(ctx, P.steelDkr, 0.17, function (c) { c.moveTo(0, 0.75); c.lineTo(-0.95, 1.0); c.moveTo(0, 0.75); c.lineTo(0.95, 1.0); c.moveTo(0, 0.75); c.lineTo(-0.4, 1.04); c.moveTo(0, 0.75); c.lineTo(0.4, 1.04); });
    EF(ctx, P.steelDk, function (c) { rr(c, -0.1, 0.42, 0.2, 0.4, 0.04); });
    EF(ctx, P.ink, function (c) { circle(c, -0.95, 1.02, 0.12); circle(c, 0.95, 1.02, 0.12); circle(c, -0.4, 1.06, 0.1); circle(c, 0.4, 1.06, 0.1); });
    // armrests as weapons: posts with rust barrels angled up and out
    for (var i = -1; i <= 1; i += 2) {
      ES(ctx, P.steelDk, 0.2, function (c) { c.moveTo(i * 0.82, 0.42); c.lineTo(i * 0.9, 0.0); });
      EF(ctx, P.rustDk, function (c) { poly(c, [i * 0.72, -0.02, i * 1.3, -0.42, i * 1.4, -0.24, i * 0.86, 0.16]); });
      EF(ctx, P.rust, function (c) { poly(c, [i * 0.78, -0.05, i * 1.28, -0.38, i * 1.34, -0.28, i * 0.84, 0.06]); });
      EF(ctx, P.gold, function (c) { poly(c, [i * 1.02, -0.2, i * 1.12, -0.26, i * 1.16, -0.18, i * 1.06, -0.1]); });
      EF(ctx, P.ink, function (c) { circle(c, i * 1.36, -0.33, 0.1); });
      if (w > 0.2) EF(ctx, P.hazard, function (c) { circle(c, i * 1.36, -0.33, 0.06 + 0.1 * w); });
    }
    // seat
    EF(ctx, LEATHER, function (c) { rr(c, -0.88, 0.1, 1.76, 0.52, 0.2); });
    ES(ctx, P.gold, 0.07, function (c) { rr(c, -0.88, 0.1, 1.76, 0.52, 0.2); });
    // high back
    EF(ctx, P.tealDk, function (c) { rr(c, -0.66, -1.2, 1.32, 1.5, 0.34); rr(c, -0.88, -0.75, 0.3, 0.7, 0.12); rr(c, 0.58, -0.75, 0.3, 0.7, 0.12); });
    EF(ctx, LEATHER, function (c) { rr(c, -0.52, -1.06, 1.04, 1.2, 0.24); });
    ES(ctx, P.gold, 0.07, function (c) { rr(c, -0.66, -1.2, 1.32, 1.5, 0.34); });
    EF(ctx, P.gold, function (c) { for (var r = 0; r < 2; r++) for (var q = -1; q <= 1; q += 2) circle(c, q * 0.34, -0.1 + r * 0.38, 0.06); circle(c, 0, 0.05, 0.06); });
    // crest
    EF(ctx, P.gold, function (c) { poly(c, [-0.34, -1.2, -0.26, -1.38, -0.1, -1.26, 0, -1.42, 0.1, -1.26, 0.26, -1.38, 0.34, -1.2]); });
    // eye
    EF(ctx, P.gold, function (c) { circle(c, 0, -0.62, 0.34); });
    EF(ctx, P.ink, function (c) { circle(c, 0, -0.62, 0.28); });
    if (blk) ES(ctx, P.rust, 0.08, function (c) { c.moveTo(-0.2, -0.62); c.lineTo(0.2, -0.62); });
    else { EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, 0, -0.62, 0.2); }); EF(ctx, P.ink, function (c) { rr(c, -0.04, -0.78, 0.08, 0.32, 0.03); }); }
  };

  // ------------------------------------------------------------ ACT III BOTS
  DRAW.spam = function (ctx, e, t) {
    var a = e.age || 0, w = sin(a * 16) * 0.12, dir = (e.vx || 0) >= 0 ? 1 : -1;
    ctx.scale(dir, 1);
    ES(ctx, P.rustDk, 0.16, function (c) { c.moveTo(-0.4, 0.5); c.lineTo(-0.5 - w, 0.95); c.moveTo(0.4, 0.5); c.lineTo(0.5 + w, 0.95); });
    EF(ctx, P.rustDk, function (c) { rr(c, -1.0, -0.62, 2.0, 1.28, 0.12); });
    EF(ctx, P.steel, function (c) { rr(c, -0.92, -0.55, 1.84, 1.14, 0.1); });
    EF(ctx, P.rust, function (c) { poly(c, [-0.92, -0.55, 0.92, -0.55, 0, 0.12]); });
    ES(ctx, P.rustDk, 0.09, function (c) { c.moveTo(-0.92, 0.59); c.lineTo(-0.2, 0.08); c.moveTo(0.92, 0.59); c.lineTo(0.2, 0.08); });
    EYE(ctx, -0.3, -0.18, 0.2, P.hazard);
    EYE(ctx, 0.3, -0.18, 0.2, P.hazard);
  };

  DRAW.courier = function (ctx, e, t) {
    var a = e.age || 0, dir = (e.vx || 0) >= 0 ? 1 : -1, bob = sin(a * 9) * 0.05;
    ctx.scale(dir, 1);
    EF(ctx, 'rgba(127,231,255,0.35)', function (c) { poly(c, [-0.9, -0.1 + bob, -1.9 - 0.2 * sin(a * 40), 0.0 + bob, -0.9, 0.2 + bob]); });
    // parcel on a strap
    ES(ctx, P.steelDkr, 0.06, function (c) { c.moveTo(-0.15, 0.2 + bob); c.lineTo(-0.35, 0.62); c.moveTo(0.35, 0.2 + bob); c.lineTo(0.35, 0.62); });
    EF(ctx, SACKDK, function (c) { rr(c, -0.5, 0.58 + bob, 1.0, 0.62, 0.06); });
    EF(ctx, SACK, function (c) { rr(c, -0.46, 0.62 + bob, 0.92, 0.54, 0.05); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.1, 0.62 + bob, 0.2, 0.54); c.rect(-0.46, 0.84 + bob, 0.92, 0.1); });
    // rotors
    ES(ctx, P.steelDk, 0.07, function (c) { c.moveTo(-0.55, -0.66 + bob); c.lineTo(-0.2, -0.3 + bob); c.moveTo(0.4, -0.66 + bob); c.lineTo(0.1, -0.3 + bob); });
    EF(ctx, 'rgba(197,208,214,' + (0.35 + 0.25 * sin(a * 50)) + ')', function (c) { c.ellipse(-0.55, -0.7 + bob, 0.6, 0.1, 0, 0, TAU); c.ellipse(0.4, -0.7 + bob, 0.6, 0.1, 0, 0, TAU); });
    // sleek hull
    EF(ctx, P.tealDk, function (c) { poly(c, [-0.95, -0.35 + bob, -0.2, -0.45 + bob, 0.8, -0.2 + bob, 1.15, 0.0 + bob, 0.8, 0.28 + bob, -0.2, 0.34 + bob, -0.95, 0.15 + bob]); });
    EF(ctx, P.steel, function (c) { poly(c, [-0.5, -0.38 + bob, -0.2, -0.4 + bob, 0.8, -0.18 + bob, 1.0, 0.0 + bob, 0.1, 0.0 + bob, -0.5, -0.05 + bob]); });
    EF(ctx, P.gold, function (c) { c.rect(-0.7, -0.2 + bob, 0.5, 0.07); });
    EF(ctx, P.ink, function (c) { c.ellipse(0.55, -0.02 + bob, 0.28, 0.14, 0, 0, TAU); });
    EF(ctx, P.arc, function (c) { circle(c, 0.6, -0.02 + bob, 0.08); });
  };

  DRAW.paralegal = function (ctx, e, t) {
    var a = e.age || 0, ph = (a % 5) / 5, dn = ph > 0.88 ? 1 : ph > 0.7 ? (ph - 0.7) / 0.18 * -0.5 : 0, sy = -0.55 + dn * 0.0 + (ph > 0.88 ? 0.5 : (ph > 0.7 ? -0.15 * ((ph - 0.7) / 0.18) : 0));
    // legs and desk-paper
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.5, 0.8, 0.3, 0.3, 0.06); rr(c, 0.2, 0.8, 0.3, 0.3, 0.06); });
    EF(ctx, P.steel, function (c) { rr(c, -1.25, 0.62, 0.7, 0.46, 0.04); });
    ES(ctx, P.steelDk, 0.05, function (c) { c.moveTo(-1.15, 0.78); c.lineTo(-0.65, 0.78); c.moveTo(-1.15, 0.92); c.lineTo(-0.8, 0.92); });
    // body suit + tie
    EF(ctx, P.plate, function (c) { rr(c, -0.75, -0.1, 1.5, 0.95, 0.2); });
    EF(ctx, P.steel, function (c) { poly(c, [-0.2, -0.1, 0.2, -0.1, 0, 0.25]); });
    EF(ctx, P.rust, function (c) { poly(c, [-0.07, 0.0, 0.07, 0.0, 0.12, 0.6, 0, 0.72, -0.12, 0.6]); });
    // stamp arm
    ES(ctx, P.steelDk, 0.18, function (c) { c.moveTo(0.7, 0.2); c.lineTo(1.0, sy + 0.5); });
    EF(ctx, P.steelDkr, function (c) { rr(c, 0.9, sy - 0.15, 0.2, 0.6, 0.05); });
    EF(ctx, P.hazard, function (c) { circle(c, 1.0, sy - 0.2, 0.2); });
    EF(ctx, P.rust, function (c) { rr(c, 0.72, sy + 0.42, 0.56, 0.2, 0.04); });
    if (ph > 0.88) EF(ctx, 'rgba(232,100,44,0.55)', function (c) { c.ellipse(1.0, 0.72, 0.5, 0.12, 0, 0, TAU); });
    // head + glasses
    EF(ctx, P.steelDk, function (c) { rr(c, -0.55, -1.05, 1.1, 0.85, 0.22); });
    EF(ctx, P.ink, function (c) { rr(c, -0.42, -0.92, 0.84, 0.5, 0.14); });
    EYE(ctx, -0.18, -0.67, 0.14, P.rust);
    EYE(ctx, 0.2, -0.67, 0.14, P.rust);
    ES(ctx, P.hazard, 0.06, function (c) { circle(c, -0.18, -0.67, 0.22); circle(c, 0.2, -0.67, 0.22); c.moveTo(0.02, -0.67); c.lineTo(0.02, -0.67); });
  };

  DRAW.copier = function (ctx, e, t) {
    var a = e.age || 0, sx = sin(a * 3) * 0.62, flash = (a % 5) > 4.6;
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.0, 0.82, 0.3, 0.2, 0.04); rr(c, 0.7, 0.82, 0.3, 0.2, 0.04); });
    // output tray with a paper
    EF(ctx, P.steel, function (c) { poly(c, [-1.25, 0.2, -0.95, 0.15, -0.95, 0.55, -1.25, 0.7]); });
    EF(ctx, P.white, function (c) { rr(c, -1.3, 0.34, 0.4, 0.07, 0.02); });
    // body
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.0, -0.2, 2.0, 1.05, 0.12); });
    EF(ctx, P.steelDk, function (c) { rr(c, -0.94, -0.14, 1.88, 0.52, 0.1); });
    EF(ctx, P.tealDk, function (c) { rr(c, -0.94, 0.42, 1.88, 0.4, 0.06); });
    EF(ctx, P.hazard, function (c) { c.rect(-0.8, 0.6, 0.5, 0.08); });
    EF(ctx, P.ink, function (c) { rr(c, 0.45, 0.5, 0.4, 0.22, 0.04); });
    EF(ctx, P.ok, function (c) { c.rect(0.5, 0.56, 0.1, 0.1); });
    // lid + glass with scanning bar
    EF(ctx, P.steel, function (c) { poly(c, [-1.0, -0.2, -0.78, -0.7, 0.78, -0.7, 1.0, -0.2]); });
    EF(ctx, P.ink, function (c) { poly(c, [-0.8, -0.24, -0.66, -0.58, 0.66, -0.58, 0.8, -0.24]); });
    EF(ctx, flash ? P.white : 'rgba(127,231,255,0.9)', function (c) { rr(c, sx - 0.09, -0.6, 0.18, 0.4, 0.04); });
    EF(ctx, 'rgba(127,231,255,0.25)', function (c) { rr(c, sx - 0.3, -0.6, 0.6, 0.4, 0.04); });
    // eye on the control strip
    EYE(ctx, 0.0, 0.2, 0.15, P.rust);
  };

  DRAW.hr = function (ctx, e, t) {
    var a = e.age || 0, bob = sin(a * 3) * 0.05, heal = e.healing ? 0.5 + 0.5 * sin(a * 7) : 0;
    if (heal && !SILC) { EF(ctx, 'rgba(125,220,106,' + (0.1 + 0.12 * heal) + ')', function (c) { circle(c, 0, 0, 1.25 + 0.1 * heal); }); }
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.5, 0.8, 0.3, 0.28, 0.06); rr(c, 0.2, 0.8, 0.3, 0.28, 0.06); });
    // clipboard arm
    ES(ctx, P.steelDk, 0.16, function (c) { c.moveTo(-0.65, 0.1); c.lineTo(-0.95, 0.35); });
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.3, 0.05, 0.62, 0.85, 0.06); });
    EF(ctx, P.white, function (c) { rr(c, -1.24, 0.14, 0.5, 0.7, 0.03); });
    ES(ctx, P.steelDk, 0.05, function (c) { c.moveTo(-1.16, 0.34); c.lineTo(-0.82, 0.34); c.moveTo(-1.16, 0.5); c.lineTo(-0.82, 0.5); c.moveTo(-1.16, 0.66); c.lineTo(-0.95, 0.66); });
    EF(ctx, P.hazard, function (c) { rr(c, -1.1, 0.0, 0.22, 0.14, 0.03); });
    // round friendly body
    EF(ctx, P.tealMid, function (c) { rr(c, -0.7, -0.1 + bob, 1.4, 1.0, 0.4); });
    EF(ctx, P.white, function (c) { rr(c, -0.44, 0.08 + bob, 0.88, 0.7, 0.2); });
    EF(ctx, P.ok, function (c) { c.rect(-0.1, 0.16 + bob, 0.2, 0.54); c.rect(-0.28, 0.33 + bob, 0.56, 0.2); });
    // head
    EF(ctx, P.steel, function (c) { circle(c, 0, -0.58 + bob, 0.62); });
    EF(ctx, P.ink, function (c) { rr(c, -0.44, -0.78 + bob, 0.88, 0.4, 0.18); });
    EF(ctx, P.arc, function (c) { circle(c, -0.18, -0.6 + bob, 0.1); circle(c, 0.18, -0.6 + bob, 0.1); });
    ES(ctx, P.arc, 0.06, function (c) { c.arc(0, -0.46 + bob, 0.16, 0.2, Math.PI - 0.2); });
    ES(ctx, P.rust, 0.07, function (c) { c.moveTo(-0.5, -1.0 + bob); c.lineTo(-0.1, -1.1 + bob); c.moveTo(0.5, -1.0 + bob); c.lineTo(0.1, -1.1 + bob); });
  };

  // ------------------------------------------------------------ ACT III WARDENS
  DRAW.receptionist = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, ring = (a % 1.6) > 1.45 || w > 0.3;
    // mech legs
    ES(ctx, P.steelDkr, 0.24, function (c) { c.moveTo(-0.7, 0.55); c.lineTo(-1.0, 1.0); c.moveTo(0.7, 0.55); c.lineTo(1.0, 1.0); });
    EF(ctx, P.ink, function (c) { rr(c, -1.2, 0.95, 0.4, 0.14, 0.04); rr(c, 0.8, 0.95, 0.4, 0.14, 0.04); });
    // torso behind desk + arms with handsets
    EF(ctx, P.plate, function (c) { rr(c, -0.6, -0.5, 1.2, 1.0, 0.2); });
    for (var i = -1; i <= 1; i += 2) {
      ES(ctx, P.steelDk, 0.22, function (c) { c.moveTo(i * 0.6, -0.3); c.lineTo(i * 1.15, -0.55 - 0.1 * w); });
      EF(ctx, P.rustDk, function (c) { poly(c, [i * 1.0, -0.45 - 0.1 * w, i * 1.35, -0.78 - 0.1 * w, i * 1.45, -0.62 - 0.1 * w, i * 1.2, -0.38 - 0.1 * w]); });
      EF(ctx, P.rust, function (c) { circle(c, i * 1.36, -0.78 - 0.1 * w, 0.14); circle(c, i * 1.1, -0.38 - 0.1 * w, 0.14); });
      if (ring) ES(ctx, 'rgba(255,198,41,0.7)', 0.07, function (c) { c.arc(i * 1.45, -0.8 - 0.1 * w, 0.28, -2.5, -0.6); c.moveTo(i * 1.45 + 0.4, -0.8); c.arc(i * 1.45, -0.8 - 0.1 * w, 0.45, -2.5, -0.6); });
    }
    // head + headset
    EF(ctx, P.steelDk, function (c) { rr(c, -0.5, -1.35, 1.0, 0.82, 0.24); });
    EF(ctx, P.ink, function (c) { rr(c, -0.38, -1.22, 0.76, 0.5, 0.14); });
    EYE(ctx, -0.17, -0.96, 0.13, ring ? P.white : P.hazard);
    EYE(ctx, 0.17, -0.96, 0.13, ring ? P.white : P.hazard);
    ES(ctx, P.arc, 0.09, function (c) { c.arc(0, -1.0, 0.58, Math.PI, TAU); });
    EF(ctx, P.arc, function (c) { rr(c, -0.7, -1.05, 0.2, 0.34, 0.06); rr(c, 0.5, -1.05, 0.2, 0.34, 0.06); });
    ES(ctx, P.arc, 0.06, function (c) { c.moveTo(-0.62, -0.74); c.lineTo(-0.5, -0.56); c.lineTo(-0.2, -0.52); });
    EF(ctx, P.hazard, function (c) { circle(c, -0.17, -0.5, 0.07); });
    // desk
    EF(ctx, P.tealDk, function (c) { rr(c, -1.15, 0.0, 2.3, 0.95, 0.08); });
    EF(ctx, P.tealMid, function (c) { rr(c, -1.25, -0.08, 2.5, 0.2, 0.06); });
    EF(ctx, P.hazard, function (c) { for (var k = -3; k <= 3; k++) poly(c, [k * 0.3 - 0.08, 0.75, k * 0.3 + 0.08, 0.75, k * 0.3 + 0.2, 0.92, k * 0.3 + 0.04, 0.92]); });
    EF(ctx, P.ink, function (c) { rr(c, -0.95, 0.28, 0.7, 0.3, 0.05); });
    EF(ctx, P.arc, function (c) { c.rect(-0.88, 0.33, 0.55, 0.05); c.rect(-0.88, 0.43, 0.35, 0.05); });
    EF(ctx, P.gold, function (c) { c.ellipse(0.55, -0.1, 0.18, 0.1, 0, Math.PI, TAU); });
    EF(ctx, ring ? P.rustLt : P.rust, function (c) { circle(c, -0.9, -0.15, 0.1); });
  };

  DRAW.counsel = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, step = sin(a * 5) * 0.12, up = 0.3 + 0.7 * w;
    // legs
    ES(ctx, P.steelDkr, 0.2, function (c) { c.moveTo(-0.5, 0.7); c.lineTo(-0.6 + step, 1.0); c.moveTo(0.5, 0.7); c.lineTo(0.6 - step, 1.0); });
    EF(ctx, P.ink, function (c) { rr(c, -0.8 + step, 0.97, 0.45, 0.14, 0.04); rr(c, 0.38 - step, 0.97, 0.45, 0.14, 0.04); });
    // briefcase
    EF(ctx, P.ink, function (c) { rr(c, -1.0, -0.55, 2.0, 1.32, 0.12); });
    EF(ctx, SACKDK, function (c) { rr(c, -0.95, -0.5, 1.9, 1.22, 0.1); });
    EF(ctx, SACK, function (c) { rr(c, -0.95, -0.5, 1.9, 0.5, 0.1); });
    ES(ctx, P.ink, 0.06, function (c) { c.moveTo(-0.95, 0.0); c.lineTo(0.95, 0.0); });
    ES(ctx, P.steelDk, 0.14, function (c) { c.moveTo(-0.3, -0.5); c.lineTo(-0.3, -0.82); c.lineTo(0.3, -0.82); c.lineTo(0.3, -0.5); });
    EF(ctx, P.gold, function (c) { rr(c, -0.7, -0.08, 0.26, 0.2, 0.04); rr(c, 0.44, -0.08, 0.26, 0.2, 0.04); });
    ES(ctx, P.goldDk, 0.05, function (c) { rr(c, -0.95, -0.5, 1.9, 1.22, 0.1); });
    // eye slit
    EF(ctx, P.ink, function (c) { rr(c, -0.5, -0.38, 1.0, 0.28, 0.1); });
    EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, 0, -0.24, 0.1 + 0.06 * w); });
    ES(ctx, P.ink, 0.09, function (c) { c.moveTo(-0.55, -0.55); c.lineTo(-0.1, -0.42); c.moveTo(0.55, -0.55); c.lineTo(0.1, -0.42); });
    // nameplate
    EF(ctx, P.gold, function (c) { rr(c, -0.3, 0.3, 0.6, 0.18, 0.03); });
    // gavel arm
    ES(ctx, P.steelDk, 0.2, function (c) { c.moveTo(0.9, 0.2); c.lineTo(1.2, -0.1); });
    var gx = 1.2, gy = -0.1, ang = -0.9 - up * 0.6;
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(ang);
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.08, -1.1 - 0.35, 0.16, 1.5, 0.04); });
    EF(ctx, SACK, function (c) { rr(c, -0.32, -1.05 - 0.55, 0.64, 0.5, 0.06); });
    EF(ctx, P.gold, function (c) { c.rect(-0.34, -1.0 - 0.55, 0.1, 0.4); c.rect(0.24, -1.0 - 0.55, 0.1, 0.4); });
    ctx.restore();
    ES(ctx, P.steelDk, 0.2, function (c) { c.moveTo(-0.9, 0.2); c.lineTo(-1.2, 0.5); });
    EF(ctx, P.steelDk, function (c) { circle(c, -1.2, 0.55, 0.16); });
  };

  DRAW.comptroller = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0;
    // ledger base
    EF(ctx, P.ink, function (c) { rr(c, -1.15, 0.78, 2.3, 0.3, 0.05); });
    EF(ctx, P.ok, function (c) { rr(c, -1.1, 0.8, 2.2, 0.22, 0.04); });
    EF(ctx, P.white, function (c) { c.rect(-1.0, 0.86, 1.95, 0.08); });
    // abacus frame
    EF(ctx, SACKDK, function (c) { rr(c, -0.95, -1.05, 1.9, 1.85, 0.08); });
    EF(ctx, P.ink, function (c) { rr(c, -0.8, -0.9, 1.6, 1.55, 0.04); });
    for (var row = 0; row < 5; row++) {
      var y = -0.72 + row * 0.34;
      ES(ctx, P.steelDk, 0.05, function (c) { c.moveTo(-0.8, y); c.lineTo(0.8, y); });
      var slide = 0.5 + 0.5 * sin(a * 1.1 + row * 1.7), nb = 6;
      for (var b = 0; b < nb; b++) {
        var bx = -0.7 + b * 0.19 + (b < 3 ? 0 : 0.25 * slide) + (b < 3 ? 0.2 * slide : 0);
        EF(ctx, (row + b) % 3 === 0 ? P.gold : (row % 2 ? P.rust : P.steel), function (c) { rr(c, bx - 0.08, y - 0.12, 0.16, 0.24, 0.07); });
      }
    }
    // eye shade + eye
    EF(ctx, P.ok, function (c) { poly(c, [-0.7, -1.02, 0.7, -1.02, 0.45, -1.28, -0.45, -1.28]); });
    EF(ctx, P.ink, function (c) { circle(c, 0, -1.04, 0.2); });
    EF(ctx, w > 0.3 ? P.white : P.rust, function (c) { circle(c, 0, -1.04, 0.13 + 0.05 * w); });
    // legs and a coin
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.7, 1.0, 0.3, 0.14, 0.04); rr(c, 0.4, 1.0, 0.3, 0.14, 0.04); });
    EF(ctx, P.gold, function (c) { circle(c, 1.05, -0.5, 0.2); });
    EF(ctx, P.goldDk, function (c) { circle(c, 1.05, -0.5, 0.1); });
  };

  DRAW.market = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, bear = (e.phase || 1) >= 2;
    var hl = bear ? P.rust : P.ok, hd = bear ? P.rustDk : '#3a7a34';
    // legs
    EF(ctx, P.steelDkr, function (c) { rr(c, -0.75, 0.55, 0.45, 0.5, 0.08); rr(c, 0.3, 0.55, 0.45, 0.5, 0.08); });
    EF(ctx, P.ink, function (c) { rr(c, -0.9, 0.98, 0.7, 0.14, 0.04); rr(c, 0.2, 0.98, 0.7, 0.14, 0.04); });
    // torso with ticker
    EF(ctx, P.plate, function (c) { rr(c, -1.05, -0.2, 2.1, 0.95, 0.16); });
    EF(ctx, P.ink, function (c) { rr(c, -0.9, -0.05, 1.8, 0.62, 0.08); });
    ES(ctx, bear ? P.rust : P.ok, 0.08, function (c) {
      if (bear) { c.moveTo(-0.8, -0.0); c.lineTo(-0.4, 0.15); c.lineTo(-0.2, 0.05); c.lineTo(0.2, 0.3); c.lineTo(0.4, 0.22); c.lineTo(0.8, 0.5); }
      else { c.moveTo(-0.8, 0.5); c.lineTo(-0.4, 0.3); c.lineTo(-0.2, 0.38); c.lineTo(0.2, 0.12); c.lineTo(0.4, 0.2); c.lineTo(0.8, -0.0); }
    });
    // arms
    for (var i = -1; i <= 1; i += 2) {
      EF(ctx, P.steelDk, function (c) { rr(c, i > 0 ? 1.0 : -1.4, -0.3, 0.4, 0.9, 0.12); });
      EF(ctx, hd, function (c) { rr(c, i > 0 ? 1.0 : -1.4, 0.5, 0.4, 0.3, 0.08); });
    }
    // head: bull (green, horns, nose ring) or bear (rust, ears, fangs)
    if (!bear) {
      EF(ctx, P.steel, function (c) { poly(c, [-0.55, -0.75, -1.3, -0.95, -1.5, -1.5, -1.0, -1.15, -0.55, -1.0]); poly(c, [0.55, -0.75, 1.3, -0.95, 1.5, -1.5, 1.0, -1.15, 0.55, -1.0]); });
      EF(ctx, hd, function (c) { rr(c, -0.7, -1.18, 1.4, 1.0, 0.3); });
      EF(ctx, hl, function (c) { rr(c, -0.62, -1.12, 1.24, 0.5, 0.22); });
      EF(ctx, P.steel, function (c) { rr(c, -0.42, -0.58, 0.84, 0.4, 0.16); });
      EF(ctx, P.ink, function (c) { circle(c, -0.18, -0.4, 0.07); circle(c, 0.18, -0.4, 0.07); });
      ES(ctx, P.gold, 0.07, function (c) { c.arc(0, -0.3, 0.14, 0.2, Math.PI - 0.2); });
      EYE(ctx, -0.32, -0.88, 0.13, w > 0.3 ? P.white : P.hazard);
      EYE(ctx, 0.32, -0.88, 0.13, w > 0.3 ? P.white : P.hazard);
    } else {
      EF(ctx, hd, function (c) { circle(c, -0.62, -1.2, 0.26); circle(c, 0.62, -1.2, 0.26); });
      EF(ctx, P.ink, function (c) { circle(c, -0.62, -1.2, 0.12); circle(c, 0.62, -1.2, 0.12); });
      EF(ctx, hd, function (c) { rr(c, -0.75, -1.15, 1.5, 1.0, 0.4); });
      EF(ctx, hl, function (c) { rr(c, -0.67, -1.09, 1.34, 0.55, 0.3); });
      EF(ctx, P.rustLt, function (c) { rr(c, -0.4, -0.62, 0.8, 0.4, 0.16); });
      EF(ctx, P.ink, function (c) { rr(c, -0.14, -0.58, 0.28, 0.14, 0.05); });
      EF(ctx, P.white, function (c) { poly(c, [-0.3, -0.26, -0.18, -0.26, -0.24, -0.08]); poly(c, [0.3, -0.26, 0.18, -0.26, 0.24, -0.08]); });
      EYE(ctx, -0.3, -0.88, 0.13, w > 0.3 ? P.white : P.hazard);
      EYE(ctx, 0.3, -0.88, 0.13, w > 0.3 ? P.white : P.hazard);
      ES(ctx, P.ink, 0.08, function (c) { c.moveTo(-0.5, -1.05); c.lineTo(-0.15, -0.95); c.moveTo(0.5, -1.05); c.lineTo(0.15, -0.95); });
    }
  };

  DRAW.founder = function (ctx, e, t) {
    var w = e.windup || 0, a = e.age || 0, ph = e.phase || 1, ec = ph >= 3 ? P.rust : P.hazard;
    // treads of mismatched scrap
    EF(ctx, P.ink, function (c) { rr(c, -1.25, 0.55, 2.5, 0.5, 0.22); });
    EF(ctx, P.steelDkr, function (c) { rr(c, -1.2, 0.58, 2.4, 0.42, 0.2); });
    EF(ctx, P.rustDk, function (c) { for (var i = -3; i <= 3; i++) circle(c, i * 0.35, 0.8, 0.1); });
    EF(ctx, P.hazard, function (c) { circle(c, -0.35, 0.8, 0.07); circle(c, 0.7, 0.8, 0.07); });
    // back battery (oil drum) and a scrap magnet arm
    EF(ctx, P.rustDk, function (c) { rr(c, -1.55, -0.5, 0.5, 1.0, 0.1); });
    ES(ctx, P.steelDk, 0.07, function (c) { c.moveTo(-1.55, -0.2); c.lineTo(-1.05, -0.2); c.moveTo(-1.55, 0.15); c.lineTo(-1.05, 0.15); });
    ES(ctx, P.steelDk, 0.16, function (c) { c.moveTo(0.95, 0.0); c.lineTo(1.3, 0.2); });
    ES(ctx, P.rust, 0.28, function (c) { c.arc(1.5, 0.2, 0.3, Math.PI * 0.5, Math.PI * 1.5, true); });
    EF(ctx, P.steel, function (c) { c.rect(1.4, -0.18, 0.2, 0.1); c.rect(1.4, 0.5, 0.2, 0.1); });
    // body of patched plates
    EF(ctx, P.steelDk, function (c) { rr(c, -1.05, -0.65, 2.1, 1.5, 0.3); });
    EF(ctx, P.tealDk, function (c) { poly(c, [-1.05, -0.3, -0.3, -0.65, -0.1, 0.3, -1.05, 0.5]); });
    EF(ctx, P.rustDk, function (c) { poly(c, [0.2, -0.65, 0.95, -0.55, 1.05, 0.2, 0.4, 0.1]); });
    EF(ctx, P.steelDkr, function (c) { poly(c, [0.0, 0.35, 1.0, 0.4, 1.0, 0.8, 0.0, 0.8]); });
    ES(ctx, P.ink, 0.05, function (c) { c.moveTo(-0.1, 0.3); c.lineTo(0.2, -0.65); c.moveTo(-1.05, 0.5); c.lineTo(0.0, 0.35); });
    EF(ctx, P.rustLt, function (c) { circle(c, -0.8, -0.45, 0.06); circle(c, -0.5, 0.65, 0.06); circle(c, 0.8, -0.4, 0.06); circle(c, 0.85, 0.62, 0.06); circle(c, 0.1, 0.62, 0.06); });
    ES(ctx, P.rustDk, 0.08, function (c) { c.moveTo(-0.7, 0.2); c.lineTo(-0.7, 0.8); c.moveTo(0.6, 0.45); c.lineTo(0.6, 0.8); });
    // oversized visor with a single weary eye
    EF(ctx, P.ink, function (c) { rr(c, -0.75, -0.5, 1.5, 0.78, 0.3); });
    ES(ctx, P.steelDkr, 0.07, function (c) { rr(c, -0.75, -0.5, 1.5, 0.78, 0.3); });
    EF(ctx, ec, function (c) { circle(c, -0.05, -0.1, 0.27 + 0.05 * w); });
    EF(ctx, P.ink, function (c) { c.rect(-0.3, -0.42, 0.5, ((a % 5) > 4.7 ? 0.6 : 0.3)); });
    EF(ctx, FLASH ? P.white : '#f3e6c0', function (c) { circle(c, -0.12, -0.17, 0.08); });
    // bent coil of scrap springs
    ES(ctx, P.steelDk, 0.12, function (c) { c.moveTo(-0.1, -0.65); c.lineTo(-0.25, -1.05); });
    ES(ctx, P.steel, 0.07, function (c) { for (var k = 0; k < 4; k++) { c.moveTo(-0.55 + k * 0.03, -0.72 - k * 0.1); c.lineTo(0.15 + k * 0.03, -0.78 - k * 0.1); } });
    EF(ctx, P.arc, function (c) { circle(c, -0.45, -1.2, 0.09); });
    // crown of welded bolts
    EF(ctx, P.goldDk, function (c) { rr(c, 0.15, -1.0, 0.85, 0.16, 0.04); });
    for (var q = 0; q < 4; q++) { var qx = 0.27 + q * 0.23, qy = -1.12 - ((q % 2) ? 0.06 : 0.16); EF(ctx, q % 2 ? P.steel : P.gold, function (c) { hex(c, qx, qy, 0.16, q); }); EF(ctx, P.ink, function (c) { circle(c, qx, qy, 0.05); }); }
    EF(ctx, P.hazard, function (c) { circle(c, 0.6, -0.96, 0.05); });
  };

  // ------------------------------------------------------------ DISPATCH
  var WARDENS = { compactor: 1, shredder: 1, furnace: 1, foreman: 1, overseer: 1, forklift: 1, firewall: 1, inspector: 1, vp: 1, chairman: 1, receptionist: 1, counsel: 1, comptroller: 1, market: 1, founder: 1 };

  function enemy(ctx, e, t, sil) {
    var fn = DRAW[e.type] || DRAW.scrapling, r = e.r || 12;
    var w = e.windup || 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (w > 0) ctx.translate(sin((e.age || 0) * 70) * w * r * 0.03, cos((e.age || 0) * 83) * w * r * 0.03);
    ctx.scale(r, r);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (WARDENS[e.type]) {
      EF(ctx, P.shadow, function (c) { c.ellipse(0, 1.1, 0.95, 0.16, 0, 0, TAU); });
      if (w > 0) EF(ctx, 'rgba(232,100,44,' + (0.1 + 0.2 * w) + ')', function (c) { circle(c, 0, 0, 1.35 + 0.1 * w); });
    }
    FLASH = !!(e.flash > 0);
    SILC = sil ? '#0a1319' : null;
    COPY = !!e.copy && !sil;
    fn(ctx, e, t || 0);
    FLASH = false; SILC = null; COPY = false;
    if (e.copy && !sil) { // faint scanlines
      ctx.beginPath();
      for (var sl = -1; sl <= 1.01; sl += 0.28) { ctx.moveTo(-1.15, sl); ctx.lineTo(1.15, sl); }
      ctx.strokeStyle = 'rgba(14,26,33,0.4)'; ctx.lineWidth = 0.07; ctx.stroke();
    }
    if (e.invuln) {
      var k = 1.45 + (WARDENS[e.type] ? 0.0 : 0.0);
      ctx.beginPath(); hex(ctx, 0, 0, k, 0.52 + (t || 0) * 0.2);
      ctx.fillStyle = 'rgba(127,231,255,0.16)'; ctx.fill();
      ctx.strokeStyle = P.arc; ctx.lineWidth = 0.1; ctx.stroke();
      ctx.beginPath(); hex(ctx, 0, 0, k * 0.88, 0.52 + (t || 0) * 0.2);
      ctx.strokeStyle = 'rgba(234,242,244,0.55)'; ctx.lineWidth = 0.04; ctx.stroke();
    }
    if (e.elite) {
      var q = (t || 0) * 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU);
      ctx.strokeStyle = P.hazard; ctx.lineWidth = 0.12; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU);
      ctx.strokeStyle = 'rgba(255,198,41,0.28)'; ctx.lineWidth = 0.3; ctx.stroke();
      ctx.beginPath();
      for (var i = 0; i < 4; i++) { var a = q + i * TAU / 4, px = cos(a) * 1.3, py = sin(a) * 1.3; ctx.moveTo(px + cos(a) * 0.22, py + sin(a) * 0.22); ctx.lineTo(px - sin(a) * 0.14, py + cos(a) * 0.14); ctx.lineTo(px - cos(a) * 0.1, py - sin(a) * 0.1); ctx.lineTo(px + sin(a) * 0.14, py - cos(a) * 0.14); ctx.closePath(); }
      ctx.fillStyle = P.white; ctx.fill();
    }
    ctx.restore();
  }

  // ============================================================ INTERN (allied)
  function intern(ctx, x, y, r, t) {
    t = t || 0;
    var run = sin(t * 14) * 0.14, hop = abs(sin(t * 7)) * 0.08, blink = (t % 2.6) > 2.5;
    ctx.save(); ctx.translate(x, y - hop * r); ctx.scale(r, r);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    F(ctx, P.shadow, function (c) { c.ellipse(0, 1.05 + hop, 0.7, 0.14, 0, 0, TAU); });
    F(ctx, P.steelDkr, function (c) { rr(c, -0.5 + run, 0.7, 0.36, 0.28, 0.1); rr(c, 0.14 - run, 0.7, 0.36, 0.28, 0.1); });
    F(ctx, P.steel, function (c) { rr(c, -0.62, -0.1, 1.24, 0.88, 0.3); });
    F(ctx, P.steelDk, function (c) { rr(c, -0.5, 0.5, 1.0, 0.22, 0.1); });
    S(ctx, P.arcDk, 0.1, function (c) { c.moveTo(-0.3, -0.1); c.lineTo(0, 0.38); c.lineTo(0.3, -0.1); });
    F(ctx, P.white, function (c) { rr(c, -0.17, 0.34, 0.34, 0.42, 0.04); });
    F(ctx, P.arc, function (c) { c.rect(-0.17, 0.34, 0.34, 0.12); });
    F(ctx, P.steelDkr, function (c) { circle(c, 0, 0.6, 0.06); });
    F(ctx, P.steelDk, function (c) { rr(c, -0.8, -1.0, 1.6, 0.98, 0.42); });
    F(ctx, P.ink, function (c) { rr(c, -0.66, -0.88, 1.32, 0.74, 0.32); });
    if (blink) S(ctx, P.arc, 0.1, function (c) { c.moveTo(-0.4, -0.5); c.lineTo(-0.1, -0.5); c.moveTo(0.1, -0.5); c.lineTo(0.4, -0.5); });
    else { F(ctx, P.arc, function (c) { circle(c, -0.26, -0.5, 0.17); circle(c, 0.26, -0.5, 0.17); }); F(ctx, P.white, function (c) { circle(c, -0.3, -0.55, 0.06); circle(c, 0.22, -0.55, 0.06); }); }
    S(ctx, P.arc, 0.07, function (c) { c.arc(0, -0.38, 0.2, 0.3, Math.PI - 0.3); });
    S(ctx, P.steelDk, 0.07, function (c) { c.moveTo(0, -1.0); c.lineTo(0, -1.28); });
    F(ctx, P.arc, function (c) { circle(c, 0, -1.3, 0.1 + 0.03 * sin(t * 6)); });
    ctx.restore();
  }

  // ============================================================ PICKUPS / DRONE / SHOT
  // These are drawn every frame for dozens of objects: no closures, no arrays, no string building per call.
  var CORE_GLOW = [];
  (function () { for (var i = 0; i < 8; i++) CORE_GLOW.push('rgba(199,146,255,' + (0.10 + 0.10 * i / 7).toFixed(3) + ')'); })();
  function diamond(ctx, rx, ry) { ctx.moveTo(0, -ry); ctx.lineTo(rx, 0); ctx.lineTo(0, ry); ctx.lineTo(-rx, 0); ctx.closePath(); }

  function pickup(ctx, p, t) {
    var a = p.age || 0;
    if (a > 12 && ((a * 7) | 0) % 2) return;
    ctx.save(); ctx.translate(p.x, p.y);
    if (p.kind === 'core') {
      var pu = 0.5 + 0.5 * sin(a * 5);
      ctx.beginPath(); circle(ctx, 0, 0, 8.5); fill(ctx, CORE_GLOW[(pu * 7 + 0.5) | 0]);
      ctx.beginPath(); diamond(ctx, 4.6, 6.5); fill(ctx, P.coreDk);
      ctx.beginPath(); diamond(ctx, 3.4, 5); fill(ctx, P.core);
      ctx.beginPath(); diamond(ctx, 1.5, 2.6); fill(ctx, P.white);
    } else if (p.kind === 'cell') {
      var bl = ((a * 3) | 0) % 2;
      ctx.beginPath(); circle(ctx, 0, 0, 8); fill(ctx, 'rgba(125,220,106,0.12)');
      ctx.beginPath(); rr(ctx, -3.4, -5, 6.8, 10, 1.4); fill(ctx, P.steelDkr);
      ctx.beginPath(); rr(ctx, -2.5, -4.2, 5, 8.4, 0.9); fill(ctx, P.steel);
      ctx.beginPath(); ctx.rect(-1.5, -6.4, 3, 1.6); fill(ctx, P.steelDk);
      ctx.beginPath(); ctx.rect(-1.7, -3, 3.4, 1.7); ctx.rect(-1.7, -0.6, 3.4, 1.7); if (bl) ctx.rect(-1.7, 1.8, 3.4, 1.7); fill(ctx, P.ok);
    } else {
      var v = p.value || 1, big = v >= 50 ? 7 : v >= 10 ? 6.2 : 5.2;
      var sq = 0.7 + 0.3 * abs(cos(a * 3.5));
      ctx.rotate(a * 2.2); ctx.scale(1, sq);
      ctx.beginPath(); circle(ctx, 0, 0, big + 1.6); fill(ctx, 'rgba(255,198,41,0.10)');
      if (v >= 50) { ctx.beginPath(); hex(ctx, 2.2, 1.6, big * 0.8, 0.4); fill(ctx, P.steelDk); }
      ctx.beginPath(); hex(ctx, 0, 0, big, 0); fill(ctx, P.steelDk);
      ctx.beginPath(); hex(ctx, -0.2, -0.3, big * 0.82, 0); fill(ctx, P.steel);
      ctx.beginPath(); circle(ctx, 0, 0, big * 0.36); fill(ctx, P.floor);
      ctx.beginPath();
      ctx.moveTo(big * 0.2, -big * 0.95); ctx.lineTo(big * 0.82, -big * 0.5); ctx.lineTo(big * 0.55, -big * 0.38); ctx.lineTo(big * 0.15, -big * 0.7); ctx.closePath();
      fill(ctx, P.hazard);
    }
    ctx.restore();
  }

  function drone(ctx, x, y, t) {
    t = t || 0;
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round';
    ctx.beginPath(); circle(ctx, 0, 0, 6.5); fill(ctx, 'rgba(127,231,255,0.18)');
    ctx.beginPath();
    for (var i = 0; i < 3; i++) { var a = t * 6 + i * TAU / 3; ctx.moveTo(cos(a) * 5.2, sin(a) * 5.2); ctx.arc(0, 0, 5.2, a, a + 0.9); }
    stroke(ctx, P.arc, 1.1);
    ctx.beginPath(); circle(ctx, 0, 0, 3.4); fill(ctx, P.steelDkr);
    ctx.beginPath(); circle(ctx, 0, 0, 2.9); fill(ctx, P.steel);
    ctx.beginPath(); rr(ctx, -2, -1.2, 4, 2, 1); fill(ctx, P.ink);
    ctx.beginPath(); circle(ctx, 0.4, 0, 0.9); fill(ctx, P.arc);
    ctx.restore();
  }

  function shot(ctx, s, t) {
    var r = s.r || 5, vx = s.vx || 0, vy = s.vy || 0, sp = Math.sqrt(vx * vx + vy * vy) || 1;
    var nx = vx / sp, ny = vy / sp, L = r * 2.8;
    ctx.save(); ctx.translate(s.x, s.y);
    ctx.beginPath(); circle(ctx, 0, 0, r * 1.7); fill(ctx, 'rgba(232,100,44,0.25)');
    ctx.beginPath();
    ctx.moveTo(-ny * r * 0.9, nx * r * 0.9); ctx.lineTo(ny * r * 0.9, -nx * r * 0.9); ctx.lineTo(-nx * L, -ny * L); ctx.closePath();
    fill(ctx, 'rgba(232,100,44,0.7)');
    ctx.beginPath(); circle(ctx, 0, 0, r); fill(ctx, P.rust);
    ctx.beginPath(); circle(ctx, 0, 0, r * 0.62); fill(ctx, P.rustLt);
    ctx.beginPath(); circle(ctx, 0, 0, r * 0.28); fill(ctx, P.white);
    ctx.restore();
  }

  // ============================================================ ICONS
  var ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="square"';
  var FL = 'fill="currentColor" stroke="none"';
  var HEXD = 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z';
  var ICONS = {
    boot: '<path d="M5 10h14v10H5z"/><circle cx="12" cy="15" r="2.6"/><path d="M12 10V4M9.5 4h5"/>',
    coil: '<path d="M12 2v3M5 6.500h14M5 11h14M5 15.500h14M12 18v4" stroke-linecap="butt"/>',
    pulse: '<path d="M2 12h5l2-7 4 14 2-7h7" stroke-linejoin="miter"/>',
    field: '<circle cx="12" cy="12" r="2.2" ' + FL + '/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10" stroke-dasharray="3 3"/>',
    fork: '<path d="M12 22v-8M12 14L5 3M12 14l7-11M12 14V3" stroke-linejoin="miter"/>',
    amp: '<path d="M3 4l17 8-17 8z" stroke-linejoin="miter"/><path d="M6.5 12h5M9 9.5v5"/>',
    surge: '<path d="M14 2L5 14h6l-1 8 9-12h-6z" stroke-linejoin="miter"/>',
    chain: '<path d="M10 14a4 4 0 0 1 0-5.6l2.4-2.4a4 4 0 0 1 5.6 5.6l-1.4 1.4M14 10a4 4 0 0 1 0 5.6L11.6 18a4 4 0 0 1-5.6-5.6l1.4-1.4"/>',
    overload: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>',
    cell: '<path d="M7 5h10v16H7zM10 2h4v3M12 10v6M9 13h6" stroke-linejoin="miter"/>',
    thrust: '<path d="M7 3h10l2 9H5zM9 15v4M12 15v7M15 15v4" stroke-linejoin="miter"/>',
    recycler: '<path d="M20 12a8 8 0 0 1-13.5 5.8M4 12a8 8 0 0 1 13.5-5.8"/><path d="M18 2.5v4.5h-4.5M6 21.5V17h4.5"/>',
    capacitor: '<path d="M3.5 18a9.5 9.5 0 1 1 17 0"/><path d="M12 15l4-6" stroke-linejoin="miter"/><circle cx="12" cy="15" r="1.6" ' + FL + '/><path d="M5 20h14"/>',
    coolant: '<path d="M12 2.5c4 5 6.5 8 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.500 8 7.500 12 2.5z" stroke-linejoin="miter"/><path d="M9 15a3 3 0 0 0 3 3"/>',
    plating: '<path d="M3 5h18v14H3z"/><circle cx="6.500" cy="8.500" r="1" ' + FL + '/><circle cx="17.500" cy="8.500" r="1" ' + FL + '/><circle cx="6.500" cy="15.500" r="1" ' + FL + '/><circle cx="17.500" cy="15.500" r="1" ' + FL + '/><path d="M10 9l-1 6M15 9l-1 6" stroke-width="1.500"/>',
    spare: '<path d="M2 8h15v10H2zM17 11h3v4h-3zM8 11v4M6 13h4" stroke-linejoin="miter"/><path d="M5 5h15v2" stroke-dasharray="2 2" stroke-width="1.500"/>',
    magnet: '<path d="M5 3h4v9a3 3 0 0 0 6 0V3h4v9a7 7 0 0 1-14 0zM5 7h4M15 7h4" stroke-linejoin="miter"/>',
    sorter: '<path d="M3 4h18l-7 9v7l-4-2v-5z" stroke-linejoin="miter"/><path d="M7 8h10"/>',
    sweep: '<path d="M19 2.5L12 13"/><path d="M8 12l7 3.500-4 6.500-8-3.500z" stroke-linejoin="miter"/><path d="M8 16l2 3"/>',
    lucky: '<path d="M12 2l2.300 7.700L22 12l-7.700 2.300L12 22l-2.300-7.700L2 12l7.700-2.300z" stroke-linejoin="miter"/>',
    beacon: '<circle cx="12" cy="8" r="2" ' + FL + '/><path d="M7.500 3.500a9 9 0 0 0 0 9M16.500 3.500a9 9 0 0 1 0 9M12 11l-3.500 11M12 11l3.500 11M9.500 17h5"/>',
    extract: '<path d="M12 2l4 4-4 6-4-6z" stroke-linejoin="miter"/><path d="M4 12v4a8 8 0 0 0 16 0v-4M12 20v2"/>',
    drone: '<path d="M9 9h6v6H9zM9 9L5.500 5.500M15 9l3.500-3.500M9 15l-3.500 3.500M15 15l3.500 3.500"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/>',
    dronedmg: '<path d="M2 14c0-5 4-5 4 0s4 5 4 0 4-5 4 0 4 5 4 0" /><path d="M20 4l-3 4h4l-3 4" stroke-width="1.700" stroke-linejoin="miter"/><path d="M2 20h14" stroke-width="1.500"/>',
    dronerate: '<circle cx="12" cy="13.500" r="8"/><path d="M12 13.500V8M9.500 2h5M19 5l1.500 1.500" stroke-linejoin="miter"/><path d="M12 13.500l3.500 2.500"/>',
    collector: '<path d="M5 3v8l7 7 7-7V3M12 18v4" stroke-linejoin="miter"/><path d="M12 5l3 1.700v3.400L12 11.800 9 10.100V6.700z" stroke-width="1.500"/>',
    titan: '<path d="M5 10h14v11H5z"/><path d="M1.500 11h3.500v6H1.500zM19 11h3.500v6H19zM8 10V3M16 10V3M5.500 3h5M13.500 3h5"/><path d="M8.500 14h7v3h-7z" ' + FL + '/>',
    bolt: '<path d="' + HEXD + '"/><circle cx="12" cy="12" r="3.200"/>',
    core: '<path d="M12 2l8 10-8 10-8-10z"/><path d="M12 7l3.500 5-3.500 5-3.500-5z" ' + FL + '/>',
    battery: '<path d="M2 7h17v10H2zM19 10h3v4h-3z" stroke-linejoin="miter"/><path d="M5 10v4M8.500 10v4M12 10v4" stroke-width="2"/>',
    signal: '<path d="M4 21v-4M9.500 21v-8M15 21V8M20.500 21V3" stroke-width="3" stroke-linecap="butt"/>',
    lock: '<path d="M5 11h14v10H5z" stroke-linejoin="miter"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v3"/>',
    pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z" ' + FL + '/>',
    play: '<path d="M6 3.500l14 8.500-14 8.500z" ' + FL + '/>',
    sound: '<path d="M3 9h4l5-4v14l-5-4H3z" stroke-linejoin="miter"/><path d="M16 8.500a5 5 0 0 1 0 7M19 5.500a9 9 0 0 1 0 13"/>',
    soundOff: '<path d="M3 9h4l5-4v14l-5-4H3z" stroke-linejoin="miter"/><path d="M16 9l6 6M22 9l-6 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    close: '<path d="M5 5l14 14M19 5L5 19" stroke-linecap="butt"/>',
    check: '<path d="M4 12.500l5 5L20 6" stroke-linecap="butt" stroke-linejoin="miter" stroke-width="2.600"/>',
    blueprint: '<path d="M3 3h18v18H3zM3 9h18M9 3v18"/><path d="M13 14h5v4" stroke-linejoin="miter"/><circle cx="13" cy="14" r="1" ' + FL + '/>',
    codex: '<path d="M4 4h13a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3z" stroke-linejoin="miter"/><path d="M8 4v14M11 9h5"/>',
    log: '<path d="M5 4h14v18H5z" stroke-linejoin="miter"/><path d="M9 2h6v4H9zM8.500 11h7M8.500 15h7M8.500 19h4"/>',
    warn: '<path d="M12 3l10 18H2z" stroke-linejoin="miter"/><path d="M12 10v5M12 18v1" stroke-width="2.400"/>',
    arrow: '<path d="M3 12h16M13 5.500l6.500 6.500-6.500 6.500" stroke-linejoin="miter" stroke-linecap="butt"/>',
    fusion: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 9l2.200 3-2.200 3-2.200-3z" ' + FL + '/>',
    supercell: '<path d="M2 6h17v12H2zM19 10h3v4h-3z" stroke-linejoin="miter"/><path d="M11 8.500L8 12.500h4l-3 4" stroke-linejoin="miter" stroke-width="1.800"/><path d="M4 3h12" stroke-width="1.500"/>',
    dividends: '<path d="M4 7c0-1.700 3.600-3 8-3s8 1.300 8 3-3.600 3-8 3-8-1.300-8-3zM4 7v5c0 1.700 3.600 3 8 3s8-1.300 8-3V7M4 12v5c0 1.700 3.600 3 8 3s8-1.300 8-3v-5"/>',
    lattice: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="12" cy="11" r="1.600" ' + FL + '/><path d="M7 5h10M6 7l5 11M18 7l-5 11M12 12.500V17M6.500 6.500l4 3.500M17.500 6.500l-4 3.500" stroke-width="1.500"/>',
    storm: '<path d="M7 14a4 4 0 0 1 0-8 5 5 0 0 1 9.500 1.500A3.500 3.500 0 0 1 17 14" stroke-linecap="butt"/><path d="M13 10l-3.500 6h4.500l-3 6" stroke-linejoin="miter" stroke-width="2.200"/>',
    singularity: '<circle cx="12" cy="12" r="2.600" ' + FL + '/><path d="M12 6.500a5.500 5.500 0 1 1-5.500 5.500"/><path d="M12 2.500a9.500 9.500 0 1 1-9.500 9.500" stroke-linecap="butt"/><path d="M2.500 12l2-2.500M12 2.500L9.500 4.500" stroke-width="1.500"/>',
    severance: '<path d="M3 5h18v10H3z" stroke-linejoin="miter"/><path d="M3 5l9 6.500L21 5"/><path d="M4 19l5 1.500M20 19l-5 1.500M12 17v5" stroke-width="1.800"/>',
    stockopt: '<path d="M3 21h18M4 17l5-5 4 3 7-8" stroke-linejoin="miter" stroke-linecap="butt"/><path d="M15 7h5v5" stroke-linejoin="miter"/>',
    rehire: '<circle cx="10" cy="7.500" r="3.500"/><path d="M3 21a7 7 0 0 1 14 0z" stroke-linejoin="miter"/><path d="M19 3v7M15.500 6.500h7" stroke-linecap="butt"/>',
    nanites: '<circle cx="6" cy="6" r="2" ' + FL + '/><circle cx="16" cy="5" r="1.500" ' + FL + '/><circle cx="11" cy="11" r="2.500" ' + FL + '/><circle cx="19" cy="12" r="2" ' + FL + '/><circle cx="6" cy="17" r="1.600" ' + FL + '/><circle cx="14" cy="19" r="2" ' + FL + '/><path d="M8 7l2 2.500M13 10l-1-3.500M13.500 12l4 0M10 13l-3 3M12.500 13.500L13.500 17" stroke-width="1.200"/>',
    parachute: '<path d="M3 10c0-5 4-8 9-8s9 3 9 8z" stroke-linejoin="miter"/><path d="M3 10l8 9M21 10l-8 9M12 10v9M8 10l3 9M16 10l-3 9" stroke-width="1.300"/><path d="M9.500 19h5v3h-5z" stroke-linejoin="miter"/>',
    takeover: '<path d="M3 19h18M3 17L2 6l5.500 4.500L12 3l4.500 7.500L22 6l-1 11z" stroke-linejoin="miter"/><circle cx="12" cy="13" r="1.600" ' + FL + '/>',
    overtimepay: '<circle cx="10" cy="13" r="8"/><path d="M10 8v5l3 2" stroke-linejoin="miter"/><path d="M18 6l3-3 3 3M18 10l3-3 3 3" stroke-width="1.700" stroke-linejoin="miter" transform="translate(-1 0)"/>',
    hazardpay: '<path d="M12 3l10 18H2z" stroke-linejoin="miter"/><path d="M12 10.500l3 1.700v3.400l-3 1.700-3-1.700v-3.400z" stroke-width="1.500"/>',
    classified: '<path d="M5 3h14v18H5z" stroke-linejoin="miter"/><path d="M8 7h8v3H8zM8 13h8v3H8z" ' + FL + '/><path d="M8 19h5" stroke-width="1.500"/>',
    overtime: '<circle cx="12" cy="12" r="7.500"/><path d="M12 7v5.500l3.500 2" stroke-linejoin="miter"/><circle cx="12" cy="12" r="10.500" stroke-dasharray="2 2.500" stroke-width="1.500"/>',
    colossus: '<path d="M7 8l1.500-4 1.500 2 2-3 2 3 1.500-2L17 8z" stroke-linejoin="miter"/><path d="M6 10h12v11H6zM2.500 11h3.500v7H2.500zM18 11h3.500v7H18z" stroke-linejoin="miter"/><path d="M9.500 14h5v3h-5z" ' + FL + '/>',
    megacoil: '<path d="M12 2v2M3 8h18M5 12.500h14M7 17h10M9.500 21.500h5" stroke-linecap="butt"/><path d="M3 3l2.500 2.500M21 3l-2.500 2.500" stroke-width="1.700"/>',
    diligence: '<path d="M4 3h9l3 3v4M4 3v18h6" stroke-linejoin="miter"/><path d="M7 8h5M7 12h3"/><circle cx="16" cy="16" r="4"/><path d="M19 19l3 3"/>',
    legal: '<path d="M12 3v17M7 21h10M4 7h16" stroke-linejoin="miter"/><path d="M4 7l-2.500 7a2.500 2 0 0 0 5 0zM20 7l-2.500 7a2.500 2 0 0 0 5 0z" stroke-linejoin="miter"/>',
    compound: '<path d="M3 21h18M5 21v-4h3v4M10.500 21v-8h3v8M16 21V9h3v12" stroke-linejoin="miter"/><path d="M3.500 11c5 0 9-2.500 12-7.500M11.500 3.500h4.500v4.500" stroke-linejoin="miter"/>',
    fleet: '<path d="M2 12h6v4H2zM16 12h6v4h-6zM9 4h6v4H9z" stroke-linejoin="miter"/><path d="M5 12V9M19 12V9M12 4V2M3 18h4M17 18h4M10 10h4" stroke-width="1.500"/>',
    insider: '<path d="M1.500 12s4-7 10.500-7 10.500 7 10.500 7-4 7-10.500 7S1.500 12 1.500 12z" stroke-linejoin="miter"/><circle cx="12" cy="12" r="3" ' + FL + '/><path d="M4 21l16-18" stroke-width="1.700"/>',
    orbital: '<circle cx="12" cy="7" r="3.500"/><path d="M2.500 9.500a10 4 0 0 0 19 0" stroke-linecap="butt"/><path d="M12 12.500V22M8.500 18.500L12 22l3.500-3.500" stroke-linejoin="miter" stroke-linecap="butt"/>',
    expense: '<path d="M3 5h18v14H3zM3 9.500h18M6.500 15h5" stroke-linejoin="miter"/><path d="M16 14.500h2" stroke-width="2.600"/>',
    restructure: '<path d="M9 2h6v5H9zM2.500 16h6v5h-6zM15.500 16h6v5h-6z" stroke-linejoin="miter"/><path d="M12 7v3.500M5.500 16v-5.500h4.500M18.500 16v-5.500h-4" stroke-linejoin="miter"/><path d="M11 12.500l2 3" stroke-width="1.700"/>',
    outsource: '<path d="M3 4h10v16H3zM6 8h4M6 12h4M6 16h4" stroke-linejoin="miter"/><path d="M13 12h9M18.500 8.500L22 12l-3.500 3.500" stroke-linejoin="miter" stroke-linecap="butt"/>',
    stake: '<circle cx="12" cy="12" r="9.500"/><path d="M12 12V2.500A9.500 9.500 0 1 1 3.800 16.800z" ' + FL + '/><path d="M12 12L3.800 16.800" stroke-width="1.500"/>',
    exec: '<path d="M7.500 3L12 6.500 16.500 3M10 6.500h4l2 12.500-4 3-4-3z" stroke-linejoin="miter"/><path d="M12 9.500v7" stroke-width="1.500"/>',
    founder: '<path d="M5 9l1-5 3.200 2.500L12 3l2.800 3.500L18 4l1 5z" stroke-linejoin="miter"/><path d="M12 11.500l5 2.800v5.400L12 22.500l-5-2.800v-5.400z" stroke-linejoin="miter"/><circle cx="12" cy="17" r="1.600" ' + FL + '/>',
    hold: '<path d="M5 3h3.500l1.500 4.500-2 1.500a11 11 0 0 0 5.500 5.500l1.500-2 4.500 1.500V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" stroke-linejoin="miter"/><path d="M15 3v5.500M19 3v5.500" stroke-width="2.200" stroke-linecap="butt"/>',
    injunction: '<circle cx="12" cy="9.500" r="7"/><path d="M8.500 6l7 7M15.500 6l-7 7"/><path d="M8 15.500L6.500 22l5.500-3 5.500 3-1.500-6.500" stroke-linejoin="miter"/>',
    repo: '<circle cx="12" cy="4.500" r="2.200"/><path d="M12 6.700V16a4 4 0 0 1-8 0v-2" stroke-linecap="butt"/><path d="M1.500 15.500L4 13l2.500 2.500" stroke-linejoin="miter" stroke-width="1.700"/><path d="M15 20h6" stroke-width="1.500"/>'
  };
  function icon(name, size) {
    var body = ICONS.hasOwnProperty(name) ? ICONS[name] : ICONS.bolt;
    size = size || 24;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" ' + ST + ' aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  // ============================================================ PORTRAIT
  var RADII = { scrapling: 11, roller: 12, sparker: 12, shieldbot: 15, hauler: 22, splitter: 15, mite: 7, turret: 14, bomber: 12, gilded: 12, pylon: 13, compactor: 32, shredder: 30, furnace: 38, foreman: 32, overseer: 42, repo: 12, printer: 16, laser: 12, firenode: 14, auditor: 12, mimic: 10, forklift: 34, firewall: 40, inspector: 30, vp: 36, chairman: 44, spam: 6, courier: 10, paralegal: 12, copier: 15, hr: 12, receptionist: 32, counsel: 34, comptroller: 40, market: 40, founder: 46 };

  function portrait(canvas, kind, id, opts) {
    opts = opts || {};
    if (!canvas || !canvas.getContext) return;
    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    var cw = rect.width || canvas.clientWidth || canvas.width || 120;
    var ch = rect.height || canvas.clientHeight || canvas.height || 120;
    var dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || (root.devicePixelRatio) || 1);
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var m = Math.min(cw, ch);
    if (kind === 'player') {
      var mg = !!(opts.magnate || (opts.loadout && opts.loadout.magnate));
      var co = mg || !!(opts.colossus || (opts.loadout && opts.loadout.colossus));
      var ti = !!(opts.titan || co || (opts.loadout && opts.loadout.titan));
      var r = m * (co ? 0.16 : ti ? 0.21 : 0.23);
      player(ctx, cw / 2, ch / 2 + r * 0.7, r, { t: opts.t != null ? opts.t : 0.6, facing: 0, loadout: opts.loadout || {}, oc: opts.oc, hurt: opts.hurt, pulse: opts.pulse != null ? opts.pulse : 0.9, titan: ti, colossus: co, magnate: mg });
    } else {
      var warden = !!WARDENS[id];
      var rr0 = m * (warden ? 0.31 : 0.33);
      var cy = ch / 2 + (id === 'pylon' ? rr0 * 0.3 : id === 'chairman' ? rr0 * 0.1 : id === 'founder' || id === 'market' ? rr0 * 0.12 : id === 'receptionist' || id === 'counsel' ? rr0 * 0.05 : 0);
      var e = { type: id, x: cw / 2, y: cy, r: rr0, age: 1.1, facing: -0.4, vx: 1, vy: 0, planted: true, windup: 0, flash: 0, elite: false, invuln: false, armor: id === 'printer' ? 0.5 : 0, phase: Math.max(1, (opts.phase | 0) || 1), copy: !!opts.copy, healing: false, disguised: false, stolen: 0, shieldedBy: null, infected: 0 };
      enemy(ctx, e, 1.1, !!opts.silhouette);
    }
  }

  BY.Sprites = {
    PALETTE: P,
    player: player,
    enemy: function (ctx, e, t) { enemy(ctx, e, t, false); },
    pickup: pickup,
    drone: drone,
    shot: shot,
    icon: icon,
    intern: intern,
    portrait: portrait
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
