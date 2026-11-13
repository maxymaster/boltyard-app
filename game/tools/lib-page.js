// Shared Playwright helpers for the real-page tools (play-through, robustness, shots).
'use strict';
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const root = path.join(__dirname, '..');
const URL = 'file://' + (process.env.BOLT_HTML || path.join(root, 'dist/test.html'));
const AUTOPILOT = path.join(root, 'tools/autopilot.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch() {
  return chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
}

// o: { w, h, dpr, touch, reduced, noStorage, save, errors:[] }
async function open(browser, o) {
  o = o || {};
  const errors = o.errors || [];
  const touch = o.touch !== false;
  const ctx = await browser.newContext({
    viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: o.dpr || 1,
    hasTouch: touch, isMobile: touch, reducedMotion: o.reduced ? 'reduce' : 'no-preference'
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.addInitScript(() => {
    window.__rej = [];
    window.addEventListener('unhandledrejection', (e) => window.__rej.push(String(e.reason)));
  });
  if (o.seed !== undefined) await page.addInitScript((seed) => {   // seeded Math.random: the game picks its shift seeds from it
    let a = seed | 0;
    Math.random = function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, o.seed);
  if (o.noStorage) await page.addInitScript(() => {
    const deny = () => { throw new Error('storage denied'); };
    Object.defineProperty(window, 'localStorage', { get: deny });
    Object.defineProperty(window, 'sessionStorage', { get: deny });
  });
  if (o.save) await page.addInitScript((s) => {
    try { if (!localStorage.getItem('boltyard.save.v1')) localStorage.setItem('boltyard.save.v1', JSON.stringify(s)); } catch (e) {}
  }, o.save);
  await page.goto(URL);
  await page.addScriptTag({ path: AUTOPILOT });
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  await sleep(150);
  return { ctx, page, errors };
}
const screen = (page) => page.evaluate(() => BY.UI.debug.screen());
async function waitScreen(page, names, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 60000)) {
    const s = await screen(page);
    if (names.includes(s)) return s;
    await sleep(40);
  }
  return null;
}

// ---- Act II save fixtures (v2). kind: preOverseer | justWon | mid | blocked | chairman | ot7
function act2Save(kind) {
  const fs = require('fs'), vm = require('vm');
  const sb = {}; sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(root, 'src/data.js'), 'utf8'), sb);
  const D = sb.BY.Data;
  const up = { boot: 1 };
  for (const u of D.UPGRADES) if (u.branch !== 'rnd' && u.branch !== 'exec') up[u.id] = u.max;
  const seen = {};
  for (const e of D.ENEMIES) seen[e.id] = true;
  for (const b of D.BOSSES) seen[b.id] = true;
  const s = { v: 2, bolts: 5e8, cores: 30, up, sectorsCleared: 4, bossKills: { 1: 9, 2: 7, 3: 5, 4: 3 }, sector: 5, seen,
    stats: { shifts: 94, kills: 21000, boltsTotal: 5.2e9, coresTotal: 90, playTime: 4380, bestCombo: 77, bestShiftBolts: 8.4e8, wonShifts: null, wonPlayTime: null, act2Shifts: null, act2PlayTime: null, stolen: 0 },
    flags: { won: false, movedOnce: true, tip: 3, shopped: true, act2: false, chairman: false, reveal: false },
    overtime: { level: 0, best: 0 }, settings: { sound: false, shake: true } };
  const won = () => { s.flags.won = true; s.flags.act2 = true; s.stats.wonShifts = 94; s.stats.wonPlayTime = 4380; s.bossKills[5] = 1; s.sectorsCleared = 5; };
  if (kind === 'justWon') { won(); s.sector = 6; }
  if (kind === 'mid') {
    won(); s.flags.reveal = true; s.sectorsCleared = 7; s.sector = 8; s.bolts = 2.3e9; s.cores = 55;
    Object.assign(s.bossKills, { 6: 3, 7: 2 }); Object.assign(s.up, { fusion: 3, supercell: 2, dividends: 3, severance: 0, storm: 1 });
    s.stats.shifts = 130; s.stats.boltsTotal = 3e10; s.stats.stolen = 123456;
  }
  if (kind === 'blocked') {
    won(); s.flags.reveal = true; s.sectorsCleared = 9; s.sector = 10; s.bolts = 4e9; s.cores = 80;
    Object.assign(s.bossKills, { 6: 3, 7: 2, 8: 2, 9: 1 });
    Object.assign(s.up, { fusion: 6, supercell: 2, dividends: 3, severance: 1, parachute: 1, rehire: 1, nanites: 1, lattice: 2, storm: 1, stockopt: 1 });
  }
  if (kind === 'chairman' || kind === 'ot7') {
    won(); s.flags.reveal = true; s.flags.chairman = true; s.sectorsCleared = 10; s.sector = 11; s.bolts = 8e10; s.cores = 120;
    Object.assign(s.bossKills, { 6: 3, 7: 2, 8: 2, 9: 1, 10: 1 });
    Object.assign(s.up, { fusion: 10, supercell: 8, dividends: 10, severance: 3, parachute: 3, rehire: 5, nanites: 5, lattice: 5, storm: 5, stockopt: 5, singularity: 5, takeover: 1, overtimepay: 3 });
    s.stats.act2Shifts = 77; s.stats.act2PlayTime = 5400; s.stats.shifts = 171; s.stats.stolen = 9e6;
  }
  if (kind === 'ot7') {
    s.overtime = { level: 6, best: 6 }; s.bolts = 1e30; s.cores = 1.5e12; s.stats.boltsTotal = 9.9e32; s.stats.bestShiftBolts = 7.7e28;
    s.up.overtimepay = 37; s.up.hazardpay = 12; s.stats.kills = 9.9e7; s.stats.coresTotal = 2e12;
  }
  return s;
}

// ---- Act III save fixtures (v3). kind: justChairman | mid3 | blocked3 | founder
function act3Save(kind) {
  const s = act2Save('chairman');          // Act I maxed, R&D mid-way, Chairman fallen
  s.v = 3;
  const sv = (o) => Object.assign(s.up, o);
  const rnd = { fusion: 10, supercell: 8, dividends: 10, severance: 3, parachute: 3, rehire: 5, nanites: 5, lattice: 5, storm: 5, stockopt: 5, singularity: 5, takeover: 1, overtimepay: 22, hazardpay: 18 };
  sv(rnd);
  s.overtime = { level: 0, best: 0 }; s.sector = 11; s.sectorsCleared = 10; s.bolts = 9e13; s.cores = 70;
  s.fatigue = { 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  s.flags = Object.assign({}, s.flags, { act3: true, founder: false, reveal3: false, finale: false });
  s.stats = Object.assign({}, s.stats, { act3Shifts: null, act3PlayTime: null, clawed: 0 });
  const seen = Object.assign({}, s.seen);
  s.seen = seen;
  if (kind === 'mid3') {
    s.flags.reveal3 = true; s.sectorsCleared = 12; s.sector = 13; s.bolts = 4e18; s.cores = 31;
    Object.assign(s.bossKills, { 11: 3, 12: 2 }); sv({ megacoil: 4, diligence: 2, legal: 1, compound: 2, fleet: 1, insider: 1, orbital: 1, expense: 0, restructure: 1, outsource: 0 });
    s.fatigue[13] = 0.12; s.stats.shifts = 232; s.stats.act3Shifts = null; s.stats.clawed = 7.5e14;
  }
  if (kind === 'blocked3' || kind === 'founder') {
    s.flags.reveal3 = true; s.sectorsCleared = 14; s.sector = 15; s.bolts = 6e19; s.cores = 44;
    Object.assign(s.bossKills, { 11: 3, 12: 3, 13: 2, 14: 2 });
    sv({ megacoil: 8, diligence: 5, legal: 3, compound: 5, fleet: 3, insider: 5, orbital: 5, expense: 3, restructure: 5, outsource: 3 });
    s.stats.shifts = 281; s.stats.clawed = 4.2e17; s.fatigue[14] = 0.06;
  }
  if (kind === 'founder') {
    s.flags.finale = true; s.flags.founder = true; s.sectorsCleared = 15; s.sector = 16; s.bolts = 7e25; s.cores = 120; s.bossKills[15] = 1; sv({ stake: 1, overtimepay: 40, hazardpay: 31 });
    s.stats.act3Shifts = 64; s.stats.act3PlayTime = 4300; s.stats.shifts = 311; s.stats.playTime = 17100; s.overtime = { level: 2, best: 2 };
  }
  return s;
}
module.exports = { launch, open, screen, waitScreen, sleep, URL, root, chromium, act2Save, act3Save };
