/* BOLTYARD - ui.js: boot, save/load, main loop, input, HUD, every screen outside the arena canvas. */
(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};
  var D = BY.Data, E = BY.Engine, S = BY.Sprites, A = BY.Audio, R = BY.Render;
  var TICK = D.TICK;
  var OTSEC = D.SECTORS.length;   // Overtime is the last sector (16)
  var KEY = 'boltyard.save.v1';
  var doc = root.document;
  // Release label shown in Settings. The app wrapper may set window.BY_VERSION (e.g. '1.0 (build 7)') to show the bundle's own.
  var VERSION = '1.0', BUILD = 6;
  // Inside the native app the wrapper sets window.BY_NATIVE = true before these scripts: the page is already fullscreen, portrait
  // and kept awake, so Focus mode (fullscreen + wake lock) has nothing to do and its controls are hidden (style.css: html.native).
  var NATIVE = !!root.BY_NATIVE;
  // The Home Screen web app (build.js --pwa) sets BY_NATIVE for the app layout and BY_WEBAPP so the screen wake lock is still requested.
  var WEBAPP = !!root.BY_WEBAPP;

  // ------------------------------------------------------------------ helpers
  function $(id) { return doc.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  // Big numbers: everything goes through BY.Fmt (data.js). int = exact below 1e6 (thin-space thousands), else 1.2K / 3.4Qa / 1.2e36.
  var F = BY.Fmt;
  function fmt(n) { return F.int(n); }
  function fbig(n) { return F.num(n); }
  function fnum(x) {   // stats: small values keep a decimal
    if (x >= 1000) return F.num(x);
    if (x >= 100) return String(Math.round(x));
    return (Math.round(x * 10) / 10).toFixed(1);
  }
  function fmult(x) { return x < 10 ? x.toFixed(2) : F.num(x); }
  // shrink the font of a clipped number until it fits its box (the box must be width-bounded and overflow:hidden)
  function fit(el, base, min) {
    el.style.fontSize = '';
    if (el.scrollWidth <= el.clientWidth + 0.5) return;
    var fs = base;
    while (fs > min && el.scrollWidth > el.clientWidth + 0.5) { fs -= 1; el.style.fontSize = fs + 'px'; }
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ':' + pad(m, 2) + ':' + pad(s, 2) : m + ':' + pad(s, 2);
  }
  function icon(name, size) { return S.icon(name, size); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // HUD strip is narrow: drop the article so the Warden's name fits beside its HP bar
  function hudName(n) { return String(n || '').replace(/^The\s+/i, ''); }
  function lowerThe(name) { return name.replace(/^The /, 'the '); }

  var mqReduce = null;
  try { mqReduce = root.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { /* ignore */ }
  function reduced() { return !!(mqReduce && mqReduce.matches); }

  // ------------------------------------------------------------------ state
  var save = null;
  var run = null;
  var mode = 'boot';           // title | shift | report | workshop | victory
  var paused = false;
  var ending = false, endT = 0;
  var lastReport = null;
  var acc = 0, lastTs = 0;
  var dbg = { timeScale: 1, inputFn: null };
  var els = {};
  var tweens = [];

  // ------------------------------------------------------------------ storage
  var BAK = 'boltyard.save.bak', storeMsg = '', newerSave = false;
  function backupRaw(raw) {       // keep the unreadable save once, before anything can overwrite it
    try { if (raw && root.localStorage.getItem(BAK) !== raw) root.localStorage.setItem(BAK, raw); } catch (e) { /* storage unavailable */ }
  }
  function readStore() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { backupRaw(raw); storeMsg = 'Your saved game was unreadable. A copy was kept and you are starting fresh.'; return null; }
  }
  function writeStore() {
    if (newerSave) return;      // a save from a newer build stays untouched
    try { root.localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable: the game still works */ }
  }
  function clearStore() { try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ count-up numbers
  // Works on plain doubles (no int32 anywhere), so 1e30 animates as smoothly as 12.
  function Counter(el, fitBase) { this.el = el; this.shown = null; this.to = 0; this.from = 0; this.t0 = 0; this.dur = 0; this.active = false; this.txt = null; this.fitBase = fitBase || 0; }
  function fitHeader() {
    var a = els.wsBolts, b = els.wsCores;
    if (!a || !b || els.workshop.hidden) return;
    a.style.fontSize = ''; b.style.fontSize = '';
    fit(a, 24, 12); fit(b, 24, 12); a.style.fontSize = ''; fit(a, 24, 12);
  }
  Counter.prototype.render = function (v) {
    var t = fmt(v);
    if (t !== this.txt) { this.txt = t; this.el.textContent = t; if (this.fitBase) fitHeader(); }
  };
  Counter.prototype.set = function (v, animate) {
    v = Number(v); if (!(v >= 0)) v = 0;
    if (this.shown === null || !animate || reduced()) {
      this.active = false; this.to = v; this.shown = v; this.render(v); return;
    }
    if (v === this.to) return;
    if (v === this.shown && !this.active) { this.to = v; return; }
    this.from = this.shown; this.to = v; this.t0 = -1;
    this.dur = clamp(280 + Math.log10(Math.abs(v - this.from) + 1) * 60, 280, 800);
    this.el.classList.remove('up', 'down');
    void this.el.offsetWidth;
    this.el.classList.add(v > this.from ? 'up' : 'down');
    if (!this.active) { this.active = true; tweens.push(this); }
  };
  Counter.prototype.tick = function (now) {
    if (this.t0 < 0) this.t0 = now;
    var p = clamp((now - this.t0) / this.dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
    var v = p >= 1 ? this.to : this.from + (this.to - this.from) * e;
    this.shown = v;
    this.render(v);
    if (p >= 1) { this.active = false; return false; }
    return true;
  };
  function tickTweens(now) {
    for (var i = tweens.length - 1; i >= 0; i--) {
      if (!tweens[i].active || !tweens[i].tick(now)) tweens.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ canvas / render
  function renderOpts() {
    return { reducedMotion: reduced(), shake: !!(save && save.settings.shake) && !reduced() };
  }
  function applySettings() {
    A.setEnabled(!!save.settings.sound);
    R.setOptions(renderOpts());
    els.app.classList.toggle('noshake', !save.settings.shake || reduced());
    els.shakeNote.hidden = !reduced();
    syncSwitches();
  }
  function resizeCanvas() { try { R.resize(); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ screens
  function setMode(m) {
    mode = m;
    els.title.hidden = m !== 'title';
    els.workshop.hidden = m !== 'workshop';
    els.hud.hidden = !(m === 'shift' || m === 'report' || m === 'victory');
    if (m !== 'shift') { els.warn.hidden = true; els.hint.hidden = true; els.toast.hidden = true; }
    if (m !== 'report') els.report.hidden = true;
    if (m !== 'victory') els.victory.hidden = true;
    if (m !== 'shift') { els.pause.hidden = true; paused = false; }
    if (m !== 'workshop' && els.wsBanner && !els.wsBanner.hidden) finishReveal();
    doc.documentElement.classList.toggle('shifting', m === 'shift');
    if (m !== 'shift') wakeRelease();
    resizeCanvas();
  }

  // ================================================================== TITLE / ATTRACT
  function enterTitle() {
    setMode('title');
    startAttract();
  }
  function startAttract() {
    resizeCanvas();
    var sz = R.arenaSize();
    run = E.startShift(save, 1, { w: sz.w, h: sz.h, seed: (Math.random() * 1e9) | 0, attract: true });
    R.begin(run, save);
    ending = false; acc = 0;
    inputKind = ''; ptr.id = null;
  }
  function attractTarget(r) {
    var t = r.t;
    tgt.x = r.w * 0.5 + Math.sin(t * 0.8) * 110;
    tgt.y = r.h * 0.58 + Math.sin(t * 1.6) * 120;
    return tgt;
  }

  // ================================================================== SHIFT
  var tgt = { x: 0, y: 0 };
  var inputKind = '';          // '' | touch | mouse | key
  var ptr = { id: null, x: 0, y: 0, moved: 0 };
  var keys = { l: false, r: false, u: false, d: false };
  var reticle = { x: 0, y: 0 };
  var drawOpts = { reticle: null, paused: false };
  var H = {};                  // cached HUD values

  function beginShift(sector) {
    if (mode === 'shift') return;           // a double tap must never start a second shift
    A.unlock();
    save.sector = sector;
    setMode('shift');
    resizeCanvas();
    var sz = R.arenaSize();
    run = E.startShift(save, sector, { w: sz.w, h: sz.h, seed: (Math.random() * 2147483647) | 0 });
    R.begin(run, save);
    tgt.x = run.player.tx; tgt.y = run.player.ty;
    inputKind = ''; ptr.id = null; ptr.moved = 0;
    keys.l = keys.r = keys.u = keys.d = false;
    paused = false; ending = false; endT = 0; acc = 0;
    resetHud();
    if (save.stats.shifts >= 2 && save.flags.tip < TIPS) save.flags.tip = TIPS;   // tips are for the first shifts only
    coach.t = 0; coach.shownAt = -1; coach.token++;
    els.hint.classList.remove('fade'); els.hint.hidden = true;
    if (save.flags.tip === 0 && !save.flags.movedOnce) showTip(0);
    else if (save.flags.tip === 0) save.flags.tip = 1;
    if (run.boss.blocked) toast(sector === 15 ? 'The Founder will not come without a Majority Stake' : sector === 10 ? 'The Chairman will not come without Hostile Takeover' : 'The Overseer will not come without the Titan Frame', true, 3200);
    else if (run.overtime) toast('Overtime ' + run.overtime + ' · ' + hudName(run.boss.name), true, 2200);
    A.play('clockin');
    wakeAcquire();
  }

  // ---- first-shift coach: three one-line tips, each shown once (flags.tip counts how many are done)
  var TIPS = 3;
  var coach = { t: 0, shownAt: -1, token: 0 };
  var POINTER_FINE = false;
  try { POINTER_FINE = !!(root.matchMedia && root.matchMedia('(pointer: fine)').matches); } catch (e) { /* ignore */ }
  var TIP_TEXT = [
    function () { return POINTER_FINE ? 'Move the mouse to steer Sprocket.' : 'Drag anywhere to steer Sprocket.'; },
    function () { return 'The ring zaps bots on its own. Grab the bolts they drop.'; },
    function () { return 'The battery is your timer. When it is flat, spend your bolts in the Workshop.'; }
  ];
  function showTip(i) {
    coach.shownAt = run ? run.t : 0;
    els.hintText.textContent = TIP_TEXT[i]();
    els.hint.classList.toggle('nothumb', i !== 0);
    els.hint.classList.remove('fade');
    els.hint.hidden = false;
  }
  function endTip(instant) {
    var tok = ++coach.token;
    coach.shownAt = -1;
    if (instant || reduced()) { els.hint.hidden = true; return; }
    els.hint.classList.add('fade');
    root.setTimeout(function () { if (tok === coach.token) { els.hint.hidden = true; els.hint.classList.remove('fade'); } }, 380);
  }
  function advanceTip(instant) {
    save.flags.tip = Math.min(TIPS, save.flags.tip + 1);
    endTip(instant);
    writeStore();
  }
  function updateCoach() {
    var tip = save.flags.tip;
    if (!run || run.attract || tip >= TIPS || tip === 0) return;
    var P = run.player, shown = coach.shownAt >= 0, since = run.t - coach.shownAt;
    if (tip === 1) {
      if (!shown) { if (run.t - coach.t > 0.5) showTip(1); }
      else if (run.earned.bolts > 0 && since > 1.2 || since > 6) advanceTip(false);
    } else if (tip === 2) {
      if (!shown) { if (P.battery < P.maxBattery * 0.72 && !run.over) showTip(2); }
      else if (since > 5.5) advanceTip(false);
    }
  }

  function noteMoved() {
    if (save.flags.movedOnce) return;
    save.flags.movedOnce = true;
    if (save.flags.tip === 0) { save.flags.tip = 1; coach.t = run ? run.t : 0; endTip(true); }
    writeStore();
  }

  function clampTarget(r) {
    var p = r.player, lim = D.PLAYER.leash;
    tgt.x = clamp(tgt.x, 0, r.w); tgt.y = clamp(tgt.y, 0, r.h);
    var dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > lim) { tgt.x = p.x + dx / d * lim; tgt.y = p.y + dy / d * lim; }
  }

  function currentInput(r) {
    if (dbg.inputFn) { var t = dbg.inputFn(r); if (t) noteMoved(); return t || null; }
    if (r.attract) return attractTarget(r);
    if (inputKind === 'key') {
      var kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
      if (kx || ky) {
        var m = Math.sqrt(kx * kx + ky * ky);
        tgt.x += kx / m * 320 * TICK; tgt.y += ky / m * 320 * TICK;
        clampTarget(r);
      }
      return tgt;
    }
    return inputKind ? tgt : null;
  }

  // ---- pointer input
  function onPointerDown(e) {
    if (mode !== 'shift' || paused || ending || !run || run.over) return;
    A.unlock();
    if (e.pointerType === 'mouse') { if (e.button === 0) mouseTo(e); return; }
    if (ptr.id !== null) return;
    if (e.clientX < 12 || e.clientX > root.innerWidth - 12) { e.preventDefault(); return; }   // edge swipes are almost always a back-swipe          // follow the first pointer only
    ptr.id = e.pointerId; ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = 0;
    try { els.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (inputKind !== 'touch') { inputKind = 'touch'; }
    tgt.x = run.player.tx; tgt.y = run.player.ty;
    e.preventDefault();
  }
  function mouseTo(e) {
    var p = R.toArena(e.clientX, e.clientY);
    inputKind = 'mouse';
    tgt.x = p.x; tgt.y = p.y;
    noteMoved();
  }
  function onPointerMove(e) {
    if (mode !== 'shift' || paused || ending || !run || run.over) return;
    if (e.pointerType === 'mouse') { mouseTo(e); return; }
    if (e.pointerId !== ptr.id) return;
    var k = 1.3 / (R.scale() || 1);
    var dx = (e.clientX - ptr.x) * k, dy = (e.clientY - ptr.y) * k;
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.moved += Math.abs(dx) + Math.abs(dy);
    tgt.x += dx; tgt.y += dy;
    clampTarget(run);
    if (ptr.moved > 4) noteMoved();
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (e.pointerId === ptr.id) {
      ptr.id = null; focusState.lastDragEnd = root.performance.now();
      try { els.stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }

  // ---- keyboard
  function onKeyDown(e) {
    var k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Escape') {
      if (!els.settings.hidden) { closeSettings(); e.preventDefault(); return; }
      if (mode === 'workshop' && !els.sheet.hidden) { closeSheet(); e.preventDefault(); return; }
      if (mode === 'shift' && run && !run.over && !ending) { togglePause(); e.preventDefault(); }
      return;
    }
    if (mode === 'workshop' && tab === 'bp' && BP.built && els.settings.hidden) {
      var hitm = true;
      switch (k) {
        case 'ArrowLeft': panBy(70, 0); break;
        case 'ArrowRight': panBy(-70, 0); break;
        case 'ArrowUp': panBy(0, 70); break;
        case 'ArrowDown': panBy(0, -70); break;
        case '+': case '=': zoomBtn(1.2); break;
        case '-': case '_': zoomBtn(1 / 1.2); break;
        case '0': homeView(true); break;
        default: hitm = false;
      }
      if (hitm) { e.preventDefault(); return; }
    }
    if (mode === 'shift' && run && !run.over && !ending) {
      if (k === ' ' || k === 'Spacebar') { e.preventDefault(); togglePause(); return; }
      if (paused) return;
      var hit = true;
      switch (k) {
        case 'ArrowLeft': case 'a': case 'A': keys.l = true; break;
        case 'ArrowRight': case 'd': case 'D': keys.r = true; break;
        case 'ArrowUp': case 'w': case 'W': keys.u = true; break;
        case 'ArrowDown': case 's': case 'S': keys.d = true; break;
        default: hit = false;
      }
      if (hit) {
        e.preventDefault();
        if (inputKind !== 'key') { inputKind = 'key'; tgt.x = run.player.tx; tgt.y = run.player.ty; }
        noteMoved();
      }
    }
  }
  function onKeyUp(e) {
    var k = e.key;
    if ((k === ' ' || k === 'Spacebar') && (mode === 'shift')) { e.preventDefault(); return; }
    switch (k) {
      case 'ArrowLeft': case 'a': case 'A': keys.l = false; break;
      case 'ArrowRight': case 'd': case 'D': keys.r = false; break;
      case 'ArrowUp': case 'w': case 'W': keys.u = false; break;
      case 'ArrowDown': case 's': case 'S': keys.d = false; break;
    }
  }

  // ---- pause
  function togglePause() { if (paused) resume(); else pause(); }
  function pause() {
    if (mode !== 'shift' || paused || !run || run.over || ending) return;
    paused = true;
    keys.l = keys.r = keys.u = keys.d = false;
    ptr.id = null;
    els.pause.hidden = false;
    syncSwitches();
    A.play('click');
    try { els.btnResume.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function resume() {
    if (!paused) return;
    paused = false; acc = 0;
    els.pause.hidden = true;
    A.play('click');
    try { els.btnPause.blur(); } catch (e) { /* ignore */ }
  }
  function clockOut() {
    if (!run || mode !== 'shift') return;
    paused = false; els.pause.hidden = true;
    E.clockOut(run);
    ending = true; endT = 0; beginEndFx();
    A.play('click');
  }

  // ---- HUD
  function resetHud() {
    H = { battPct: -1, battNum: -1, low: null, oc: null, hit: null, bolts: -1, cores: -1, showCores: false,
      ocShow: null, ocPct: -1, ocOn: null, sigMode: '', sigPct: -1, sigText: '', warnShown: false, popAt: 0, toastUntil: 0, budget: null, fitKey: '' };
    els.hudCoreWrap.hidden = true;
    els.hudOc.hidden = true;
    els.hudBoltsBox.style.fontSize = ''; els.hudSig.classList.remove('tight');
    updateHud(true);
  }
  function updateHud(force) {
    var P = run.player, b = run.boss, pct, q, num, low, ocOn;
    pct = P.maxBattery > 0 ? clamp(P.battery / P.maxBattery, 0, 1) : 0;
    q = Math.round(pct * 500) / 500;
    if (q !== H.battPct) { H.battPct = q; els.battFill.style.transform = 'scaleX(' + q + ')'; els.batt.setAttribute('aria-valuenow', String(Math.round(q * 100))); }
    num = Math.max(0, Math.ceil(P.battery));
    if (num !== H.battNum) { H.battNum = num; els.battNum.textContent = fmt(num); }
    var bud = !!P.budget;
    if (bud !== H.budget) { H.budget = bud; els.batt.classList.toggle('budget', bud); }
    low = pct < 0.25 && P.battery > 0;
    if (low !== H.low) { H.low = low; els.batt.classList.toggle('low', low); }
    ocOn = !!P.oc.active;
    if (ocOn !== H.oc) { H.oc = ocOn; els.batt.classList.toggle('oc', ocOn); }

    var bolts = Math.floor(run.earned.bolts);
    if (bolts !== H.bolts) {
      H.bolts = bolts; els.hudBolts.textContent = fmt(bolts); hudFit();
      if (!force && !reduced() && els.hudBolts.animate) {
        var now = root.performance.now();
        if (now - H.popAt > 120) { H.popAt = now; els.hudBolts.animate([{ transform: 'scale(1.35)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' }); }
      }
    }
    var cores = Math.floor(run.earned.cores);
    if (cores !== H.cores) {
      H.cores = cores; els.hudCores.textContent = fmt(cores);
      if (cores > 0 && !H.showCores) { H.showCores = true; els.hudCoreWrap.hidden = false; }
      hudFit();
    }

    // Overclock chip (once unlocked)
    if (P.oc.unlocked !== H.ocShow) { H.ocShow = P.oc.unlocked; els.hudOc.hidden = !P.oc.unlocked; }
    if (P.oc.unlocked) {
      var op = P.oc.active ? (P.oc.dur > 0 ? P.oc.time / P.oc.dur : 0) : P.oc.charge;
      op = Math.round(clamp(op, 0, 1) * 100) / 100;
      if (op !== H.ocPct) { H.ocPct = op; els.ocFill.style.transform = 'scaleX(' + op + ')'; }
      if (ocOn !== H.ocOn) { H.ocOn = ocOn; els.hudOc.classList.toggle('on', ocOn); els.ocLabel.textContent = 'OC'; }
    }

    // Warden signal -> Warden name + HP bar
    var mode2, text, val;
    if (b.state === 'active') { mode2 = 'boss'; text = hudName(b.name); val = b.maxHp > 0 ? b.hp / b.maxHp : 0; }
    else if (b.state === 'warning') { mode2 = 'warn'; text = hudName(b.name); val = 1; }
    else if (b.state === 'dead') { mode2 = 'dead'; text = 'Scrapped'; val = 0; }
    else if (b.blocked) { mode2 = 'blocked'; text = run.sector === 15 ? 'Needs Stake' : run.sector === 10 ? 'Needs Takeover' : 'Needs Titan Frame'; val = 0; }
    else { val = b.need > 0 ? clamp(b.signal / b.need, 0, 1) : 0; mode2 = val >= 1 ? 'full' : val >= 0.8 ? 'near' : 'fill'; text = 'Warden'; }
    if (run.overtime && (mode2 === 'fill' || mode2 === 'near' || mode2 === 'full')) text = 'OT ' + run.overtime + ' · ' + hudName(b.name);
    else if (run.overtime && (mode2 === 'boss' || mode2 === 'warn')) text = 'OT ' + run.overtime + ' · ' + text;
    if (mode2 !== H.sigMode) {
      H.sigMode = mode2; els.hudSig.setAttribute('data-mode', mode2);
      els.hudSig.setAttribute('aria-label', mode2 === 'fill' || mode2 === 'near' ? 'Warden signal' : text);
      els.sigIcon.innerHTML = icon(mode2 === 'blocked' ? 'lock' : (mode2 === 'boss' || mode2 === 'warn') ? 'warn' : 'signal', 16);
    }
    if (text !== H.sigText) { H.sigText = text; els.sigLabel.textContent = text; }
    val = Math.round(val * 200) / 200;
    if (val !== H.sigPct) { H.sigPct = val; els.sigFill.style.transform = 'scaleX(' + val + ')'; }

    // warning band follows the engine state
    var warn = b.state === 'warning';
    if (warn !== H.warnShown) { H.warnShown = warn; els.warn.hidden = !warn; if (warn) els.warnName.textContent = b.name; }
  }
  // keep the bolts / cores readout from squeezing the Warden meter when the numbers get huge
  function hudFit() {
    if (!els.hudSig) return;
    var key = H.bolts + '|' + H.cores;
    var long = String(els.hudBolts.textContent).length + (H.showCores ? String(els.hudCores.textContent).length : 0);
    var box = els.hudBoltsBox;
    if (long <= 8) { if (box.style.fontSize) box.style.fontSize = ''; return; }
    var r2 = box.parentNode, fs = 18;
    box.style.fontSize = '';
    while (fs > 12 && (r2.scrollWidth > r2.clientWidth + 1 || els.hudSig.clientWidth < 120)) { fs -= 1; box.style.fontSize = fs + 'px'; }
    els.hudSig.classList.toggle('tight', els.hudSig.clientWidth < 110);
  }
  function toast(text, hz, ms) {
    ms = ms || 1100;
    els.toast.textContent = text;
    els.toast.classList.toggle('hz', !!hz);
    els.toast.hidden = false;
    // restart animation (its length follows the requested duration)
    els.toast.style.animation = 'none'; void els.toast.offsetWidth; els.toast.style.animation = ''; els.toast.style.animationDuration = ms + 'ms';
    H.toastUntil = root.performance.now() + ms;
  }
  function hudEvents(events) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.type) {
        case 'bossWarn': H.warnShown = true; els.warn.hidden = false; els.warnName.textContent = e.name; break;
        case 'bossSpawn': H.warnShown = false; els.warn.hidden = true; toast('Reserve power +' + Math.round(D.TUNE.reserve * 100) + '%', true, 1600); break;
        case 'ocStart': toast('Overclock'); break;
        case 'steal': toast('Repo Bot took ' + fbig(e.bolts), false, 1000); break;
        case 'refund': toast('Refund +' + fbig(e.bolts), true, 1000); break;
        case 'severance': toast('Severance payout', true, 1400); break;
        case 'spare': toast('Spare cell online', true); break;
        case 'bossDead': toast('Warden scrapped', true); break;
        case 'hurt':
          els.batt.classList.add('hit'); H.hitUntil = root.performance.now() + 160;   // a colour change, not motion: kept under reduced motion
          break;
      }
    }
  }

  // ---- main loop
  function frame(ts) {
    root.requestAnimationFrame(frame);
    var dt = (ts - lastTs) / 1000; lastTs = ts;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    tickTweens(ts);
    if (!run || mode === 'workshop' || mode === 'boot') return;

    var scale = dbg.timeScale > 0 ? dbg.timeScale : 1;
    var stepping = (mode === 'title' || mode === 'shift') && !paused && !run.over && !ending;
    if (stepping) {
      acc += dt * scale;
      var maxSteps = 5 * Math.max(1, Math.ceil(scale)), n = 0;
      while (acc >= TICK && n < maxSteps && !run.over) {
        E.step(run, save, currentInput(run));
        acc -= TICK; n++;
      }
      if (acc >= TICK) acc = 0;     // drop the remainder instead of spiralling
      R.handle(run.events, run);
      A.handle(run.events, run);
      if (mode === 'shift') hudEvents(run.events);
      run.events.length = 0;
      if (mode === 'shift') { updateHud(false); updateCoach(); }
      if (mode === 'title' && run.over) startAttract();
      if (mode === 'shift' && run.over) { ending = true; endT = 0; beginEndFx(); }
    } else if (run.events.length) {
      // events produced outside the stepping branch (end of shift): still hand them over once
      R.handle(run.events, run); A.handle(run.events, run);
      if (mode === 'shift') hudEvents(run.events);
      run.events.length = 0;
    }
    if (mode === 'shift') {
      if (H.hitUntil && root.performance.now() > H.hitUntil) { H.hitUntil = 0; els.batt.classList.remove('hit'); }
      if (!els.toast.hidden && root.performance.now() > H.toastUntil) els.toast.hidden = true;
    }
    if (mode === 'shift' && run.over && !ending && !paused) { ending = true; endT = 0; beginEndFx(); }   // e.g. the page was hidden and came back
    if (ending && !paused) {
      endT += dt * scale;
      if (mode === 'shift') updateHud(false);
      var beat = run.reason === 'victory' ? 2.0 : run.reason === 'clockout' ? (sweepFx ? 1.0 : 0.35) : (sweepFx ? 1.3 : 0.9);
      if (endT >= beat) { ending = false; finishShift(); }
    }
    if (mode === 'title' || mode === 'shift' || mode === 'report' || mode === 'victory') {
      drawOpts.paused = paused;
      drawOpts.reticle = null;
      if (mode === 'shift' && inputKind === 'touch' && !dbg.inputFn) {
        reticle.x = run.player.tx; reticle.y = run.player.ty; drawOpts.reticle = reticle;
      }
      R.draw(run, dt, drawOpts);
    }
  }

  // Yard Sweep made visible: the leftovers get zapped away during the end-of-shift beat and a banner says how much it paid.
  var sweepFx = false;
  function beginEndFx() {
    sweepFx = false;
    if (!run || run.attract || !(run.stats.sweepPct > 0)) return;
    var rep = E.endShift(run, save);          // idempotent: the report is the same one finishShift reads
    if (!(rep.swept > 0)) return;
    sweepFx = true;
    try { R.sweep(run); } catch (e) { /* ignore */ }
    toast('Yard Sweep +' + fbig(rep.swept), true, 1300);
    A.play('pickup', { pitch: 1.5 });
    root.setTimeout(function () { A.play('pickup', { pitch: 2 }); }, 110);
  }

  function finishShift() {
    if (!run || mode !== 'shift') return;
    var rep = E.endShift(run, save);
    if (rep.unlockedSector) save.sector = rep.unlockedSector;
    writeStore();
    lastReport = rep;
    codexDirty = true;
    if (rep.gameWon) showVictory(rep); else if (rep.act2Won) showFinale(rep); else if (rep.act3Won) showFounder(rep); else showReport(rep);
  }

  // ================================================================== REPORT
  var repCounter = null, repTimers = [];
  function clearRepTimers() { for (var i = 0; i < repTimers.length; i++) root.clearTimeout(repTimers[i]); repTimers.length = 0; }
  function later(fn, ms) { repTimers.push(root.setTimeout(fn, ms)); }

  var LINES = ['Sprocket was towed back to the workshop.', 'The battery is flat. Sprocket is not impressed.', 'Sprocket coasted to a stop. Someone will fetch it.', 'Out of charge. Into the tow truck.'];
  function row(k, v, cls, id) { return '<div class="row ' + (cls || '') + '"><span class="k">' + k + '</span><span class="d"></span>' + v + '</div>'; }

  function showReport(r) {
    setMode('report');
    els.report.hidden = false;
    clearRepTimers();
    var si = E.sectorInfo(save, r.sector);
    var n = E.affordableCount(save);
    els.repNo.textContent = 'No. ' + pad(save.stats.shifts, 4);
    var ot = r.sector === OTSEC ? (r.overtimeLevel || (save.overtime.level + 1)) : 0;
    var bossName = (run && !run.attract && run.sector === r.sector && run.boss && run.boss.name) || si.bossName;
    els.repSector.textContent = r.sector === OTSEC ? 'Yard 9 · Overtime ' + pad(ot, 2) + ' · ' + bossName : 'Yard 9 · Sector ' + pad(r.sector, 2) + ' · ' + si.name;
    var stamp = r.overtimeLevel ? 'Overtime ' + r.overtimeLevel + ' cleared' : r.reason === 'victory' ? 'Warden scrapped' : r.reason === 'clockout' ? 'Clocked out' : 'Battery flat';
    els.repStamp.textContent = stamp;
    els.repStamp.className = 'stamp' + (r.reason === 'victory' ? ' ok' : r.reason === 'clockout' ? ' arc' : '');
    els.repStamp.setAttribute('data-ot', r.overtimeLevel ? '1' : '');
    els.repLine.textContent = r.reason === 'victory' ? bossName + ' is scrap. Sprocket gets a sticker.'
      : r.reason === 'clockout' ? 'Sprocket clocked out early. Bolts kept.'
      : LINES[(save.stats.shifts - 1) % LINES.length];
    if (r.unlockedSector) {
      els.repUnlock.hidden = false;
      els.repUnlock.innerHTML = icon('check', 16) + '<span>Sector ' + r.unlockedSector + ' unlocked · ' + esc(E.sectorInfo(save, r.unlockedSector).name) + '</span>';
    } else els.repUnlock.hidden = true;

    var h = '';
    h += row('Time on shift', '<b>' + fmtTime(r.time) + '</b>');
    h += row('Bots scrapped', '<b>' + fmt(r.kills) + '</b>');
    h += row('Best streak', '<b>' + fmt(r.bestCombo) + '</b>');
    h += row('Bolts', '<b id="repBolts">0</b>', 'big');
    if (r.swept > 0) h += row('incl. Yard Sweep', '<b>+' + fmt(r.swept) + '</b>', 'sub');
    if (r.stolen > 0) h += row('Stolen by Repo Bots', '<b class="neg">−' + fmt(r.stolen) + '</b>', 'sub');
    if (r.fatigueUp) h += row('Board is tired', '<b>Warden −' + Math.round(r.fatigue * 100) + '% next time</b>', 'sub');
    var ft = fundTarget();
    if (ft && r.bolts > 0) {
      var gain = r.bolts / ft.cost.bolts * 100;
      h += row((ft.id === 'titan' ? 'Titan' : ft.id === 'stake' ? 'Stake' : 'Takeover') + ' fund', '<b>+' + (gain < 1 ? '<1' : gain < 10 ? gain.toFixed(1).replace(/\.0$/, '') : Math.round(gain)) + '%</b>', 'sub');
    }
    if (r.clawed > 0) h += row('Clawed back by Head Office', '<b class="neg">−' + fmt(r.clawed) + '</b>', 'sub');
    if (r.compound > 1.005) h += row('Compound Interest', '<b>×' + fmult(r.compound) + '</b>', 'sub');
    if (r.expense > 0) h += row('Expense Account', '<b>+' + (r.expense < 10 ? r.expense.toFixed(1) : Math.round(r.expense)) + ' s battery</b>', 'sub');
    if (r.severance) h += row('Severance payout', '<b>cashed in</b>', 'sub');
    if (r.stockMult > 1) h += row('Stock Options', '<b>×' + r.stockMult.toFixed(2) + '</b>', 'sub');
    if (r.cores > 0) h += row('Cores', '<b>' + fmt(r.cores) + '</b>', 'big');
    if (r.bossSeen) {
      h += row('Warden', '<b>' + esc(bossName) + (r.bossDefeated ? ' · scrapped' : ' · still standing') + '</b>', 'sub');
    } else if (si.lureBlocked) {
      h += row('Warden signal', '<b>' + (r.sector === 15 ? 'Needs a Majority Stake' : r.sector === 10 ? 'Needs Hostile Takeover' : 'Needs Titan Frame') + '</b>', 'sub');
    } else {
      h += row('Warden signal', '<span class="mini"><i style="transform:scaleX(' + clamp(r.signalPct, 0, 1).toFixed(2) + ')"></i></span><b>' + Math.round(r.signalPct * 100) + '%</b>', 'sub');
    }
    els.repRows.innerHTML = h;
    if (r.newSeen && r.newSeen.length) {
      els.repNew.hidden = false;
      var names = r.newSeen.map(function (id) { var d = D.ENEMY_BY_ID[id] || D.BOSS_BY_ID[id]; return d ? d.name : id; });
      els.repNew.innerHTML = 'New in the codex: <b>' + esc(names.join(', ')) + '</b>';
    } else els.repNew.hidden = true;

    els.repNext.textContent = nextAction(r, si, n);

    // buttons: Workshop is primary when something is affordable
    var wsLabel = n > 0 ? 'Workshop · ' + plural(n, 'upgrade', 'upgrades') + ' ready' : 'Workshop';
    if (n > 0) {
      els.btnRepPrimary.textContent = wsLabel; els.btnRepPrimary.onclick = function () { A.play('click'); enterWorkshop({ afterShift: true }); };
      els.btnRepSecond.textContent = 'Clock in again'; els.btnRepSecond.onclick = function () { focusAtClockIn(); beginShift(save.sector); };
    } else {
      els.btnRepPrimary.textContent = 'Clock in again'; els.btnRepPrimary.onclick = function () { focusAtClockIn(); beginShift(save.sector); };
      els.btnRepSecond.textContent = 'Workshop'; els.btnRepSecond.onclick = function () { A.play('click'); enterWorkshop({ afterShift: true }); };
    }

    // time-card animation
    var st = els.repStamp, card = els.repCard;
    st.classList.remove('in', 'now');
    var bc = new Counter($('repBolts'));
    repCounter = bc;
    if (reduced()) { bc.set(r.bolts, false); st.classList.add('now'); }
    else {
      later(function () { bc.set(0, false); bc.set(r.bolts, true); }, 280);
      later(function () {
        st.classList.add('in');
        A.play('click', { pitch: 0.5, vol: 1.6 });
        if (save.settings.shake) { card.classList.remove('thunk'); void card.offsetWidth; card.classList.add('thunk'); }
      }, 620);
    }
    if (r.unlockedSector) later(function () { A.play('unlock'); }, 700);
    try { els.btnRepPrimary.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  // one clear next action, always
  function nextAction(r, si, n) {
    if (r.reason === 'victory' && r.unlockedSector) return 'Sector ' + r.unlockedSector + ' is open. Spend the haul in the Workshop, then pick it.';
    if (r.bossDefeated) return 'Warden down. Spend the haul in the Workshop.';
    if (si.lureBlocked && r.sector === 15) return 'The Founder will not come until Sprocket holds a Majority Stake. Build it in the Executive Suite.';
    if (si.lureBlocked) return r.sector === 10 ? 'The Chairman will not come until Sprocket takes over. Build Hostile Takeover in the Workshop.' : 'The Overseer will not come until Sprocket is a Titan. Build the Titan Frame in the Workshop.';
    if (r.overtimeLevel) return 'Overtime ' + r.overtimeLevel + ' cleared. Level ' + (r.overtimeLevel + 1) + ' hits harder and pays more.';
    if (save.stats.shifts <= 1) return 'Dying is normal. Spend your bolts in the Workshop and come back stronger.';
    if (n > 0) return plural(n, 'upgrade', 'upgrades') + ' ready. Bolt ' + (n === 1 ? 'it' : 'them') + ' on in the Workshop, then clock in.';
    if (r.bossSeen) return 'The Warden won this round. Clock in again with a fuller battery.';
    return 'Nothing affordable yet. Clock in again and bring back more bolts.';
  }

  // ---- the Overseer falls: stamp one, then management's stamp lands on top of it
  function vicCard(kind) {
    setMode('victory');
    els.victory.hidden = false;
    clearRepTimers();
    els.victory.setAttribute('data-kind', kind);
    els.vicStamp.classList.remove('in', 'now'); els.vicStamp2.classList.remove('in', 'now');
  }
  function showVictory(r) {
    vicCard('act1');
    var st = save.stats;
    els.vicStamp.textContent = 'YARD 9 SECURED';
    els.vicStamp2.textContent = 'MANAGEMENT HAS NOTICED';
    els.vicStamp2.hidden = false;
    setVicLine('act1');
    els.vicUnlock.hidden = true;
    els.vicRows.innerHTML =
      row('Shifts worked', '<b>' + fmt(st.wonShifts != null ? st.wonShifts : st.shifts) + '</b>', 'big') +
      row('Time on the clock', '<b>' + fmtTime(st.wonPlayTime != null ? st.wonPlayTime : st.playTime) + '</b>', 'big') +
      row('Wardens scrapped', '<b>' + [1, 2, 3, 4, 5].reduce(function (a, n) { return a + (save.bossKills[n] || 0); }, 0) + '</b>', 'sub') +
      row('Bolts banked, all shifts', '<b>' + fmt(st.boltsTotal) + '</b>', 'sub');
    els.btnKeep.textContent = 'Keep playing'; els.btnVic2.hidden = true;
    els.btnKeep.onclick = function () { A.play('click'); enterWorkshop({ afterShift: true }); };
    if (reduced()) { els.vicStamp.classList.add('now'); els.vicStamp2.classList.add('now'); setVicLine('fixed'); }
    else {
      later(function () { els.vicStamp.classList.add('in'); A.play('click', { pitch: 0.5, vol: 1.6 }); }, 500);
      later(function () { els.vicStamp2.classList.add('in'); A.play('classified'); }, 1700);
      later(function () { setVicLine('fixed', null, true); }, 2000);
    }
    A.play('victory');
    try { els.btnKeep.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  // the correction on the time card: "has not noticed yet" gets a hand-drawn rust strike, then the fix is written in
  function setVicLine(state, text, animate) {
    var a1 = $('vicLine1'), xo = els.vicXo || $('vicXo'), fix = els.vicFix || $('vicFix');
    xo.classList.remove('struck', 'anim');
    fix.hidden = true;
    if (state === 'act2') { a1.textContent = text; return; }
    a1.innerHTML = 'The Overseer is scrap. Management <span id="vicXo" class="xo">has not noticed yet</span>.';
    xo = $('vicXo'); els.vicXo = xo;
    if (state === 'fixed') { xo.classList.add('struck'); if (animate) xo.classList.add('anim'); fix.hidden = false; }
  }
  // ---- the Chairman falls: stamp one, then Head Office's stamp lands on top of it
  function showFinale(r) {
    vicCard('act2');
    var st = save.stats;
    els.vicStamp.textContent = 'UNDER NEW MANAGEMENT';
    els.vicStamp2.textContent = 'HEAD OFFICE WOULD LIKE A WORD';
    els.vicStamp2.hidden = false;
    setVicLine('act2', 'The Chairman is scrap. The building is yours. His phone is still ringing, and the caller ID says Head Office.');
    els.vicUnlock.hidden = false;
    els.vicUnlock.innerHTML = icon('exec', 18) + '<span>Executive Suite declassified · Sector 11 open</span>';
    var w2 = [6, 7, 8, 9, 10].reduce(function (a, n) { return a + (save.bossKills[n] || 0); }, 0);
    els.vicRows.innerHTML =
      row('Act II shifts', '<b>' + fmt(st.act2Shifts != null ? st.act2Shifts : st.shifts) + '</b>', 'big') +
      row('Act II time on the clock', '<b>' + fmtTime(st.act2PlayTime != null ? st.act2PlayTime : st.playTime) + '</b>', 'big') +
      row('Wardens scrapped, Act II', '<b>' + fmt(w2) + '</b>', 'sub') +
      row('Bolts banked, all shifts', '<b>' + fmt(st.boltsTotal) + '</b>', 'sub');
    els.btnKeep.textContent = 'Workshop'; els.btnVic2.textContent = 'Clock in — The Lobby'; els.btnVic2.hidden = false;
    pendingChairman = true;
    els.btnKeep.onclick = function () { A.play('click'); enterWorkshop({ afterShift: true }); };
    els.btnVic2.onclick = function () { A.play('click'); save.sector = 11; writeStore(); focusAtClockIn(); beginShift(11); };
    if (reduced()) { els.vicStamp.classList.add('now'); els.vicStamp2.classList.add('now'); }
    else {
      later(function () { els.vicStamp.classList.add('in'); A.play('click', { pitch: 0.5, vol: 1.6 }); A.play('classified'); }, 500);
      later(function () { els.vicStamp2.classList.add('in'); A.play('memo'); }, 1700);
    }
    A.play('victory');
    try { els.btnKeep.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  // ---- the Founder falls: the end of the story, then Overtime
  function showFounder(r) {
    vicCard('act3');
    var st = save.stats;
    save.flags.finale = true; writeStore();
    els.vicStamp.textContent = "FOUNDER'S DAY";
    els.vicStamp2.hidden = true;
    setVicLine('act2', 'The Founder is scrap. Sprocket is the company now.');
    els.vicUnlock.hidden = false;
    els.vicUnlock.innerHTML = icon('overtime', 18) + '<span>Overtime is open · No ceiling, no closing time</span>';
    var w3 = [11, 12, 13, 14, 15].reduce(function (a, n) { return a + (save.bossKills[n] || 0); }, 0);
    els.vicRows.innerHTML =
      row('Act III shifts', '<b>' + fmt(st.act3Shifts != null ? st.act3Shifts : st.shifts) + '</b>', 'big') +
      row('Act III time on the clock', '<b>' + fmtTime(st.act3PlayTime != null ? st.act3PlayTime : st.playTime) + '</b>', 'big') +
      row('Wardens scrapped, Act III', '<b>' + fmt(w3) + '</b>', 'sub') +
      row('Shifts, whole story', '<b>' + fmt(st.shifts) + '</b>', 'sub') +
      row('Time, whole story', '<b>' + fmtTime(st.playTime) + '</b>', 'sub') +
      (st.clawed > 0 ? row('Clawed back, all shifts', '<b class="neg">−' + fmt(st.clawed) + '</b>', 'sub') : '') +
      row('Bolts banked, all shifts', '<b>' + fmt(st.boltsTotal) + '</b>', 'sub');
    els.btnKeep.textContent = 'Clock in for Overtime'; els.btnVic2.textContent = 'Workshop'; els.btnVic2.hidden = false;
    els.btnKeep.onclick = function () { A.play('click'); save.sector = OTSEC; writeStore(); focusAtClockIn(); beginShift(OTSEC); };
    els.btnVic2.onclick = function () { A.play('click'); enterWorkshop({ afterShift: true }); };
    if (reduced()) els.vicStamp.classList.add('now');
    else later(function () { els.vicStamp.classList.add('in'); A.play('click', { pitch: 0.5, vol: 1.6 }); }, 500);
    A.play('founder');
    try { els.btnKeep.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  // ================================================================== WORKSHOP
  var cBolts, cCores;
  var codexDirty = true, tab = 'bp', scrollMem = { bp: 0, codex: 0, log: 0 };
  var secTimer = 0;
  var pendingChairman = false, rvTimers = [], rvActive = false;

  function enterWorkshop(o) {
    o = o || {};
    clearRepTimers();
    if (!E.sectorInfo(save, save.sector).unlocked) save.sector = 1;
    setMode('workshop');
    // animate currencies from whatever was shown last
    els.wsCoreWrap.hidden = !(save.cores > 0 || save.stats.coresTotal > 0);
    cBolts.set(save.bolts, !o.boot); cCores.set(save.cores, !o.boot);
    fitHeader();
    closeSheet(true);
    // the Act II reveal (once per save), and the two pay nodes after the Chairman: plates start redacted, then un-redact
    var rvIds = [];
    if (save.flags.act2 && !save.flags.reveal) {
      save.flags.reveal = true; writeStore();
      D.UPGRADES.forEach(function (u) { if (u.gate === 'act2') rvIds.push(u.id); });
    }
    if (save.flags.act3 && !save.flags.reveal3) {          // Act III: Head Office, once per save (an older save that already beat the Chairman gets it too)
      save.flags.reveal3 = true; pendingChairman = false; writeStore();
      D.UPGRADES.forEach(function (u) { if (u.gate === 'chairman') rvIds.push(u.id); });
    }
    finishReveal(true);
    BP.hold = {}; MAP.homed = false;
    if (rvIds.length && !reduced()) rvIds.forEach(function (id) { BP.hold[id] = true; });
    layoutBlueprint();
    refreshAll({ initial: true });
    renderSectors();
    showTab(tab, true);
    if (rvIds.length) startReveal(rvIds, !reduced());
    else if (tab === 'bp') root.requestAnimationFrame(function () { root.requestAnimationFrame(autoScrollCheapest); });
  }
  function startReveal(ids, animate) {
    var first = ids[0], isA2 = ids.every(function (id) { return D.UPGRADE_BY_ID[id].gate === 'act2'; });
    els.wsBannerT.textContent = isA2 ? 'Management has noticed' : 'Head Office would like a word';
    els.wsBannerS.textContent = isA2 ? 'R&D declassified · Sector 6 open' : 'Executive Suite declassified · Sector 11 open';
    if (!isA2) A.play('memo');
    els.wsBanner.style.bottom = els.dock.offsetHeight + 'px';
    els.wsBanner.hidden = false;
    els.wsBanner.style.animation = 'none'; void els.wsBanner.offsetWidth; els.wsBanner.style.animation = '';
    showTab('bp', true);
    if (!animate) {
      root.requestAnimationFrame(function () { scrollNodeIntoView(first, {}); });
      rvTimers.push(root.setTimeout(function () { els.wsBanner.hidden = true; }, 3600));
      return;
    }
    rvActive = true;
    var order = ids.filter(function (id) { return BP.shown[id]; }).sort(function (a, b) { var x = BP.pos[a], y = BP.pos[b]; return (x.x * x.x + x.y * x.y) - (y.x * y.x + y.y * y.y); });
    if (!order.length) { rvTimers.push(root.setTimeout(function () { els.wsBanner.hidden = true; }, 3600)); return; }
    root.requestAnimationFrame(function () {
      var n = BP.nodes[order[0]];
      if (n) panToPoint(BP.pos[order[0]].x, BP.pos[order[0]].y, true);
    });
    order.forEach(function (id, i) {
      rvTimers.push(root.setTimeout(function () {
        delete BP.hold[id];
        refreshNodes({}); updateStamps();
        var n = BP.nodes[id];
        if (n) { n.nw.classList.remove('punch'); void n.nw.offsetWidth; n.nw.classList.add('punch'); }
        A.play('unlock', { pitch: 0.8 + Math.min(0.9, i * 0.07), vol: 0.7 });
        if (i === 0) { var tn = els.secTiles.querySelector('[data-n="' + (isA2 ? 6 : 11) + '"]'); if (tn) { tn.classList.remove('punch'); void tn.offsetWidth; tn.classList.add('punch'); } }
      }, 1100 + i * 170));
    });
    rvTimers.push(root.setTimeout(function () { rvActive = false; BP.hold = {}; refreshAll({ initial: true }); }, 1100 + order.length * 170 + 300));
    rvTimers.push(root.setTimeout(function () { els.wsBanner.hidden = true; }, 4200));
  }
  function finishReveal(quiet) {
    for (var i = 0; i < rvTimers.length; i++) root.clearTimeout(rvTimers[i]);
    rvTimers.length = 0;
    if (BP.hold && Object.keys(BP.hold).length) { BP.hold = {}; if (BP.built && !quiet) { refreshNodes({}); updateStamps(); } }
    rvActive = false;
    els.wsBanner.hidden = true;
  }
  function toTitle() {
    clearRepTimers();
    enterTitle();
  }

  // ---- header / bench
  function drawPortrait() {
    try { var st0 = E.stats(save); S.portrait(els.portrait, 'player', null, { loadout: E.loadout(save), titan: !!st0.titan, colossus: !!st0.colossus }); } catch (e) { /* ignore */ }
  }
  function updateStats(bump) {
    var st = E.stats(save);
    var dps = st.damage * st.targets / st.pulseInterval * (1 + st.critChance * (st.critMult - 1)) + st.drones * st.droneDmg / st.droneInterval;
    var vals = [fnum(dps), F.num(st.maxBattery), F.num(st.radius), '×' + fmult(st.boltMult)];
    var ids = ['stDps', 'stBat', 'stField', 'stBolt'];
    for (var i = 0; i < 4; i++) {
      var el = $(ids[i]);
      if (el.textContent !== vals[i]) {
        el.textContent = vals[i];
        fit(el, 16, 11);
        if (bump && !reduced() && el.animate) el.animate([{ color: '#fff', transform: 'translateY(-2px)' }, { transform: 'none' }], { duration: 400, easing: 'ease-out' });
      }
    }
  }
  // Blueprint tab: stats + sector picker fold into the header bar so the map gets the room; the sector button opens them
  var wsOpen = false;
  function syncSlim() {
    var slim = tab === 'bp' && !wsOpen;
    els.workshop.classList.toggle('slim', slim);
    els.workshop.classList.toggle('notbp', tab !== 'bp');
    els.btnSecBar.setAttribute('aria-expanded', slim ? 'false' : 'true');
    if (BP.built) root.requestAnimationFrame(function () { measureMap(); });
  }
  function updateClockLabel() {
    els.secBarT.textContent = save.sector === OTSEC ? 'OT ' + E.sectorInfo(save, OTSEC).overtime : 'S' + save.sector;
    els.clockLabel.textContent = save.sector === OTSEC ? 'Clock in — Overtime ' + E.sectorInfo(save, OTSEC).overtime : 'Clock in — Sector ' + save.sector;
  }
  function updateBadge() {
    var n = E.affordableCount(save);
    els.bpBadge.hidden = n === 0;
    els.bpBadge.textContent = n;
    els.tabBtnBp.setAttribute('aria-label', 'Blueprint' + (n ? ', ' + plural(n, 'upgrade', 'upgrades') + ' ready' : ''));
    return n;
  }

  // ---- sectors: act tabs (I / II / III / OT) over one row of five tiles, so sixteen sectors never take more than two rows
  var ACTS = [{ key: 'I', lo: 1, hi: 5 }, { key: 'II', lo: 6, hi: 10 }, { key: 'III', lo: 11, hi: 15 }, { key: 'OT', lo: 16, hi: 16 }];
  var BLOCKER = { 5: 'the Titan Frame', 10: 'Hostile Takeover', 15: 'a Majority Stake' };
  var secAct = 0, secKey = '';
  function actOf(n) { return n >= OTSEC ? 3 : n >= 11 ? 2 : n >= 6 ? 1 : 0; }
  function actsOpen() { var f = save.flags; return [true, !!f.act2, !!f.act3, !!f.founder]; }
  function renderSectors(keepAct) {
    var h = els.secTiles, open = actsOpen(), nOpen = open.filter(Boolean).length, n, i;
    if (!keepAct) secAct = actOf(save.sector);
    if (!open[secAct]) secAct = 0;
    els.workshop.classList.toggle('a2', nOpen > 1);
    // act tabs (hidden while only Act I exists, so an early save keeps its single row)
    els.secActs.hidden = nOpen < 2;
    if (nOpen >= 2) {
      var th = '';
      for (i = 0; i < 4; i++) {
        if (!open[i]) continue;
        var ac = ACTS[i], done = 0, tot = ac.hi - ac.lo + 1, sub;
        if (i < 3) { for (n = ac.lo; n <= ac.hi; n++) if (E.sectorInfo(save, n).cleared) done++; sub = done + '/' + tot; }
        else sub = pad(E.sectorInfo(save, OTSEC).overtime, 2);
        th += '<button type="button" class="sact' + (secAct === i ? ' on' : '') + (actOf(save.sector) === i ? ' here' : '') + (i < 3 && done === tot ? ' done' : '') + '" role="tab" aria-selected="' + (secAct === i) + '" data-act="' + i + '" aria-label="' + (i < 3 ? 'Act ' + ac.key + ', ' + done + ' of ' + tot + ' cleared' : 'Overtime') + '"><b>' + ac.key + '</b><span>' + sub + '</span></button>';
      }
      els.secActs.innerHTML = th;
    }
    var ac2 = ACTS[secAct], key = String(secAct);
    if (key !== secKey || !h.children.length) {
      secKey = key; h.innerHTML = '';
      var row = doc.createElement('div'); row.className = 'srow r' + (ac2.hi - ac2.lo + 1);
      for (n = ac2.lo; n <= ac2.hi; n++) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'stile'; b.setAttribute('role', 'radio'); b.setAttribute('data-n', n);
        b.innerHTML = '<span class="st-n"></span><span class="st-mk"></span>';
        row.appendChild(b);
      }
      h.appendChild(row);
    }
    var tiles = h.querySelectorAll('.stile');
    for (i = 0; i < tiles.length; i++) {
      var tl = tiles[i], sn = +tl.getAttribute('data-n'), si = E.sectorInfo(save, sn), isOt = sn === OTSEC;
      tl.className = 'stile' + (isOt ? ' ot' : ' act' + (actOf(sn) + 1)) + (si.cleared && !isOt ? ' cleared' : '') + (!si.unlocked ? ' locked' : '') + (save.sector === sn ? ' sel' : '');
      tl.setAttribute('aria-checked', save.sector === sn ? 'true' : 'false');
      tl.firstChild.textContent = isOt ? 'Overtime ' + pad(si.overtime, 2) : pad(sn, 2);
      fit(tl.firstChild, isOt ? 16 : 22, 12);
      tl.setAttribute('aria-label', isOt ? 'Overtime ' + si.overtime + ', ' + si.bossName
        : 'Sector ' + sn + ', ' + si.name + (si.cleared ? ', cleared' : '') + (!si.unlocked ? ', locked' : '') + (si.lureBlocked ? ', needs ' + BLOCKER[sn] : ''));
      tl.lastChild.innerHTML = !si.unlocked ? icon('lock', 14) : (si.cleared && !isOt) ? icon('check', 14) : (si.lureBlocked ? icon('warn', 14) : '');
    }
    showSectorInfo();
  }
  function showSectorInfo(msg) {
    var n = save.sector, si = E.sectorInfo(save, n);
    els.secInfo.classList.toggle('lockmsg', !!msg);
    if (msg) { els.secInfo.innerHTML = '<span class="note">' + esc(msg) + '</span>'; return; }
    if (n === OTSEC) {
      els.secInfo.innerHTML = '<b>Overtime ' + pad(si.overtime, 2) + '</b><span class="note ot">Warden: ' + esc(si.bossName) + '</span>';
      return;
    }
    els.secInfo.innerHTML = '<b><span class="yd">Yard 9 · </span>Sector ' + pad(n, 2) + ' · ' + esc(si.name) + '</b>' +
      (si.fatigue > 0 ? '<span class="note ok">Board fatigue −' + Math.round(si.fatigue * 100) + '%</span>' : '') +
      (si.lureBlocked ? '<span class="note">' + (n === 10 ? 'Needs Hostile Takeover' : n === 15 ? 'The Founder will not come without a Majority Stake.' : 'The Overseer will not come without the Titan Frame.') + '</span>' : '');
  }
  function pickSector(n) {
    var si = E.sectorInfo(save, n);
    if (!si.unlocked) {
      var prev = E.sectorInfo(save, n - 1);
      A.play('deny');
      showSectorInfo('Scrap ' + lowerThe(prev.bossName) + ' to open ' + si.name + '.');
      root.clearTimeout(secTimer);
      secTimer = root.setTimeout(function () { showSectorInfo(); }, 3200);
      return;
    }
    root.clearTimeout(secTimer);
    save.sector = n; writeStore();
    A.play('click');
    renderSectors(); updateClockLabel();
    if (wsOpen) { wsOpen = false; syncSlim(); }
  }

  // ---- capstone fund: while nothing else is affordable, show how close the Titan Frame / Hostile Takeover is
  function fundTarget() {
    if (!save.flags.won && !save.stats.shifts) return null;
    var best = null, i, ids = ['titan', 'takeover', 'stake'];
    for (i = 0; i < ids.length; i++) {
      var inf = E.upgradeInfo(save, ids[i]);
      if (!inf || inf.classified || !inf.unlocked || inf.maxed || inf.level > 0 || !inf.cost) continue;
      if (!best || inf.cost.bolts < best.cost.bolts) best = inf;
    }
    if (!best || best.affordable || E.affordableCount(save) > 0) return null;
    return best;
  }
  function fundPct(inf, bolts) {
    var r = inf.cost.bolts > 0 ? bolts / inf.cost.bolts : 1;
    return clamp(r, 0, 1);
  }
  function updateFund() {
    var t = fundTarget();
    if (!t || !els.sheet.hidden) { els.fund.hidden = true; return; }
    var c = t.cost, r = Math.min(fundPct(t, save.bolts), c.cores > 0 ? clamp(save.cores / c.cores, 0, 1) : 1);
    els.fund.hidden = false;
    els.fundT.textContent = (t.id === 'titan' ? 'Titan' : t.id === 'stake' ? 'Stake' : 'Takeover') + ' fund ' + Math.floor(r * 100) + '%';
    els.fundS.textContent = (c.cores > 0 ? fmt(Math.min(save.cores, c.cores)) + '/' + fmt(c.cores) + ' cores' : fbig(save.bolts) + '/' + fbig(c.bolts));
    els.fundFill.style.transform = 'scaleX(' + r.toFixed(3) + ')';
  }

  // ---- tabs
  function showTab(t, quiet) {
    scrollMem[tab] = els.pane.scrollTop;
    tab = t;
    var map = { bp: ['tabBp', 'tabBtnBp'], codex: ['tabCodex', 'tabBtnCodex'], log: ['tabLog', 'tabBtnLog'] };
    for (var k in map) {
      $(map[k][0]).hidden = k !== t;
      $(map[k][1]).setAttribute('aria-selected', k === t ? 'true' : 'false');
    }
    if (t !== 'bp') closeSheet(true);
    if (t === 'codex') renderCodex();
    if (t === 'log') renderLog();
    els.pane.classList.toggle('bpmode', t === 'bp');
    syncSlim();
    els.pane.scrollTop = t === 'bp' ? 0 : (scrollMem[t] || 0);
    if (t === 'bp') { layoutBlueprint(); measureMap(); }
    updatePointer();
    if (!quiet) A.play('click');
  }

  // ---- blueprint: a pannable, zoomable radial map. Sprocket sits at the origin, acts grow outward as rings.
  var RING_NAMES = [{ act: 'Act I', name: 'The Yard', short: 'Yard', key: 'I' }, { act: 'Act II', name: 'R&D', short: 'R&D', key: 'II' }, { act: 'Act III', name: 'Executive Suite', short: 'Suite', key: 'III' }];
  var RING_R = [4.35, 7.4];                 // act boundaries in grid units; the outer ring is computed from the data
  var U = 84, ZMIN = 0.2, ZMAX = 1.6, NODE = 50, TAPPX = 36, READ = 48;   // plates under TAPPX on screen are too small to tap; a tap zooms them to READ
  var ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  var BRANCH = { arc: 'Arc', chassis: 'Chassis', salvage: 'Salvage', drones: 'Drones', core: 'Core', rnd: 'R&D', exec: 'Executive' };
  var BP = { N: NODE, nodes: {}, paths: [], defs: [], cache: {}, sel: null, built: false, ptr: null, hold: {}, pos: {}, shown: {}, ghost: {}, st: {}, plates: [], chips: [], R: [4.35, 7.4, 11], bounds: null, world: null };
  var MAP = { tx: 0, ty: 0, z: 1, vw: 0, vh: 0, homed: false, ptrs: {}, nptr: 0, drag: null, pinch: null, raf: 0, anim: 0 };
  var NSVG = 'http://www.w3.org/2000/svg';
  function svgEl(tag, cls) { var e = doc.createElementNS(NSVG, tag); if (cls) e.setAttribute('class', cls); return e; }
  // positions are data (def.pos, grid units). Until a def has one, fan the old grid out around Sprocket.
  var FB_DIR = { arc: [0, -1], salvage: [1, 0], drones: [0, 1], chassis: [-1, 0] }, FB_COL = { arc: 0, chassis: 2, salvage: 3, drones: 4 };
  function fallbackPos(d) {
    var v = FB_DIR[d.branch], row = d.row || 0, col = d.col || 0, a, r;
    if (d.id === 'boot') return [0, 0];
    if (v) { var along = 1 + (row - 1) * 0.95, off = (col - FB_COL[d.branch]) * 1.1; return [v[0] * along - v[1] * off, v[1] * along + v[0] * off]; }
    if (d.branch === 'core') return [-3.7, -3.7];
    if (d.branch === 'exec') { r = 8.2 + (row - 14); a = (135 + (col - 2) * 16) * Math.PI / 180; }
    else { r = 5.2 + (row - 9) * 0.95; a = (-45 + (col - 2) * 16) * Math.PI / 180; }
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  function posOf(d) { return (d.pos && d.pos.length === 2) ? d.pos : fallbackPos(d); }
  function iconOf(d) { return d.icon || d.id; }
  function ringOf(id) { var p = BP.pos[id], r = Math.sqrt(p.x * p.x + p.y * p.y) / U; return r < BP.R[0] ? 0 : r < BP.R[1] ? 1 : 2; }
  // orthogonal polyline -> path with rounded corners
  function rpath(pts, r) {
    var d = 'M' + pts[0][0] + ' ' + pts[0][1], i;
    for (i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      var l1 = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), l2 = Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]);
      var rr = Math.min(r, l1 / 2, l2 / 2);
      var ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1]), vx = Math.sign(c[0] - b[0]), vy = Math.sign(c[1] - b[1]);
      d += 'L' + (b[0] - ux * rr) + ' ' + (b[1] - uy * rr) + 'Q' + b[0] + ' ' + b[1] + ' ' + (b[0] + vx * rr) + ' ' + (b[1] + vy * rr);
    }
    var z = pts[pts.length - 1];
    return d + 'L' + z[0] + ' ' + z[1];
  }
  function segHits(p, q, id1, id2) {
    var h = NODE / 2 + 5, k;
    for (k in BP.pos) {
      if (k === id1 || k === id2) continue;
      var c = BP.pos[k], x0 = c.x - h, x1 = c.x + h, y0 = c.y - h, y1 = c.y + h;
      if (p[0] === q[0]) { if (p[0] > x0 && p[0] < x1 && Math.max(p[1], q[1]) > y0 && Math.min(p[1], q[1]) < y1) return true; }
      else if (p[1] > y0 && p[1] < y1 && Math.max(p[0], q[0]) > x0 && Math.min(p[0], q[0]) < x1) return true;
    }
    return false;
  }
  function route(a, b, ida, idb) {
    var A0 = [a.x, a.y], B0 = [b.x, b.y];
    if (a.x === b.x || a.y === b.y) return [A0, B0];
    var c1 = [b.x, a.y], c2 = [a.x, b.y];
    var ok1 = !segHits(A0, c1, ida, idb) && !segHits(c1, B0, ida, idb), ok2 = !segHits(A0, c2, ida, idb) && !segHits(c2, B0, ida, idb);
    var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    var pick = ok1 && ok2 ? (dx >= dy ? c1 : c2) : ok1 ? c1 : ok2 ? c2 : c1;
    return [A0, pick, B0];
  }
  // level-track octagon, inset from the plate edge, starting at 12 o'clock
  function octPath(N, inset, ch) {
    var a = inset, b = N - inset, m = N / 2, c = ch;
    return 'M' + m + ' ' + a + 'H' + (b - c) + 'L' + b + ' ' + (a + c) + 'V' + (b - c) + 'L' + (b - c) + ' ' + b + 'H' + (a + c) + 'L' + a + ' ' + (b - c) + 'V' + (a + c) + 'L' + (a + c) + ' ' + a + 'H' + m;
  }
  function segPat(m, k) {
    var gp = m <= 6 ? 3 : 2, seg = 100 / m - gp, s = '', i;
    if (k <= 0) return '0 100';
    for (i = 0; i < k; i++) s += seg.toFixed(2) + ' ' + gp + ' ';
    if (k < m) s += '0 ' + Math.max(0.01, 100 - k * (seg + gp)).toFixed(2);
    return s.trim();
  }
  // revealed: owned, or any requirement owned, or nothing required (engine value wins when it exists)
  function isRevealed(def, inf) {
    if (inf && inf.revealed !== undefined) return !!inf.revealed;
    if (inf && inf.level > 0) return true;
    if (!def.requires || !def.requires.length) return true;
    for (var i = 0; i < def.requires.length; i++) if ((save.up[def.requires[i][0]] || 0) > 0 || def.requires[i][0] === 'boot') return true;
    return false;
  }

  function layoutBlueprint() {
    if (BP.built) return;
    var host = els.bp, i, j, k;
    host.innerHTML = '';
    var world = doc.createElement('div'); world.className = 'bp-world'; host.appendChild(world); BP.world = world;
    BP.defs = D.UPGRADES; BP.nodes = {}; BP.paths = []; BP.cache = {}; BP.plates = []; BP.chips = []; BP.pos = {}; BP.shown = {}; BP.ghost = {}; BP.st = {};
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, maxR = 0, N = NODE;
    var iconCount = {};
    for (i = 0; i < BP.defs.length; i++) {
      var d = BP.defs[i], p = posOf(d), px = Math.round(p[0] * U), py = Math.round(p[1] * U);
      BP.pos[d.id] = { x: px, y: py };
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      maxR = Math.max(maxR, Math.sqrt(px * px + py * py) / U);
      iconCount[iconOf(d)] = (iconCount[iconOf(d)] || 0) + 1;
    }
    BP.R = [RING_R[0], RING_R[1], Math.max(10.8, maxR + 1)];
    var PAD = 130;
    x0 -= PAD; x1 += PAD; y0 -= PAD; y1 += PAD;
    BP.bounds = { x0: x0, x1: x1, y0: y0, y1: y1 };
    var grid = doc.createElement('div'); grid.className = 'bp-grid';
    grid.style.left = (x0 - 400) + 'px'; grid.style.top = (y0 - 400) + 'px'; grid.style.width = (x1 - x0 + 800) + 'px'; grid.style.height = (y1 - y0 + 800) + 'px';
    world.appendChild(grid);
    var svg = svgEl('svg', 'traces'), W2 = x1 - x0, H2 = y1 - y0;
    svg.style.left = x0 + 'px'; svg.style.top = y0 + 'px';
    svg.setAttribute('width', W2); svg.setAttribute('height', H2); svg.setAttribute('viewBox', x0 + ' ' + y0 + ' ' + W2 + ' ' + H2);
    for (k = 0; k < 3; k++) { var rc = svgEl('circle', 'ring r' + (k + 1)); rc.setAttribute('cx', 0); rc.setAttribute('cy', 0); rc.setAttribute('r', BP.R[k] * U); svg.appendChild(rc); }
    var byId = {};
    for (i = 0; i < BP.defs.length; i++) byId[BP.defs[i].id] = BP.defs[i];
    function addTrace(pts, parent, child, need) {
      var dd = rpath(pts, 10);
      var g = svgEl('g', 'tg gone');
      var halo = svgEl('path', 'th'); halo.setAttribute('d', dd);
      var pt = svgEl('path', 'tr'); pt.setAttribute('d', dd);
      var cur = svgEl('path', 'flw'); cur.setAttribute('d', dd);
      g.appendChild(halo); g.appendChild(pt); g.appendChild(cur);
      for (var q = 1; q < pts.length - 1; q++) { var pad = svgEl('circle', 'pad'); pad.setAttribute('cx', pts[q][0]); pad.setAttribute('cy', pts[q][1]); pad.setAttribute('r', 2.8); g.appendChild(pad); }
      svg.appendChild(g);
      BP.paths.push({ g: g, d: dd, parent: parent, child: child, need: need, lit: null, mode: '' });
    }
    for (i = 0; i < BP.defs.length; i++) {
      var dd0 = BP.defs[i];
      if (dd0.id === 'boot') continue;
      var reqs = dd0.requires.length ? dd0.requires : [['boot', 1]];   // roots hang off Sprocket
      for (j = 0; j < reqs.length; j++) {
        if (!byId[reqs[j][0]]) continue;
        addTrace(route(BP.pos[reqs[j][0]], BP.pos[dd0.id], reqs[j][0], dd0.id), reqs[j][0], dd0.id, reqs[j][1]);
      }
    }
    var gs = svgEl('g'); svg.appendChild(gs); BP.sparks = gs;
    world.appendChild(svg);
    // act ring plates: sit on their ring wherever the nodes leave the most room
    for (k = 0; k < 3; k++) {
      var R = BP.R[k] * U, best = [0, -R], bd = -1, a;
      for (a = -180; a < 180; a += 5) {
        var lx = Math.cos(a * Math.PI / 180) * R, ly = Math.sin(a * Math.PI / 180) * R, md = 1e9, id;
        for (id in BP.pos) { var dx = lx - BP.pos[id].x, dy = ly - BP.pos[id].y, dist = Math.sqrt(dx * dx + dy * dy); if (dist < md) md = dist; }
        if (md > bd + 1) { bd = md; best = [lx, ly]; }
      }
      var rn = RING_NAMES[k], pl = doc.createElement('div');
      pl.className = 'sec-plate s' + (k + 1);
      pl.style.left = Math.round(best[0] - 92) + 'px'; pl.style.top = Math.round(best[1] - 17) + 'px';
      pl.innerHTML = '<span class="sp-t"><b class="sp-act">' + rn.act + '</b><span class="sp-name"><u>' + esc(rn.name) + '</u></span></span><span class="sp-ct"><b></b><em></em></span><span class="sp-bar"><i></i></span><span class="sp-cls">Classified</span>';
      world.appendChild(pl);
      BP.plates.push({ el: pl, ct: pl.querySelector('.sp-ct b'), tot: pl.querySelector('.sp-ct em'), bar: pl.querySelector('.sp-bar i'), key: '', pos: { x: best[0], y: best[1] } });
    }
    var ptr = doc.createElement('div'); ptr.className = 'bp-ptr'; ptr.hidden = true;
    ptr.innerHTML = '<span>Tap to upgrade</span><i></i>';
    world.appendChild(ptr);
    BP.ptr = ptr;
    // nodes
    for (i = 0; i < BP.defs.length; i++) {
      var df = BP.defs[i], cc = BP.pos[df.id];
      var nw = doc.createElement('div'); nw.className = 'nw gone'; nw.setAttribute('data-b', df.branch);
      nw.style.left = (cc.x - N / 2) + 'px'; nw.style.top = (cc.y - N / 2) + 'px'; nw.style.width = N + 'px'; nw.style.height = N + 'px';
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'node'; b.setAttribute('data-id', df.id);
      var inner = '';
      if (df.id !== 'boot') inner += '<svg class="lvl" viewBox="0 0 ' + N + ' ' + N + '" aria-hidden="true"><path class="lt" pathLength="100" d="' + octPath(N, 3.2, 6.4) + '"/><path class="lf" pathLength="100" d="' + octPath(N, 3.2, 6.4) + '"/></svg>';
      inner += '<span class="face"></span><span class="ni">' + icon(iconOf(df), 22) + '</span>';
      if (df.id !== 'boot') inner += '<span class="nl"></span>';
      if (df.tier > 0) inner += '<span class="nbadge">' + (ROMAN[df.tier] || df.tier) + '</span>';
      inner += '<span class="nlock">' + icon('lock', 12) + '</span><span class="nck">' + icon('check', 12) + '</span><span class="rd"><i></i><i></i><i></i></span>';
      b.innerHTML = inner;
      var fx = doc.createElement('span'); fx.className = 'fx';
      nw.appendChild(fx); nw.appendChild(b); world.appendChild(nw);
      BP.nodes[df.id] = { nw: nw, btn: b, nl: b.querySelector('.nl'), ni: b.querySelector('.ni'), lf: b.querySelector('.lf'), lt: b.querySelector('.lt'), svg: b.querySelector('.lvl'), fx: fx, cls: false, prevUnlocked: null, prevAff: null, prevShown: null, trk: '', ico: iconOf(df) };
    }
    var jh = '';
    for (k = 0; k < 3; k++) jh += '<button type="button" class="jchip" data-s="' + k + '"><b>' + RING_NAMES[k].key + '</b><span>' + esc(RING_NAMES[k].short) + '</span><i class="jdot" hidden></i><span class="jlock" hidden>' + icon('lock', 12) + '</span></button>';
    els.bpJump.innerHTML = jh;
    BP.chips = els.bpJump.querySelectorAll('.jchip');
    BP.built = true;
    BP.cache = {};
  }

  // ---- the map camera: tx/ty are the screen position of Sprocket, z the zoom; only a transform ever changes
  function measureMap() {
    var w = els.bp.clientWidth, h = els.bp.clientHeight;
    if (!w || !h) return false;
    var changed = w !== MAP.vw || h !== MAP.vh;
    MAP.vw = w; MAP.vh = h;
    if (!MAP.homed && BP.built) { homeView(false); MAP.homed = true; }
    else if (changed) setView(MAP.tx, MAP.ty, MAP.z);
    return true;
  }
  function clampView() {
    var b = BP.bounds, z = MAP.z;
    if (!b || !MAP.vw) return;
    var cx = clamp((MAP.vw / 2 - MAP.tx) / z, b.x0, b.x1), cy = clamp((MAP.vh / 2 - MAP.ty) / z, b.y0, b.y1);
    MAP.tx = MAP.vw / 2 - cx * z; MAP.ty = MAP.vh / 2 - cy * z;
  }
  function setView(tx, ty, z) {
    MAP.z = clamp(z, ZMIN, ZMAX); MAP.tx = tx; MAP.ty = ty;
    clampView();
    if (!MAP.raf) MAP.raf = root.requestAnimationFrame(applyView);
  }
  function applyView() {
    MAP.raf = 0;
    if (!BP.world) return;
    BP.world.style.transform = 'translate3d(' + MAP.tx.toFixed(1) + 'px,' + MAP.ty.toFixed(1) + 'px,0) scale(' + MAP.z.toFixed(4) + ')';
    // which act ring is the view looking at
    if (BP.chips && BP.chips.length && MAP.vw) {
      var cx = (MAP.vw / 2 - MAP.tx) / MAP.z, cy = (MAP.vh / 2 - MAP.ty) / MAP.z, r = Math.sqrt(cx * cx + cy * cy) / U, act = r < BP.R[0] ? 0 : r < BP.R[1] ? 1 : 2;
      for (var i = 0; i < BP.chips.length; i++) BP.chips[i].classList.toggle('on', i === act);
    }
    els.bp.classList.toggle('lowz', MAP.z < 0.7);
    flowPause();
  }
  function stopAnim() { if (MAP.anim) { root.cancelAnimationFrame(MAP.anim); MAP.anim = 0; } }
  function animView(tx, ty, z, ms) {
    stopAnim();
    if (reduced() || !ms) { setView(tx, ty, z); return; }
    var f = { tx: MAP.tx, ty: MAP.ty, z: MAP.z }, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = clamp((ts - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 3);
      setView(f.tx + (tx - f.tx) * e, f.ty + (ty - f.ty) * e, f.z + (z - f.z) * e);
      MAP.anim = p < 1 ? root.requestAnimationFrame(step) : 0;
    }
    MAP.anim = root.requestAnimationFrame(step);
  }
  function zoomAt(px, py, nz) {
    nz = clamp(nz, ZMIN, ZMAX);
    var wx = (px - MAP.tx) / MAP.z, wy = (py - MAP.ty) / MAP.z;
    setView(px - wx * nz, py - wy * nz, nz);
  }
  // fit a world-space box (plate centres, plus a plate of margin) into the visible map, above whatever the sheet covers
  function fitBox(x0, y0, x1, y1, smooth, zmin) {
    var cov = coveredH(), m = NODE / 2 + 12, w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
    var z = clamp(Math.min(MAP.vw / w, (MAP.vh - cov) / h), zmin || ZMIN, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    animView(MAP.vw / 2 - cx * z, (MAP.vh - cov) / 2 - cy * z, z, smooth ? 280 : 0);
  }
  function homeView(animate) {
    if (!MAP.vw) return;
    var id, x0 = 0, y0 = 0, x1 = 0, y1 = 0;      // Sprocket at the origin is always in
    for (id in BP.pos) if (BP.shown[id] || BP.ghost[id]) { var p = BP.pos[id]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    fitBox(x0, y0, x1, y1, animate, ZMIN);       // every revealed plate plus the ring of ghosts beyond them
  }
  function coveredH() { return els.sheet.hidden ? 0 : els.sheet.offsetHeight; }
  function panToPoint(x, y, smooth) {
    var cov = coveredH();
    animView(MAP.vw / 2 - x * MAP.z, (MAP.vh - cov) / 2 - y * MAP.z, MAP.z, smooth ? 280 : 0);
  }
  function scrollNodeIntoView(id, opts) {
    var p = BP.pos[id]; if (!p || !MAP.vw) return;
    var cov = coveredH(), sx = MAP.tx + p.x * MAP.z, sy = MAP.ty + p.y * MAP.z, m = NODE * MAP.z / 2 + 14;
    if (sx >= m && sx <= MAP.vw - m && sy >= m + 4 && sy <= MAP.vh - cov - m) return;
    panToPoint(p.x, p.y, opts && opts.smooth);
  }
  function autoScrollCheapest() {
    if (tab !== 'bp') return;
    measureMap();
    var id = cheapestAffordable();
    if (id) scrollNodeIntoView(id, { smooth: true });
  }
  function jumpTo(k) {
    var id, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (id in BP.pos) {
      if (ringOf(id) !== k || !(BP.shown[id] || BP.ghost[id])) continue;
      var q = BP.pos[id]; n++;
      if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
    }
    if (!n) { var f = BP.plates[k].pos; panToPoint(f.x, f.y, true); }
    else fitBox(x0, y0, x1, y1, true, ZMIN);   // frame the whole act ring
    A.play('click', { pitch: 1.2, vol: 0.7 });
  }
  // ---- gestures: one finger pans, two pinch, a tap that moves less than 8 px is a tap
  var lastPan = 0;
  function now() { return root.performance.now(); }
  function scrollGuard() { return now() - lastPan < 250; }
  function mapXY(e) { var r = els.bp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onMapDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAnim();
    var q = mapXY(e);
    MAP.ptrs[e.pointerId] = { x: q.x, y: q.y }; MAP.nptr++;
    try { els.bp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (MAP.nptr === 1) MAP.drag = { id: e.pointerId, sx: q.x, sy: q.y, tx0: MAP.tx, ty0: MAP.ty, moved: false, t0: now() };
    else if (MAP.nptr === 2) {
      var ids = Object.keys(MAP.ptrs), a = MAP.ptrs[ids[0]], b = MAP.ptrs[ids[1]];
      MAP.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: MAP.z, ids: ids };
      if (MAP.drag) MAP.drag.moved = true;
    }
  }
  function onMapMove(e) {
    var pt = MAP.ptrs[e.pointerId]; if (!pt) return;
    var q = mapXY(e);
    pt.x = q.x; pt.y = q.y;
    if (MAP.pinch && MAP.nptr >= 2) {
      var a = MAP.ptrs[MAP.pinch.ids[0]], b = MAP.ptrs[MAP.pinch.ids[1]];
      if (!a || !b) return;
      var d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(mx, my, MAP.pinch.z0 * d / MAP.pinch.d0);
      lastPan = now();
      return;
    }
    var dr = MAP.drag;
    if (!dr || dr.id !== e.pointerId) return;
    if (!dr.moved && Math.hypot(q.x - dr.sx, q.y - dr.sy) < 8) return;
    dr.moved = true; lastPan = now();
    setView(dr.tx0 + (q.x - dr.sx), dr.ty0 + (q.y - dr.sy), MAP.z);
    if (e.cancelable) e.preventDefault();
  }
  function onMapUp(e) {
    var pt = MAP.ptrs[e.pointerId]; if (!pt) return;
    delete MAP.ptrs[e.pointerId]; MAP.nptr = Math.max(0, MAP.nptr - 1);
    try { els.bp.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var dr = MAP.drag;
    if (MAP.pinch && MAP.nptr < 2) { MAP.pinch = null; lastPan = now(); if (MAP.nptr === 1) { var k = Object.keys(MAP.ptrs)[0]; MAP.drag = { id: +k, sx: MAP.ptrs[k].x, sy: MAP.ptrs[k].y, tx0: MAP.tx, ty0: MAP.ty, moved: true, t0: now() }; } else MAP.drag = null; return; }
    if (!dr || dr.id !== e.pointerId) return;
    MAP.drag = null;
    if (dr.moved) { lastPan = now(); return; }
    if (e.type === 'pointercancel') return;
    var el = doc.elementFromPoint(e.clientX, e.clientY), ctl = el && el.closest ? el.closest('button:not(.node), .bp-ctl') : null;
    var q = mapXY(e), id = ctl ? null : plateNear(q.x, q.y);
    if (!id) { if (!els.sheet.hidden) closeSheet(); return; }
    if (NODE * MAP.z < TAPPX) { zoomToTap(q.x, q.y); return; }   // plates too small to hit: a tap zooms in, it does not open a sheet
    tapNode(id);
  }
  // nearest revealed plate whose centre is within a generous reach of the tap (screen px, map-local)
  function plateNear(x, y) {
    var half = NODE * MAP.z / 2, reach = Math.max(22, half + 8), best = null, bd = 1e9, id;
    for (id in BP.pos) {
      if (!BP.shown[id]) continue;
      var p = BP.pos[id], d = Math.hypot(MAP.tx + p.x * MAP.z - x, MAP.ty + p.y * MAP.z - y);
      if (d <= reach && d < bd) { bd = d; best = id; }
    }
    return best;
  }
  // smooth zoom to a readable level (plates about 48 px), the tapped spot moved to the middle of the visible map
  function zoomToTap(x, y) {
    var nz = clamp(READ / NODE, ZMIN, ZMAX), wx = (x - MAP.tx) / MAP.z, wy = (y - MAP.ty) / MAP.z, cov = coveredH();
    A.play('click', { pitch: 1.2, vol: 0.6 });
    animView(MAP.vw / 2 - wx * nz, (MAP.vh - cov) / 2 - wy * nz, nz, 260);
  }
  function tapNode(id) {
    if (BP.sel === id && !els.sheet.hidden) { closeSheet(); return; }
    A.play('click', { pitch: 1.3, vol: 0.7 });
    openSheet(id);
  }
  function onMapWheel(e) {
    e.preventDefault();
    var q = mapXY(e);
    zoomAt(q.x, q.y, MAP.z * Math.exp(-e.deltaY * 0.0015));
  }
  function panBy(dx, dy) { stopAnim(); setView(MAP.tx + dx, MAP.ty + dy, MAP.z); }
  function zoomBtn(f) { stopAnim(); zoomAt(MAP.vw / 2, (MAP.vh - coveredH()) / 2, MAP.z * f); A.play('click', { pitch: f > 1 ? 1.3 : 1, vol: 0.6 }); }
  // the lit traces carry a slow current; it rests while the map is moving
  var flowT = 0;
  function flowPause() {
    if (!BP.world) return;
    BP.world.classList.add('moving');
    root.clearTimeout(flowT);
    flowT = root.setTimeout(function () { BP.world.classList.remove('moving'); }, 260);
  }

  function refreshAll(o) {
    o = o || {};
    if (save.cores > 0 || save.stats.coresTotal > 0) els.wsCoreWrap.hidden = false;
    cBolts.set(save.bolts, !o.initial); cCores.set(save.cores, !o.initial);
    fitHeader();
    refreshNodes(o);
    refreshTraces(o);
    updateStats(!o.initial);
    updateClockLabel();
    updateBadge(); updateFund();
    if (o.portrait !== false) drawPortrait();
    if (BP.sel && !els.sheet.hidden) renderSheet();
    updatePointer();
  }
  // first Workshop visit: point at the cheapest thing you can already buy, until the first purchase is made
  function updatePointer() {
    var ptr = BP.ptr;
    if (!ptr) return;
    var id = (!save.flags.shopped && tab === 'bp' && !BP.sel) ? cheapestAffordable() : null;
    els.bp.classList.toggle('pointing', !!id);
    if (!id || !BP.nodes[id]) { ptr.hidden = true; return; }
    var p = BP.pos[id];
    ptr.style.left = (p.x - 62) + 'px'; ptr.style.top = (p.y - NODE / 2 - 34) + 'px';
    ptr.lastChild.style.marginLeft = '55px';
    ptr.hidden = false;
  }
  function lvText(l) { var t = fmt(l); return t.length <= 3 ? 'LV ' + t : t; }
  function nodeCls(inf) { return !!(inf.classified || (BP.hold && BP.hold[inf.id])); }
  function setTrack(n, inf, hide) {
    var key = hide ? 'x' : inf.max === null ? 'inf' : inf.max + ':' + Math.min(inf.level, inf.max);
    if (n.trk === key) return;
    n.trk = key;
    n.svg.style.display = hide ? 'none' : '';
    if (hide) return;
    if (inf.max === null) { n.svg.setAttribute('class', 'lvl inf'); n.lf.setAttribute('stroke-dasharray', '3 2'); n.lt.removeAttribute('stroke-dasharray'); return; }
    n.svg.setAttribute('class', 'lvl');
    if (inf.max <= 12) { n.lt.setAttribute('stroke-dasharray', segPat(inf.max, inf.max)); n.lf.setAttribute('stroke-dasharray', segPat(inf.max, Math.min(inf.level, inf.max))); }
    else { n.lt.removeAttribute('stroke-dasharray'); n.lf.setAttribute('stroke-dasharray', (100 * Math.min(1, inf.level / inf.max)).toFixed(2) + ' 100'); }
  }
  function refreshNodes(o) {
    if (!BP.built) return;
    o = o || {};
    var aff = [false, false, false], i, id, inf, infs = {}, defs = BP.defs;
    // pass 1: who is on the map (revealed), who is a faint ghost one step beyond the frontier
    for (i = 0; i < defs.length; i++) {
      id = defs[i].id; inf = E.upgradeInfo(save, id); infs[id] = inf;
      BP.shown[id] = id === 'boot' || isRevealed(defs[i], inf);
    }
    for (i = 0; i < defs.length; i++) {
      id = defs[i].id; var g = false;
      if (!BP.shown[id]) for (var j = 0; j < defs[i].requires.length; j++) if (BP.shown[defs[i].requires[j][0]]) { g = true; break; }
      BP.ghost[id] = g;
    }
    // pass 2: paint what changed
    for (i = 0; i < defs.length; i++) {
      id = defs[i].id; inf = infs[id];
      var n = BP.nodes[id], cls = nodeCls(inf), shown = BP.shown[id], ghost = BP.ghost[id];
      BP.st[id] = { aff: !!(inf.affordable && !cls && shown), maxed: !!inf.maxed, cls: cls };
      if (inf.affordable && !cls && shown) aff[ringOf(id)] = true;
      var key = inf.level + '|' + (inf.unlocked ? 1 : 0) + (inf.affordable ? 1 : 0) + (inf.maxed ? 1 : 0) + (BP.sel === id ? 1 : 0) + (cls ? 'c' : '') + (shown ? 's' : ghost ? 'g' : 'x');
      if (BP.cache[id] === key) continue;
      BP.cache[id] = key;
      var isBoot = id === 'boot', unl = inf.unlocked && !cls;
      n.btn.className = 'node' + (BP.sel === id ? ' sel' : '') + (cls ? ' cls' : '') + (!unl && !cls ? ' locked' : '') + (inf.maxed ? ' maxed' : (inf.level > 0 && !isBoot && !cls ? ' owned' : '')) + (inf.affordable && !cls ? ' aff' : '') + (isBoot ? ' boot' : '');
      n.nw.className = 'nw' + (shown ? '' : ghost ? ' ghost' : ' gone') + (inf.affordable && !cls && shown ? ' aff' : '') + (BP.sel === id ? ' sel' : '');
      n.btn.tabIndex = shown ? 0 : -1;
      if (cls !== n.cls) { n.cls = cls; n.ni.innerHTML = cls ? '' : icon(n.ico, 22); }
      if (n.nl) n.nl.textContent = inf.max === null ? lvText(inf.level) : inf.level + '/' + inf.max;
      if (!isBoot) setTrack(n, inf, cls);
      n.btn.setAttribute('aria-label', cls ? 'Classified, ' + classifiedHint(id)
        : inf.name + (isBoot ? ', base frame' : inf.max === null ? ', level ' + inf.level + ', no limit' : ', level ' + inf.level + ' of ' + inf.max) + (inf.maxed && !isBoot ? ', maxed' : '') + (!inf.unlocked ? ', locked' : '') + (inf.affordable ? ', can afford' : ''));
      if (!o.initial && !reduced()) {
        if (n.prevShown === false && shown) popIn(n);
        else if (n.prevUnlocked === false && unl) {
          n.nw.classList.add('unl');
          (function (nw) { root.setTimeout(function () { nw.classList.remove('unl'); }, 750); })(n.nw);
        }
        if (n.prevAff === false && inf.affordable && !cls && BP.sel !== id) flashFx(n, 'flash');
      }
      n.prevUnlocked = unl; n.prevAff = !!inf.affordable; n.prevShown = shown;
    }
    updateStamps();
    updateJump(aff);
  }
  function popIn(n) {
    if (n.nw.animate) n.nw.animate([{ transform: 'scale(.35)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: .65 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'ease-out' });
  }
  function flashFx(n, cls) { n.nw.classList.remove('buyfx', 'flash'); void n.nw.offsetWidth; n.nw.classList.add(cls); }
  function classifiedHint(id) { return D.UPGRADE_BY_ID[id].gate === 'chairman' ? 'scrap the Chairman' : 'scrap the Overseer'; }
  // act ring plates: progress of capped levels, or a redacted plate while every node in the ring is classified
  function updateStamps() {
    if (!BP.built) return;
    var k, j;
    for (k = 0; k < 3; k++) {
      var pl = BP.plates[k], owned = 0, total = 0, nodes = 0, cl = 0;
      for (j = 0; j < BP.defs.length; j++) {
        var d = BP.defs[j];
        if (d.id === 'boot' || ringOf(d.id) !== k) continue;
        nodes++;
        var s = BP.st[d.id];
        if (s && s.cls) cl++;
        if (d.max === Infinity) continue;
        total += d.max; owned += Math.min(save.up[d.id] || 0, d.max);
      }
      var redacted = nodes > 0 && cl === nodes, key = (redacted ? 'c' : '') + owned + '/' + total;
      if (key === pl.key) continue;
      pl.key = key;
      pl.el.classList.toggle('cls', redacted);
      pl.el.classList.toggle('full', total > 0 && owned >= total);
      pl.el.setAttribute('aria-label', RING_NAMES[k].act + ', ' + (redacted ? 'classified' : RING_NAMES[k].name + ', ' + owned + ' of ' + total + ' levels'));
      pl.ct.textContent = fmt(owned); pl.tot.textContent = '/' + fmt(total);
      pl.bar.style.transform = 'scaleX(' + (total ? owned / total : 0).toFixed(3) + ')';
      BP.plates[k].redacted = redacted;
    }
  }
  function updateJump(aff) {
    if (!BP.chips || !BP.chips.length) return;
    for (var i = 0; i < 3; i++) {
      var ch = BP.chips[i], cl = !!BP.plates[i].redacted;
      ch.classList.toggle('cls', cl);
      var jd = ch.querySelector('.jdot'); jd.hidden = !aff[i];
      jd.setAttribute('role', 'img'); jd.setAttribute('aria-label', 'Something new to buy here'); jd.setAttribute('title', 'Something new to buy here');
      ch.setAttribute('title', aff[i] ? RING_NAMES[i].act + ': something new to buy here' : RING_NAMES[i].act);
      ch.querySelector('.jlock').hidden = !cl;
      ch.setAttribute('aria-label', 'Pan to ' + RING_NAMES[i].act + (cl ? ', classified' : '') + (aff[i] ? ', upgrade ready' : ''));
    }
  }
  function refreshTraces(o) {
    var lit = [];
    for (var i = 0; i < BP.paths.length; i++) {
      var p = BP.paths[i], on = E.upgradeInfo(save, p.parent).level >= (p.need || 1);
      var mode = BP.shown[p.parent] && BP.shown[p.child] ? 'on' : (BP.shown[p.parent] && BP.ghost[p.child]) ? 'ghost' : 'gone';
      if (on !== p.lit || mode !== p.mode) {
        p.mode = mode;
        if (on && !p.lit) lit.push(p);
        p.lit = on; p.g.setAttribute('class', 'tg' + (mode === 'gone' ? ' gone' : mode === 'ghost' ? ' ghost' : '') + (on && mode === 'on' ? ' lit' : ''));
      }
    }
    return lit;
  }
  function sparkFrom(id) {
    if (reduced() || !BP.sparks) return;
    for (var i = 0; i < BP.paths.length; i++) {
      var p = BP.paths[i];
      if ((p.parent !== id && p.child !== id) || p.mode !== 'on') continue;
      var s = svgEl('path', 'sp');
      s.setAttribute('d', p.d); s.setAttribute('pathLength', '100');
      s.addEventListener('animationend', (function (el) { return function () { if (el.parentNode) el.parentNode.removeChild(el); }; })(s));
      BP.sparks.appendChild(s);
    }
  }

  function cheapestAffordable() {
    var best = null, bc = Infinity;
    for (var i = 0; i < BP.defs.length; i++) {
      var inf = E.upgradeInfo(save, BP.defs[i].id);
      if (inf.affordable && inf.id !== 'boot' && BP.shown[inf.id]) { var c = inf.cost.bolts + inf.cost.cores * 1e6; if (c < bc) { bc = c; best = inf.id; } }
    }
    return best;
  }

  // ---- detail sheet
  function openSheet(id) {
    BP.sel = id;
    els.sheet.hidden = false;
    if (wsOpen) { wsOpen = false; syncSlim(); }
    els.workshop.classList.add('sheeting');      // the sector picker steps aside so the map keeps room above the sheet
    els.sheet.style.bottom = els.dock.offsetHeight + 'px';
    els.sheet.style.animation = 'none'; void els.sheet.offsetWidth; els.sheet.style.animation = '';
    updateFund();
    refreshNodes({});
    renderSheet();
    measureMap();
    updatePointer();
    root.requestAnimationFrame(function () { centreAbove(id); });
  }
  // put the selected plate in the middle of the map above the sheet, zooming up first if plates would be unreadably small
  function centreAbove(id) {
    var p = BP.pos[id]; if (!p || !MAP.vw || BP.sel !== id) return;
    measureMap();
    var z = NODE * MAP.z < TAPPX ? clamp(READ / NODE, ZMIN, ZMAX) : MAP.z, cov = coveredH();
    animView(MAP.vw / 2 - p.x * z, (MAP.vh - cov) / 2 - p.y * z, z, 280);
  }
  function closeSheet(quiet) {
    if (els.sheet.hidden && !BP.sel) return;
    var was = BP.sel;
    BP.sel = null;
    els.sheet.hidden = true;
    els.workshop.classList.remove('sheeting');
    measureMap();
    stopHold();
    updateFund();
    if (was) refreshNodes({});
    updatePointer();
  }
  function maxPreview(id) {
    var c = {}, k; for (k in save) c[k] = save[k];
    c.up = {}; for (k in save.up) c.up[k] = save.up[k];
    var n = 0; while (n < 400 && E.buy(c, id)) n++;
    return n;
  }
  function costRow(kind, have, need) {
    var ok = have >= need, pct = need > 0 ? Math.min(1, have / need) : 1;
    var pt = ok ? 'Ready' : (pct < 0.01 ? '<1%' : Math.floor(pct * 100) + '%') + ' · ' + fmt(need - have) + ' short';
    return '<div class="cst ' + kind + (ok ? ' ok' : ' short') + '"><span class="ci">' + icon(kind === 'bolt' ? 'bolt' : 'core', 18) + '<span class="cn">' + fmt(need) + '</span></span><span class="mt"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></span><span class="cp">' + pt + '</span></div>';
  }
  function renderSheet() {
    var id = BP.sel, inf = E.upgradeInfo(save, id);
    if (!inf) return;
    var isBoot = id === 'boot', cls = nodeCls(inf), def = D.UPGRADE_BY_ID[id];
    var head = els.sheet.querySelector('.ns-head');
    els.sheet.setAttribute('data-b', inf.branch);
    els.nsIcon.innerHTML = icon(cls ? 'classified' : id, 26);
    els.nsName.textContent = cls ? 'CLASSIFIED' : inf.name;
    els.nsBranch.textContent = cls ? 'Redacted' : (BRANCH[inf.branch] || inf.branch);
    els.nsLevel.textContent = cls ? 'REDACTED' : isBoot ? 'BASE FRAME' : inf.maxed ? 'MAXED' : inf.max === null ? 'Level ' + fmt(inf.level) : 'Level ' + inf.level + ' of ' + inf.max;
    els.nsDesc.textContent = cls ? '' : inf.desc;
    var nowRow = els.nsNow.parentNode.parentNode;
    nowRow.hidden = cls || (!isBoot && !inf.unlocked && !inf.maxed);
    els.nsNow.textContent = cls ? '' : inf.now;
    els.nsNext.parentNode.hidden = els.nsNow.parentNode.nextElementSibling.hidden = !!inf.maxed;
    els.nsNext.textContent = inf.next || '';
    // level track
    var t = els.nsTrack, th = '', i;
    if (cls || isBoot || inf.max === null) t.hidden = true;
    else {
      t.hidden = false;
      if (inf.max <= 12) { for (i = 0; i < inf.max; i++) th += '<i' + (i < inf.level ? ' class="f"' : '') + '></i>'; t.className = 'ns-track seg'; }
      else { th = '<i class="bar" style="transform:scaleX(' + (inf.level / inf.max).toFixed(3) + ')"></i>'; t.className = 'ns-track cont'; }
      t.innerHTML = th;
    }
    // requirements while locked
    var rq = els.nsReq;
    if (!cls && !isBoot && !inf.unlocked && (def.requires.length || inf.actReq)) {
      var rh = '<li class="lbl">Needs</li>';
      def.requires.forEach(function (r) {
        var have = E.upgradeInfo(save, r[0]).level, ok = have >= r[1];
        rh += '<li class="' + (ok ? 'ok' : 'no') + '">' + icon(ok ? 'check' : 'close', 14) + '<span>' + esc(D.UPGRADE_BY_ID[r[0]].name) + (r[1] > 1 ? ' ' + r[1] : '') + '</span></li>';
      });
      if (inf.actReq) {
        var ar = inf.actReq, aok = ar.have >= ar.need, an = typeof ar.act === 'number' ? ['I', 'II', 'III'][ar.act - 1] || ar.act : ar.act;
        rh += '<li class="act ' + (aok ? 'ok' : 'no') + '">' + icon(aok ? 'check' : 'close', 14) + '<span>' + fmt(ar.have) + ' / ' + fmt(ar.need) + ' Act ' + esc(an) + ' levels</span><i class="ab"><b style="transform:scaleX(' + clamp(ar.need > 0 ? ar.have / ar.need : 1, 0, 1).toFixed(3) + ')"></b></i></li>';
      }
      rq.innerHTML = rh; rq.hidden = false;
    } else { rq.hidden = true; rq.innerHTML = ''; }
    var h = '', btn = els.btnBuy, mx = els.btnMax;
    if (cls) {
      h = '<span class="lockmsg">' + icon('lock', 16) + 'Classified — ' + classifiedHint(id) + '</span>';
      btn.hidden = false; btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Locked'; mx.hidden = true;
    }
    else if (isBoot) { h = ''; btn.hidden = true; mx.hidden = true; }
    else if (inf.maxed) { h = '<span class="maxmsg">Maxed out</span>'; btn.hidden = true; mx.hidden = true; }
    else {
      var c = inf.cost;
      if (inf.unlocked && inf.affordable) h = '<div class="cst-all">' + icon('check', 16) + '<span>Can afford</span><span class="ci2">' + icon('bolt', 16) + fmt(c.bolts) + (c.cores > 0 ? icon('core', 16) + fmt(c.cores) : '') + '</span></div>';
      else {
        h = costRow('bolt', save.bolts, c.bolts);
        if (c.cores > 0) h += costRow('core', save.cores, c.cores);
      }
      btn.hidden = false; mx.hidden = false;
      if (!inf.unlocked) {
        btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Locked';
        mx.setAttribute('aria-disabled', 'true'); mx.textContent = 'Max'; mx.removeAttribute('data-n');
      } else {
        btn.textContent = 'Bolt on';
        if (inf.affordable) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
        var mn = inf.affordable ? maxPreview(id) : 0;
        mx.textContent = mn > 1 ? 'Max +' + fmt(mn) : 'Max';
        mx.setAttribute('data-n', String(mn));
        if (mn > 0) mx.removeAttribute('aria-disabled'); else mx.setAttribute('aria-disabled', 'true');
      }
    }
    els.nsCost.innerHTML = h;
  }

  var holdT = 0, holdN = 0, holding = false;
  function buyFx(id, before) {
    var n = BP.nodes[id];
    if (n && !reduced()) {
      if (n.nw.animate) n.nw.animate([{ transform: 'scale(1.22)' }, { transform: 'scale(.95)', offset: .6 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      flashFx(n, 'buyfx');
    }
    if (before === 0) sparkFrom(id);
  }
  function doBuy() {
    var id = BP.sel; if (!id) return false;
    var before = E.upgradeInfo(save, id);
    if (E.buy(save, id)) {
      A.play('buy', { pitch: 1 + Math.min(0.5, before.level * 0.02) });
      save.flags.shopped = true;
      writeStore();
      refreshAll({});
      buyFx(id, before.level);
      return true;
    }
    denyShake();
    return false;
  }
  function doMax() {
    var id = BP.sel; if (!id) return false;
    var before = E.upgradeInfo(save, id), n = 0;
    while (n < 400 && E.buy(save, id)) n++;
    if (n > 0) {
      A.play('buy', { pitch: 1 + Math.min(0.5, (before.level + n) * 0.02) });
      save.flags.shopped = true;
      writeStore();
      refreshAll({});
      buyFx(id, before.level);
      return true;
    }
    denyShake();
    return false;
  }
  function denyShake() {
    A.play('deny');
    if (!reduced() && els.nsCost.animate) els.nsCost.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }
  function holdStep() {
    if (!holding) return;
    if (!doBuy()) { stopHold(); return; }
    holdN++;
    holdT = root.setTimeout(holdStep, Math.max(45, 130 - holdN * 8));
  }
  function startHold(e) {
    if (e.button > 0) return;
    e.preventDefault();
    stopHold();
    if (scrollGuard()) return;               // a tap that lands right after a scroll is the finger still moving
    try { els.btnBuy.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (!doBuy()) return;
    holding = true; holdN = 0;
    holdT = root.setTimeout(holdStep, 380);
  }
  function stopHold() { holding = false; root.clearTimeout(holdT); }

  // ---- codex: Act I / Act II headers; Act II stays out of sight until the Overseer has fallen (or one has been met)
  var A2_BOTS = { repo: 1, printer: 1, laser: 1, firenode: 1, auditor: 1, mimic: 1 };
  var A3_BOTS = { spam: 1, courier: 1, paralegal: 1, copier: 1, hr: 1 };
  var A3_WARDENS = { receptionist: 1, counsel: 1, comptroller: 1, market: 1, founder: 1 };
  var A2_WARDENS = { forklift: 1, firewall: 1, inspector: 1, vp: 1, chairman: 1 };
  function renderCodex() {
    if (!codexDirty && els.tabCodex.firstChild) return;
    codexDirty = false;
    var seen = save.seen || {}, h = '';
    function entry(e, isBoss) {
      var ok = !!seen[e.id];
      return '<div class="cx-e' + (ok ? '' : ' unmet') + (ok && (e.hostile || isBoss) ? ' host' : '') + '" data-id="' + e.id + '">' +
        '<canvas data-kind="' + (ok ? 'm' : 'u') + '" data-id="' + e.id + '" aria-hidden="true"></canvas><div class="in"><h3>' +
        (ok ? esc(e.name) + ' <span class="ser">' + esc(e.serial) + '</span>' + (e.hostile || isBoss ? '<span class="tag">Hostile</span>' : '') : '???  <span class="ser">' + esc(e.serial.replace(/[A-Z0-9]/g, '?')) + '</span>') +
        '</h3><p>' + (ok ? esc(e.blurb) : 'Not met yet.') + '</p></div></div>';
    }
    function group(title, list, isBoss) {
      var met = list.filter(function (e) { return seen[e.id]; }).length;
      return '<h2 class="cx-h"><span>' + title + '</span><span>' + met + '/' + list.length + '</span></h2><div class="cx">' + list.map(function (e) { return entry(e, isBoss); }).join('') + '</div>';
    }
    var bots1 = D.ENEMIES.filter(function (e) { return !A2_BOTS[e.id] && !A3_BOTS[e.id]; }), bots2 = D.ENEMIES.filter(function (e) { return A2_BOTS[e.id]; }), bots3 = D.ENEMIES.filter(function (e) { return A3_BOTS[e.id]; });
    var wd1 = D.BOSSES.filter(function (b) { return !A2_WARDENS[b.id] && !A3_WARDENS[b.id]; }), wd2 = D.BOSSES.filter(function (b) { return A2_WARDENS[b.id]; }), wd3 = D.BOSSES.filter(function (b) { return A3_WARDENS[b.id]; });
    var showA2 = !!save.flags.act2 || bots2.concat(wd2).some(function (e) { return seen[e.id]; });
    var showA3 = !!save.flags.act3 || bots3.concat(wd3).some(function (e) { return seen[e.id]; });
    h += '<h2 class="cx-act"><span>Act I</span><i></i><span>Yard 9</span></h2>' + group('Rogue bots', bots1, false) + group('Wardens', wd1, true);
    if (showA2) h += '<h2 class="cx-act a2"><span>Act II</span><i></i><span>Management</span></h2>' + group('Rogue bots', bots2, false) + group('Wardens', wd2, true);
    if (showA3) h += '<h2 class="cx-act a3"><span>Act III</span><i></i><span>Head Office</span></h2>' + group('Rogue bots', bots3, false) + group('Wardens', wd3, true);
    els.tabCodex.innerHTML = h;
    var cvs = els.tabCodex.querySelectorAll('canvas');
    for (var i = 0; i < cvs.length; i++) {
      try { S.portrait(cvs[i], 'enemy', cvs[i].getAttribute('data-id'), { silhouette: cvs[i].getAttribute('data-kind') === 'u' }); } catch (e) { /* ignore */ }
    }
  }

  // ---- log
  function renderLog() {
    var s = save.stats, h = '';
    function r(k, v) { return '<div class="lg-r"><span>' + k + '</span><span class="d"></span><b>' + v + '</b></div>'; }
    h += '<h2 class="lg-h">Shift log</h2>';
    h += r('Shifts worked', fmt(s.shifts)) + r('Time on the clock', fmtTime(s.playTime)) + r('Bots scrapped', fmt(s.kills)) + r('Best streak', fmt(s.bestCombo)) + r('Best shift, bolts', fmt(s.bestShiftBolts));
    h += '<h2 class="lg-h">Totals</h2>' + r('Bolts banked', fmt(s.boltsTotal)) + r('Cores banked', fmt(s.coresTotal));
    if (save.flags.act2 || s.stolen > 0) h += r('Lost to Repo Bots', fmt(s.stolen));
    h += '<h2 class="lg-h">Wardens scrapped</h2>';
    D.SECTORS.forEach(function (sec) {
      if (sec.n > 15 || (sec.n > 10 && !save.flags.act3) || (sec.n > 5 && !save.flags.act2)) return;
      var b = D.BOSS_BY_ID[sec.warden], n = (save.bossKills && save.bossKills[sec.n]) || 0;
      h += r(esc(b.name), n ? '×' + fmt(n) : '—');
    });
    if (s.wonShifts != null) h += '<h2 class="lg-h">Yard 9</h2>' + r('Secured on shift', fmt(s.wonShifts)) + r('Time to secure', fmtTime(s.wonPlayTime));
    if (s.act2Shifts != null) h += '<h2 class="lg-h">Act II</h2>' + r('Act II shifts', fmt(s.act2Shifts)) + r('Act II time', fmtTime(s.act2PlayTime));
    if (s.act3Shifts != null) h += '<h2 class="lg-h">Act III</h2>' + r('Act III shifts', fmt(s.act3Shifts)) + r('Act III time', fmtTime(s.act3PlayTime));
    if (save.flags.act3 || s.clawed > 0) h += '<h2 class="lg-h">Head Office</h2>' + r('Clawed back, lifetime', fmt(s.clawed || 0));
    if (save.flags.founder || (save.overtime && save.overtime.best > 0)) h += '<h2 class="lg-h">Overtime</h2>' + r('Best Overtime level', fmt(save.overtime.best)) + r('Overtime cleared', fmt(save.overtime.level));
    els.tabLog.innerHTML = '<div class="lg">' + h + '</div>';
  }

  // ================================================================== SETTINGS
  var resetArmed = false, resetTimer = 0;
  function syncSwitches() {
    var sw = [els.swSound, els.swPauseSound];
    sw.forEach(function (b) { if (b) b.setAttribute('aria-checked', save.settings.sound ? 'true' : 'false'); });
    els.swShake.setAttribute('aria-checked', save.settings.shake ? 'true' : 'false');
    els.btnTitleSound.innerHTML = icon(save.settings.sound ? 'sound' : 'soundOff', 22);
    els.btnTitleSound.setAttribute('aria-label', save.settings.sound ? 'Sound on' : 'Sound off');
  }
  function setSound(on) {
    save.settings.sound = !!on; A.setEnabled(!!on); syncSwitches(); writeStore();
    if (on) { A.unlock(); A.play('click'); }
  }
  function openSettings() {
    els.settings.hidden = false; disarmReset(); resetBackupUi(); syncSwitches();
    try { els.swSound.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSettings() { els.settings.hidden = true; disarmReset(); A.play('click'); }
  function disarmReset() {
    resetArmed = false; root.clearTimeout(resetTimer);
    els.btnReset.classList.remove('armed'); els.btnReset.textContent = 'Reset progress';
  }
  function onReset() {
    if (!resetArmed) {
      resetArmed = true; els.btnReset.classList.add('armed'); els.btnReset.textContent = 'Tap again to erase everything';
      A.play('deny');
      resetTimer = root.setTimeout(disarmReset, 5000);
      return;
    }
    disarmReset();
    var keep = { sound: save.settings.sound, shake: save.settings.shake };
    save = E.newSave();
    save.settings.sound = keep.sound; save.settings.shake = keep.shake;
    newerSave = false; clearStore(); writeStore();
    els.settings.hidden = true;
    codexDirty = true; BP.sel = null; BP.cache = {}; MAP.homed = false;
    cBolts.set(0, false); cCores.set(0, false);
    els.wsCoreWrap.hidden = true;
    applySettings();
    toTitle();
  }

  // ------------------------------------------------------------------ save backup code (Settings)
  // 'BY1:' + base64 of the save JSON. Restoring validates through E.loadSave, writes the save and reloads the page.
  var bkStage = 0;
  function b64enc(str) { return root.btoa(unescape(encodeURIComponent(str))); }
  function b64dec(str) { return decodeURIComponent(escape(root.atob(str))); }
  function bkMsg(text, bad) { els.bkMsg.textContent = text; els.bkMsg.hidden = !text; els.bkMsg.classList.toggle('bad', !!bad); }
  function resetBackupUi() {
    bkStage = 0; els.bkCode.hidden = true; els.bkCode.value = ''; els.bkCode.readOnly = false;
    els.btnRestore.textContent = 'Restore from code'; bkMsg('');
  }
  function onBackup() {
    A.play('click');
    var code = 'BY1:' + b64enc(JSON.stringify(save));
    bkStage = 0; els.btnRestore.textContent = 'Restore from code';
    els.bkCode.hidden = false; els.bkCode.readOnly = true; els.bkCode.value = code;
    try { els.bkCode.focus({ preventScroll: true }); els.bkCode.select(); } catch (e) { /* ignore */ }
    var done = function () { bkMsg('Save code copied. Paste it somewhere safe, like Notes.'); };
    var manual = function () { bkMsg('Copy the code above and keep it somewhere safe, like Notes.'); };
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(code).then(done, manual);
      else manual();
    } catch (e) { manual(); }
  }
  function parseCode(text) {
    text = String(text || '').replace(/\s+/g, '');
    if (text.indexOf('BY1:') !== 0) throw new Error('prefix');
    var raw = JSON.parse(b64dec(text.slice(4)));
    if (!raw || typeof raw !== 'object' || typeof raw.v !== 'number') throw new Error('shape');
    if (raw.v > E.newSave().v) throw new Error('newer');
    E.loadSave(JSON.parse(JSON.stringify(raw)));
    return raw;
  }
  function onRestore() {
    if (bkStage === 0) {
      A.play('click');
      bkStage = 1; els.bkCode.hidden = false; els.bkCode.readOnly = false; els.bkCode.value = '';
      els.btnRestore.textContent = 'Restore now';
      bkMsg('Paste your save code above. This replaces your current progress.');
      try { els.bkCode.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      return;
    }
    var raw;
    try { raw = parseCode(els.bkCode.value); }
    catch (e) { A.play('deny'); bkMsg(e && e.message === 'newer' ? 'That code is from a newer version of Boltyard.' : "That doesn't look like a Boltyard save code.", true); return; }
    try { root.localStorage.setItem(KEY, JSON.stringify(raw)); } catch (e) { A.play('deny'); bkMsg('Could not save here: storage is unavailable.', true); return; }
    A.play('buy'); bkMsg('Save restored. Reloading\u2026');
    newerSave = true;           // stop this page from writing its old save over the restored one
    root.setTimeout(function () { try { root.location.reload(); } catch (e) { /* ignore */ } }, 400);
  }

  // ================================================================== FOCUS MODE (SPEC 12.14)
  // Two layers: a fullscreen attempt (the artifact viewer or iPhone Safari may refuse) and touch guards that are always on in a shift.
  // In the native app (NATIVE) only the touch guards run: no fullscreen request, no wake lock, no Focus controls, no notes.
  var FKEY = 'boltyard.focus.v1';
  var focusState = { want: false, fs: false, entered: false, refused: false, wake: null, wakeRefused: false, noted: false, lastDragEnd: 0, lastEnd: 0 };
  // one quiet note per session about what the browser refused (fullscreen first, else the wake lock); never twice
  var sysT = 0;
  function sysNote(text) {
    if (focusState.noted || !els.sysNote) return;
    focusState.noted = true;
    els.sysNote.textContent = text; els.sysNote.hidden = false;
    root.clearTimeout(sysT); sysT = root.setTimeout(function () { els.sysNote.hidden = true; }, 4200);
  }
  function fsRefused() { focusState.refused = true; syncFocusUi(); sysNote("Fullscreen isn't allowed here \u2014 touch guards are still on"); }
  function focusRead() { if (NATIVE) return; try { focusState.want = root.localStorage.getItem(FKEY) === '1'; } catch (e) { /* ignore */ } }
  function focusWrite() { try { root.localStorage.setItem(FKEY, focusState.want ? '1' : '0'); } catch (e) { /* ignore */ } }
  function fsElement() { try { return doc.fullscreenElement || doc.webkitFullscreenElement || null; } catch (e) { return null; } }
  function fsSupported() { var de = doc.documentElement; return !!(de && (de.requestFullscreen || de.webkitRequestFullscreen)); }
  function lockPortrait() {
    try { var o = root.screen && root.screen.orientation; if (o && o.lock) { var q = o.lock('portrait'); if (q && q.catch) q.catch(function () { /* ignore */ }); } } catch (e) { /* ignore */ }
  }
  function unlockOrientation() { try { var o = root.screen && root.screen.orientation; if (o && o.unlock) o.unlock(); } catch (e) { /* ignore */ } }
  function enterFs() {
    var de = doc.documentElement, p;
    if (NATIVE) return;
    if (!fsSupported()) { fsRefused(); return; }
    try {
      if (de.requestFullscreen) p = de.requestFullscreen({ navigationUI: 'hide' }); else p = de.webkitRequestFullscreen();
      if (p && p.then) p.then(function () { lockPortrait(); }, function () { fsRefused(); });
    } catch (e) { fsRefused(); return; }
    syncFocusUi();
  }
  function exitFs() {
    try {
      var p = doc.exitFullscreen ? doc.exitFullscreen() : (doc.webkitExitFullscreen ? doc.webkitExitFullscreen() : null);
      if (p && p.catch) p.catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
    unlockOrientation();
  }
  function onFsChange() {
    var on = !!fsElement();
    focusState.fs = on;
    if (on) { focusState.entered = true; focusState.refused = false; }
    else if (focusState.entered) {
      focusState.entered = false; focusState.want = false; focusWrite();   // left fullscreen: the player (or the system) chose to
      if (mode === 'shift') pause();
    }
    syncFocusUi();
  }
  // the Focus button: fullscreen on/off, remembered
  function toggleFocus() {
    if (NATIVE) return;
    A.play('click');
    if (fsElement()) { focusState.want = false; focusWrite(); exitFs(); }
    else { focusState.want = true; focusWrite(); focusState.refused = false; enterFs(); }
    syncFocusUi();
  }
  // called inside a clock-in tap (a user gesture): re-enter fullscreen when the player asked for it
  function focusAtClockIn() { if (focusState.want && !fsElement()) enterFs(); }
  var FOCUS_ICON = { on: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', off: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' };
  function svgIcon(body, size) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="square" aria-hidden="true" focusable="false">' + body + '</svg>'; }
  function syncFocusUi() {
    if (!els.btnFocusHud) return;
    var on = !!fsElement();
    [els.btnFocusHud, els.btnFocusTitle, els.btnFocusWs].forEach(function (b) {
      b.innerHTML = svgIcon(on ? FOCUS_ICON.on : FOCUS_ICON.off, 22);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? 'Leave focus mode' : 'Enter focus mode');
      b.classList.toggle('on', on);
      var un = focusState.refused && !on;
      b.classList.toggle('unavail', un);
      if (un) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-label', 'Focus mode unavailable here'); b.title = 'Fullscreen unavailable here; touch guards still on'; }
      else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); }
    });
    els.swFocus.setAttribute('aria-checked', focusState.want ? 'true' : 'false');
    els.focusNote.textContent = focusState.refused ? 'Fullscreen unavailable here; touch guards are still on.' : 'Goes fullscreen when you clock in. Touch guards are always on during a shift.';
    els.focusNote.classList.toggle('warn', focusState.refused);
  }
  // screen wake lock while a shift is running
  function wakeAcquire() {
    try {
      if ((NATIVE && !WEBAPP) || !root.navigator || !root.navigator.wakeLock || focusState.wake) return;
      var p = root.navigator.wakeLock.request('screen');
      if (p && p.then) p.then(function (l) {
        focusState.wake = l;
        if (mode !== 'shift') { wakeRelease(); return; }
        try { l.addEventListener('release', function () { if (focusState.wake === l) focusState.wake = null; }); } catch (e) { /* ignore */ }
      }, function () { focusState.wakeRefused = true; sysNote("Screen lock can't be held off here \u2014 the display may dim"); });
    } catch (e) { /* ignore */ }
  }
  function wakeRelease() {
    try { var l = focusState.wake; focusState.wake = null; if (l && l.release) { var q = l.release(); if (q && q.catch) q.catch(function () { /* ignore */ }); } } catch (e) { /* ignore */ }
  }
  // touch guards: no pinch, double-tap zoom, pull-to-refresh or long-press menus on the stage and HUD during a shift
  function bindGuards() {
    function stop(e) { if (mode === 'shift' && e.cancelable) e.preventDefault(); }
    function multi(e) { if (mode === 'shift' && e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }
    var last = 0;
    function dbl(e) { if (mode !== 'shift') return; var t = root.performance.now(); if (t - last < 320 && e.cancelable) e.preventDefault(); last = t; }
    [els.stage, els.hud].forEach(function (el) {
      el.addEventListener('touchmove', stop, { passive: false });
      el.addEventListener('touchstart', multi, { passive: false });
      el.addEventListener('gesturestart', stop, { passive: false });
      el.addEventListener('gesturechange', stop, { passive: false });
    });
    els.stage.addEventListener('touchend', dbl, { passive: false });
    doc.addEventListener('fullscreenchange', onFsChange);
    doc.addEventListener('webkitfullscreenchange', onFsChange);
  }

  // ================================================================== boot
  function bindAll() {
    var ids = ['app', 'hud', 'batt', 'battFill', 'battNum', 'btnPause', 'hudBolts', 'hudCoreWrap', 'hudCores', 'hudOc', 'ocLabel', 'ocFill',
      'hudSig', 'sigIcon', 'sigLabel', 'sigFill', 'stage', 'arena', 'warn', 'warnName', 'toast', 'sysNote', 'hint', 'hintText',
      'title', 'btnTitleSound', 'btnTitleClock', 'workshop', 'wsBolts', 'wsCores', 'wsCoreWrap', 'btnGear', 'btnSecBar', 'secBarT', 'portrait',
      'secTiles', 'secInfo', 'tabBtnBp', 'tabBtnCodex', 'tabBtnLog', 'bpBadge', 'pane', 'tabBp', 'tabCodex', 'tabLog', 'bp', 'sheet',
      'nsIcon', 'nsName', 'nsBranch', 'nsLevel', 'nsDesc', 'nsNow', 'nsNext', 'nsCost', 'btnBuy', 'nsClose', 'btnClockIn', 'clockLabel',
      'pause', 'btnResume', 'btnClockOut', 'swPauseSound', 'report', 'repNo', 'repSector', 'repStamp', 'repLine', 'repUnlock', 'repRows', 'repNew',
      'fund', 'fundT', 'fundS', 'fundFill', 'btnRepPrimary', 'btnRepSecond', 'victory', 'vicStamp', 'vicStamp2', 'vicLine', 'vicUnlock', 'vicRows', 'btnKeep', 'btnVic2', 'wsBanner', 'wsBannerT', 'wsBannerS', 'battBud', 'hudBoltsBox', 'settings', 'settingsScrim', 'swSound', 'swShake', 'shakeNote', 'repNext', 'btnReset', 'btnSetClose', 'secActs', 'bpJump', 'btnMax', 'nsTrack', 'nsReq', 'swFocus', 'focusNote', 'btnFocusHud', 'btnFocusTitle', 'btnFocusWs', 'bpZoomIn', 'bpZoomOut', 'bpHome', 'about', 'btnBackup', 'btnRestore', 'bkCode', 'bkMsg'];
    ids.forEach(function (id) { els[id] = $(id); });
    els.tabs = doc.querySelector('.ws-tabs');
    els.dock = doc.querySelector('.ws-dock');
    els.repCard = els.report.querySelector('.card');
    var ic = doc.querySelectorAll('[data-icon]');
    for (var i = 0; i < ic.length; i++) ic[i].innerHTML = icon(ic[i].getAttribute('data-icon'), parseInt(ic[i].getAttribute('data-size'), 10) || 24);
    var MI = { bpZoomIn: '<path d="M12 5v14M5 12h14"/>', bpZoomOut: '<path d="M5 12h14"/>', bpHome: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' };
    for (var mk in MI) els[mk].innerHTML = svgIcon(MI[mk], 22);
    cBolts = new Counter(els.wsBolts, 24); cCores = new Counter(els.wsCores, 24);
  }

  var pz = { armed: false, id: null };
  function bindEvents() {
    // stage input
    els.stage.addEventListener('pointerdown', onPointerDown);
    els.stage.addEventListener('pointermove', onPointerMove);
    els.stage.addEventListener('pointerup', onPointerUp);
    els.stage.addEventListener('pointercancel', onPointerUp);
    els.stage.addEventListener('lostpointercapture', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    doc.addEventListener('selectstart', function (e) { e.preventDefault(); });
    doc.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    doc.addEventListener('dragstart', function (e) { e.preventDefault(); });
    root.addEventListener('blur', function () { keys.l = keys.r = keys.u = keys.d = false; });
    // resize
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', onResize);
    if (root.ResizeObserver) { try { new root.ResizeObserver(function () { resizeCanvas(); }).observe(els.stage); } catch (e) { /* ignore */ } }
    if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', applySettings);
    // lifecycle
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) pause(); else { lastTs = root.performance.now(); if (mode === 'shift') wakeAcquire(); } });
    root.addEventListener('pagehide', function () {
      try {
        if (run && !run.attract && mode === 'shift') { lastReport = E.endShift(run, save); }
        writeStore();
      } catch (e) { /* ignore */ }
    });

    // title
    els.btnTitleClock.addEventListener('click', function () { A.unlock(); focusAtClockIn(); beginShift(save.sector); });
    els.btnTitleSound.addEventListener('click', function () { setSound(!save.settings.sound); });
    // shift
    els.btnPause.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pz.armed = root.performance.now() - focusState.lastDragEnd >= 400; pz.id = e.pointerId;   // a tap right after steering is a stray finger
    });
    els.btnPause.addEventListener('pointerup', function (e) {
      var up = doc.elementFromPoint(e.clientX, e.clientY);
      if (pz.armed && pz.id === e.pointerId && up && els.btnPause.contains(up)) pause();   // must start and end on the button
      pz.armed = false;
    });
    els.btnPause.addEventListener('pointercancel', function () { pz.armed = false; });
    els.btnPause.addEventListener('click', function (e) { if (e.detail === 0) pause(); });
    els.btnResume.addEventListener('click', resume);
    els.btnClockOut.addEventListener('click', clockOut);
    els.swPauseSound.addEventListener('click', function () { setSound(!save.settings.sound); });
    // workshop
    els.btnClockIn.addEventListener('click', function () { A.unlock(); focusAtClockIn(); beginShift(save.sector); });
    els.btnSecBar.addEventListener('click', function () { A.play('click'); wsOpen = !wsOpen; syncSlim(); });
    els.btnGear.addEventListener('click', function () { A.play('click'); openSettings(); });
    els.btnSetClose.addEventListener('click', closeSettings);
    els.settingsScrim.addEventListener('click', closeSettings);
    els.swSound.addEventListener('click', function () { setSound(!save.settings.sound); });
    els.swShake.addEventListener('click', function () { save.settings.shake = !save.settings.shake; applySettings(); writeStore(); A.play('click'); });
    els.btnReset.addEventListener('click', onReset);
    els.btnBackup.addEventListener('click', onBackup);
    els.btnRestore.addEventListener('click', onRestore);
    doc.addEventListener('pointerdown', function (e) { if (resetArmed && e.target !== els.btnReset) disarmReset(); }, true);
    els.secTiles.addEventListener('click', function (e) { var b = e.target.closest('.stile'); if (b) pickSector(+b.getAttribute('data-n')); });
    [els.tabBtnBp, els.tabBtnCodex, els.tabBtnLog].forEach(function (b) { b.addEventListener('click', function () { if (tab !== b.getAttribute('data-tab')) showTab(b.getAttribute('data-tab')); }); });
    // the map: drag to pan, pinch / wheel / buttons to zoom, tap a plate for its sheet
    els.bp.addEventListener('pointerdown', onMapDown);
    els.bp.addEventListener('pointermove', onMapMove);
    els.bp.addEventListener('pointerup', onMapUp);
    els.bp.addEventListener('pointercancel', onMapUp);
    els.bp.addEventListener('wheel', onMapWheel, { passive: false });
    els.bp.addEventListener('click', function (e) {          // keyboard activation only: touch and mouse taps are handled on pointerup
      if (e.detail !== 0) return;
      var b = e.target.closest('.node'); if (b) tapNode(b.getAttribute('data-id'));
    });
    els.bpZoomIn.addEventListener('click', function () { zoomBtn(1.25); });
    els.bpZoomOut.addEventListener('click', function () { zoomBtn(0.8); });
    els.bpHome.addEventListener('click', function () { A.play('click', { pitch: 1.1, vol: 0.6 }); stopAnim(); homeView(true); });
    els.bpJump.addEventListener('click', function (e) { var c = e.target.closest('.jchip'); if (c) jumpTo(+c.getAttribute('data-s')); });
    els.secActs.addEventListener('click', function (e) { var c = e.target.closest('.sact'); if (c) { secAct = +c.getAttribute('data-act'); A.play('click'); renderSectors(true); } });
    if (root.ResizeObserver) { try { new root.ResizeObserver(function () { if (mode === 'workshop' && tab === 'bp') measureMap(); }).observe(els.bp); } catch (e) { /* ignore */ } }
    // focus mode
    [els.btnFocusHud, els.btnFocusTitle, els.btnFocusWs].forEach(function (b) { b.addEventListener('click', toggleFocus); });
    els.swFocus.addEventListener('click', function () {
      focusState.want = !focusState.want; focusWrite(); A.play('click');
      if (!focusState.want && fsElement()) exitFs();
      syncFocusUi();
    });
    bindGuards();
    els.nsClose.addEventListener('click', function () { closeSheet(); });
    els.btnBuy.addEventListener('pointerdown', startHold);
    ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach(function (t) { els.btnBuy.addEventListener(t, stopHold); });
    els.btnBuy.addEventListener('click', function (e) { if (e.detail === 0) doBuy(); });
    els.btnMax.addEventListener('click', function () { if (scrollGuard()) return; if (els.btnMax.getAttribute('aria-disabled') === 'true') { denyShake(); return; } doMax(); });
    els.btnBuy.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function onResize() {
    resizeCanvas();
    if (mode === 'workshop') { layoutBlueprint(); measureMap(); refreshAll({ initial: true }); if (BP.sel) els.sheet.style.bottom = els.dock.offsetHeight + 'px'; }
  }

  function start(data) {
    data = data || {};
    bindAll();
    var raw = data.save || readStore();
    try {
      if (raw && typeof raw.v === 'number' && raw.v > E.newSave().v) { newerSave = true; storeMsg = 'This save is from a newer version of Boltyard. Playing a fresh game here; your save is left untouched.'; raw = null; }
      save = E.loadSave(raw);
    } catch (e) {
      try { backupRaw(root.localStorage.getItem(KEY) || JSON.stringify(raw)); } catch (e2) { /* ignore */ }
      storeMsg = 'Your saved game could not be loaded. A copy was kept and you are starting fresh.';
      save = E.loadSave(null);
    }
    try { R.init(els.arena, renderOpts()); } catch (e) { /* ignore */ }
    if (NATIVE) {
      doc.documentElement.classList.add('native');
      [els.btnFocusHud, els.btnFocusTitle, els.btnFocusWs, els.swFocus].forEach(function (b) { b.hidden = true; });
    }
    if (els.about) els.about.textContent = 'Boltyard v' + (typeof root.BY_VERSION === 'string' && root.BY_VERSION ? root.BY_VERSION : VERSION + ' (build ' + BUILD + ')');
    focusRead();
    bindEvents();
    syncFocusUi();
    applySettings();
    updateClockLabel();
    renderSectors();
    if (save.stats.shifts > 0) enterWorkshop({ boot: true, afterShift: true });
    else enterTitle();
    lastTs = root.performance.now();
    root.requestAnimationFrame(frame);
    if (storeMsg && els.sysNote) { els.sysNote.textContent = storeMsg; els.sysNote.hidden = false; els.sysNote.setAttribute('data-kind', 'save'); root.setTimeout(function () { els.sysNote.hidden = true; }, 7000); }
  }

  // ================================================================== debug / test hook
  BY.UI = {
    fmt: fmt,
    version: VERSION, build: BUILD, native: NATIVE, webapp: WEBAPP,
    debug: {
      run: function () { return run; },
      save: function () { return save; },
      setSave: function (obj) {
        save = E.loadSave(obj); writeStore(); codexDirty = true; BP.sel = null; BP.cache = {}; MAP.homed = false;
        if (mode === 'workshop') { enterWorkshop({ boot: true }); } else { applySettings(); }
      },
      setInput: function (fn) { dbg.inputFn = typeof fn === 'function' ? fn : null; },
      get timeScale() { return dbg.timeScale; },
      set timeScale(v) { dbg.timeScale = +v > 0 ? +v : 1; },
      screen: function () { return mode; },
      focus: function () { return { want: focusState.want, fs: !!fsElement(), refused: focusState.refused, wake: !!focusState.wake, native: NATIVE }; },
      view: function (tx, ty, z) { if (z !== undefined) { stopAnim(); setView(tx === null ? MAP.tx : tx, ty === null ? MAP.ty : ty, z); } return { tx: MAP.tx, ty: MAP.ty, z: MAP.z }; },
      panTo: function (id) { var q = BP.pos[id]; if (!q) return false; stopAnim(); setView(MAP.tx, MAP.ty, Math.max(MAP.z, 0.9)); panToPoint(q.x, q.y, false); return !!BP.shown[id]; },
      map: function () { return { tx: MAP.tx, ty: MAP.ty, z: MAP.z, vw: MAP.vw, vh: MAP.vh, shown: Object.keys(BP.shown).filter(function (k) { return BP.shown[k]; }), ghost: Object.keys(BP.ghost).filter(function (k) { return BP.ghost[k]; }) }; },
      paused: function () { return paused; },
      report: function () { return lastReport; },
      hold: function () { return !!ending; },
      begin: function (sector) { beginShift(sector || save.sector); },
      workshop: function () { enterWorkshop({ afterShift: true }); },
      fakeReport: function (rep) { if (!run) startAttract(); lastReport = rep; if (rep.gameWon) showVictory(rep); else if (rep.act2Won) showFinale(rep); else if (rep.act3Won) showFounder(rep); else showReport(rep); },
      reveal: function () { return { active: rvActive, hold: Object.keys(BP.hold || {}), banner: !els.wsBanner.hidden }; }
    }
  };

  function boot() {
    var hot = root.claude && root.claude.hot;
    try { if (hot && hot.snapshot) hot.snapshot(function () { return { save: save }; }); } catch (e) { /* ignore */ }
    if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
  }
  boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
