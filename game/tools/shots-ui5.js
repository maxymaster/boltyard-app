#!/usr/bin/env node
// node tools/shots-ui5.js -> shots/ui-v5.png (map open, after tap, sheet open, refused Focus; 390x844 and 320x640)
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process');
const L = require('./lib-page.js');
const sleep = L.sleep, OUT = path.join(L.root, 'shots'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await L.launch(), files = [];
  for (const [w, h] of [[390, 844], [320, 640]]) {
    const snap = async (page, n) => { const f = path.join(OUT, 'v5-' + w + '-' + n + '.png'); await page.screenshot({ path: f }); files.push(f); };
    { const { ctx, page } = await L.open(browser, { w, h, dpr: 1, save: L.act3Save('mid3') });
      await sleep(900); await page.tap('#bpHome'); await sleep(700); await snap(page, 1);
      const pick = await page.evaluate(() => { const E = BY.Engine, sv = BY.UI.debug.save(); return BY.UI.debug.map().shown.find((i) => { const f = E.upgradeInfo(sv, i); return i !== 'boot' && f.unlocked && f.affordable && !f.maxed; }); });
      const r = await page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, pick);
      await page.touchscreen.tap(r[0], r[1]); await sleep(700); await snap(page, 2);
      const r2 = await page.evaluate((i) => { const e = document.querySelector('.node[data-id="' + i + '"]').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; }, pick);
      await page.touchscreen.tap(r2[0], r2[1]); await sleep(800); await snap(page, 3);
      await ctx.close(); }
    { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await page.addInitScript((sv) => { localStorage.setItem('boltyard.save.v1', JSON.stringify(sv)); Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('denied')); }, L.act3Save('mid3'));
      await page.goto(L.URL); await sleep(900); await page.tap('#btnFocusWs'); await sleep(500); await snap(page, 4); await ctx.close(); }
  }
  await browser.close();
  const out = path.join(OUT, 'ui-v5.png');
  cp.execSync('montage ' + files.join(' ') + ' -tile 4x2 -geometry 390x844+6+6 -background "#222" ' + out);
  console.log(out);
})();
