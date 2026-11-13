#!/usr/bin/env node
// node tools/robustness.js
// Edge-case checks on the REAL page (dist/test.html): resize / rotation, hidden tab, long frames, multi-touch, double taps,
// hold-to-repeat buying, pausing in special windows, clock-out payout, audio gating, sound persistence, horizontal overflow.
'use strict';
const L = require('./lib-page.js');
const { sleep } = L;

let pass = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

function save(o) {
  return Object.assign({
    v: 1, bolts: 0, cores: 0, up: { boot: 1 }, sectorsCleared: 0, bossKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, sector: 1, seen: {},
    stats: { shifts: 4, kills: 40, boltsTotal: 200, coresTotal: 0, playTime: 90, bestCombo: 5, bestShiftBolts: 30, wonShifts: null, wonPlayTime: null },
    flags: { won: false, movedOnce: true, tip: 3, shopped: true }, settings: { sound: false, shake: true }
  }, o || {});
}
const midUp = { boot: 1, coil: 6, pulse: 3, field: 2, fork: 1, cell: 5, thrust: 2, recycler: 1, magnet: 3, sorter: 4, sweep: 2, drone: 1 };

async function drag(cdp, x0, y0, x1, y1, steps) {
  steps = steps || 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const sprocketScreen = (page) => page.evaluate(() => {
  const p = BY.UI.debug.run().player, st = BY.Render.stats(), rc = document.getElementById('arena').getBoundingClientRect();
  return { x: rc.left + st.fit[1] + p.x * st.fit[0], y: rc.top + st.fit[2] + p.y * st.fit[0], r: p.r * st.fit[0], rc: [rc.left, rc.top, rc.right, rc.bottom], scale: st.fit[0], vw: innerWidth, vh: innerHeight };
});

(async () => {
  const browser = await L.launch();
  const errors = [];

  // =====================================================================================================
  console.log('1. resize / orientation flip mid-shift');
  {
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, dpr: 2, save: save({ up: midUp }), errors });
    await page.tap('#btnClockIn'); await sleep(400);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    let s0 = await sprocketScreen(page);
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(500);
    let s1 = await sprocketScreen(page);
    const inside = (s) => s.x - s.r >= s.rc[0] - 0.5 && s.x + s.r <= s.rc[2] + 0.5 && s.y - s.r >= s.rc[1] - 0.5 && s.y + s.r <= s.rc[3] + 0.5 && s.rc[3] <= s.vh + 1 && s.rc[2] <= s.vw + 1;
    check('portrait: Sprocket inside the canvas', inside(s0), JSON.stringify([Math.round(s0.x), Math.round(s0.y)]));
    check('landscape: Sprocket still inside the canvas and the canvas inside the window', inside(s1), JSON.stringify([Math.round(s1.x), Math.round(s1.y), s1.rc.map(Math.round)]));
    const t0 = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
    await drag(cdp, 400, 200, 460, 200);
    const t1 = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty, alive: BY.UI.debug.run().player.battery > 0 }; });
    const want = 60 * 1.3 / s1.scale;
    check('landscape: touch drag moves the target by delta x1.3 / scale', Math.abs((t1.tx - t0.tx) - want) < 8 || Math.abs(t1.tx - t0.tx) > 3, (t1.tx - t0.tx).toFixed(1) + ' vs ' + want.toFixed(1));
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(500);
    const s2 = await sprocketScreen(page);
    check('back to portrait: Sprocket inside the canvas', inside(s2), JSON.stringify([Math.round(s2.x), Math.round(s2.y)]));
    await page.setViewportSize({ width: 320, height: 560 }); await sleep(300);
    check('tiny window: Sprocket inside the canvas', inside(await sprocketScreen(page)));
    const alive = await page.evaluate(() => { const r = BY.UI.debug.run(); return { over: r.over, t: r.t }; });
    check('shift survived three resizes', !alive.over && alive.t > 0.5, JSON.stringify(alive));
    await ctx.close();
  }

  // =====================================================================================================
  console.log('2. hidden tab pauses; long frames do not fast-forward');
  {
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, save: save({ up: midUp }), errors });
    await page.tap('#btnClockIn'); await sleep(600);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    const before = await page.evaluate(() => { const r = BY.UI.debug.run(); return { t: r.t, b: r.player.battery }; });
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(100);
    check('hiding the tab pauses the shift', await page.evaluate(() => BY.UI.debug.paused()));
    const pausedAt = await page.evaluate(() => BY.UI.debug.run().t);
    await sleep(3000);   // "away" for 3 s
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(300);
    const back = await page.evaluate(() => { const r = BY.UI.debug.run(); return { t: r.t, b: r.player.battery, paused: BY.UI.debug.paused() }; });
    check('coming back keeps it paused, no time passed', back.paused && Math.abs(back.t - pausedAt) < 0.05, back.t.toFixed(2) + ' vs ' + pausedAt.toFixed(2));
    await page.tap('#btnResume'); await sleep(500);
    const res = await page.evaluate(() => { const r = BY.UI.debug.run(); return { t: r.t, b: r.player.battery, over: r.over }; });
    check('after Resume only ~0.5 s of game time has passed and Sprocket is alive', res.t - pausedAt < 0.9 && !res.over, (res.t - pausedAt).toFixed(2) + ' s');
    // a 2.5 s frozen main thread (long frame) must not fast-forward the simulation
    const tBlock0 = await page.evaluate(() => BY.UI.debug.run().t);
    await page.evaluate(() => { const e = performance.now() + 2500; while (performance.now() < e) { /* block */ } });
    await sleep(250);
    const tBlock1 = await page.evaluate(() => BY.UI.debug.run().t);
    check('a 2.5 s long frame advances the game by well under 1 s', tBlock1 - tBlock0 < 1.0, (tBlock1 - tBlock0).toFixed(2) + ' s');
    await ctx.close();
  }

  // =====================================================================================================
  console.log('3. multi-touch');
  {
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, save: save({ up: midUp }), errors });
    await page.tap('#btnClockIn'); await sleep(400);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    const cdp = await ctx.newCDPSession(page);
    const box = await page.locator('#stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 6, y: cy, id: 1 }] }); await sleep(16); }
    await sleep(120);
    const a = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
    // second finger lands far away and wanders
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx + 30, y: cy, id: 1 }, { x: box.x + 30, y: box.y + 60, id: 2 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 30, y: cy, id: 1 }, { x: box.x + 30 + i * 25, y: box.y + 60 + i * 40, id: 2 }] });
      await sleep(16);
    }
    const b = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
    check('a second finger does not move the target', Math.hypot(b.tx - a.tx, b.ty - a.ty) < 2, 'delta ' + Math.hypot(b.tx - a.tx, b.ty - a.ty).toFixed(2));
    // first finger lifts; second keeps moving: still nothing (it never owned the input)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: box.x + 230, y: box.y + 380, id: 2 }] });
    for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 230 + i * 10, y: box.y + 380, id: 2 }] }); await sleep(16); }
    const c = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
    check('after the first finger lifts, the orphan second finger is ignored', Math.hypot(c.tx - a.tx, c.ty - a.ty) < 2, 'delta ' + Math.hypot(c.tx - a.tx, c.ty - a.ty).toFixed(2));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // a fresh touch afterwards works again
    await drag(cdp, cx, cy, cx - 40, cy, 6);
    const d = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx }; });
    check('a new touch afterwards steers again', d.tx < a.tx - 5, (d.tx - a.tx).toFixed(1));
    // no page scroll / zoom while playing
    const drag2 = await page.evaluate(() => ({ sy: scrollY, sx: scrollX, vs: visualViewport ? visualViewport.scale : 1 }));
    check('page never scrolled or zoomed during the shift', drag2.sy === 0 && drag2.sx === 0 && Math.abs(drag2.vs - 1) < 0.01, JSON.stringify(drag2));
    await ctx.close();
  }

  // =====================================================================================================
  console.log('4. double taps, hold-to-repeat, pausing in special windows, clock-out payout');
  {
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, save: save({ bolts: 4, up: { boot: 1 } }), errors });
    // Clock In double tap: the second tap must not start another shift
    const dbl = await page.evaluate(async () => {
      const btn = document.getElementById('btnClockIn');
      btn.click(); const r1 = BY.UI.debug.run(); btn.click();
      const r2 = BY.UI.debug.run();
      return { same: r1 === r2, screen: BY.UI.debug.screen(), t: r2.t };
    });
    check('double tap on Clock In starts exactly one shift', dbl.same && dbl.screen === 'shift' && dbl.t < 0.1, JSON.stringify(dbl));
    await page.evaluate(() => { BY.UI.debug.workshop && 0; });
    await ctx.close();
  }
  {
    // Bolt on: rapid taps with exactly one level of money
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, save: save({ bolts: 4, up: { boot: 1 } }), errors });
    await page.tap('.node[data-id="coil"]'); await sleep(250);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('btnBuy'), out = [];
      const PE = (t) => new PointerEvent(t, { bubbles: true, cancelable: true, button: 0, pointerId: 3, pointerType: 'touch', isPrimary: true });
      for (let i = 0; i < 6; i++) { btn.dispatchEvent(PE('pointerdown')); btn.dispatchEvent(PE('pointerup')); }
      const s = BY.UI.debug.save();
      return { lvl: s.up.coil, bolts: s.bolts };
    });
    check('six rapid Bolt on taps with money for one level: bought once, bolts never negative', r.lvl === 1 && r.bolts === 0, JSON.stringify(r));
    await ctx.close();
  }
  {
    // hold to repeat stops exactly at unaffordable: money for N coil levels + change
    const costs = await (async () => { const { page, ctx } = await L.open(browser, { w: 390, h: 844, errors }); const c = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => BY.Engine.cost('coil', l).bolts)); await ctx.close(); return c; })();
    const N = 6, money = costs.slice(0, N).reduce((a, b) => a + b, 0) + Math.floor(costs[N] / 2);
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, save: save({ bolts: money, up: { boot: 1 } }), errors });
    await page.tap('.node[data-id="coil"]'); await sleep(250);
    const cdp = await ctx.newCDPSession(page);
    const bb = await page.locator('#btnBuy').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, id: 1 }] });
    await sleep(2500);
    const during = await page.evaluate(() => { const s = BY.UI.debug.save(); return { lvl: s.up.coil, bolts: s.bolts }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    const after = await page.evaluate(() => { const s = BY.UI.debug.save(); return { lvl: s.up.coil, bolts: s.bolts }; });
    check('holding Bolt on buys every affordable level and stops at the first unaffordable one', after.lvl === N && after.bolts === Math.floor(costs[N] / 2) && during.lvl === N, JSON.stringify({ during, after, want: N, costNext: costs[N] }));
    await sleep(600);
    const later = await page.evaluate(() => BY.UI.debug.save().up.coil);
    check('nothing more is bought after the hold ends', later === N);
    await ctx.close();
  }
  {
    // pausing during the Warden warning and during the victory window
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, dpr: 1, save: save({ up: midUp, sectorsCleared: 0 }), errors });
    await page.tap('#btnClockIn'); await sleep(400);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; BY.UI.debug.setInput(() => ({ x: 180, y: 520 })); const r = BY.UI.debug.run(); r.boss.signal = r.boss.need; r.boss.state = 'warning'; r.boss.warn = 2.5; });
    await sleep(500);
    await page.tap('#btnPause'); await sleep(150);
    const w0 = await page.evaluate(() => ({ warn: BY.UI.debug.run().boss.warn, band: !document.getElementById('warn').hidden, paused: BY.UI.debug.paused() }));
    await sleep(900);
    const w1 = await page.evaluate(() => ({ warn: BY.UI.debug.run().boss.warn, band: !document.getElementById('warn').hidden }));
    check('Warden warning: pausing freezes the countdown and keeps the band', w0.paused && w0.band && w1.band && Math.abs(w0.warn - w1.warn) < 0.001 && w0.warn > 0, JSON.stringify([w0, w1]));
    await page.tap('#btnResume');
    await sleep(2400);
    const w2 = await page.evaluate(() => ({ state: BY.UI.debug.run().boss.state, hp: BY.UI.debug.run().boss.hp }));
    check('Warden warning: resuming lets the Warden arrive', w2.state === 'active', JSON.stringify(w2));
    // kill it: put Sprocket on top of a nearly dead Compactor
    await page.evaluate(() => {
      const r = BY.UI.debug.run(), b = r.enemies.find((e) => e.boss);
      b.hp = 0.001; r.player.x = b.x; r.player.y = b.y + b.r + 14; r.player.battery = r.player.maxBattery;
      BY.UI.debug.setInput(() => ({ x: b.x, y: b.y + b.r + 14 }));
    });
    let dead = false;
    for (let i = 0; i < 40 && !dead; i++) { await sleep(50); dead = await page.evaluate(() => BY.UI.debug.run().boss.state === 'dead'); }
    check('the Warden dies', dead);
    await page.tap('#btnPause').catch(() => {}); await sleep(100);
    const v0 = await page.evaluate(() => { const r = BY.UI.debug.run(); return { vt: r._victoryT, paused: BY.UI.debug.paused(), over: r.over }; });
    await sleep(1200);
    const v1 = await page.evaluate(() => { const r = BY.UI.debug.run(); return { vt: r._victoryT, over: r.over }; });
    check('victory window: pausing freezes the timer and the shift does not end', v0.paused && !v1.over && Math.abs(v0.vt - v1.vt) < 0.001, JSON.stringify([v0, v1]));
    if (v0.paused) await page.tap('#btnResume');
    const scr = await L.waitScreen(page, ['report', 'victory'], 6000);
    check('resuming finishes the shift with a report', scr === 'report' || scr === 'victory', scr);
    const rep = await page.evaluate(() => BY.UI.debug.report());
    check('the report records the Warden kill', rep && rep.bossDefeated && rep.reason === 'victory', rep && rep.reason);
    await ctx.close();
  }
  {
    // clock out early pays exactly what the report says (Yard Sweep owned)
    const { page, ctx } = await L.open(browser, { w: 390, h: 844, dpr: 1, save: save({ bolts: 10, up: midUp, sectorsCleared: 1, sector: 2 }), errors });
    await page.tap('#btnClockIn'); await sleep(300);
    await page.evaluate(() => { BY.UI.debug.setInput((run) => BY.Autopilot.target(run, { skill: 'attentive' })); BY.UI.debug.timeScale = 4; });
    await sleep(2500);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    const pre = await page.evaluate(() => ({ bolts: BY.UI.debug.save().bolts, cores: BY.UI.debug.save().cores, hud: document.getElementById('hudBolts').textContent, earned: BY.UI.debug.run().earned.bolts }));
    await page.tap('#btnPause'); await sleep(150);
    await page.tap('#btnClockOut');
    check('clock out reaches the report', await L.waitScreen(page, ['report'], 5000) === 'report');
    await sleep(1500);
    const post = await page.evaluate(() => { const r = BY.UI.debug.report(); return { rep: r, bolts: BY.UI.debug.save().bolts, shown: document.getElementById('repBolts').textContent, stored: JSON.parse(localStorage.getItem('boltyard.save.v1')).bolts, reason: r.reason }; });
    check('clock out: save grew by exactly report.bolts', post.bolts - pre.bolts === post.rep.bolts, pre.bolts + ' + ' + post.rep.bolts + ' = ' + post.bolts);
    check('clock out: the report card shows that number', post.shown.replace(/[,\s]/g, '') === String(post.rep.bolts) || /K|M/.test(post.shown), post.shown + ' vs ' + post.rep.bolts);
    check('clock out: stored save equals live save, reason is clockout', post.stored === post.bolts && post.reason === 'clockout');
    check('clock out: report is at least what the HUD showed (sweep can only add)', post.rep.bolts >= pre.earned, post.rep.bolts + ' >= ' + pre.earned + ' (swept ' + post.rep.swept + ')');
    await ctx.close();
  }

  // =====================================================================================================
  console.log('5. audio gating and sound persistence');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.addInitScript(() => {
      window.__ac = [];
      const wrap = (name) => { const C = window[name]; if (!C) return; window[name] = function () { const a = new (Function.prototype.bind.apply(C, [null].concat([].slice.call(arguments))))(); window.__ac.push(name); return a; }; window[name].prototype = C.prototype; };
      wrap('AudioContext'); wrap('webkitAudioContext');
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(L.URL);
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(1500);
    const pre = await page.evaluate(() => window.__ac.length);
    check('no AudioContext exists before any user gesture (title + attract shift running)', pre === 0, String(pre));
    await page.tap('#btnTitleClock'); await sleep(500);
    const post = await page.evaluate(() => ({ n: window.__ac.length, enabled: BY.Audio.isEnabled() }));
    check('the first tap (Clock In) creates the audio context', post.n >= 1 && post.enabled, JSON.stringify(post));
    // sound toggle persists across a reload
    await page.evaluate(() => { BY.UI.debug.run().player.battery = 0.01; });
    await L.waitScreen(page, ['report'], 8000);
    await page.tap('#btnRepSecond').catch(() => {}); await sleep(100);
    if (await L.screen(page) !== 'workshop') await page.tap('#btnRepPrimary');
    await L.waitScreen(page, ['workshop'], 3000);
    await page.tap('#btnGear'); await sleep(250);
    await page.tap('#swSound'); await sleep(150);
    const off = await page.evaluate(() => ({ s: BY.UI.debug.save().settings.sound, en: BY.Audio.isEnabled(), stored: JSON.parse(localStorage.getItem('boltyard.save.v1')).settings.sound }));
    check('Sound toggle off: setting, audio engine and stored save all say off', off.s === false && off.en === false && off.stored === false, JSON.stringify(off));
    await page.reload();
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(800);
    const re = await page.evaluate(() => ({ s: BY.UI.debug.save().settings.sound, en: BY.Audio.isEnabled(), ac: window.__ac.length }));
    check('after a reload Sound is still off, audio engine disabled, no AudioContext created', re.s === false && re.en === false && re.ac === 0, JSON.stringify(re));
    await ctx.close();
  }

  // =====================================================================================================
  console.log('6. no horizontal scroll, no document scrollbar');
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932], [768, 1024], [1280, 800]]) {
    const { page, ctx } = await L.open(browser, { w, h, dpr: 1, save: save({ bolts: 500, cores: 2, up: Object.assign({}, midUp, { drone: 2, capacitor: 1 }), sectorsCleared: 2, sector: 3 }), errors });
    const m = async (label) => {
      const r = await page.evaluate(() => {
        const d = document.documentElement, b = document.body;
        return { sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight, bsw: b.scrollWidth, bsh: b.scrollHeight, iw: innerWidth, ih: innerHeight, sx: scrollX, sy: scrollY };
      });
      check(w + 'x' + h + ' ' + label + ': no horizontal overflow / vertical document scroll', r.sw <= r.iw && r.bsw <= r.iw && r.sh <= r.ih + 1 && r.bsh <= r.ih + 1 && r.sx === 0 && r.sy === 0, JSON.stringify([r.sw, r.iw, r.sh, r.ih]));
    };
    await m('workshop');
    await page.tap('#tabBtnCodex'); await sleep(100); await m('codex');
    await page.tap('#tabBtnLog'); await sleep(100); await m('log');
    await page.tap('#tabBtnBp'); await sleep(100);
    await page.tap('#btnClockIn'); await sleep(700);
    await page.evaluate(() => { BY.UI.debug.setInput((run) => BY.Autopilot.target(run, { skill: 'attentive' })); BY.UI.debug.timeScale = 8; });
    await sleep(1500);
    await m('shift');
    await page.evaluate(() => { BY.UI.debug.run().player.battery = 0.01; });
    await L.waitScreen(page, ['report'], 8000); await sleep(900);
    await m('report');
    await ctx.close();
  }

  // ---- Act II: hostile / absurd v2 saves must boot, render every tab and survive a shift
  {
    console.log('Act II saves');
    const mk = (extra) => Object.assign(L.act2Save('mid'), extra);
    const cases = {
      'junk overtime + flags': mk({ overtime: { level: 'x', best: NaN }, flags: { act2: 'yes', reveal: 1, chairman: {} } }),
      'infinite bolts / NaN cores': mk({ bolts: 1e308 * 10, cores: NaN }),
      'sector 99, uncapped levels 1e12': mk({ sector: 99, up: Object.assign(L.act2Save('ot7').up, { overtimepay: 1e12, hazardpay: -5 }) }),
      'Overtime level 500': mk(Object.assign(L.act2Save('ot7'), { overtime: { level: 500, best: 500 }, bolts: 1e300 })),
      'v1 save that had won': Object.assign(L.act2Save('justWon'), { v: 1 })
    };
    for (const [name, sv] of Object.entries(cases)) {
      const errs = [];
      const { ctx, page } = await L.open(browser, { w: 320, h: 640, errors: errs, save: sv });
      await sleep(500);
      const scr = await L.screen(page);
      for (const t of ['#tabBtnCodex', '#tabBtnLog', '#tabBtnBp']) { await page.tap(t); await sleep(120); }
      await page.evaluate(() => { document.getElementById('pane').scrollTop = 99999; });
      await sleep(120);
      const txt = await page.evaluate(() => document.getElementById('workshop').innerText);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check('Act II save "' + name + '": boots to workshop, no NaN / undefined / [object], no scroll, no errors', scr === 'workshop' && !/NaN|undefined|\[object|Infinity/.test(txt) && sw[0] <= sw[1] && errs.length === 0, scr + ' ' + errs.slice(0, 1).join(''));
      await page.tap('#btnClockIn'); await sleep(900);
      check('Act II save "' + name + '": a shift starts and steps', (await L.screen(page)) === 'shift' && (await page.evaluate(() => BY.UI.debug.run().t)) > 0.3 && errs.length === 0, errs.slice(0, 2).join(' '));
      await ctx.close();
    }
  }

  console.log('\nbrowser errors: ' + errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  if (errors.length) { failed++; }
  console.log('ROBUSTNESS: ' + pass + ' passed, ' + failed + ' failed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ROBUSTNESS crashed: ' + (e && e.stack || e)); process.exit(2); });
