#!/usr/bin/env node
// node tools/shots.js   -> shots/final-*.png  (real page, 390x844 DPR 2 touch, plus 360x640 and 1280x800 extras)
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const L = require('./lib-page.js');
const { sleep } = L;
const OUT = path.join(L.root, 'shots');
const sb = {}; sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(L.root, 'src/data.js'), 'utf8'), sb);
const D = sb.BY.Data;

function save(frac, sector, extra) {
  const up = { boot: 1 };
  for (const u of D.UPGRADES) { const n = Math.floor(u.max * frac); if (n > 0) up[u.id] = n; }
  if (frac >= 1) up.titan = 1; else delete up.titan;
  const s = { v: 1, bolts: frac >= 1 ? 5e8 : 2500, cores: frac >= 1 ? 40 : 3, up, sectorsCleared: sector - 1, bossKills: {}, sector, seen: {},
    stats: { shifts: 30, kills: 900, boltsTotal: 1e6, coresTotal: 10, playTime: 1500, bestCombo: 40, bestShiftBolts: 9000, wonShifts: 0, wonPlayTime: 0 },
    flags: { won: false, movedOnce: true, tip: 3, shopped: true }, settings: { sound: false, shake: true } };
  for (let i = 1; i < sector; i++) s.bossKills[i] = 1;
  return Object.assign(s, extra || {});
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, 'final-' + name + '.png') }); console.log('  shot final-' + name + '.png'); };
const ap = (page, skill) => page.evaluate((sk) => { const d = BY.UI.debug; d.setInput((r) => BY.Autopilot.target(r, { skill: sk || 'attentive' })); }, skill);
const bossStay = (page) => page.evaluate(() => { clearInterval(window.__keep); window.__keep = setInterval(() => { const r = BY.UI.debug.run(); if (r && !r.over) r.player.battery = Math.max(r.player.battery, r.player.maxBattery * 0.7); }, 100); });
async function until(page, fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await sleep(40); } return false; }

async function toBoss(page, state, scale) {
  await page.evaluate((sc) => { BY.UI.debug.timeScale = sc; }, scale || 6);
  const fn = new Function("const r = BY.UI.debug.run(); return !!r && r.boss.state === " + JSON.stringify(state) + ";");
  const ok = await until(page, fn, 90000);
  await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
  return ok;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await L.launch();
  const errs = [];
  const tap = (page, sel) => page.tap(sel);

  // ---- fresh save: title, first shift, first report, first workshop
  {
    const { ctx, page } = await L.open(browser, { dpr: 2, errors: errs, seed: 7 });
    await sleep(500); await shot(page, '01-title');
    await tap(page, '#btnTitleClock'); await sleep(3000); await shot(page, '02-first-shift-3s-hint');
    await ap(page, 'attentive'); await sleep(9000); await shot(page, '03-first-shift-10s');
    await page.evaluate(() => { BY.UI.debug.timeScale = 10; });
    await L.waitScreen(page, ['report'], 120000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    await sleep(1800); await shot(page, '04-first-report');
    await tap(page, '#btnRepPrimary'); await L.waitScreen(page, ['workshop'], 5000); await sleep(900);
    await shot(page, '05-first-workshop');
    const bought = await page.evaluate(() => { const b = BY.UI.debug.save(); return b.bolts; });
    const node = await page.$('.node[data-id="coil"]') || await page.$('.node.afford'); if (node) { await node.tap(); await sleep(500); await shot(page, '06-node-sheet'); }
    console.log('  first-visit bolts', bought);
    await ctx.close();
  }

  // ---- mid save in sector 3: fight with elites
  {
    const { ctx, page } = await L.open(browser, { dpr: 2, errors: errs, seed: 11, save: save(0.3, 3) });
    await tap(page, '#btnTitleClock').catch(() => {}); await sleep(300);
    if ((await L.screen(page)) !== 'shift') await tap(page, '#btnClockIn');
    await ap(page); await bossStay(page);
    await page.evaluate(() => { BY.UI.debug.timeScale = 6; });
    await until(page, () => { const r = BY.UI.debug.run(); return r && r.t > 25 && r.enemies.some((e) => e.elite); }, 60000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    await sleep(500); await shot(page, '07-sector3-elites');
    // Warden warning band
    const w = await toBoss(page, 'warning', 4); console.log('  warning reached', w);
    await sleep(900); await shot(page, '08-warden-warning');
    const a = await toBoss(page, 'active', 8); console.log('  warden active', a);
    await sleep(1600); await shot(page, '09-warden-fight');
    await ctx.close();
  }

  // ---- sector 1 Compactor with slam telegraph
  {
    const { ctx, page } = await L.open(browser, { dpr: 2, errors: errs, seed: 5, save: save(0.3, 1) });
    await tap(page, '#btnTitleClock').catch(() => {}); await sleep(300);
    if ((await L.screen(page)) !== 'shift') await tap(page, '#btnClockIn');
    await ap(page); await bossStay(page);
    await toBoss(page, 'active', 8);
    for (let i = 0; i < 40; i++) { await sleep(150); const tel = await page.evaluate(() => { const r = BY.UI.debug.run(); return !!(r && r.hazards && r.hazards.length); }); if (tel) break; }
    await shot(page, '10-compactor-telegraph');
    await ctx.close();
  }

  // ---- late save, sector 5: Overclock, Overseer
  {
    const { ctx, page } = await L.open(browser, { dpr: 2, errors: errs, seed: 3, save: save(1, 5) });
    await sleep(300);
    await shot(page, '11-late-workshop');
    const t = await page.$('.node[data-id="titan"]'); if (t) { await t.tap(); await sleep(500); await shot(page, '12-titan-node-sheet'); await page.tap('#nsClose'); await sleep(300); }
    await tap(page, '#btnClockIn'); await sleep(300);
    await ap(page); await bossStay(page);
    await page.evaluate(() => { const r = BY.UI.debug.run(); r.player.oc.active = true; r.player.oc.time = r.player.oc.dur; r.player.oc.charge = 1; });
    await sleep(1500); await shot(page, '13-overclock');
    await toBoss(page, 'active', 8);
    await page.evaluate(() => { const r = BY.UI.debug.run(); r.player.oc.active = false; });
    let got = false;
    for (let i = 0; i < 50 && !got; i++) { await sleep(200); got = await page.evaluate(() => { const r = BY.UI.debug.run(); return !!(r && r.hazards && r.hazards.length); }); }
    await shot(page, '14-overseer-telegraph');
    await page.evaluate(() => { BY.UI.debug.timeScale = 4; });
    const won = await L.waitScreen(page, ['victory'], 90000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    console.log('  victory screen', won);
    await sleep(2500); await shot(page, '15-victory');
    await ctx.close();
  }

  // ---- extras: 360x640 and 1280x800
  {
    const { ctx, page } = await L.open(browser, { w: 360, h: 640, dpr: 2, errors: errs, seed: 9, save: save(0.5, 2) });
    await sleep(500); await shot(page, '16-workshop-360x640');
    await tap(page, '#btnClockIn'); await sleep(300); await ap(page); await sleep(3500); await shot(page, '17-shift-360x640');
    await ctx.close();
  }
  {
    const { ctx, page } = await L.open(browser, { w: 1280, h: 800, dpr: 1, touch: false, errors: errs, seed: 9, save: save(0.5, 2) });
    await sleep(500); await shot(page, '18-workshop-1280x800');
    await ctx.close();
  }
  await browser.close();
  console.log('SHOTS done; console/page errors: ' + errs.length + (errs.length ? ' ' + errs[0] : ''));
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.log('SHOTS crashed: ' + (e && e.stack || e)); process.exit(2); });
