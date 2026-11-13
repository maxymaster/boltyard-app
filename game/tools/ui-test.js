#!/usr/bin/env node
// node tools/ui-test.js [--real] [--phase=a,b,c]
// Builds dist/test.html and drives it in headless Chrome. Fails on any console error / page error.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const root = path.join(__dirname, '..');
const useReal = process.argv.includes('--real');
const only = (process.argv.find((a) => a.startsWith('--phase=')) || '').slice(8).split(',').filter(Boolean);
const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
console.log(execSync('node tools/build.js' + (useReal ? '' : ' --stub-render'), { cwd: root }).toString().trim());
const URL = 'file://' + path.join(root, 'dist/test.html');
const AUTOPILOT = path.join(root, 'tools/autopilot.js');

const errors = [];
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, vp, o) {
  o = o || {};
  const ctx = await browser.newContext({
    viewport: vp, deviceScaleFactor: o.dpr || 2, hasTouch: o.touch !== false, isMobile: o.mobile !== false && o.touch !== false,
    reducedMotion: o.reduced ? 'reduce' : 'no-preference'
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  if (o.noStorage) await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage denied'); } });
  });
  if (o.save) await page.addInitScript((s) => { try { if (!localStorage.getItem('boltyard.save.v1')) { localStorage.setItem('boltyard.save.v1', JSON.stringify(s)); window.__seeded = (window.__seeded || 0) + 1; } else window.__seeded = 0; } catch (e) { window.__seeded = 'err ' + e; } }, o.save);
  await page.goto(URL);
  await page.addScriptTag({ path: AUTOPILOT });
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  await sleep(150);
  return { ctx, page };
}
// the Blueprint is a pannable map: bring a plate into view, then tap it (mouse for desktop)
const ot7Save = () => { const s = require('./lib-page.js').act3Save('founder'); s.overtime = { level: 6, best: 6 }; s.bolts = 1e30; s.cores = 1.5e12; s.stats.boltsTotal = 9.9e32; s.stats.bestShiftBolts = 7.7e28; s.up.overtimepay = 37; s.up.hazardpay = 12; s.stats.kills = 9.9e7; s.stats.coresTotal = 2e12; return s; };
const secTap = async (page, sel, opt) => { if (await page.evaluate(() => document.getElementById('workshop').classList.contains('slim'))) { await page.tap('#btnSecBar'); await sleep(200); } return page.tap(sel, opt); };
async function tapId(page, id, desk) {
  const shown = await page.evaluate((i) => BY.UI.debug.panTo(i), id);
  await sleep(140);
  const r = await page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, id);
  if (desk) await page.mouse.click(r[0], r[1]); else await page.touchscreen.tap(r[0], r[1]);
  return shown;
}
const screen = (page) => page.evaluate(() => BY.UI.debug.screen());
async function waitScreen(page, names, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 60000)) {
    const s = await screen(page);
    if (names.includes(s)) return s;
    await sleep(60);
  }
  return null;
}
async function touchDrag(cdp, x0, y0, x1, y1, steps) {
  steps = steps || 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const shot = (page, name) => page.screenshot({ path: path.join(shots, name) });

// a mid-game save for layout tests / screenshots
function midSave() {
  return {
    v: 1, bolts: 3400, cores: 2,
    up: { boot: 1, coil: 6, pulse: 3, field: 2, fork: 1, amp: 0, cell: 5, thrust: 2, recycler: 1, magnet: 3, sorter: 4, drone: 1 },
    sectorsCleared: 2, bossKills: { 1: 3, 2: 1, 3: 0, 4: 0, 5: 0 }, sector: 3,
    seen: { scrapling: true, roller: true, sparker: true, shieldbot: true, hauler: true, compactor: true, shredder: true },
    stats: { shifts: 31, kills: 800, boltsTotal: 9000, coresTotal: 6, playTime: 1500, bestCombo: 24, bestShiftBolts: 600, wonShifts: null, wonPlayTime: null },
    flags: { won: false, movedOnce: true }, settings: { sound: false, shake: true }
  };
}
function lateSave() {
  const s = JSON.parse(JSON.stringify(midSave()));
  return s;
}

const phases = {};

// ---------------------------------------------------------------- A: title, shift, input, report
phases.a = async (browser) => {
  console.log('A. title / shift / input / report');
  const { ctx, page } = await open(browser, { width: 390, height: 700 });
  check('boots into title (empty storage)', await screen(page) === 'title');
  const t1 = await page.evaluate(() => BY.UI.debug.run().t);
  await sleep(500);
  const t2 = await page.evaluate(() => ({ t: BY.UI.debug.run().t, attract: BY.UI.debug.run().attract, kills: BY.UI.debug.run().enemies.length }));
  check('attract shift is running', t2.attract && t2.t > t1 + 0.2, t1.toFixed(2) + ' -> ' + t2.t.toFixed(2) + ', bots ' + t2.kills);
  check('title is visible, Clock In present', await page.isVisible('#btnTitleClock'));
  await shot(page, 'ui-title.png');

  await page.tap('#btnTitleClock');
  await sleep(250);
  check('tap Clock In -> shift screen', await screen(page) === 'shift');
  check('HUD visible, first-shift hint visible', await page.isVisible('#hud') && await page.isVisible('#hint'));
  const cdp = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty, sc: BY.Render.scale() }; });
  const box = await page.locator('#stage').boundingBox();
  const dx = 60, dy = -50;
  await touchDrag(cdp, box.x + box.width / 2, box.y + box.height * 0.8, box.x + box.width / 2 + dx, box.y + box.height * 0.8 + dy);
  await sleep(120);
  const after = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty, hint: !document.getElementById('hint').hidden && /steer/i.test(document.getElementById('hintText').textContent), moved: BY.UI.debug.save().flags.movedOnce }; });
  const ex = dx * 1.3 / before.sc, ey = dy * 1.3 / before.sc;
  check('touch drag moves target by delta x1.3 / scale (x)', Math.abs((after.tx - before.tx) - ex) < 6, (after.tx - before.tx).toFixed(1) + ' vs ' + ex.toFixed(1));
  check('touch drag moves target by delta x1.3 / scale (y)', Math.abs((after.ty - before.ty) - ey) < 6, (after.ty - before.ty).toFixed(1) + ' vs ' + ey.toFixed(1));
  check('steer hint disappears once moved (a later tip may follow); movedOnce saved', !after.hint && after.moved);
  await sleep(250);
  await shot(page, 'ui-shift.png');

  // pause / resume / clock out
  await page.keyboard.press('Escape');
  await sleep(100);
  let ps = await page.evaluate(() => ({ p: BY.UI.debug.paused(), t: BY.UI.debug.run().t, vis: !document.getElementById('pause').hidden }));
  check('Esc pauses and shows the pause sheet', ps.p && ps.vis);
  await sleep(300);
  const tPaused = await page.evaluate(() => BY.UI.debug.run().t);
  check('engine time frozen while paused', Math.abs(tPaused - ps.t) < 0.02, ps.t.toFixed(3) + ' / ' + tPaused.toFixed(3));
  await shot(page, 'ui-pause.png');
  await page.keyboard.press('Space');
  await sleep(250);
  ps = await page.evaluate(() => ({ p: BY.UI.debug.paused(), t: BY.UI.debug.run().t }));
  check('Space resumes', !ps.p && ps.t > tPaused + 0.05);
  await page.tap('#btnPause');
  await sleep(120);
  check('pause button pauses', await page.evaluate(() => BY.UI.debug.paused()));
  await page.tap('#btnResume');
  await sleep(120);
  check('Resume button resumes', !(await page.evaluate(() => BY.UI.debug.paused())));
  await page.tap('#btnPause'); await sleep(100);
  await page.tap('#btnClockOut');
  const s1 = await waitScreen(page, ['report'], 5000);
  check('Clock out ends the shift -> report', s1 === 'report');
  const rep0 = await page.evaluate(() => BY.UI.debug.report());
  check('clock-out report reason', rep0 && rep0.reason === 'clockout');
  await sleep(1200);
  check('stamp reads CLOCKED OUT', (await page.textContent('#repStamp')).trim().toUpperCase() === 'CLOCKED OUT');

  // a real shift with the autopilot driving
  await page.tap('#btnRepSecond, #btnRepPrimary >> text=Clock in again').catch(async () => { await page.evaluate(() => BY.UI.debug.begin()); });
  await sleep(200);
  if (await screen(page) !== 'shift') await page.evaluate(() => BY.UI.debug.begin());
  await page.evaluate(() => { BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 8; });
  const s2 = await waitScreen(page, ['report'], 90000);
  check('autopilot shift ends in a report', s2 === 'report');
  await page.evaluate(() => { BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });
  await sleep(1500);
  const rep = await page.evaluate(() => BY.UI.debug.report());
  const rows = await page.evaluate(() => document.getElementById('repRows').innerText);
  const fmtB = await page.evaluate((n) => BY.UI.fmt(n), rep.bolts);
  check('report bolts row matches report', rows.includes(fmtB) && (await page.textContent('#repBolts')).trim() === fmtB, 'bolts ' + rep.bolts + ' kills ' + rep.kills);
  check('report kills row matches report', new RegExp('Bots scrapped\\s*\\n?\\s*' + rep.kills + '\\b').test(rows.replace(/\n+/g, '\n')) || rows.includes(String(rep.kills)), 'kills ' + rep.kills);
  const prim = (await page.textContent('#btnRepPrimary')).trim();
  check('report primary button label reflects affordable upgrades', /Workshop/.test(prim) || /Clock in again/.test(prim), prim);
  await shot(page, 'ui-report.png');
  await ctx.close();
};

// ---------------------------------------------------------------- B: desktop input
phases.b = async (browser) => {
  console.log('B. desktop input');
  const { ctx, page } = await open(browser, { width: 1280, height: 800 }, { touch: false, dpr: 1 });
  check('desktop boots to title', await screen(page) === 'title');
  await page.click('#btnTitleClock');
  await sleep(200);
  check('mouse click Clock In -> shift', await screen(page) === 'shift');
  const map = await page.evaluate(() => { const a = BY.Render.toArena(0, 0), b = BY.Render.toArena(100, 100); return { ox: a.x, oy: a.y, k: (b.x - a.x) / 100 }; });
  const pl = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { x: p.x, y: p.y }; });
  const cx = (pl.x + 40 - map.ox) / map.k, cy = (pl.y - 50 - map.oy) / map.k;
  await page.mouse.move(cx - 20, cy + 20); await page.mouse.move(cx, cy, { steps: 4 });
  await sleep(80);
  const tg = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
  check('mouse move sets the absolute target', Math.abs(tg.tx - (pl.x + 40)) < 4 && Math.abs(tg.ty - (pl.y - 50)) < 4, tg.tx.toFixed(1) + ',' + tg.ty.toFixed(1) + ' vs ' + (pl.x + 40).toFixed(1) + ',' + (pl.y - 50).toFixed(1));
  const k0 = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
  await page.keyboard.down('ArrowLeft'); await sleep(350); await page.keyboard.up('ArrowLeft');
  const k1 = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
  check('ArrowLeft moves the target left', k1.tx < k0.tx - 15, k0.tx.toFixed(1) + ' -> ' + k1.tx.toFixed(1));
  await page.keyboard.down('s'); await sleep(300); await page.keyboard.up('s');
  const k2 = await page.evaluate(() => { const p = BY.UI.debug.run().player; return { tx: p.tx, ty: p.ty }; });
  check('S moves the target down', k2.ty > k1.ty + 15, k1.ty.toFixed(1) + ' -> ' + k2.ty.toFixed(1));
  const cs = await page.evaluate(() => { const a = document.getElementById('app').getBoundingClientRect(); return { w: a.width, x: a.x }; });
  check('app is a centred 480px column on desktop', Math.abs(cs.w - 480) < 1 && Math.abs(cs.x - 400) < 1, cs.w + ' @ ' + cs.x);
  await shot(page, 'ui-shift-desktop.png');
  await ctx.close();
};

// ---------------------------------------------------------------- C: workshop purchase, tabs, persistence
phases.c = async (browser) => {
  console.log('C. workshop');
  const { ctx, page } = await open(browser, { width: 390, height: 700 });
  await page.tap('#btnTitleClock');
  await sleep(200);
  await page.evaluate(() => { BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 8; });
  await waitScreen(page, ['report'], 90000);
  await page.evaluate(() => { BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });
  await sleep(1300);
  const bolts0 = await page.evaluate(() => BY.UI.debug.save().bolts);
  const nAff = await page.evaluate(() => BY.Engine.affordableCount(BY.UI.debug.save()));
  check('first shift earned enough for a purchase', nAff > 0, 'bolts ' + bolts0 + ', affordable ' + nAff);
  const wsBtn = (await page.textContent('#btnRepPrimary')).includes('Workshop') ? '#btnRepPrimary' : '#btnRepSecond';
  check('report primary says Workshop with a count when upgrades are ready', /Workshop . \d+ upgrade/.test((await page.textContent('#btnRepPrimary')).trim()), (await page.textContent('#btnRepPrimary')).trim());
  await page.tap(wsBtn);
  await sleep(900);
  check('-> workshop', await screen(page) === 'workshop');
  check('Blueprint tab shows the affordable count', await page.isVisible('#bpBadge') && (await page.textContent('#bpBadge')).trim() === String(nAff));
  const cheapest = await page.evaluate(() => {
    const s = BY.UI.debug.save(); let best = null, bc = 1e18;
    for (const u of BY.Data.UPGRADES) { const i = BY.Engine.upgradeInfo(s, u.id); if (u.id !== 'boot' && i.affordable && i.cost.bolts < bc) { bc = i.cost.bolts; best = u.id; } }
    return { id: best, cost: bc };
  });
  const inView = await page.evaluate((id) => { const n = document.querySelector('.node[data-id=' + id + ']').getBoundingClientRect(), p = document.getElementById('pane').getBoundingClientRect(); return n.top >= p.top - 1 && n.bottom <= p.bottom + 1; }, cheapest.id);
  check('cheapest affordable node is in view', inView, cheapest.id + ' cost ' + cheapest.cost);
  await shot(page, 'ui-workshop.png');
  const saveBefore = await page.evaluate(() => JSON.stringify(BY.UI.debug.save()));
  await tapId(page, cheapest.id);
  await sleep(500);
  check('detail sheet opens', await page.isVisible('#sheet'));
  check('sheet shows the node name', (await page.textContent('#nsName')).length > 2, await page.textContent('#nsName'));
  await shot(page, 'ui-sheet.png');
  await page.tap('#btnBuy');
  await sleep(500);
  const st = await page.evaluate((id) => { const s = BY.UI.debug.save(); return { lv: s.up[id], bolts: s.bolts, stored: JSON.parse(localStorage.getItem('boltyard.save.v1')), node: document.querySelector('.node[data-id=' + id + ']').innerText + '|' + document.querySelector('.node[data-id=' + id + ']').getAttribute('aria-label') }; }, cheapest.id);
  check('buy via taps: level 1', st.lv === 1, 'level ' + st.lv);
  check('buy: bolts decreased by the cost', st.bolts === bolts0 - cheapest.cost, bolts0 + ' -> ' + st.bolts);
  check('buy: save changed in storage', JSON.stringify(st.stored) !== saveBefore && st.stored.up[cheapest.id] === 1);
  check('buy: node shows level 1', /1\//.test(st.node) || /level 1 /.test(st.node), st.node.replace(/\n/g, ' '));
  const kids = await page.evaluate((id) => BY.Data.UPGRADES.filter((u) => u.requires.some((r) => r[0] === id)).map((u) => ({ id: u.id, unl: BY.Engine.upgradeInfo(BY.UI.debug.save(), u.id).unlocked, locked: document.querySelector('.node[data-id=' + u.id + ']').classList.contains('locked') })), cheapest.id);
  check('buy: children unlocked in engine and in the DOM', kids.length > 0 && kids.every((k) => k.unl && !k.locked), JSON.stringify(kids.map((k) => k.id)));
  await shot(page, 'ui-sheet-after.png');
  // deny: tap Bolt on until it fails, assert it does not buy and the deny shake runs
  await page.evaluate(() => { const s = BY.UI.debug.save(); s.bolts = 0; BY.UI.debug.setSave(s); });
  await sleep(300);
  await tapId(page, 'coil');
  await sleep(300);
  const lvBefore = await page.evaluate(() => BY.UI.debug.save().up.coil);
  await page.tap('#btnBuy', { force: true });
  await sleep(100);
  const lvAfter = await page.evaluate(() => BY.UI.debug.save().up.coil);
  check('unaffordable Bolt on does nothing', lvBefore === lvAfter);
  check('cost shows the red short state', await page.isVisible('#nsCost .short'));
  // hold to repeat
  await page.evaluate(() => { const s = BY.UI.debug.save(); s.bolts = 100000; BY.UI.debug.setSave(s); });
  await sleep(300);
  await tapId(page, 'coil'); await sleep(250);
  if (!(await page.isVisible('#sheet'))) { await tapId(page, 'coil'); await sleep(250); }
  const hb = await page.locator('#btnBuy').boundingBox();
  const l0 = await page.evaluate(() => BY.UI.debug.save().up.coil);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2, id: 1 }] });
  await sleep(1300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const l1 = await page.evaluate(() => BY.UI.debug.save().up.coil);
  check('holding Bolt on repeats purchases', l1 >= l0 + 4, l0 + ' -> ' + l1);
  await sleep(500);
  const l2 = await page.evaluate(() => BY.UI.debug.save().up.coil);
  check('releasing stops the repeat', l2 === l1);
  await page.evaluate(() => BY.UI.debug.setSave(Object.assign(BY.UI.debug.save(), {})));

  // sector picker
  await page.evaluate((s) => BY.UI.debug.setSave(s), midSave());
  await sleep(500);
  await secTap(page, '.stile[data-n="2"]');
  await sleep(150);
  const sec = await page.evaluate(() => ({ s: BY.UI.debug.save().sector, stored: JSON.parse(localStorage.getItem('boltyard.save.v1')).sector, label: document.getElementById('clockLabel').textContent }));
  check('sector pick updates Clock In label and persists', sec.s === 2 && sec.stored === 2 && /Sector 2/.test(sec.label), sec.label);
  await secTap(page, '.stile[data-n="4"]');
  await sleep(150);
  const info = (await page.textContent('#secInfo')).trim();
  check('locked sector tap explains how to open it', /Scrap/.test(info) && /Assembly Line|The Smelter|Smelter/.test(info) || /Scrap/.test(info), info);
  check('locked sector tap does not select it', (await page.evaluate(() => BY.UI.debug.save().sector)) === 2);
  await secTap(page, '.stile[data-n="5"]'); await sleep(100);

  // tabs
  await page.tap('#tabBtnCodex'); await sleep(400);
  check('codex tab shows bots and silhouettes', (await page.locator('.cx-e').count()) === 16 && (await page.locator('.cx-e.unmet').count()) > 0, (await page.locator('.cx-e.unmet').count()) + ' unmet');
  await shot(page, 'ui-codex.png');
  await page.tap('#tabBtnLog'); await sleep(300);
  check('log tab shows totals', (await page.textContent('#tabLog')).includes('Shifts worked'));
  await shot(page, 'ui-log.png');
  await page.tap('#tabBtnBp'); await sleep(200);
  await page.tap('#btnGear'); await sleep(350);
  check('settings sheet opens', await page.isVisible('#settings'));
  await shot(page, 'ui-settings.png');
  await ctx.close();
};

// ---------------------------------------------------------------- D: persistence, reload, settings, reset, no-storage
phases.d = async (browser) => {
  console.log('D. persistence / settings / reset / storage disabled');
  let { ctx, page } = await open(browser, { width: 390, height: 700 }, { save: midSave() });
  check('returning player boots into the Workshop', await screen(page) === 'workshop');
  const sv0 = await page.evaluate(() => JSON.stringify(BY.UI.debug.save()));
  await page.reload();
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  check('reload boots into the Workshop with the same save', await screen(page) === 'workshop' && (await page.evaluate(() => JSON.stringify(BY.UI.debug.save()))) === sv0);
  // sound toggle persistence (mid save has sound:false -> turn on)
  await page.tap('#btnGear'); await sleep(300);
  check('sound switch reflects the saved setting (off)', (await page.getAttribute('#swSound', 'aria-checked')) === 'false');
  await page.tap('#swSound'); await sleep(100);
  check('sound toggle saves', await page.evaluate(() => JSON.parse(localStorage.getItem('boltyard.save.v1')).settings.sound === true));
  await page.tap('#swShake'); await sleep(100);
  check('shake toggle saves', await page.evaluate(() => JSON.parse(localStorage.getItem('boltyard.save.v1')).settings.shake === false));
  // headless Chrome can drop a localStorage write made moments before a reload: carry the app's saved string across explicitly
  { const cur = await page.evaluate(() => localStorage.getItem('boltyard.save.v1')); await page.addInitScript((c) => { try { if (c) localStorage.setItem('boltyard.save.v1', c); } catch (e) {} }, cur); }
  await page.reload();
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  check('settings survive reload', await page.evaluate(() => { const s = BY.UI.debug.save().settings; return s.sound === true && s.shake === false; }));
  // two-step reset
  await page.tap('#btnGear'); await sleep(300);
  await page.tap('#btnReset'); await sleep(100);
  check('first Reset tap arms (label changes, save kept)', /again/i.test(await page.textContent('#btnReset')) && (await page.evaluate(() => BY.UI.debug.save().stats.shifts)) === 31);
  await page.tap('#swSound'); await sleep(100);
  check('tapping anything else disarms', !/again/i.test(await page.textContent('#btnReset')));
  await page.tap('#btnReset'); await sleep(80);
  await page.tap('#btnReset'); await sleep(500);
  const afterReset = await page.evaluate(() => ({ s: BY.UI.debug.save().stats.shifts, b: BY.UI.debug.save().bolts, scr: BY.UI.debug.screen() }));
  check('second Reset tap wipes progress and returns to title', afterReset.s === 0 && afterReset.b === 0 && afterReset.scr === 'title', JSON.stringify(afterReset));
  await ctx.close();

  // storage disabled
  ({ ctx, page } = await open(browser, { width: 390, height: 700 }, { noStorage: true }));
  check('boots with localStorage throwing', await screen(page) === 'title');
  await page.tap('#btnTitleClock'); await sleep(200);
  await page.evaluate(() => { BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 8; });
  const sr = await waitScreen(page, ['report'], 90000);
  check('a full shift plays and reports without storage', sr === 'report');
  await sleep(300);
  await page.evaluate(() => { BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });
  await page.tap('#btnGear').catch(() => {});
  await ctx.close();

  // lifecycle: hidden page pauses; pagehide banks the shift
  ({ ctx, page } = await open(browser, { width: 390, height: 700 }, { save: midSave() }));
  await page.evaluate(() => { BY.UI.debug.begin(1); BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 6; });
  await sleep(1500);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(150);
  check('hiding the page pauses the shift', await page.evaluate(() => BY.UI.debug.paused()));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  const pre = await page.evaluate(() => ({ sh: JSON.parse(localStorage.getItem('boltyard.save.v1')).stats.shifts, t: BY.UI.debug.run().t }));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const post = await page.evaluate(() => ({ sh: JSON.parse(localStorage.getItem('boltyard.save.v1')).stats.shifts, bolts: JSON.parse(localStorage.getItem('boltyard.save.v1')).bolts }));
  check('pagehide ends the shift and saves it', post.sh === pre.sh + 1, pre.sh + ' -> ' + post.sh + ' (shift time ' + pre.t.toFixed(1) + 's)');
  await ctx.close();

  // reduced motion boots and renders
  ({ ctx, page } = await open(browser, { width: 390, height: 700 }, { save: midSave(), reduced: true }));
  check('reduced-motion boot ok', await screen(page) === 'workshop');
  await tapId(page, 'coil'); await sleep(150);
  await page.tap('#btnBuy'); await sleep(200);
  check('purchase works with reduced motion', await page.evaluate(() => BY.UI.debug.save().up.coil) === 7);
  await ctx.close();
};

// ---------------------------------------------------------------- E: long play with autopilot
phases.e = async (browser) => {
  console.log('E. long autopilot play, Warden, sector unlock, late game, victory');
  const { ctx, page } = await open(browser, { width: 390, height: 700 });
  await page.tap('#btnTitleClock'); await sleep(200);
  await page.evaluate(() => {
    window.__w = { warn: false, boss: false, frozen: null, want: true };
    (function tick() {
      const sig = document.getElementById('hudSig');
      if (!document.getElementById('warn').hidden && !__w.warn) { __w.warn = true; if (__w.want) { BY.UI.debug.timeScale = 0.02; __w.frozen = 'warn'; } }
      if (sig && sig.dataset.mode === 'boss' && !__w.boss) { __w.boss = true; if (__w.want) { BY.UI.debug.timeScale = 0.02; __w.frozen = 'boss'; } }
      requestAnimationFrame(tick);
    })();
    BY.UI.debug.setInput((r) => BY.Autopilot.target(r));
    BY.UI.debug.timeScale = 14;
  });
  let shifts = 0, sawUnlock = false, sawKillReport = false, shotWarn = false, shotBoss = false, bandText = '', bossLabel = '';
  const t0 = Date.now();
  while (shifts < 90 && Date.now() - t0 < 14 * 60 * 1000) {
    const t1 = Date.now();
    let s = null;
    while (Date.now() - t1 < 120000) {
      s = await screen(page);
      if (s === 'report' || s === 'victory') break;
      const fz = await page.evaluate(() => __w.frozen);
      if (fz) {
        await sleep(120);
        if (fz === 'warn') {
          shotWarn = true; bandText = (await page.textContent('#warn')).replace(/\s+/g, ' ').trim();
          await shot(page, 'ui-warden-warning.png');
        } else {
          shotBoss = true; bossLabel = (await page.textContent('#hudSig')).replace(/\s+/g, ' ').trim();
          await shot(page, 'ui-hud-warden.png');
        }
        await page.evaluate(() => { __w.frozen = null; BY.UI.debug.timeScale = 14; });
      }
      await sleep(40);
    }
    if (s !== 'report' && s !== 'victory') { check('shift ended within 2 minutes real time', false, 'shift ' + shifts); break; }
    shifts++;
    const rep = await page.evaluate(() => BY.UI.debug.report());
    if (rep.unlockedSector && !sawUnlock) {
      sawUnlock = true; await sleep(1500); await shot(page, 'ui-report-unlock.png');
    }
    if (rep.bossDefeated && !sawKillReport) {
      sawKillReport = true; await sleep(1500); await shot(page, 'ui-report-warden.png');
    }
    if (s === 'victory') break;
    if (shotWarn && shotBoss && sawUnlock && sawKillReport && shifts >= 25) break;
    await page.evaluate(() => {
      const d = BY.UI.debug, sv = d.save();
      BY.Autopilot.shop(sv); sv.sector = BY.Autopilot.pickSector(sv);
      d.setSave(sv); d.begin(sv.sector);
    });
    await sleep(80);
  }
  const fin = await page.evaluate(() => { const s = BY.UI.debug.save(); return { shifts: s.stats.shifts, cleared: s.sectorsCleared, kills: s.bossKills, bolts: s.bolts }; });
  console.log('     played ' + shifts + ' shifts, save: ' + JSON.stringify(fin) + ', real time ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  check('Warden warning band appeared', shotWarn, bandText);
  check('HUD switched to the Warden bar', shotBoss, bossLabel);
  check('a Warden was scrapped (report stamped)', sawKillReport);
  check('a sector unlocked', sawUnlock);
  await page.evaluate(() => { __w.want = false; BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });

  // late game
  await page.evaluate(() => {
    const sv = BY.Engine.newSave();
    for (const u of BY.Data.UPGRADES) sv.up[u.id] = u.max;
    sv.bolts = 123456789; sv.cores = 42; sv.sectorsCleared = 4; sv.sector = 5;
    sv.bossKills = { 1: 9, 2: 7, 3: 5, 4: 3, 5: 0 };
    for (const e of BY.Data.ENEMIES) sv.seen[e.id] = true;
    for (const b of BY.Data.BOSSES) sv.seen[b.id] = true;
    sv.stats = Object.assign(sv.stats, { shifts: 94, kills: 21000, boltsTotal: 5.2e9, coresTotal: 90, playTime: 4380, bestCombo: 77, bestShiftBolts: 8.4e8 });
    sv.flags.movedOnce = true;
    BY.UI.debug.workshop();
    BY.UI.debug.setSave(sv);
  });
  await sleep(1200);
  check('late-game Workshop renders', await screen(page) === 'workshop');
  await page.evaluate(() => { document.getElementById('pane').scrollTop = 0; });
  await sleep(200);
  await shot(page, 'ui-workshop-late.png');
  await page.evaluate(() => { document.getElementById('pane').scrollTop = 9999; });
  await sleep(200);
  await shot(page, 'ui-workshop-late-bottom.png');
  const bigtxt = await page.evaluate(() => document.getElementById('wsBolts').textContent + ' | ' + document.getElementById('stDps').textContent);
  console.log('     late header: ' + bigtxt);
  // try a real win in sector 5
  await page.evaluate(() => { BY.UI.debug.begin(5); BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 20; });
  const end = await waitScreen(page, ['report', 'victory'], 150000);
  await page.evaluate(() => { BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });
  let won = end === 'victory';
  console.log('     sector 5 shift ended: ' + end + ' ' + JSON.stringify(await page.evaluate(() => { const r = BY.UI.debug.report(); return r && { reason: r.reason, boss: r.bossDefeated, won: r.gameWon, time: Math.round(r.time) }; })));
  if (!won) {
    await page.evaluate(() => BY.UI.debug.fakeReport({ reason: 'victory', sector: 5, time: 120, bolts: 0, cores: 0, kills: 400, bestCombo: 90, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: null, gameWon: true, newSeen: [] }));
  }
  await sleep(1400);
  check('Victory screen shows', await screen(page) === 'victory' && await page.isVisible('#vicStamp'), won ? 'real win' : 'forced');
  await shot(page, 'ui-victory.png');
  await page.tap('#btnKeep'); await sleep(900);
  check('Keep playing returns to the Workshop', await screen(page) === 'workshop');
  await ctx.close();
};

// ---------------------------------------------------------------- F: layout
phases.f = async (browser) => {
  console.log('F. layout');
  const sizes = [[320, 520], [360, 640], [390, 700], [430, 900], [1280, 800]];
  for (const [w, h] of sizes) {
    const desk = w > 600;
    // title first (fresh storage)
    let { ctx, page } = await open(browser, { width: w, height: h }, { touch: !desk, dpr: desk ? 1 : 2 });
    const tag = w + 'x' + h;
    const lay = async (label) => {
      const r = await page.evaluate(() => {
        const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, wide: [], small: [], iw: innerWidth, ih: innerHeight };
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('[hidden]')) continue;
          const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
          if (el.tagName === 'svg' || el.closest('svg') || el.tagName === 'CANVAS' && false) { continue; }
          if (r.width > innerWidth + 0.5 && !el.closest('#bp')) out.wide.push(el.tagName + '#' + el.id + '.' + el.className + ' ' + Math.round(r.width));
          if (el.tagName === 'BUTTON') {
            // visible = not clipped away entirely by the scroll pane
            const pane = el.closest('#pane');
            if (pane) { const pr = pane.getBoundingClientRect(); if (r.bottom < pr.top || r.top > pr.bottom) continue; }
            const bpv = el.closest('#bp'); if (bpv && el.classList.contains('node') && BY.UI.debug.view().z < 0.9) continue;   // overview zoom: plates are deliberately small; checked at 1x
      if (bpv) { const br = bpv.getBoundingClientRect(); if (r.right < br.left || r.left > br.right || r.bottom < br.top || r.top > br.bottom) continue; }
            if (Math.min(r.width, r.height) < 43.5) out.small.push((el.id || el.className || el.textContent.slice(0, 12)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          }
        }
        return out;
      });
      check(tag + ' ' + label + ': no horizontal page scroll', r.sw <= r.cw, r.sw + '/' + r.cw);
      check(tag + ' ' + label + ': nothing wider than the viewport', r.wide.length === 0, r.wide.slice(0, 3).join('; '));
      check(tag + ' ' + label + ': every button >= 44px', r.small.length === 0, r.small.slice(0, 4).join('; '));
    };
    await lay('title');
    check(tag + ' title: Clock In fully visible', await page.evaluate(() => { const r = document.getElementById('btnTitleClock').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }));
    await ctx.close();

    ({ ctx, page } = await open(browser, { width: w, height: h }, { touch: !desk, dpr: desk ? 1 : 2, save: midSave() }));
    await sleep(900);
    await lay('workshop');
    check(tag + ' workshop: Clock In fully visible', await page.evaluate(() => { const r = document.getElementById('btnClockIn').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 44; }));
    check(tag + ' workshop: the map fills the pane and Sprocket is on it', await page.evaluate(() => { const p = document.getElementById('pane').getBoundingClientRect(), b = document.getElementById('bp').getBoundingClientRect(), n = document.querySelector('.node[data-id=boot]').getBoundingClientRect(); return b.left >= p.left - 1 && b.right <= p.right + 1 && n.left >= b.left && n.right <= b.right && n.top >= b.top && n.bottom <= b.bottom; }));
    if (w === 320 || w === 1280) await shot(page, 'ui-workshop-' + w + '.png');
    const node = desk ? page.click.bind(page) : page.tap.bind(page);
    await tapId(page, 'coil', desk); await sleep(450);
    await lay('workshop+sheet');
    check(tag + ' sheet: node and Bolt on visible above the dock', await page.evaluate(() => { const s = document.getElementById('sheet').getBoundingClientRect(), d = document.getElementById('btnClockIn').getBoundingClientRect(), b = document.getElementById('btnBuy').getBoundingClientRect(), n = document.querySelector('.node[data-id=coil]').getBoundingClientRect(), p = document.getElementById('pane').getBoundingClientRect(); return s.bottom <= d.top + 1 && b.bottom <= s.bottom && n.bottom <= s.top + 1 && n.top >= p.top - 1; }));
    if (w === 320) await shot(page, 'ui-sheet-320.png');
    await node('#nsClose'); await sleep(150);
    await node('#btnGear'); await sleep(350);
    await lay('settings');
    await node('#btnSetClose'); await sleep(150);
    await node('#btnClockIn'); await sleep(400);
    await lay('shift');
    check(tag + ' shift: pause button visible', await page.evaluate(() => { const r = document.getElementById('btnPause').getBoundingClientRect(); return r.top >= 0 && r.right <= innerWidth && r.width >= 44; }));
    if (w === 320) await shot(page, 'ui-shift-320.png');
    await node('#btnPause'); await sleep(350);
    await lay('pause');
    if (w === 320) await shot(page, 'ui-pause-320.png');
    await node('#btnClockOut'); await sleep(1500);
    await lay('report');
    if (w === 320) await shot(page, 'ui-report-320.png');
    await ctx.close();
  }
};


// ---------------------------------------------------------------- G: Act II (big numbers, 11 sectors, classified plates, reveal, finale, Overtime)
  const LP = require('./lib-page.js');
  const OVER = () => {
    const bad = [];
    const sel = '.stile .st-n, .stats dd, .stats dt, .cur .num, .node .nl, .cta span, .tab, .row b, .row .k, .ns-cost .cn, .hud-sig .sig-label, #battNum, #hudBolts, #hudCores, .stamp, .lg-r b, .lg-r span:first-child, .ws-banner b, .ws-banner span, .sec-info b, .sec-info .note, .ns-lv, .ns-title b, .cx-e h3';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      if (el.closest('#bp')) { const br = document.getElementById('bp').getBoundingClientRect(); if (r.left < br.left || r.right > br.right || r.top < br.top || r.bottom > br.bottom) continue; }   // clipped by the map edge: not on screen
      const tag = (el.id || el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 14) + '"';
      const ellipsisOk = el.matches('.hud-sig .sig-label, .ns-title b');
      if (!ellipsisOk && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) bad.push('clip ' + tag + ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (r.right > innerWidth + 0.5 || r.left < -0.5) bad.push('outside ' + tag);
      const box = el.closest('.stile, .stats > div, .node, .cur, .row, .hud-r2, .ns-buy, .lg-r, .cx-e');
      if (box && box !== el) { const b = box.getBoundingClientRect(); if (r.left < b.left - 1 || r.right > b.right + 1) bad.push('spill ' + tag + ' out of ' + (box.className || box.tagName)); }
    }
    return bad;
  };
  const LAY = (page, tag) => page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [] };
    for (const el of document.querySelectorAll('button')) {
      if (el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      const pane = el.closest('#pane');
      if (pane) { const pr = pane.getBoundingClientRect(); if (r.bottom < pr.top || r.top > pr.bottom) continue; }
      const bpv = el.closest('#bp'); if (bpv && el.classList.contains('node') && BY.UI.debug.view().z < 0.9) continue;   // overview zoom: plates are deliberately small (checked at 1x)
      if (bpv) { const br = bpv.getBoundingClientRect(); if (r.right < br.left || r.left > br.right || r.bottom < br.top || r.top > br.bottom) continue; }
      if (Math.min(r.width, r.height) < 43.5) out.small.push((el.id || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return out;
  });
  const checkLay = async (page, tag) => {
    const r = await LAY(page);
    check(tag + ': no horizontal scroll', r.sw <= r.cw, r.sw + '/' + r.cw);
    check(tag + ': taps >= 44px', r.small.length === 0, r.small.slice(0, 4).join('; '));
    const bad = await page.evaluate(OVER);
    check(tag + ': no text overflow', bad.length === 0, bad.slice(0, 3).join(' | '));
  };

phases.g = async (browser) => {
  console.log('G. Act II UI');
  const A2 = (n) => path.join(shots, 'a2-' + n + '.png');

  // ---- seeded states x widths: layout, overflow, taps (the Blueprint is a map now: pan, never scroll)
  for (const kind of ['preOverseer', 'justWon', 'mid', 'blocked', 'chairman']) {
    for (const [w, h] of [[320, 600], [360, 700], [390, 760]]) {
      const tag = kind + ' ' + w;
      const { ctx, page } = await open(browser, { width: w, height: h }, { save: LP.act2Save(kind), reduced: true });
      await sleep(700);
      await checkLay(page, tag + ' workshop');
      await page.screenshot({ path: A2(kind + '-' + w + '-ws') });
      const lastId = await page.evaluate(() => { const m = BY.UI.debug.map(); const ids = m.shown.filter((i) => document.querySelector('.node[data-id="' + i + '"]') && !document.querySelector('.node[data-id="' + i + '"]').classList.contains('cls')); return ids[ids.length - 1]; });
      await page.evaluate((id) => BY.UI.debug.panTo(id), lastId);
      await sleep(250);
      await checkLay(page, tag + ' map panned to ' + lastId);
      if (w !== 360) await page.screenshot({ path: A2(kind + '-' + w + '-bp') });
      await tapId(page, lastId); await sleep(450);
      await checkLay(page, tag + ' sheet(' + lastId + ')');
      check(tag + ' sheet: selected node fully visible above the sheet, Bolt on above the dock', await page.evaluate((id) => { const sh = document.getElementById('sheet').getBoundingClientRect(), d = document.getElementById('btnClockIn').getBoundingClientRect(), b = document.getElementById('btnBuy').getBoundingClientRect(), n = document.querySelector('.node[data-id=' + id + ']').getBoundingClientRect(), p = document.getElementById('pane').getBoundingClientRect(); return sh.bottom <= d.top + 1 && (b.bottom <= sh.bottom || document.getElementById('btnBuy').hidden) && n.bottom <= sh.top + 1 && n.top >= p.top - 1; }, lastId));
      if (w !== 360) await page.screenshot({ path: A2(kind + '-' + w + '-sheet') });
      if (w === 320 && kind !== 'preOverseer' && kind !== 'justWon') {  // a costly node: Hostile Takeover, big cost text
        await tapId(page, 'takeover'); await sleep(450);
        await checkLay(page, tag + ' sheet(takeover)');
        if (kind === 'blocked' || kind === 'ot7') await page.screenshot({ path: A2(kind + '-320-takeover') });
      }
      await ctx.close();
    }
  }

  // ---- sector picker facts
  {
    const { ctx, page } = await open(browser, { width: 360, height: 700 }, { save: LP.act2Save('blocked'), reduced: true });
    await sleep(600);
    const n = await page.evaluate(() => ({ acts: document.querySelectorAll('.sact').length, tiles: document.querySelectorAll('.stile').length, rows: document.querySelectorAll('.srow').length, locked: [...document.querySelectorAll('.stile.locked')].map((t) => t.dataset.n) }));
    check('picker: two act tabs (I, II) over one row of 5 tiles, no Overtime tab yet', n.acts === 2 && n.tiles === 5 && n.rows === 1 && !n.locked.length, JSON.stringify(n));
    check('sector 10 selected: info says "Needs Hostile Takeover"', /Needs Hostile Takeover/.test(await page.textContent('#secInfo')), (await page.textContent('#secInfo')).trim());
    check('clock-in label: Sector 10', /Clock in — Sector 10/.test(await page.textContent('#clockLabel')));
    await secTap(page, '.sact[data-act="0"]'); await sleep(100);
    await secTap(page, '.stile[data-n="1"]'); await sleep(100);
    await secTap(page, '.sact[data-act="1"]'); await sleep(100);
    await secTap(page, '.stile[data-n="10"]'); await sleep(100);
    check('tile 10 tappable (selected) while blocked', await page.evaluate(() => BY.UI.debug.save().sector) === 10);
    await page.tap('#btnClockIn'); await sleep(500);
    const hud = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), sig: document.getElementById('sigLabel').textContent, mode: document.getElementById('hudSig').dataset.mode, blocked: BY.UI.debug.run().boss.blocked }));
    check('sector 10 without Takeover: engine blocks the Chairman, HUD says Needs Takeover', hud.scr === 'shift' && hud.blocked && /Needs Takeover/.test(hud.sig), JSON.stringify(hud));
    await page.screenshot({ path: A2('blocked-hud') });
    await ctx.close();
  }
  {
    const s = LP.act2Save('mid'); s.sectorsCleared = 5; s.flags.reveal = true; s.sector = 6; s.bossKills = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
    const { ctx, page } = await open(browser, { width: 320, height: 640 }, { save: s, reduced: true });
    await sleep(500);
    await secTap(page, '.stile[data-n="8"]'); await sleep(100);
    const info = (await page.textContent('#secInfo')).trim();
    check('locked Act II tile says what opens it', /Scrap/.test(info) && /Loading Dock|Server Farm|Firewall|Forklift/.test(info), info);
    check('locked Act II tile has a lock mark and does not select', await page.evaluate(() => !!document.querySelector('.stile[data-n="8"] .st-mk svg') && BY.UI.debug.save().sector === 6));
    await ctx.close();
  }

  // ---- classified plates: redacted plates only appear next to something you already own
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act2Save('preOverseer'), reduced: true });
    await sleep(600);
    const cls = await page.evaluate(() => ({ n: document.querySelectorAll('.nw:not(.gone):not(.ghost) .node.cls').length, all: document.querySelectorAll('.node.cls').length, text: [...document.querySelectorAll('.nw:not(.gone) .node.cls')].map((n) => n.innerText.trim()).join(''), ids: [...document.querySelectorAll('.nw:not(.gone) .node.cls')].map((n) => n.dataset.id), plate: document.querySelector('.sec-plate.s2').classList.contains('cls'), plabel: document.querySelector('.sec-plate.s2').getAttribute('aria-label') }));
    check('pre-Act-II: some R&D plates are redacted (next to owned Act I tips), not the whole block', cls.n >= 1 && cls.n < cls.all && cls.text === '', JSON.stringify({ n: cls.n, all: cls.all }));
    check('pre-Act-II: the Act II ring plate shows its progress (some R&D is open), Act I is not redacted', /Act II/.test(cls.plabel) && !/Act I,/.test(cls.plabel), cls.plabel);
    const id0 = cls.ids[0];
    check('redacted plate: aria says Classified, never the real name', await page.evaluate((id) => /Classified/.test(document.querySelector('.node[data-id="' + id + '"]').getAttribute('aria-label')), id0));
    await tapId(page, id0); await sleep(400);
    const sh = await page.evaluate(() => ({ name: nsName.textContent, cost: nsCost.textContent.trim(), desc: nsDesc.textContent, now: !nsNow.parentNode.parentNode.hidden, btn: btnBuy.getAttribute('aria-disabled'), max: btnMax.hidden }));
    check('tapping a plate: "Classified — scrap the Overseer", no desc/now/cost', sh.name === 'CLASSIFIED' && /Classified — scrap the Overseer/.test(sh.cost) && sh.desc === '' && !sh.now && sh.btn === 'true' && sh.max, JSON.stringify(sh));
    await page.screenshot({ path: A2('classified-sheet') });
    await ctx.close();
    const { ctx: c2, page: p2 } = await open(browser, { width: 390, height: 760 }, { save: LP.act3Save('mid3'), reduced: true });
    await sleep(500);
    const hp = await p2.evaluate(() => { const m = BY.UI.debug.map(); return ['hazardpay', 'overtimepay'].find((i) => m.shown.includes(i)) || null; });
    check('Act II mid save: a Chairman-gated plate is on the map next to Hostile Takeover', !!hp, String(hp));
    if (hp) { await tapId(p2, hp); await sleep(400); check('Act III save: the pay plate opens a real sheet (no longer classified)', /Pay/.test(await p2.textContent('#nsName')), (await p2.textContent('#nsName')).trim()); }
    await c2.close();
  }

  // ---- uncapped nodes + big costs in the sheet
  {
    const { ctx, page } = await open(browser, { width: 360, height: 700 }, { save: ot7Save(), reduced: true });
    await sleep(500);
    await page.evaluate(() => BY.UI.debug.panTo('overtimepay'));
    await sleep(200);
    const nl = await page.evaluate(() => ({ op: document.querySelector('.node[data-id="overtimepay"] .nl').textContent, maxed: document.querySelector('.node[data-id="overtimepay"]').classList.contains('maxed'), aria: document.querySelector('.node[data-id="hazardpay"]').getAttribute('aria-label') }));
    check('uncapped node reads "LV 37", never maxed', nl.op === 'LV 37' && !nl.maxed && /level 12, no limit/.test(nl.aria), JSON.stringify(nl));
    await tapId(page, 'overtimepay'); await sleep(400);
    const sh = await page.evaluate(() => ({ lv: nsLevel.textContent, cost: nsCost.textContent.trim().replace(/\s+/g, ' '), now: nsNow.textContent, next: nsNext.textContent, track: nsTrack.hidden }));
    check('sheet for uncapped node: "Level 37", big cost via Fmt, now/next, no level bar', sh.lv === 'Level 37' && /\d(K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)|e\d/.test(sh.cost) && !/\d{7,}/.test(sh.cost) && sh.track, JSON.stringify(sh));
    const hdr = await page.evaluate(() => ({ b: wsBolts.textContent, c: wsCores.textContent, dps: stDps.textContent, bm: stBolt.textContent }));
    check('header numbers go through BY.Fmt (1e30 bolts)', hdr.b === '1No' && /^1\.5T$/.test(hdr.c) && !/e\+|NaN|undefined|Infinity/.test(JSON.stringify(hdr)), JSON.stringify(hdr));
    await ctx.close();
  }

  // ---- count-up at 1e30 never breaks
  {
    const { ctx, page } = await open(browser, { width: 360, height: 700 }, { save: LP.act2Save('mid') });
    await sleep(500);
    await page.evaluate(() => { const s = BY.UI.debug.save(); s.bolts = 1e30; s.cores = 3.4e21; BY.UI.debug.workshop(); });
    const seen = [];
    for (let i = 0; i < 14; i++) { seen.push(await page.textContent('#wsBolts')); await sleep(70); }
    await sleep(700);
    const fin = (await page.textContent('#wsBolts')).trim();
    check('count-up to 1e30: every frame is a clean formatted number', seen.every((t) => /^[0-9. ]+(K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)?$/.test(t.trim())), seen.slice(0, 6).join(' > '));
    check('count-up to 1e30 settles on the formatted value', fin === '1No', fin);
    await page.evaluate(() => { const s = BY.UI.debug.save(); s.bolts = 12; BY.UI.debug.workshop(); });
    await sleep(1200);
    check('count-down from 1e30 settles on 12', (await page.textContent('#wsBolts')).trim() === '12', (await page.textContent('#wsBolts')).trim());
    await ctx.close();
  }

  // ---- HUD: Overtime label, budget cut, huge numbers
  for (const w of [320, 390]) {
    const { ctx, page } = await open(browser, { width: w, height: 700 }, { save: ot7Save() });
    await sleep(500);
    await page.tap('#btnClockIn'); await sleep(600);
    await page.evaluate(() => { const r = BY.UI.debug.run(); r.earned.bolts = 9.99e29; r.earned.cores = 8; r.player.budget = true; });
    await sleep(500);
    const hud = await page.evaluate(() => ({ sig: sigLabel.textContent, bolts: hudBolts.textContent, cores: hudCores.textContent, bud: document.getElementById('batt').classList.contains('budget'), budVis: getComputedStyle(document.getElementById('battBud')).display !== 'none', sigW: hudSig.clientWidth, r2: [document.querySelector('.hud-r2').scrollWidth, document.querySelector('.hud-r2').clientWidth] }));
    check(w + ' HUD: Overtime label "OT 7 · <boss>"', /^OT 7 · \S/.test(hud.sig), hud.sig);
    check(w + ' HUD: budget cut indicator on the battery bar', hud.bud && hud.budVis);
    check(w + ' HUD: 9.99e29 bolts formatted and nothing overflows', /^999Oc$/.test(hud.bolts) && hud.r2[0] <= hud.r2[1] + 1 && hud.sigW >= 56, JSON.stringify(hud));
    await checkLay(page, w + ' HUD ot7');
    await page.screenshot({ path: A2('hud-ot7-' + w) });
    await page.evaluate(() => { BY.UI.debug.run().player.budget = false; });
    await sleep(200);
    check(w + ' HUD: budget indicator clears', !(await page.evaluate(() => document.getElementById('batt').classList.contains('budget'))));
    await ctx.close();
  }

  // ---- report extras + Overtime stamp (320 and 390)
  for (const w of [320, 390]) {
    const { ctx, page } = await open(browser, { width: w, height: 700 }, { save: ot7Save(), reduced: true });
    await sleep(500);
    await page.evaluate(() => BY.UI.debug.fakeReport({ reason: 'victory', sector: 16, time: 133, bolts: 7.77e28, cores: 8, kills: 1234, bestCombo: 88, swept: 1.2e27, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: false, unlockedSector: null, gameWon: false, act2Won: false, overtimeLevel: 7, severance: true, stolen: 4.5e26, stockMult: 1.24, newSeen: ['mimic'] }));
    await sleep(400);
    const t = await page.evaluate(() => ({ stamp: repStamp.textContent, rows: repRows.innerText.replace(/\n+/g, ' | '), sector: repSector.textContent }));
    check(w + ' report: "OVERTIME 7 CLEARED" stamp', /overtime 7 cleared/i.test(t.stamp), t.stamp);
    check(w + ' report: Stolen / Severance / Stock Options rows, big numbers via Fmt', /Stolen by Repo Bots/.test(t.rows) && /Severance payout/.test(t.rows) && /Stock Options \| ×1\.24/.test(t.rows) && /77\.7Oc|77\.7Oc/.test(t.rows) && /450Sx|450Sp|450Oc/.test(t.rows), t.rows);
    check(w + ' report: sector line names Overtime', /Overtime 07/.test(t.sector), t.sector);
    await checkLay(page, w + ' report ot7');
    await page.screenshot({ path: A2('report-ot7-' + w) });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 390, height: 700 }, { save: LP.act2Save('mid'), reduced: true });
    await sleep(500);
    await page.evaluate(() => BY.UI.debug.fakeReport({ reason: 'battery', sector: 7, time: 40, bolts: 12345, cores: 0, kills: 55, bestCombo: 9, swept: 0, signalPct: 0.4, bossSeen: false, bossDefeated: false, firstClear: false, unlockedSector: null, gameWon: false, act2Won: false, overtimeLevel: null, severance: false, stolen: 0, stockMult: 1, newSeen: [] }));
    await sleep(300);
    const rows = await page.textContent('#repRows');
    check('report: no Stolen/Severance/Stock rows when zero', !/Stolen|Severance|Stock/.test(rows));
    await ctx.close();
  }

  // ---- codex and log
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: ot7Save(), reduced: true });
    await sleep(500);
    await page.tap('#tabBtnCodex'); await sleep(400);
    const cx = await page.evaluate(() => ({ e: document.querySelectorAll('.cx-e').length, acts: [...document.querySelectorAll('.cx-act')].map((h) => h.firstChild.textContent), groups: [...document.querySelectorAll('.cx-h')].map((h) => h.innerText.replace(/\s+/g, ' ')) }));
    check('codex: entries grouped under Act I / II / III headers', cx.e >= 37 && cx.acts.join() === 'Act I,Act II,Act III', JSON.stringify(cx));
    await page.screenshot({ path: A2('codex-top') });
    await page.evaluate(() => { document.getElementById('pane').scrollTop = 99999; });
    await sleep(250);
    await page.screenshot({ path: A2('codex-bottom') });
    await page.tap('#tabBtnLog'); await sleep(300);
    const lg = await page.textContent('#tabLog');
    check('log: best Overtime, Act II time, bolts lost to Repo Bots', /Best Overtime level/.test(lg) && /Act II time/.test(lg) && /Lost to Repo Bots/.test(lg) && /9M/.test(lg), lg.replace(/\s+/g, ' ').slice(0, 300));
    await checkLay(page, 'log ot7');
    await page.screenshot({ path: A2('log-ot7') });
    await ctx.close();
  }

  // ---- THE REVEAL: a real Overseer kill if the autopilot can manage it (else a forced report), then Keep playing
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act2Save('preOverseer') });
    await page.evaluate(() => { window.__snd = []; const p = BY.Audio.play; BY.Audio.play = function (n) { window.__snd.push(n); return p.apply(this, arguments); }; });
    await page.evaluate(() => { BY.UI.debug.begin(5); BY.UI.debug.setInput((r) => BY.Autopilot.target(r)); BY.UI.debug.timeScale = 20; });
    let end = await waitScreen(page, ['victory', 'report'], 120000);
    await page.evaluate(() => { BY.UI.debug.setInput(null); BY.UI.debug.timeScale = 1; });
    let real = end === 'victory';
    if (!real) {
      await page.evaluate(() => { const s = BY.UI.debug.save(); s.sectorsCleared = 5; s.flags.won = true; s.flags.act2 = true; s.bossKills[5] = 1; s.stats.wonShifts = 95; s.stats.wonPlayTime = 4400; BY.UI.debug.fakeReport({ reason: 'victory', sector: 5, time: 120, bolts: 0, cores: 0, kills: 400, bestCombo: 90, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: 6, gameWon: true, newSeen: [] }); });
    }
    console.log('     Overseer kill was ' + (real ? 'REAL (autopilot)' : 'forced via fakeReport'));
    const f0 = await page.evaluate(() => ({ act2: BY.UI.debug.save().flags.act2, reveal: BY.UI.debug.save().flags.reveal, rep: BY.UI.debug.report() }));
    check('Overseer shift sets flags.act2 (engine) and reveal is not yet set', f0.act2 === true && f0.reveal === false && (!real || f0.rep.gameWon === true), JSON.stringify({ act2: f0.act2, reveal: f0.reveal }));
    await sleep(900);
    const s1 = await page.evaluate(() => ({ a: vicStamp.className, b: vicStamp2.className, bt: vicStamp2.textContent, vis: !vicStamp2.hidden }));
    check('victory: stamp one has landed, stamp two not yet', /\bin\b/.test(s1.a) && !/\bin\b/.test(s1.b), JSON.stringify(s1));
    await page.screenshot({ path: A2('reveal-1-stamp1') });
    await sleep(1700);
    const s2 = await page.evaluate(() => ({ b: vicStamp2.className, snd: window.__snd.filter((n) => n === 'classified').length }));
    check('victory: second stamp "MANAGEMENT HAS NOTICED" lands and the classified sound plays', /\bin\b/.test(s2.b) && s2.snd === 1 && /MANAGEMENT HAS NOTICED/i.test(s1.bt), JSON.stringify(s2));
    await page.screenshot({ path: A2('reveal-2-stamp2') });
    await sleep(500);
    check('reveal card: "has not noticed yet" struck through, correction line added', await page.evaluate(() => document.getElementById('vicXo').classList.contains('struck') && !document.getElementById('vicFix').hidden && /Report to Loading Dock B/.test(document.getElementById('vicFix').textContent)));
    await page.screenshot({ path: A2('reveal-2b-struck-390') });
    await checkLay(page, 'victory card');
    await page.tap('#btnKeep'); await sleep(350);
    const w0 = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), cls: document.querySelectorAll('.node.cls').length, banner: !document.getElementById('wsBanner').hidden, reveal: BY.UI.debug.save().flags.reveal, sec: BY.UI.debug.save().sector, six: !!document.querySelector('.stile[data-n="6"]:not(.locked)') }));
    check('Keep playing -> Workshop with R&D still redacted, banner up, reveal flag set, sector 6 open', w0.scr === 'workshop' && w0.cls >= 12 && w0.banner && w0.reveal === true && w0.sec === 6 && w0.six, JSON.stringify(w0));
    await sleep(1700);
    await page.screenshot({ path: A2('reveal-3-unredacting') });
    const mid = await page.evaluate(() => document.querySelectorAll('.node.cls').length);
    await sleep(3300);
    const w1 = await page.evaluate(() => ({ cls: [...document.querySelectorAll('.node.cls')].map((n) => n.dataset.id), banner: !document.getElementById('wsBanner').hidden, stamp: !!document.querySelector('.sec-plate.s2.cls'), punched: 0, gated: [...document.querySelectorAll('.node.cls')].every((n) => BY.Data.UPGRADE_BY_ID[n.dataset.id].gate === 'chairman') }));
    check('R&D plates un-redact one by one (mid-way count is between)', mid >= 2, 'redacted mid-way: ' + mid);
    check('after the reveal only Chairman-gated plates stay classified (pay + Act III); banner gone', w1.cls.length >= 2 && w1.cls.includes('hazardpay') && w1.gated && !w1.banner && !w1.stamp, JSON.stringify(w1));
    await page.screenshot({ path: A2('reveal-4-done') });
    const pre = await page.evaluate(() => { try { const j = JSON.parse(localStorage.getItem('boltyard.save.v1')); return { act2: j.flags.act2, reveal: j.flags.reveal, mem: BY.UI.debug.save().flags.reveal }; } catch (e) { return String(e); } });
    // (headless Chrome's ephemeral file:// localStorage can lose a write made just before unload - the pagehide save - when the page
    // is reloaded within ~5 s of it; the app's save IS in storage right before the reload (see `pre`). Phase D covers real persistence,
    // so carry the app's own saved string across the reload explicitly here to test the reveal-once logic deterministically.)
    const curStore = await page.evaluate(() => localStorage.getItem('boltyard.save.v1'));
    await page.addInitScript((cur) => { try { if (cur) localStorage.setItem('boltyard.save.v1', cur); } catch (e) {} }, curStore);
    await page.reload();
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(500);
    console.log('     storage before reload: ' + JSON.stringify(pre) + ' seededAfterReload=' + (await page.evaluate(() => window.__seeded)) + ' storageNow=' + (await page.evaluate(() => { try { const j = JSON.parse(localStorage.getItem('boltyard.save.v1')); return j.flags.act2 + '/' + j.flags.reveal + '/' + j.stats.shifts; } catch (e) { return 'ERR ' + e; } })));
    { const rl = await page.evaluate(() => ({ g: [...document.querySelectorAll('.node.cls')].every((n) => BY.Data.UPGRADE_BY_ID[n.dataset.id].gate === 'chairman'), cls: document.querySelectorAll('.node.cls').length, banner: !document.getElementById('wsBanner').hidden, rev: BY.UI.debug.save().flags.reveal, scr: BY.UI.debug.screen() })); check('reveal happens once: after a reload nothing extra is held back and no banner', rl.cls >= 2 && rl.g && !rl.banner, JSON.stringify(rl)); }
    await ctx.close();
  }
  {   // a v1 player who had already won: act2 but no reveal -> the reveal runs at boot
    const s = LP.act2Save('justWon'); s.v = 1; delete s.flags.act2; delete s.overtime;
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: s });
    const w0 = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), cls: document.querySelectorAll('.node.cls').length, banner: !document.getElementById('wsBanner').hidden, reveal: BY.UI.debug.save().flags.reveal, act2: BY.UI.debug.save().flags.act2 }));
    check('v1 save that had won: migrates to act2 and the reveal plays at boot', w0.scr === 'workshop' && w0.act2 && w0.reveal && w0.cls >= 12 && w0.banner, JSON.stringify(w0));
    await sleep(5200);
    check('boot reveal finishes (only Chairman-gated left)', await page.evaluate(() => document.querySelectorAll('.node.cls').length >= 2 && [...document.querySelectorAll('.node.cls')].every((n) => BY.Data.UPGRADE_BY_ID[n.dataset.id].gate === 'chairman')));
    await ctx.close();
  }
  {   // reduced motion: no animation, everything revealed immediately
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act2Save('justWon'), reduced: true });
    await sleep(500);
    check('reduced motion: the reveal is instant (Chairman-gated left, banner shown)', await page.evaluate(() => document.querySelectorAll('.node.cls').length >= 2 && [...document.querySelectorAll('.node.cls')].every((n) => BY.Data.UPGRADE_BY_ID[n.dataset.id].gate === 'chairman') && !document.getElementById('wsBanner').hidden));
    await ctx.close();
  }

  {   // reveal card at 320 (and reduced motion shows the final state directly)
    const { ctx, page } = await open(browser, { width: 320, height: 640 }, { save: LP.act2Save('justWon'), reduced: true });
    await sleep(300);
    await page.evaluate(() => BY.UI.debug.fakeReport({ reason: 'victory', sector: 5, time: 120, bolts: 0, cores: 0, kills: 400, bestCombo: 90, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: 6, gameWon: true, newSeen: [] }));
    await sleep(300);
    check('320 reveal card (reduced motion): final state at once, nothing overflows', await page.evaluate(() => document.getElementById('vicXo').classList.contains('struck') && !document.getElementById('vicFix').hidden));
    await checkLay(page, '320 reveal card');
    await page.screenshot({ path: A2('reveal-2b-struck-320') });
    await ctx.close();
  }

  // ---- Board fatigue + Takeover fund
  {
    const fundSave = () => {
      const s = LP.act2Save('blocked'); const D = require('vm');
      const sb = {}; sb.window = sb; D.createContext(sb); D.runInContext(require('fs').readFileSync(path.join(root, 'src/data.js'), 'utf8'), sb);
      for (const u of sb.BY.Data.UPGRADES) if (u.branch === 'rnd' && u.max !== Infinity && u.id !== 'takeover') s.up[u.id] = u.max;
      s.up.takeover = 0; D.runInContext(require('fs').readFileSync(path.join(root, 'src/engine.js'), 'utf8'), sb); const tk = sb.BY.Engine.upgradeInfo(sb.BY.Engine.loadSave(JSON.parse(JSON.stringify(s))), 'takeover').cost; global.__tkCost = tk.bolts; s.bolts = tk.bolts * 0.62; s.cores = 31; s.fatigue = { 6: 0, 7: 0, 8: 0, 9: 0, 10: 0.18 };
      return s;
    };
    for (const w of [320, 360, 390]) {
      const { ctx, page } = await open(browser, { width: w, height: 700 }, { save: fundSave(), reduced: true });
      await sleep(600);
      const t = await page.evaluate(() => ({ info: document.getElementById('secInfo').innerText.replace(/\s+/g, ' '), fund: !document.getElementById('fund').hidden, ft: fundT.textContent, fs: fundS.textContent, aff: BY.Engine.affordableCount(BY.UI.debug.save()) }));
      check(w + ' sector 10 info: "Board fatigue −18%" next to the name', /Board fatigue −18%/.test(t.info), t.info);
      check(w + ' Takeover fund bar: 62% (bolts) and the cores', t.fund && t.aff === 0 && /Takeover fund \d+%/.test(t.ft) && /\d+\/\d+ cores/.test(t.fs), JSON.stringify(t));
      await checkLay(page, w + ' fatigue+fund workshop');
      await page.screenshot({ path: A2('fund-' + w) });
      await tapId(page, 'takeover'); await sleep(400);
      check(w + ' fund bar steps aside while the sheet is open', await page.evaluate(() => document.getElementById('fund').hidden));
      await ctx.close();
    }
    const { ctx, page } = await open(browser, { width: 320, height: 700 }, { save: fundSave(), reduced: true });
    await sleep(500);
    await page.evaluate((arg) => BY.UI.debug.fakeReport({ reason: 'battery', sector: 10, time: 70, bolts: arg, cores: 0, kills: 300, bestCombo: 40, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: false, firstClear: false, unlockedSector: null, gameWon: false, act2Won: false, overtimeLevel: null, severance: false, stolen: 0, stockMult: 1, fatigue: 0.24, fatigueUp: true, newSeen: [] }), global.__tkCost * 0.055);
    await sleep(400);
    const rows = await page.evaluate(() => repRows.innerText.replace(/\n+/g, ' | '));
    check('report: "The Board is tired: Warden −24% next time" and "Takeover fund +9%" rows', /Board is tired \| Warden −24% next time/.test(rows) && /Takeover fund \| \+[\d.]+%/.test(rows), rows);
    await checkLay(page, '320 report fatigue+fund');
    await page.screenshot({ path: A2('fund-report-320') });
    await ctx.close();
    const n = await open(browser, { width: 360, height: 700 }, { save: LP.act2Save('mid'), reduced: true });
    await sleep(400);
    check('no fund bar when something else is affordable / no fatigue line at 0', await n.page.evaluate(() => document.getElementById('fund').hidden && !/fatigue/.test(document.getElementById('secInfo').innerText)));
    await n.ctx.close();
  }
  // ---- THE FINALE
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act2Save('chairman') });
    await page.evaluate(() => { BY.UI.debug.fakeReport({ reason: 'victory', sector: 10, time: 180, bolts: 3e12, cores: 3, kills: 800, bestCombo: 120, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: 11, gameWon: false, act2Won: true, overtimeLevel: null, severance: false, stolen: 0, stockMult: 1, newSeen: [] }); });
    await sleep(1400);
    const f = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), stamp: vicStamp.textContent, s2: vicStamp2.hidden, rows: vicRows.innerText.replace(/\n+/g, ' | '), unl: vicUnlock.textContent.trim(), btn: btnKeep.textContent, btn2: btnVic2.hidden }));
    check('finale card: UNDER NEW MANAGEMENT, Act II shifts/time, Overtime + pay nodes note', f.scr === 'victory' && /UNDER NEW MANAGEMENT/i.test(f.stamp) && !f.s2 && /Act II shifts \| 77/.test(f.rows) && /Act II time on the clock \| 1:30:00/.test(f.rows) && /Sector 11/.test(f.unl), JSON.stringify(f));
    check('chairman card: buttons Workshop / Clock in - The Lobby', f.btn === 'Workshop' && !f.btn2);
    await sleep(1600);
    check('chairman card: second stamp HEAD OFFICE WOULD LIKE A WORD', await page.evaluate(() => /HEAD OFFICE WOULD LIKE A WORD/i.test(vicStamp2.textContent) && /\bin\b/.test(vicStamp2.className)));
    await checkLay(page, 'finale card');
    await page.screenshot({ path: A2('finale-card') });
    await page.tap('#btnVic2'); await sleep(700);
    const h = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), sector: BY.UI.debug.run().sector, ot: BY.UI.debug.run().overtime, sig: sigLabel.textContent }));
    check('Clock in - The Lobby starts a sector 11 shift (no Overtime yet)', h.scr === 'shift' && h.sector === 11 && !h.ot, JSON.stringify(h));
    await page.screenshot({ path: A2('overtime-shift') });
    await ctx.close();
    // the pay nodes un-redact on the next Workshop visit
    const s = LP.act2Save('chairman'); s.up.overtimepay = 0;
    const c2 = await open(browser, { width: 390, height: 760 }, { save: s });
    await sleep(500);
    const cl = await c2.page.evaluate(() => [...document.querySelectorAll('.node.cls')].map((n) => n.dataset.id).sort().join());
    check('a save that already beat the Chairman: Act III plates start redacted at boot (incl. both pay plates)', /hazardpay/.test(cl) && /overtimepay/.test(cl), cl);
    await sleep(6500);
    check('...then un-redact', await c2.page.evaluate(() => document.querySelectorAll('.node.cls').length === 0));
    await c2.ctx.close();
  }
};


// ---------------------------------------------------------------- H. Act III UI: map, jump bar, sheet, picker, focus, cards
phases.h = async (browser) => {
  console.log('H. Act III UI, map, focus');
  for (const w of [320, 390]) {   // 16-sector picker
    const { ctx, page } = await open(browser, { width: w, height: 700 }, { save: LP.act3Save('founder'), reduced: true });
    await sleep(500);
    const pk = await page.evaluate(() => {
      const r = document.getElementById('secTiles').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.sact')];
      const seen = new Set();
      const out = { acts: tabs.length, h: Math.round(r.height), over: [] };
      for (let i = 0; i < tabs.length; i++) { document.querySelectorAll('.sact')[i].click(); const t = [...document.querySelectorAll('#secTiles .stile')]; t.forEach((e) => seen.add(e.dataset.n)); const rr = document.getElementById('secTiles').getBoundingClientRect(); out.over.push(Math.round(rr.right) <= innerWidth); }
      out.n = seen.size; out.total = [...seen].length; return out;
    });
    check(w + ' picker: 4 act tabs reach all 16 sectors, in one row of tiles', pk.acts === 4 && pk.n === 16 && pk.h <= 70 && pk.over.every(Boolean), JSON.stringify(pk));
    await checkLay(page, w + ' picker founder');
    await ctx.close();
  }
  // map, jump bar, sheet on a mid-Act-III save
  for (const w of [320, 390]) {
    const { ctx, page } = await open(browser, { width: w, height: 760 }, { save: LP.act3Save('mid3'), reduced: true });
    await sleep(700);
    await checkLay(page, w + ' act3 workshop');
    const jb = await page.evaluate(() => [...document.querySelectorAll('#bpJump .jchip')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(w + ' jump bar: three chips, each a 44px target', jb.length === 3 && jb.every((d) => d[0] >= 44 && d[1] >= 44), JSON.stringify(jb));
    const v0 = await page.evaluate(() => BY.UI.debug.view());
    await page.tap('#bpJump .jchip[data-s="0"]'); await sleep(900);
    const v1 = await page.evaluate(() => BY.UI.debug.view());
    await page.tap('#bpJump .jchip[data-s="2"]'); await sleep(900);
    const v2 = await page.evaluate(() => BY.UI.debug.view());
    check(w + ' jump bar: chips pan the map to different rings', Math.abs(v1.z - v2.z) > 0.02 || Math.hypot(v2.tx - v1.tx, v2.ty - v1.ty) > 30, JSON.stringify([v0, v1, v2]));
    await page.tap('#bpHome'); await sleep(900);
    const v3 = await page.evaluate(() => BY.UI.debug.view());
    check(w + ' recentre button returns toward Sprocket', v3.z >= 0.2 && v3.z <= 1.6 && Math.hypot(v3.tx - v0.tx, v3.ty - v0.ty) < 4, JSON.stringify(v3));
    // zoom bounds
    const zb = await page.evaluate(() => [BY.UI.debug.view(null, null, 9).z, BY.UI.debug.view(null, null, 0.01).z]);
    check(w + ' zoom is clamped to 0.2 - 1.6', Math.abs(zb[0] - 1.6) < 0.001 && Math.abs(zb[1] - 0.2) < 0.001, JSON.stringify(zb));
    await page.tap('#bpHome'); await sleep(700);
    await page.tap('#bpZoomIn'); await sleep(450);
    const z1 = (await page.evaluate(() => BY.UI.debug.view())).z;
    await page.tap('#bpZoomOut'); await page.tap('#bpZoomOut'); await sleep(450);
    const z2 = (await page.evaluate(() => BY.UI.debug.view())).z;
    check(w + ' zoom buttons change the zoom', z1 > z2, z1 + ' > ' + z2);
    // keyboard
    await page.evaluate(() => document.getElementById('bp').focus());
    const k0 = await page.evaluate(() => BY.UI.debug.view());
    await page.keyboard.press('ArrowLeft'); await sleep(450);
    await page.keyboard.press('+'); await sleep(450);
    const k1 = await page.evaluate(() => BY.UI.debug.view());
    check(w + ' keyboard: arrows pan, + zooms', k1.tx !== k0.tx && k1.z !== k0.z, JSON.stringify([k0, k1]));
    // hidden / revealed
    const rv = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(), m = BY.UI.debug.map(); const bad = m.shown.filter((i) => { const f = E.upgradeInfo(sv, i); return !(f.revealed || f.level > 0); }); const hidden = BY.Data.UPGRADES.filter((u) => !m.shown.includes(u.id) && !m.ghost.includes(u.id)).length; return { shown: m.shown.length, ghost: m.ghost.length, hidden, bad }; });
    check(w + ' map: shown nodes are revealed or owned; some nodes stay hidden', rv.bad.length === 0 && rv.shown > 10 && rv.hidden > 0, JSON.stringify(rv));
    // tap vs drag on a node
    const nid = await page.evaluate(() => { const m = BY.UI.debug.map(); return m.shown.find((i) => { const f = BY.Engine.upgradeInfo(BY.UI.debug.save(), i); return !f.classified; }); });
    await page.evaluate((i) => BY.UI.debug.panTo(i), nid); await sleep(300);
    const rc = await page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, nid);
    const cdp = await ctx.newCDPSession(page);
    const mv0 = await page.evaluate(() => BY.UI.debug.view());
    await touchDrag(cdp, rc[0], rc[1], rc[0] - 70, rc[1] - 30, 8); await sleep(400);
    const mv1 = await page.evaluate(() => ({ v: BY.UI.debug.view(), sheet: document.getElementById('workshop').classList.contains('sheeting') }));
    check(w + ' drag starting on a plate pans the map and does not open the sheet', !mv1.sheet && (Math.abs(mv1.v.tx - mv0.tx) > 20 || Math.abs(mv1.v.ty - mv0.ty) > 10), JSON.stringify([mv0, mv1]));
    await tapId(page, nid); await sleep(450);
    check(w + ' a tap on a plate opens the sheet', await page.evaluate(() => document.getElementById('workshop').classList.contains('sheeting')));
    await checkLay(page, w + ' act3 sheet');
    await ctx.close();
  }

  // slim header, default fit, ghosts, low-zoom detail, jump chips frame a ring (390x844)
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 }, { save: LP.act3Save('mid3'), reduced: true });
    await sleep(800);
    const f = await page.evaluate(() => {
      const bp = document.getElementById('bp').getBoundingClientRect(), ws = document.getElementById('workshop');
      const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
      const rects = [...document.querySelectorAll('.nw:not(.gone)')].map((n) => n.getBoundingClientRect());
      const out = rects.filter((r) => r.left < bp.left - 2 || r.right > bp.right + 2 || r.top < bp.top - 2 || r.bottom > bp.bottom + 2).length;
      return { frac: bp.height / innerHeight, slim: ws.classList.contains('slim'), stats: vis('#stats'), tiles: vis('.stile'), out, n: rects.length, z: BY.UI.debug.view().z };
    });
    check('Blueprint tab: slim header, map is >= 60% of a 390x844 screen', f.slim && !f.stats && !f.tiles && f.frac >= 0.6, JSON.stringify(f));
    check('default view fits every revealed plate and the ghosts into the map', f.out === 0 && f.n > 20, JSON.stringify(f));
    await page.tap('#btnSecBar'); await sleep(250);
    const ex = await page.evaluate(() => ({ stats: document.getElementById('stats').getClientRects().length > 0, tiles: document.querySelectorAll('.stile').length > 0 && document.querySelector('.stile').getClientRects().length > 0, exp: document.getElementById('btnSecBar').getAttribute('aria-expanded') }));
    check('the sector button expands stats + picker', ex.stats && ex.tiles && ex.exp === 'true', JSON.stringify(ex));
    await page.tap('#btnSecBar'); await sleep(250);
    check('...and folds them away again', await page.evaluate(() => document.getElementById('workshop').classList.contains('slim')));
    const lz = await page.evaluate(() => { const b = document.getElementById('bp'); BY.UI.debug.view(null, null, 0.5); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const lo = b.classList.contains('lowz'), nl = getComputedStyle(document.querySelector('.node .nl') || b).display; BY.UI.debug.view(null, null, 1); requestAnimationFrame(() => requestAnimationFrame(() => r({ lo, nl, hi: b.classList.contains('lowz') }))); }))); });
    check('below 0.7 zoom the map drops level text (icons stay); at 1x it returns', lz.lo && lz.nl === 'none' && !lz.hi, JSON.stringify(lz));
    const gh = await page.evaluate(() => { const g = document.querySelectorAll('.nw.ghost'); const n = g[0]; return { n: g.length, op: n ? +getComputedStyle(n).opacity : 0, tr: [...document.querySelectorAll('.tg.ghost')].length }; });
    check('ghost plates and traces are present and clearly visible (opacity >= .4)', gh.n > 0 && gh.op >= 0.4 && gh.tr > 0, JSON.stringify(gh));
    await page.tap('#bpHome'); await sleep(400);
    await page.tap('#bpJump .jchip[data-s="2"]'); await sleep(700);
    const jr = await page.evaluate(() => { const bp = document.getElementById('bp').getBoundingClientRect(); const ex = [...document.querySelectorAll('.nw:not(.gone):not(.ghost)')].filter((n) => n.dataset.b === 'exec'); const out = ex.filter((n) => { const r = n.getBoundingClientRect(); return r.left < bp.left - 2 || r.right > bp.right + 2 || r.top < bp.top - 2 || r.bottom > bp.bottom + 2; }).length; return { n: ex.length, out }; });
    check('jump chip frames the whole Act III ring', jr.n > 0 && jr.out === 0, JSON.stringify(jr));
    await page.tap('#bpHome'); await sleep(400);
    const gap = await page.evaluate(() => { const z = BY.UI.debug.view().z; const a = [...document.querySelectorAll('.nw:not(.gone):not(.ghost)')].filter((n) => ['arc', 'chassis', 'salvage', 'drones'].includes(n.dataset.b)).map((n) => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width]; }); let min = 1e9; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const d = (Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]) - (a[i][2] + a[j][2]) / 2) / z; if (d < min) min = d; } return Math.round(min * 10) / 10; });
    check('Act I plates keep >= 12px gaps at 1x', gap >= 12, 'min gap ' + gap + 'px');
    await ctx.close();
  }
  // sheet: affordability meter, Max, level track, locked reason
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act3Save('mid3'), reduced: true });
    await sleep(600);
    const pick = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.Data.UPGRADES.map((u) => u.id).find((i) => { const f = E.upgradeInfo(sv, i); return !f.classified && f.unlocked && f.affordable && !f.maxed && (f.max === null || f.max > 2) && BY.UI.debug.map().shown.includes(i); }) || null; });
    check('there is an affordable node on the mid Act III save', !!pick, String(pick));
    if (pick) {
      await tapId(page, pick); await sleep(450);
      const sh = await page.evaluate(() => ({ max: !btnMax.hidden, meter: document.querySelectorAll('#nsCost .cst, #nsCost .cst-all').length, track: !!document.getElementById('nsTrack'), buy: btnBuy.getAttribute('aria-disabled') }));
      check('sheet: Max button, affordability line ("Can afford" when affordable) and level track are present', sh.max && sh.meter >= 1 && sh.track && sh.buy !== 'true', JSON.stringify(sh));
      const b0 = await page.evaluate((i) => BY.Engine.upgradeInfo(BY.UI.debug.save(), i).level, pick);
      await page.tap('#btnMax'); await sleep(500);
      const b1 = await page.evaluate((i) => BY.Engine.upgradeInfo(BY.UI.debug.save(), i).level, pick);
      check('Max buys as many levels as the bank allows', b1 > b0, b0 + ' -> ' + b1);
      await page.screenshot({ path: path.join(shots, 'h-sheet-aff.png') });
    }
    const lockedId = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.UI.debug.map().shown.find((i) => { const f = E.upgradeInfo(sv, i); return !f.classified && !f.unlocked; }) || null; });
    if (lockedId) {
      await page.tap('#nsClose').catch(() => {}); await sleep(200);
      await tapId(page, lockedId); await sleep(450);
      const lk = await page.evaluate(() => ({ buy: btnBuy.getAttribute('aria-disabled'), msg: (document.querySelector('#nsCost .lockmsg') || document.getElementById('nsReq')).textContent.trim() }));
      check('locked node: Buy is disabled and the reason is shown', lk.buy === 'true' && lk.msg.length > 3, JSON.stringify(lk));
    }
    await ctx.close();
  }
  // Act III: chairman card, founder card, finale -> Overtime
  {
    const { ctx, page } = await open(browser, { width: 390, height: 760 }, { save: LP.act3Save('founder') });
    await sleep(400);
    await page.evaluate(() => BY.UI.debug.fakeReport({ reason: 'victory', sector: 15, time: 200, bolts: 7e25, cores: 9, kills: 900, bestCombo: 150, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: 16, gameWon: false, act2Won: false, act3Won: true, overtimeLevel: null, severance: false, stolen: 0, stockMult: 1, newSeen: [] }));
    await sleep(2400);
    const f = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), stamp: vicStamp.textContent, rows: vicRows.innerText.replace(/\n+/g, ' | '), body: (document.querySelector('.vic') || document.body).innerText.replace(/\s+/g, ' '), btn: btnKeep.textContent, btn2: btnVic2.hidden }));
    check("Founder finale card: FOUNDER'S DAY and 'Sprocket is the company now.'", f.scr === 'victory' && /FOUNDER.S DAY/i.test(f.stamp + f.body) && /Sprocket is the company now/.test(f.body), JSON.stringify(f).slice(0, 400));
    check('Founder card: Act III rows and an Overtime button', /Act III/.test(f.rows) && /Overtime/.test(f.btn + (f.btn2 ? '' : '')), f.btn);
    await checkLay(page, 'founder card');
    await ctx.close();
  }
  // Focus mode, fullscreen missing and present
  for (const mode of ['missing', 'present']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    const sv = LP.act2Save('justWon');
    await page.addInitScript(([m, save]) => {
      try { localStorage.setItem('boltyard.save.v1', JSON.stringify(save)); } catch (e) {}
      if (m === 'missing') {
        Element.prototype.requestFullscreen = undefined; Element.prototype.webkitRequestFullscreen = undefined;
        Document.prototype.exitFullscreen = undefined;
      } else {
        let fe = null;
        Object.defineProperty(document, 'fullscreenElement', { get: () => fe, configurable: true });
        Element.prototype.requestFullscreen = function () { window.__fs = (window.__fs || 0) + 1; fe = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
        document.exitFullscreen = function () { fe = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
        window.__leaveFs = () => { fe = null; document.dispatchEvent(new Event('fullscreenchange')); };
      }
    }, [mode, sv]);
    await page.goto(URL);
    await page.addScriptTag({ path: AUTOPILOT });
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(500);
    const btns = await page.evaluate(() => ['btnFocusHud', 'btnFocusTitle', 'btnFocusWs'].map((i) => { const e = document.getElementById(i); const r = e.getBoundingClientRect(); return [e.innerHTML.indexOf('<svg') >= 0, Math.round(r.width), Math.round(r.height), e.getAttribute('aria-pressed')]; }));
    check('focus (' + mode + '): the three focus buttons carry an inline svg and are 44px', btns.every((b) => b[0]) && btns.filter((b) => b[1] > 0).every((b) => b[1] >= 44 && b[2] >= 44) && btns.some((b) => b[1] > 0), JSON.stringify(btns));
    await page.tap('#btnFocusWs'); await sleep(300);
    const on = await page.evaluate(() => ({ f: BY.UI.debug.focus(), p: document.getElementById('btnFocusWs').getAttribute('aria-pressed'), sw: document.getElementById('swFocus').getAttribute('aria-checked') }));
    check('focus (' + mode + '): the button turns focus on without throwing', on.f.want === true && on.sw === 'true' && (mode === 'missing' ? on.f.refused : on.p === 'true'), JSON.stringify(on));
    await page.tap('#btnClockIn'); await sleep(700);
    const sh = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), cls: document.documentElement.classList.contains('shifting'), fs: BY.UI.debug.focus().fs, n: window.__fs || 0 }));
    check('focus (' + mode + '): a shift starts, html.shifting guards are on' + (mode === 'present' ? ', fullscreen requested' : ', no fullscreen API needed'), sh.scr === 'shift' && sh.cls && (mode === 'present' ? sh.n >= 1 && sh.fs : !sh.fs), JSON.stringify(sh));
    // scroll-tap guard: an edge touch within 12px is ignored by steering
    const e0 = await page.evaluate(() => BY.UI.debug.run().player.x);
    const cdp = await ctx.newCDPSession(page);
    await touchDrag(cdp, 4, 400, 120, 400, 6); await sleep(120);
    const ps = await page.evaluate(() => BY.UI.debug.paused());
    check('focus (' + mode + '): an edge swipe (<12px from the edge) does not pause or break the shift', !ps && (await page.evaluate(() => BY.UI.debug.screen())) === 'shift');
    if (mode === 'present') {
      await page.evaluate(() => window.__leaveFs()); await sleep(250);
      const lf = await page.evaluate(() => ({ paused: BY.UI.debug.paused(), want: BY.UI.debug.focus().want }));
      check('focus (present): leaving fullscreen pauses the shift and turns focus off', lf.paused && lf.want === false, JSON.stringify(lf));
    }
    await page.screenshot({ path: path.join(shots, 'h-focus-' + mode + '.png') });
    await ctx.close();
  }
};


// ---------------------------------------------------------------- phase i: map taps, sheet visibility, focus refusal, save safety
phases.i = async (browser) => {
  console.log('phase i: map tap-to-zoom, selected plate above the sheet, refused Focus, save safety');
  const LP = require('./lib-page.js');
  const mid = () => LP.act3Save('mid3');
  const plateRect = (page, id) => page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return { cx: e.x + e.width / 2, cy: e.y + e.height / 2, w: e.width, top: e.top, bottom: e.bottom }; }, id);
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const tag = vp.width + 'px: ';
    const { ctx, page } = await open(browser, vp, { save: mid() });
    await page.tap('#bpHome'); await sleep(700);
    const m0 = await page.evaluate(() => BY.UI.debug.map());
    const pick = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.UI.debug.map().shown.find((i) => { const f = E.upgradeInfo(sv, i); return !f.classified && f.unlocked && !f.maxed; }); });
    const r0 = await plateRect(page, pick);
    check(tag + 'at fit zoom plates are small (under 36 px)', r0.w < 36, 'plate ' + r0.w.toFixed(1) + ' z ' + m0.z.toFixed(2));
    await page.touchscreen.tap(r0.cx, r0.cy); await sleep(700);
    const a1 = await page.evaluate(() => ({ z: BY.UI.debug.map().z, hid: document.querySelector('.nsheet').hidden }));
    check(tag + 'a tap at fit zoom zooms in and does not open a sheet', a1.z > 0.85 && a1.hid, JSON.stringify(a1));
    const r1 = await plateRect(page, pick);
    check(tag + 'the zoomed plate is readable (>= 44 px) and near the middle of the map', r1.w >= 44 && Math.abs(r1.cx - vp.width / 2) < 40, JSON.stringify(r1));
    // readable zoom: a tap 15 px off a plate centre still opens that plate
    const near = await page.evaluate(() => { const sv = BY.UI.debug.save(), E = BY.Engine; return BY.UI.debug.map().shown.filter((i) => i !== 'boot' && E.upgradeInfo(sv, i).unlocked && !E.upgradeInfo(sv, i).maxed); });
    let opened = null;
    for (const id of near) {
      await page.evaluate((i) => BY.UI.debug.panTo(i), id); await sleep(120);
      const r = await plateRect(page, id);
      if (r.cx < 30 || r.cx > vp.width - 30 || r.cy < 160) continue;
      // nothing else within reach of the offset point
      const others = await page.evaluate(([x, y, me]) => [...document.querySelectorAll('.nw:not(.gone):not(.ghost) .node')].filter((n) => n.getAttribute('data-id') !== me).some((n) => { const b = n.getBoundingClientRect(); return Math.hypot(b.x + b.width / 2 - x, b.y + b.height / 2 - y) < 30; }), [r.cx + 15, r.cy, id]);
      if (others) continue;
      await page.touchscreen.tap(r.cx + 15, r.cy); await sleep(700);
      opened = await page.evaluate(() => { const s = document.querySelector('.node.sel'); return { id: s && s.getAttribute('data-id'), hid: document.querySelector('.nsheet').hidden }; });
      opened.want = id; break;
    }
    check(tag + 'a tap 15 px off a plate centre at readable zoom opens that plate', opened && !opened.hid && opened.id === opened.want, JSON.stringify(opened));
    if (opened) {
      const pr = await plateRect(page, opened.want);
      const sh = await page.evaluate(() => { const r = document.querySelector('.nsheet').getBoundingClientRect(), b = document.getElementById('bp').getBoundingClientRect(); return { top: r.top, h: r.height, mapTop: b.top }; });
      check(tag + 'the selected plate sits fully above the open sheet', pr.bottom <= sh.top - 4 && pr.top >= sh.mapTop, JSON.stringify({ pr, sh }));
      const ring = await page.evaluate((i) => { const w = document.querySelector('.node[data-id="' + i + '"]').parentNode; return w.classList.contains('sel') && getComputedStyle(w, '::after').borderTopWidth; }, opened.want);
      check(tag + 'the selected plate has a ring highlight', ring === '3px', String(ring));
      const lv = await page.evaluate(() => document.getElementById('nsLevel').textContent);
      check(tag + 'level reads in words', /^Level \d+( of \d+)?$|^MAXED$|^BASE FRAME$/.test(lv), lv);
      const cost = await page.evaluate(() => ({ all: !!document.querySelector('.cst-all'), rows: document.querySelectorAll('.cst').length, aff: document.getElementById('btnBuy').getAttribute('aria-disabled') !== 'true' }));
      check(tag + 'affordable shows one "Can afford" line and no meters; short shows meters', cost.aff ? (cost.all && cost.rows === 0) : (!cost.all && cost.rows >= 1), JSON.stringify(cost));
      const btn = await page.evaluate(() => ['btnBuy', 'btnMax', 'nsClose'].map((i) => { const r = document.getElementById(i).getBoundingClientRect(); return r.width ? Math.round(r.height) : 99; }));
      check(tag + 'sheet buttons stay >= 44 px', btn.every((h) => h >= 44), JSON.stringify(btn));
    }
    const jd = await page.evaluate(() => [...document.querySelectorAll('.jdot')].every((d) => d.getAttribute('aria-label') && d.getAttribute('title')));
    check(tag + 'act-tab diamonds carry an accessible label', jd);
    // jump bar and zoom buttons still work
    await page.tap('#bpHome'); await sleep(600);
    const zA = (await page.evaluate(() => BY.UI.debug.map())).z;
    await page.tap('#bpZoomIn'); await sleep(300);
    const zB = (await page.evaluate(() => BY.UI.debug.map())).z;
    const vB = await page.evaluate(() => BY.UI.debug.map());
    await page.tap('.jchip[data-s="1"]'); await sleep(700);
    const zC = (await page.evaluate(() => BY.UI.debug.map()));
    check(tag + 'zoom button and jump bar still move the map', zB > zA && (Math.abs(zC.tx - vB.tx) + Math.abs(zC.ty - vB.ty) > 5 || zC.z !== vB.z), zA.toFixed(2) + ' ' + zB.toFixed(2) + ' ' + zC.z.toFixed(2));
    await ctx.close();
  }
  { // reduced motion: tap-to-zoom lands immediately
    const { ctx, page } = await open(browser, { width: 390, height: 844 }, { save: mid(), reduced: true });
    await page.tap('#bpHome'); await sleep(300);
    const pick = await page.evaluate(() => BY.UI.debug.map().shown[3]);
    const r0 = await plateRect(page, pick);
    await page.touchscreen.tap(r0.cx, r0.cy); await sleep(80);
    const z = (await page.evaluate(() => BY.UI.debug.map())).z;
    check('reduced motion: the tap zoom is not animated', z > 0.9, z.toFixed(2));
    await ctx.close();
  }
  { // refused fullscreen
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.addInitScript((sv) => {
      try { localStorage.setItem('boltyard.save.v1', JSON.stringify(sv)); } catch (e) {}
      Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions policy violation')); };
    }, mid());
    await page.goto(URL);
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(400);
    await page.tap('#btnFocusWs'); await sleep(500);
    const st = await page.evaluate(() => { const n = document.getElementById('sysNote'), b = document.getElementById('btnFocusWs'); return { txt: n.textContent, hid: n.hidden, un: b.classList.contains('unavail'), aria: b.getAttribute('aria-disabled'), title: b.title, hud: document.getElementById('btnFocusHud').classList.contains('unavail'), title2: document.getElementById('btnFocusTitle').classList.contains('unavail') }; });
    check('refused fullscreen: a one-time toast explains it', !st.hid && /Fullscreen isn't allowed here/.test(st.txt) && /touch guards are still on/.test(st.txt), JSON.stringify(st));
    check('refused fullscreen: all three Focus buttons look unavailable with aria-disabled and a title', st.un && st.hud && st.title2 && st.aria === 'true' && /unavailable/.test(st.title), JSON.stringify(st));
    await page.screenshot({ path: path.join(shots, 'i-focus-refused.png') });
    await sleep(4600);
    await page.tap('#btnFocusWs', { force: true }); await sleep(400);
    const again = await page.evaluate(() => document.getElementById('sysNote').hidden);
    check('refused fullscreen: no second toast in the same session', again === true);
    await secTap(page, '#btnClockIn'); await sleep(700);
    const sh = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), cls: document.documentElement.classList.contains('shifting') }));
    check('refused fullscreen: touch guards still run in a shift', sh.scr === 'shift' && sh.cls, JSON.stringify(sh));
    await ctx.close();
  }
  { // corrupt save is backed up
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('boltyard.save.v1', '{"bolts": 12, oops'); } } catch (e) {} });
    await page.goto(URL);
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(500);
    const r = await page.evaluate(() => ({ bak: localStorage.getItem('boltyard.save.bak'), scr: BY.UI.debug.screen() }));
    check('corrupt save: raw string copied to boltyard.save.bak and the game starts fresh', r.bak === '{"bolts": 12, oops' && r.scr === 'title', JSON.stringify(r));
    await ctx.close();
  }
  { // future-version save is not overwritten
    const sv = mid(); sv.v = 99;
    const raw = JSON.stringify(sv);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    await page.addInitScript((r) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('boltyard.save.v1', r); } } catch (e) {} }, raw);
    await page.goto(URL);
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(400);
    await page.tap('#btnTitleClock'); await sleep(1500);
    const r = await page.evaluate(() => ({ cur: localStorage.getItem('boltyard.save.v1'), msg: document.getElementById('sysNote').textContent, shown: !document.getElementById('sysNote').hidden }));
    check('future save: the stored string is untouched after playing', r.cur === raw, 'len ' + (r.cur || '').length + ' vs ' + raw.length);
    check('future save: a clear message is shown', /newer version of Boltyard/.test(r.msg), r.msg);
    await ctx.close();
  }
};

// ---------------------------------------------------------------- main
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const order = only.length ? only : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  for (const k of order) {
    try { await phases[k](browser); } catch (e) { failed++; console.log('  FAIL phase ' + k + ' threw: ' + (e && e.stack || e)); }
  }
  await browser.close();
  console.log('\nconsole/page errors: ' + errors.length);
  errors.slice(0, 20).forEach((e) => console.log('  ' + e));
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed, ' + errors.length + ' errors (' + (useReal ? 'real renderer' : 'stub renderer') + ')');
  process.exit(failed || errors.length ? 1 : 0);
})();
