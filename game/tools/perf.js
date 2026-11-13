#!/usr/bin/env node
// node tools/perf.js [--secs 8]
// Main-thread cost per frame on the REAL page for a late, crowded sector-5 shift: maxed loadout, Titan, drones, Overclock held on,
// 24+ bots kept alive, ~100 pickups kept on the floor, optionally the Overseer with pylons.
//   "frame (real ctx)"  = whole requestAnimationFrame callback incl. any canvas work that happens on the main thread
//   "frame (JS only)"   = same scenario with the 2D context replaced by a no-op proxy: engine + UI + renderer logic, no raster
//   allocation          = growth of usedJSHeapSize between frames (sum of positive steps; a scavenge frame shows a drop and is skipped)
'use strict';
const L = require('./lib-page.js');
const { chromium } = L;
const argv = process.argv.slice(2);
const SECS = +(argv[argv.indexOf('--secs') + 1] || 8);

function maxSave() {
  const up = { boot: 1 };
  const vm = require('vm'), fs = require('fs'), sb = { }; sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(require('path').join(L.root, 'src/data.js'), 'utf8'), sb);
  const D = sb.BY.Data;
  for (const u of D.UPGRADES) up[u.id] = u.max;
  return { v: 1, bolts: 1e9, cores: 99, up, sectorsCleared: 5, bossKills: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 1 }, sector: 5, seen: {},
    stats: { shifts: 80, kills: 9000, boltsTotal: 1e9, coresTotal: 80, playTime: 3000, bestCombo: 90, bestShiftBolts: 1e6, wonShifts: 70, wonPlayTime: 2900 },
    flags: { won: true, movedOnce: true, tip: 3, shopped: true }, settings: { sound: false, shake: true } };
}

async function scenario(browser, name, o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: o.dpr || 2, hasTouch: true, isMobile: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript((s) => { try { localStorage.setItem('boltyard.save.v1', JSON.stringify(s)); } catch (e) {} }, maxSave());
  await page.addInitScript(() => {
    // frame timing: wrap every rAF callback
    window.__fr = { n: 0, ms: 0, worst: 0, list: [], heap: [], last: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((ts) => {
      const t0 = performance.now();
      cb(ts);
      const d = performance.now() - t0, F = window.__fr;
      if (window.__measure) {
        F.n++; F.ms += d; if (d > F.worst) F.worst = d; F.list.push(d);
        if (performance.memory) F.heap.push(performance.memory.usedJSHeapSize);
      }
    });
  });
  await page.goto(L.URL);
  await page.addScriptTag({ path: require('path').join(L.root, 'tools/autopilot.js') });
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  await L.sleep(300);
  if (o.noop) {
    await page.evaluate(() => {
      const N = new Proxy(function () {}, { get(_, k) { return k === Symbol.toPrimitive ? () => 0 : N; }, apply() { return N; }, set() { return true; } });
      const r = document.getElementById('arena').getBoundingClientRect();
      const fake = { width: r.width * 2, height: r.height * 2, clientWidth: r.width, clientHeight: r.height, getContext() { return N; }, getBoundingClientRect() { return { left: r.left, top: r.top, width: r.width, height: r.height }; } };
      BY.Render.init(fake, { reducedMotion: false, shake: true });
    });
  }
  await page.tap('#btnClockIn'); await L.sleep(300);
  await page.evaluate((withBoss) => {
    const E = BY.Engine, d = BY.UI.debug, run = d.run();
    d.timeScale = 1;
    d.setInput((r) => BY.Autopilot.target(r, { skill: 'attentive' }));
    const types = ['roller', 'sparker', 'shieldbot', 'hauler', 'splitter', 'bomber', 'turret'];
    window.__fill = setInterval(() => {
      const r = d.run(); if (!r || r.over) return;
      const p = r.player; p.battery = p.maxBattery;
      if (!p.oc.active) { p.oc.active = true; p.oc.time = p.oc.dur; p.oc.charge = 1; }   // hold Overclock on
      let alive = 0; for (const e of r.enemies) if (!e.dead && !e.boss && e.type !== 'pylon') alive++;
      for (let i = alive; i < 25; i++) E.spawn(r, types[(Math.random() * types.length) | 0], 20 + Math.random() * 320, 20 + Math.random() * (r.h - 40), { entered: true, elite: Math.random() < 0.05 });
      let bolts = 0; for (const q of r.pickups) if (q.kind === 'bolt') bolts++;
      for (let i = bolts; i < 110 && r.pickups.length < 150; i++) r.pickups.push({ id: r._nid++, kind: 'bolt', value: 1 + ((Math.random() * 40) | 0), x: 10 + Math.random() * 340, y: 10 + Math.random() * (r.h - 20), vx: 0, vy: 0, age: Math.random() * 6 });
      if (withBoss) {
        const b = r.enemies.find((e) => e.boss);
        if (!b && r.boss.state !== 'dead') E.spawn(r, 'overseer');
        else if (b && b.hp > b.maxHp * 0.3) { b.hp = b.maxHp * 0.3; r.boss.hp = b.hp; }   // keeps the shield + pylons phase coming
        if (b && b.hp < b.maxHp * 0.2) { b.hp = b.maxHp * 0.3; r.boss.hp = b.hp; }
      }
    }, 120);
  }, !!o.boss);
  await L.sleep(2500);   // warm up, JIT, pools
  await page.evaluate(() => { window.__fr.n = 0; window.__fr.ms = 0; window.__fr.worst = 0; window.__fr.list = []; window.__fr.heap = []; window.__measure = true; });
  const t0 = Date.now();
  await L.sleep(SECS * 1000);
  const r = await page.evaluate(() => {
    window.__measure = false;
    const F = window.__fr, run = BY.UI.debug.run(), L = F.list.slice().sort((a, b) => a - b);
    let alloc = 0, scav = 0;
    for (let i = 1; i < F.heap.length; i++) { const d = F.heap[i] - F.heap[i - 1]; if (d > 0) alloc += d; else if (d < -20000) scav++; }
    const bossE = run.enemies.find((e) => e.boss);
    return { frames: F.n, avg: F.ms / F.n, p95: L[Math.floor(L.length * 0.95)], worst: F.worst, alloc, scav,
      enemies: run.enemies.length, pickups: run.pickups.length, shots: run.shots.length, drones: run.drones.length, oc: run.player.oc.active, boss: run.boss.state, pylons: run.enemies.filter((e) => e.type === 'pylon').length, bossInvuln: bossE ? bossE.invuln : null,
      titan: run.player.titan, particles: BY.Render.stats().particles, over: run.over };
  });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  return Object.assign({ name, secs, errs: errs.length, errMsg: errs[0] }, r, { allocMBs: r.alloc / 1048576 / secs, perFrameKB: r.alloc / 1024 / Math.max(1, r.frames) });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const rows = [];
  for (const [name, o] of [['A crowd, no Warden', {}], ['B Overseer + pylons', { boss: true }]]) {
    rows.push(await scenario(browser, name + ' | real ctx', o));
    rows.push(await scenario(browser, name + ' | JS only', Object.assign({ noop: true }, o)));
  }
  console.log('scenario'.padEnd(34) + 'frames  avg ms  p95 ms  worst  alloc MB/s  KB/frame  scav  bots shots pick part drones oc  boss pylons');
  for (const r of rows) {
    console.log(r.name.padEnd(34) + String(r.frames).padStart(6) + r.avg.toFixed(2).padStart(8) + r.p95.toFixed(2).padStart(8) + r.worst.toFixed(1).padStart(7) +
      r.allocMBs.toFixed(2).padStart(10) + r.perFrameKB.toFixed(1).padStart(10) + String(r.scav).padStart(6) +
      String(r.enemies).padStart(6) + String(r.shots).padStart(6) + String(r.pickups).padStart(5) + String(r.particles).padStart(5) + String(r.drones).padStart(6) + String(r.oc).padStart(6) + ' ' + r.boss + ' ' + r.pylons + (r.errs ? '  ERRORS ' + r.errs + ' ' + r.errMsg : ''));
  }
  const js = rows.filter((r) => /JS only/.test(r.name));
  const worst = Math.max.apply(null, js.map((r) => r.avg));
  console.log('\nPERF: worst JS-only average ' + worst.toFixed(2) + ' ms/frame (budget 4 ms) -> ' + (worst < 4 ? 'OK' : 'OVER BUDGET') + '; JS-only allocation ' + js.map((r) => r.allocMBs.toFixed(2) + ' MB/s').join(', '));
  await browser.close();
  process.exit(worst < 4 && !rows.some((r) => r.errs) ? 0 : 1);
})().catch((e) => { console.log('PERF crashed: ' + (e && e.stack || e)); process.exit(2); });
