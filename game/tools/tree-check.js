// Blueprint layout checker (SPEC 12.15). Usage: node tools/tree-check.js [--png] [--quiet]
// Checks node spacing, edge clearance, reachability and the frontier width when walking the tree cheapest-first,
// and (with --png, default on) draws shots/tree-layout.png.
'use strict';
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'src', 'data.js'));
const D = BY.Data;
const UP = D.UPGRADES, BYID = D.UPGRADE_BY_ID;
const MIN_SPACING = 1.0, MIN_CLEAR = 0.45;
const wantPng = !process.argv.includes('--nopng');

function actOf(u) { return u.branch === 'rnd' ? 2 : u.branch === 'exec' ? 3 : 1; }
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

let fail = 0;
const out = [];
function bad(msg) { fail++; out.push('FAIL ' + msg); }

// 1. spacing
let minSp = 1e9, minPair = '';
for (let i = 0; i < UP.length; i++) for (let j = i + 1; j < UP.length; j++) {
  const d = dist(UP[i].pos, UP[j].pos);
  if (d < minSp) { minSp = d; minPair = UP[i].id + '/' + UP[j].id; }
  if (d < MIN_SPACING - 1e-9) bad('spacing ' + UP[i].id + ' / ' + UP[j].id + ' = ' + d.toFixed(2));
}

// 2. edges
const edges = [];
for (const u of UP) for (const r of u.requires) edges.push({ from: r[0], to: u.id, gate: false });
let minClear = 1e9, gateCross = 0, gateEdges = 0, maxLen = 0, maxLenId = '';
for (const e of edges) {
  const a = BYID[e.from].pos, b = BYID[e.to].pos;
  const len = dist(a, b);
  if (!e.gate && len > maxLen) { maxLen = len; maxLenId = e.from + '>' + e.to; }
  if (e.gate) gateEdges++;
  for (const u of UP) {
    if (u.id === e.from || u.id === e.to) continue;
    const d = segDist(u.pos, a, b);
    if (e.gate) { if (d < MIN_CLEAR) gateCross++; continue; }
    if (d < minClear) minClear = d;
    if (d < MIN_CLEAR) bad('edge ' + e.from + '>' + e.to + ' passes ' + d.toFixed(2) + ' from ' + u.id);
  }
}

// 3. reachability (all gates open, every node bought to its cap; uncapped nodes to level 1)
{
  const have = {}; have.boot = 1;
  let progress = true;
  while (progress) {
    progress = false;
    for (const u of UP) {
      const cap = u.max === Infinity ? 1 : u.max;
      if ((have[u.id] || 0) >= cap) continue;
      if (u.requires.every(r => (have[r[0]] || 0) >= r[1])) { have[u.id] = cap; progress = true; }
    }
  }
  for (const u of UP) if (!have[u.id]) bad('unreachable ' + u.id);
}

// 4. frontier walk, cheapest first (bolts, then cores) with unlimited funds
const walk = { 1: [], 2: [], 3: [] };
{
  const have = { boot: 1 };
  const cost = (u, l) => Math.round(u.base * Math.pow(u.growth, l));
  const remaining = { 1: 0, 2: 0, 3: 0 };
  for (const u of UP) if (u.id !== 'boot') remaining[actOf(u)] += u.max === Infinity ? 1 : u.max;
  for (let guard = 0; guard < 2000; guard++) {
    const fr = [];
    for (const u of UP) {
      if (u.id === 'boot') continue;
      const l = have[u.id] || 0, cap = u.max === Infinity ? 1 : u.max;
      if (l >= cap) continue;
      if (u.requires.every(r => (have[r[0]] || 0) >= r[1])) fr.push(u);
    }
    if (!fr.length) break;
    const cnt = { 1: 0, 2: 0, 3: 0 };
    for (const u of fr) cnt[actOf(u)]++;
    for (const a of [1, 2, 3]) {
      // count only while that act has started and still has a decent amount left
      let started = false;
      for (const u of UP) if (u.id !== 'boot' && actOf(u) === a && (have[u.id] || 0) > 0) started = true;
      if (a === 1) started = true;
      if (started && remaining[a] > 12) walk[a].push(cnt[a]);
    }
    let best = fr[0];
    for (const u of fr) if (cost(u, have[u.id] || 0) < cost(best, have[best.id] || 0)) best = u;
    have[best.id] = (have[best.id] || 0) + 1;
    remaining[actOf(best)]--;
  }
}
const minFr = {}, avgFr = {};
for (const a of [1, 2, 3]) {
  const w = walk[a];
  minFr[a] = w.length ? Math.min.apply(null, w) : 0;
  avgFr[a] = w.length ? w.reduce((s, x) => s + x, 0) / w.length : 0;
  if (minFr[a] < 3) bad('act ' + a + ' frontier min ' + minFr[a] + ' < 3');
}

// radii per act
const rad = { 1: [1e9, 0], 2: [1e9, 0], 3: [1e9, 0] };
for (const u of UP) { if (u.id === 'boot') continue; const r = Math.hypot(u.pos[0], u.pos[1]), a = actOf(u); rad[a][0] = Math.min(rad[a][0], r); rad[a][1] = Math.max(rad[a][1], r); }

if (!process.argv.includes('--quiet')) {
  out.push('nodes ' + UP.length + '  min spacing ' + minSp.toFixed(2) + ' (' + minPair + ')  min edge clearance ' + minClear.toFixed(2) + '  longest plain edge ' + maxLen.toFixed(1) + ' (' + maxLenId + ')');
  out.push('capstone act requirements: ' + UP.filter(u => u.actReq).map(u => u.id + ' ' + u.actReq.levels + ' Act ' + u.actReq.act + ' levels').join(', '));
  out.push('frontier width cheapest-first: act I min ' + minFr[1] + ' avg ' + avgFr[1].toFixed(1) + ' | act II min ' + minFr[2] + ' avg ' + avgFr[2].toFixed(1) + ' | act III min ' + minFr[3] + ' avg ' + avgFr[3].toFixed(1));
  out.push('radius act I ' + rad[1][0].toFixed(1) + '-' + rad[1][1].toFixed(1) + '  act II ' + rad[2][0].toFixed(1) + '-' + rad[2][1].toFixed(1) + '  act III ' + rad[3][0].toFixed(1) + '-' + rad[3][1].toFixed(1));
}
out.push(fail ? 'TREE CHECK: ' + fail + ' problem(s)' : 'TREE CHECK: ok');
console.log(out.join('\n'));

// 5. preview PNG
async function png() {
  const { chromium } = require('/opt/npm-tools/node_modules/playwright');
  const dir = path.join(__dirname, '..', 'shots'); fs.mkdirSync(dir, { recursive: true });
  const S = 74, pad = 60;
  let xs = UP.map(u => u.pos[0]), ys = UP.map(u => u.pos[1]);
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const R = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) + 1;
  const W = Math.round((maxX - minX + 2) * S + pad * 2), H = Math.round((maxY - minY + 2) * S + pad * 2);
  const ox = pad + (1 - minX) * S, oy = pad + (1 - minY) * S;
  const data = { nodes: UP.map(u => ({ id: u.id, x: u.pos[0], y: u.pos[1], act: actOf(u), max: u.max === Infinity ? 0 : u.max, tier: u.tier || 0, cap: u.requires.length >= 3, gate: u.gate || '' })), edges, W, H, ox, oy, S,
                 rings: [rad[1][1] + 0.5, rad[2][1] + 0.5, rad[3][1] + 0.5] };
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent('<body style="margin:0;background:#12161c"><canvas id=c width=' + W + ' height=' + H + '></canvas></body>');
  await page.evaluate(d => {
    const c = document.getElementById('c'), g = c.getContext('2d');
    const col = { 1: '#e0a63a', 2: '#4fb3e8', 3: '#e0607e' };
    const X = x => d.ox + x * d.S, Y = y => d.oy + y * d.S;
    g.fillStyle = '#12161c'; g.fillRect(0, 0, d.W, d.H);
    g.strokeStyle = '#2a323d'; g.setLineDash([4, 6]);
    for (const r of d.rings) { g.beginPath(); g.arc(X(0), Y(0), r * d.S, 0, 7); g.stroke(); }
    g.setLineDash([]);
    const by = {}; for (const n of d.nodes) by[n.id] = n;
    for (const e of d.edges) {
      const a = by[e.from], b = by[e.to];
      g.strokeStyle = e.gate ? 'rgba(255,255,255,0.18)' : 'rgba(200,210,225,0.55)'; g.lineWidth = e.gate ? 1 : 1.6;
      g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke();
    }
    g.font = '10px sans-serif'; g.textAlign = 'center';
    for (const n of d.nodes) {
      g.fillStyle = col[n.act]; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath();
      if (n.cap || n.id === 'boot') { g.rect(X(n.x) - 15, Y(n.y) - 15, 30, 30); } else { g.arc(X(n.x), Y(n.y), 14, 0, 7); }
      g.fill(); g.stroke();
      g.fillStyle = '#000'; g.fillText(n.tier ? n.id.replace(/\d$/, '') + ' ' + ['', 'I', 'II', 'III'][n.tier] : n.id, X(n.x), Y(n.y) + 3);
    }
  }, data);
  await page.screenshot({ path: path.join(dir, 'tree-layout.png') });
  await browser.close();
  console.log('wrote shots/tree-layout.png (' + W + 'x' + H + ')');
}
if (wantPng) png().then(() => process.exit(fail ? 1 : 0)).catch(e => { console.error(e); process.exit(2); });
else process.exit(fail ? 1 : 0);
