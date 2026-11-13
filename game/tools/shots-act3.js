#!/usr/bin/env node
// node tools/shots-act3.js -> shots/ui-act3.png (contact sheet of seven Act III UI shots)
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process');
const L = require('./lib-page.js');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(L.root, 'shots'); fs.mkdirSync(OUT, { recursive: true });
async function open(browser, w, h, save, reduced) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror ' + e.message));
  await page.addInitScript((s) => { try { localStorage.setItem('boltyard.save.v1', JSON.stringify(s)); } catch (e) {} }, save);
  await page.goto(L.URL);
  await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
  await sleep(700);
  return { ctx, page };
}
const tapId = async (page, id) => {
  await page.evaluate((i) => BY.UI.debug.panTo(i), id); await sleep(200);
  const r = await page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, id);
  await page.touchscreen.tap(r[0], r[1]); await sleep(500);
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const files = [];
  const snap = async (page, n) => { const f = path.join(OUT, 'sheet-' + n + '.png'); await page.screenshot({ path: f }); files.push(f); };
  { const { ctx, page } = await open(browser, 390, 844, L.act3Save('mid3'), true);
    await page.tap('#bpHome'); await sleep(800); await snap(page, 1);
    await page.evaluate(() => BY.UI.debug.panTo('stake')); await sleep(300);
    await page.evaluate(() => { const m = BY.UI.debug.map(); const z = BY.UI.debug.view(); BY.UI.debug.view(z.tx, z.ty, 1); }); await sleep(300);
    await snap(page, 2);
    await page.evaluate(() => BY.UI.debug.view(0, 0, 1)); await page.tap('#bpHome'); await sleep(500);
    const pick = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.UI.debug.map().shown.find((i) => { const f = E.upgradeInfo(sv, i); return !f.classified && f.unlocked && f.affordable && !f.maxed && (f.max === null || f.max > 2); }); });
    await tapId(page, pick); await snap(page, 3);
    await page.tap('#nsClose'); await sleep(300);
    const lk = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.UI.debug.map().shown.find((i) => { const f = E.upgradeInfo(sv, i); return !f.classified && !f.unlocked; }); });
    await tapId(page, lk); await snap(page, 4);
    await ctx.close(); }
  { const { ctx, page } = await open(browser, 320, 640, L.act3Save('founder'), true);
    await page.evaluate(() => { const t = [...document.querySelectorAll('.sact')]; t[2] && t[2].click(); }); await sleep(300);
    await snap(page, 5); await ctx.close(); }
  { const { ctx, page } = await open(browser, 390, 844, Object.assign(L.act3Save('founder'), {}), false);
    await page.evaluate(() => { BY.UI.debug.save().stats.boltsTotal = 9e26; BY.UI.debug.fakeReport({ reason: 'victory', sector: 15, time: 200, bolts: 7e25, cores: 9, kills: 900, bestCombo: 150, swept: 0, signalPct: 1, bossSeen: true, bossDefeated: true, firstClear: true, unlockedSector: 16, gameWon: false, act2Won: false, act3Won: true, overtimeLevel: null, severance: false, stolen: 0, stockMult: 1, newSeen: [] }); });
    await sleep(3200); await snap(page, 6); await ctx.close(); }
  { const { ctx, page } = await open(browser, 390, 844, L.act3Save('mid3'), false);
    await page.tap('#btnClockIn'); await sleep(2500); await snap(page, 7); await ctx.close(); }
  await browser.close();
  const out = path.join(OUT, 'ui-act3.png');
  cp.execSync('montage ' + files.map((f) => '"' + f + '"').join(' ') + ' -resize 480x -tile 4x2 -geometry +10+10 -background "#06090c" "' + out + '"');
  console.log('wrote ' + out);
})().catch((e) => { console.log('crashed ' + (e && e.stack || e)); process.exit(2); });
