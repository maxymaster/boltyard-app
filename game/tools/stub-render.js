// Minimal BY.Render (SPEC 6.3) so the UI can be developed before the real renderer exists.
(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};
  var cv, ctx, cssW = 360, cssH = 640, dpr = 1, sc = 1, ox = 0, oy = 0, rect = null;
  var arenaH = 640, opts = {}, save = null, zaps = [], clock = 0;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function fit() {
    sc = Math.min(cssW / 360, cssH / arenaH);
    ox = (cssW - 360 * sc) / 2; oy = (cssH - arenaH * sc) / 2;
  }
  BY.Render = {
    init: function (canvas, o) { cv = canvas; ctx = cv.getContext('2d'); opts = o || {}; BY.Render.resize(); },
    setOptions: function (o) { for (var k in o) opts[k] = o[k]; },
    resize: function () {
      if (!cv) return;
      rect = cv.getBoundingClientRect();
      cssW = rect.width || 360; cssH = rect.height || 640;
      dpr = Math.min(2, root.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(cssW * dpr)); cv.height = Math.max(1, Math.round(cssH * dpr));
      fit();
    },
    arenaSize: function () { return { w: 360, h: Math.round(clamp(360 * cssH / cssW, 480, 760)) }; },
    toArena: function (cx, cy) { var r = cv.getBoundingClientRect(); return { x: (cx - r.left - ox) / sc, y: (cy - r.top - oy) / sc }; },
    scale: function () { return sc; },
    begin: function (run, sv) { save = sv; arenaH = run.h; zaps.length = 0; fit(); },
    handle: function (events) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'zap') zaps.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, t: 0.12 });
      }
    },
    draw: function (run, dt, o) {
      if (!ctx) return;
      var S = BY.Sprites, P = run.player, i, t = run.t;
      clock += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0e1a21'; ctx.fillRect(0, 0, cssW, cssH);
      ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.rect(0, 0, 360, run.h); ctx.clip();
      ctx.fillStyle = '#152630'; ctx.fillRect(0, 0, 360, run.h);
      ctx.strokeStyle = 'rgba(53,89,110,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (i = 60; i < 360; i += 60) { ctx.moveTo(i, 0); ctx.lineTo(i, run.h); }
      for (i = 60; i < run.h; i += 60) { ctx.moveTo(0, i); ctx.lineTo(360, i); }
      ctx.stroke();
      for (i = 0; i < run.hazards.length; i++) {
        var h = run.hazards[i], f = clamp(h.t / h.dur, 0, 1);
        ctx.strokeStyle = ctx.fillStyle = 'rgba(232,100,44,.55)'; ctx.lineWidth = 3;
        if (h.kind === 'slam' || h.kind === 'hold' || h.kind === 'injunction' || h.kind === 'blink') { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 6.3); ctx.stroke(); ctx.globalAlpha = .3 * f; ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.lineWidth = h.w; ctx.globalAlpha = .25 + .3 * f; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x2, h.y2); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      for (i = 0; i < run.pickups.length; i++) S.pickup(ctx, run.pickups[i], t);
      ctx.strokeStyle = opts.reducedMotion ? 'rgba(127,231,255,.25)' : 'rgba(127,231,255,.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(P.x, P.y, run.stats.radius, 0, 6.3); ctx.stroke();
      for (i = 0; i < run.enemies.length; i++) if (!run.enemies[i].dead) S.enemy(ctx, run.enemies[i], t);
      for (i = 0; i < run.shots.length; i++) S.shot(ctx, run.shots[i], t);
      for (i = 0; i < run.drones.length; i++) S.drone(ctx, run.drones[i].x, run.drones[i].y, t);
      S.player(ctx, P.x, P.y, P.r * (P.magnate ? 1.4 : P.colossus ? 1.3 : P.titan ? 1.15 : 1), { t: t, facing: 0, loadout: BY.Engine.loadout(save), oc: P.oc.active, hurt: Math.max(0, 1 - P.hurt / 0.4), pulse: P.pulse, titan: P.titan, colossus: P.colossus, magnate: P.magnate });
      ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2;
      for (i = zaps.length - 1; i >= 0; i--) {
        var z = zaps[i]; z.t -= dt;
        if (z.t <= 0) { zaps.splice(i, 1); continue; }
        ctx.beginPath(); ctx.moveTo(z.x1, z.y1); ctx.lineTo(z.x2, z.y2); ctx.stroke();
      }
      if (o && o.reticle) {
        ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.reticle.x, o.reticle.y, 9, 0, 6.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(o.reticle.x - 14, o.reticle.y); ctx.lineTo(o.reticle.x + 14, o.reticle.y);
        ctx.moveTo(o.reticle.x, o.reticle.y - 14); ctx.lineTo(o.reticle.x, o.reticle.y + 14); ctx.stroke();
      }
      ctx.restore();
      if (o && o.paused) { ctx.fillStyle = 'rgba(14,26,33,.45)'; ctx.fillRect(0, 0, cssW, cssH); }
    },
    handleResize: null
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
