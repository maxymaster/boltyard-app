#!/usr/bin/env node
// node tools/shots-review.js <tag> [--native]  -> shots/review/<tag>-*.png
// Real page at 390x844 DPR 2 with a simulated iPhone safe area (top 47, bottom 34): env(safe-area-inset-*) is
// substituted in a copy of dist/test.html, and a fake Dynamic Island + home indicator are drawn on top.
// --native sets window.BY_NATIVE = true before the game scripts (what the Capacitor wrapper does).
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const tag = process.argv[2] || 'shot';
const native = process.argv.includes('--native');
let html = fs.readFileSync(path.join(root, 'dist/test.html'), 'utf8');
html = html.replace(/env\(safe-area-inset-top,\s*0px\)/g, '47px').replace(/env\(safe-area-inset-bottom,\s*0px\)/g, '34px')
  .replace(/env\(safe-area-inset-(left|right),\s*0px\)/g, '0px');
const tmp = path.join(root, 'dist/review.html');
fs.writeFileSync(tmp, html);
process.env.BOLT_HTML = tmp;
const L = require('./lib-page.js');
const { sleep } = L;
const OUT = path.join(root, 'shots/review');
fs.mkdirSync(OUT, { recursive: true });

async function open(browser, o) {
  const r = await L.open(browser, Object.assign({ dpr: 2 }, o));
  return r;
}
const chrome = (page) => page.evaluate(() => {
  if (document.getElementById('__chrome')) return;
  const d = document.createElement('div'); d.id = '__chrome';
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  d.innerHTML = '<i style="position:absolute;left:50%;top:11px;width:124px;height:36px;margin-left:-62px;border-radius:20px;background:#000"></i>' +
    '<i style="position:absolute;left:50%;bottom:8px;width:138px;height:5px;margin-left:-69px;border-radius:3px;background:rgba(255,255,255,.75)"></i>';
  document.documentElement.appendChild(d);
});
const NODE = '.node[data-id="coil"]';
const shot = async (page, name) => { await chrome(page); await page.screenshot({ path: path.join(OUT, tag + '-' + name + '.png') }); console.log('  ' + tag + '-' + name + '.png'); };

(async () => {
  const browser = await L.launch();
  const errs = [];
  const init = async (ctxOpen) => ctxOpen;
  const mk = async (o) => {
    // BY_NATIVE must exist before the game scripts: lib-page has no hook, so patch the file copy instead
    return open(browser, Object.assign({ errors: errs }, o));
  };
  if (native) fs.writeFileSync(tmp, html.replace('<body>', '<body><script>window.BY_NATIVE = true;</script>'));

  { // fresh save: title, shift, report, workshop, sheet, settings
    const { ctx, page } = await mk({ seed: 7 });
    await sleep(900); await shot(page, '01-title');
    await page.tap('#btnTitleClock'); await sleep(2500); await shot(page, '02-first-shift-hint');
    await page.evaluate(() => { const d = BY.UI.debug; d.setInput((r) => BY.Autopilot.target(r, { skill: 'attentive' })); });
    await sleep(6000); await shot(page, '03-shift-hud');
    await page.tap('#btnPause'); await sleep(500); await shot(page, '04-pause');
    await page.tap('#btnResume'); await sleep(200);
    await page.evaluate(() => { BY.UI.debug.timeScale = 10; });
    await L.waitScreen(page, ['report'], 120000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    await sleep(2200); await shot(page, '05-report');
    await page.tap('#btnRepPrimary'); await L.waitScreen(page, ['workshop'], 5000); await sleep(1200);
    await shot(page, '06-workshop-first');
    const node = await page.$(NODE) || await page.$('.node.afford');
    if (node) { await node.tap(); await sleep(600); await shot(page, '07-detail-sheet'); await page.tap('#nsClose').catch(() => {}); await sleep(300); }
    await page.tap('#btnGear'); await sleep(600); await shot(page, '08-settings');
    await ctx.close();
  }
  { // Act III mid save: busy workshop, HUD with cores/OC, tabs
    const { ctx, page } = await mk({ seed: 11, save: L.act3Save('mid3') });
    await sleep(1200); await shot(page, '09-workshop-act3');
    const node = await page.$(NODE) || await page.$('.node.afford');
    if (node) { await node.tap(); await sleep(600); await shot(page, '10-detail-sheet-act3'); await page.tap('#nsClose').catch(() => {}); await sleep(300); }
    await page.tap('#tabBtnCodex'); await sleep(500); await shot(page, '11-codex');
    await page.tap('#tabBtnLog'); await sleep(500); await shot(page, '12-log');
    await page.tap('#btnGear'); await sleep(500); await shot(page, '13-settings-act3');
    await page.tap('#btnSetClose'); await sleep(300);
    await page.tap('#btnClockIn'); await sleep(400);
    await page.evaluate(() => { const d = BY.UI.debug; d.setInput((r) => BY.Autopilot.target(r, { skill: 'attentive' })); d.timeScale = 4; });
    await sleep(4000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    await sleep(500); await shot(page, '14-shift-hud-act3');
    await page.evaluate(() => { BY.UI.debug.timeScale = 10; });
    await L.waitScreen(page, ['report', 'victory'], 180000);
    await page.evaluate(() => { BY.UI.debug.timeScale = 1; });
    await sleep(2500); await shot(page, '15-report-act3');
    await ctx.close();
  }
  await browser.close();
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
})().catch((e) => { console.error(e); process.exit(1); });
