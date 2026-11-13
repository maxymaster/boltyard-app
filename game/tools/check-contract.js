#!/usr/bin/env node
// node tools/check-contract.js   (SPEC section 8 "Page contract" assertions on dist/index.html, plus two dynamic checks)
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib-page.js');

const file = path.join(__dirname, '..', 'dist', 'index.html');
const html = fs.readFileSync(file, 'utf8');
let pass = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const js = scripts.join('\n');
const markup = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');

// ---- structure
check('no <!doctype>, <html>, <head>, <body>', !/<!doctype|<\/?(html|head|body)[\s>]/i.test(html));
check('starts with <title>Boltyard</title>', html.startsWith('<title>Boltyard</title>'));
check('second line is the claude:viewport-fit-sides meta', html.split('\n')[1] === '<meta name="claude:viewport-fit-sides" content="cover">');
check('no viewport meta of our own (the host adds it)', !/<meta[^>]+name="viewport"/i.test(html));
const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
check('exactly one <link>: the Google Fonts stylesheet', links.length === 1 && /^<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?/.test(links[0]) && /Saira\+Stencil\+One/.test(links[0]) && /Chakra\+Petch/.test(links[0]), links.join(' '));
check('exactly one <style>', (html.match(/<style>/g) || []).length === 1);
check('order: title, meta, link, style, markup, scripts', html.indexOf('<title>') < html.indexOf('<meta') && html.indexOf('<meta') < html.indexOf('<link') && html.indexOf('<link') < html.indexOf('<style>') && html.indexOf('</style>') < html.indexOf('<div id="app"') && html.indexOf('<div id="app"') < html.indexOf('<script>'));
check('scripts are all inline (no src), none after the page ends', scripts.length === 6 && !/<script[^>]+src=/i.test(html), scripts.length + ' inline scripts');
check('no <iframe>, <object>, <embed>, <img>, <video>, <audio> elements', !/<(iframe|object|embed|img|video|audio|source)\b/i.test(markup));
check('no <a> elements at all (so no <a download>)', !/<a[\s>]/i.test(markup) && !/download\s*=/.test(markup));

// ---- layout rules
check('side gutters use max(16px, env(safe-area-inset-left/right, 0px))',
  /padding-left:\s*max\(16px,\s*env\(safe-area-inset-left,\s*0px\)\)/.test(style) && /padding-right:\s*max\(16px,\s*env\(safe-area-inset-right,\s*0px\)\)/.test(style));
check('html, body: height 100%', /html\s*\{[^}]*height:\s*100%/.test(style) && /body\s*\{[^}]*height:\s*100%/.test(style));
check('no 100vh / 100dvh / 100svh anywhere', !/\b100(d|s|l)?vh\b/.test(style + markup));
const rootBlock = (style.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];
check(':root does not touch padding (host safe-area padding stays)', !/padding/.test(rootBlock) && !/(^|[^-\w])(html|:root)\s*\{[^}]*padding/.test(style));
check('body margin is 0', /body\s*\{[^}]*margin:\s*0/.test(style));
check('color-scheme: dark on :root', /color-scheme:\s*dark/.test(rootBlock));
check('html and body set an explicit background and color', /html\s*\{[^}]*background:/.test(style) && /body\s*\{[^}]*background:/.test(style) && /body\s*\{[^}]*color:/.test(style));
check('every colour is a token or literal: no named CSS colours (white/black/red/...)',
  !/(color|background|border[a-z-]*|fill|stroke)\s*:\s*(white|black|red|blue|green|gray|grey|silver|yellow|orange|transparent\s+url)\b/i.test(style));
check('visible keyboard focus (:focus-visible) is styled', /:focus-visible/.test(style));
check('[hidden] is honoured', /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(style));
check('touch-action: none on the arena, no page scroll (overflow hidden on body)', /#arena\s*\{[^}]*touch-action:\s*none/.test(style) && /body\s*\{[^}]*overflow:\s*hidden/.test(style));
check('prefers-reduced-motion is handled in CSS', /prefers-reduced-motion:\s*reduce/.test(style));
const smallFonts = [...style.matchAll(/font(?:-size)?:\s*[^;{}]*?\b(\d+(?:\.\d+)?)px/g)].map((m) => +m[1]).filter((n) => n < 12 && n > 0);
check('no CSS text under 12px', smallFonts.length === 0, smallFonts.join(','));

// ---- script rules
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const code = strip(js);
check('no alert( / confirm( / prompt( / print(', !/(^|[^.\w$])(alert|confirm|prompt)\s*\(/.test(code) && !/window\.print|\.print\s*\(/.test(code));
check('no window.open, location changes, downloads, createObjectURL', !/window\.open|\.open\s*\(\s*['"]http|location\.(href|assign|replace)\s*=|createObjectURL|\.download\s*=/.test(code));
check('no fetch / XMLHttpRequest / WebSocket / sendBeacon / importScripts / eval / new Function', !/\b(fetch|importScripts)\s*\(|new\s+(XMLHttpRequest|WebSocket|EventSource)|sendBeacon/.test(code) && !/\beval\s*\(|new Function\s*\(/.test(code));
const urls = [...new Set((html.match(/https?:\/\/[^\s"'<>)]+/g) || []))];
const badUrls = urls.filter((u) => !/^https:\/\/fonts\.googleapis\.com\/css2\?/.test(u) && u !== 'http://www.w3.org/2000/svg');
check('no external requests except the Google Fonts stylesheet (xmlns aside)', badUrls.length === 0, badUrls.join(' ') || urls.length + ' urls: fonts + svg xmlns');
check('CSS has no url() or @import', !/url\(|@import/.test(style));

// storage: every access sits inside a try block (static) ...
const lines = js.split('\n');
const storageHits = [];
lines.forEach((ln, i) => {
  if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(strip(ln)) && !/^\s*(\/\/|\*|\/\*)/.test(ln)) {
    const win = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/\btry\s*\{/.test(win)) storageHits.push(i + 1);
  }
});
const storageCount = lines.filter((ln) => /\b(localStorage|sessionStorage)\b/.test(strip(ln))).length;
check('every localStorage / sessionStorage access is inside try { }', storageHits.length === 0, storageCount + ' accesses' + (storageHits.length ? ', unguarded at js lines ' + storageHits.join(',') : ''));
check('hot-reload hooks wired: window.claude?.hot snapshot + ready, safe when window.claude is undefined',
  /root\.claude\s*&&\s*root\.claude\.hot/.test(js) && /hot\.snapshot/.test(js) && /hot\.ready\s*\)\s*hot\.ready\(start\)/.test(js) && /hot && hot\.data/.test(js));

(async () => {
  // ---- dynamic: storage that throws on every access, and hot-reload stubs
  const browser = await L.launch();
  {
    const errs = [];
    const { page } = await L.open(browser, { w: 390, h: 844, noStorage: true, errors: errs });
    await page.tap('#btnTitleClock');
    await L.sleep(1200);
    const st = await page.evaluate(() => ({ scr: BY.UI.debug.screen(), t: BY.UI.debug.run().t }));
    check('storage that throws on access: game boots and a shift runs', st.scr === 'shift' && st.t > 0.5 && errs.length === 0, JSON.stringify(st) + (errs.length ? ' ' + errs[0] : ''));
    await page.close();
  }
  {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.addInitScript(() => {
      const seed = { v: 1, bolts: 777, cores: 3, up: { boot: 1, coil: 4 }, sectorsCleared: 1, sector: 2, stats: { shifts: 5 }, flags: { movedOnce: true, tip: 3 }, settings: { sound: false } };
      window.__hotCalls = [];
      window.claude = { hot: {
        snapshot(fn) { window.__hotSnap = fn; window.__hotCalls.push('snapshot'); },
        ready(fn) { window.__hotCalls.push('ready'); fn({ save: seed }); }
      } };
    });
    await page.goto(L.URL);
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    const r = await page.evaluate(() => {
      const snap = window.__hotSnap && window.__hotSnap();
      return { calls: window.__hotCalls.join(','), bolts: BY.UI.debug.save().bolts, screen: BY.UI.debug.screen(), snapBolts: snap && snap.save && snap.save.bolts };
    });
    check('window.claude.hot: snapshot registered, ready() called, restored save used, snapshot returns { save }',
      /snapshot/.test(r.calls) && /ready/.test(r.calls) && r.bolts === 777 && r.screen === 'workshop' && r.snapBolts === 777, JSON.stringify(r));
    check('hot-reload stub run has no console / page errors', errs.length === 0, errs[0] || '');
    await ctx.close();
  }
  await browser.close();

  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log('\nCONTRACT: ' + pass + ' passed, ' + failed + ' failed | dist/index.html ' + kb + ' KB (' + (fs.statSync(file).size) + ' bytes)');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CONTRACT crashed: ' + (e && e.stack || e)); process.exit(2); });
