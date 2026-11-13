#!/usr/bin/env node
// node tools/native-check.js  -> the page with window.BY_NATIVE = true (the Capacitor wrapper's flag) vs. without it.
// Native: no Focus controls, no fullscreen or wake-lock request, no system note, html.native set, version line shown.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'dist/test.html'), 'utf8');
const SPY = '<script>window.__calls = [];' +
  'try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: function () { window.__calls.push("wake"); return Promise.reject(new Error("no")); } } }); } catch (e) {}' +
  'Element.prototype.requestFullscreen = function () { window.__calls.push("fs"); return Promise.reject(new Error("no")); };</script>';
const tmp = path.join(root, 'dist/native-check.html');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + JSON.stringify(extra) : '')); };

(async () => {
  let L, browser;
  for (const native of [true, false]) {
    fs.writeFileSync(tmp, src.replace('<body>', '<body>' + SPY + (native ? '<script>window.BY_NATIVE = true;</script>' : '')));
    process.env.BOLT_HTML = tmp;
    if (!L) { L = require('./lib-page.js'); browser = await L.launch(); }
    const errors = [];
    const { ctx, page } = await L.open(browser, { errors, seed: 3 });
    const tag = native ? 'native: ' : 'web: ';
    const vis = () => page.evaluate(() => ['btnFocusHud', 'btnFocusTitle', 'btnFocusWs', 'swFocus'].map((id) => { const e = document.getElementById(id); return !!(e && e.offsetParent !== null && !e.hidden); }));
    ok((await page.evaluate(() => document.documentElement.classList.contains('native'))) === native, tag + 'html.native ' + (native ? 'set' : 'absent'));
    ok((await page.evaluate(() => BY.UI.native)) === native, tag + 'BY.UI.native');
    let v = await vis();
    ok(v[1] === !native, tag + 'title Focus button ' + (native ? 'hidden' : 'shown'));
    await page.tap('#btnTitleClock'); await L.sleep(1200);
    v = await vis();
    ok(v[0] === !native, tag + 'HUD Focus button ' + (native ? 'hidden' : 'shown'));
    const calls = await page.evaluate(() => window.__calls.slice());
    const note = await page.evaluate(() => { const n = document.getElementById('sysNote'); return n.hidden ? '' : n.textContent; });
    if (native) { ok(calls.length === 0, tag + 'no wake-lock / fullscreen request in a shift', calls); ok(note === '', tag + 'no system note', note); }
    else { ok(calls.includes('wake'), tag + 'wake lock still requested', calls); ok(/Screen lock/.test(note), tag + 'refusal note still shown', note); }
    await page.evaluate(() => { BY.UI.debug.workshop(); }); await L.sleep(600);
    v = await vis();
    ok(v[2] === !native, tag + 'workshop Focus button ' + (native ? 'hidden' : 'shown'));
    await page.tap('#btnGear'); await L.sleep(300);
    v = await vis();
    ok(v[3] === !native, tag + 'Settings Focus switch ' + (native ? 'hidden' : 'shown'));
    const about = await page.evaluate(() => document.getElementById('about').textContent);
    ok(/^Boltyard v\d+\.\d+ \(build \d+\)$/.test(about), tag + 'version line', about);
    const txt = await page.evaluate(() => document.getElementById('settings').innerText);
    if (native) ok(!/fullscreen|focus mode/i.test(txt), tag + 'Settings has no fullscreen / Focus wording');
    ok(errors.length === 0, tag + 'no page errors', errors);
    await ctx.close();
  }
  await browser.close();
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log('NATIVE CHECK: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
