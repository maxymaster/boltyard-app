/* Boltyard audio tests. Run: node tools/audio-test.js
 * Phase 1: Node, no browser globals. Phase 2: headless Chrome with OfflineAudioContext renders. */
'use strict';
const path = require('path');
const root = path.resolve(__dirname, '..');
const modPath = path.join(root, 'src', 'audio.js');
let failures = 0;
function check(ok, msg) { if (!ok) { failures++; console.log('  FAIL: ' + msg); } }
function fresh() { delete require.cache[modPath]; delete globalThis.BY; require(modPath); return globalThis.BY.Audio; }

const EVENTS = [
  { type: 'pulse', x: 1, y: 1, r: 46 }, { type: 'zap', x1: 0, y1: 0, x2: 1, y2: 1, crit: false, src: 'arc' },
  { type: 'zap', x1: 0, y1: 0, x2: 1, y2: 1, crit: true, src: 'drone' }, { type: 'zap', x1: 0, y1: 0, x2: 1, y2: 1, crit: false, src: 'chain' },
  { type: 'hit', x: 1, y: 1, dmg: 2, crit: false, armored: false, enemyId: 3 },
  { type: 'kill', x: 1, y: 1, r: 12, enemyType: 'scrapling', elite: false, boss: false, bolts: 2 },
  { type: 'kill', x: 1, y: 1, r: 22, enemyType: 'hauler', elite: false, boss: false, bolts: 9 },
  { type: 'kill', x: 1, y: 1, r: 30, enemyType: 'compactor', elite: false, boss: true, bolts: 9 },
  { type: 'explode', x: 1, y: 1, r: 55, src: 'overload' }, { type: 'explode', x: 1, y: 1, r: 60, src: 'bomber' },
  { type: 'spawn', enemyId: 1, enemyType: 'roller', x: 1, y: 1, elite: true },
  { type: 'pickup', kind: 'bolt', value: 2, x: 1, y: 1 }, { type: 'pickup', kind: 'core', value: 1, x: 1, y: 1 }, { type: 'pickup', kind: 'cell', value: 1, x: 1, y: 1 },
  { type: 'hurt', amount: 3, x: 1, y: 1, src: 'contact' }, { type: 'hurt', amount: 6, x: 1, y: 1, src: 'slam' }, { type: 'shot', x: 1, y: 1 },
  { type: 'lowBattery' }, { type: 'spare' }, { type: 'ocStart', dur: 4 }, { type: 'ocEnd' }, { type: 'combo', n: 5 }, { type: 'combo', n: 500 },
  { type: 'bossWarn', name: 'The Compactor', dur: 2.5 }, { type: 'bossSpawn', enemyId: 9, name: 'The Compactor' }, { type: 'bossPhase', phase: 2 },
  { type: 'telegraph', kind: 'slam', x: 1, y: 1, r: 60, dur: 1 }, { type: 'telegraph', kind: 'charge', x: 1, y: 1, r: 20, dur: 1 },
  { type: 'slam', x: 1, y: 1, r: 60 }, { type: 'shield', on: true }, { type: 'shield', on: false },
  { type: 'bossDead', x: 1, y: 1, name: 'The Compactor', bolts: 60, cores: 2 }, { type: 'sectorClear', sector: 1, first: true },
  { type: 'end', reason: 'battery' }, { type: 'end', reason: 'clockout' }, { type: 'end', reason: 'victory' },
  { type: 'laser', x: 1, y: 1, x2: 5, y2: 5, w: 4 }, { type: 'storm', n: 3 }, { type: 'wellOpen', id: 1, x: 1, y: 1, r: 40 },
  { type: 'wellBoom', id: 1, x: 1, y: 1, r: 40, n: 3 }, { type: 'intern', id: 1, x: 1, y: 1 }, { type: 'internEnd', id: 1, x: 1, y: 1 },
  { type: 'infect', enemyId: 2 }, { type: 'stock', n: 1, mult: 1.2 }, { type: 'steal', enemyId: 2, x: 1, y: 1, bolts: 5 },
  { type: 'refund', x: 1, y: 1, bolts: 5 }, { type: 'print', enemyId: 2 }, { type: 'blink', enemyId: 2, x: 1, y: 1 },
  { type: 'mimicWake', enemyId: 2 }, { type: 'severance', x: 1, y: 1, r: 80, bolts: 30 }, { type: 'overtime', level: 2 },
  { type: 'budget', on: true }, { type: 'budget', on: false },
  { type: 'hold' }, { type: 'injunction' }, { type: 'clawback' }, { type: 'orbital' }, { type: 'burst' }, { type: 'copy' }, { type: 'founder' }
];
const NAMES = ['click', 'buy', 'deny', 'clockin', 'zap', 'crit', 'kill', 'killBig', 'pickup', 'core', 'cell', 'hurt', 'low', 'ocStart', 'ocEnd', 'combo',
  'bossWarn', 'bossSpawn', 'bossDead', 'slam', 'explode', 'shot', 'shiftEnd', 'victory', 'unlock',
  'laser', 'storm', 'well', 'wellBoom', 'steal', 'refund', 'intern', 'severance', 'overtime', 'budget', 'blink', 'print', 'mimic', 'classified',
  'hold', 'injunction', 'clawback', 'orbital', 'burst', 'copy', 'memo', 'founder'];

function nodePhase() {
  console.log('== Phase 1: Node (no window/document/AudioContext) ==');
  check(typeof window === 'undefined' && typeof document === 'undefined' && typeof AudioContext === 'undefined', 'node has no browser globals');
  let A = fresh();
  let calls = 0;
  const run = (label, f) => { try { f(); calls++; } catch (e) { check(false, label + ' threw ' + e); } };
  for (const n of NAMES) { run('play ' + n, () => { A.play(n); A.play(n, { pitch: 2, vol: 0.5 }); A.play(n, { pitch: NaN, vol: Infinity }); }); }
  run('play unknown', () => { A.play('nope'); A.play(); A.play(null); A.play({}); A.play('zap', null); A.play('__proto__'); A.play('constructor'); A.play('toString'); });
  for (const ev of EVENTS) run('handle ' + ev.type, () => { A.handle([ev], {}); A.handle([ev], null); A.handle([ev]); });
  run('handle all', () => { A.handle(EVENTS, {}); A.handle([], {}); A.handle(undefined, undefined); A.handle(null); A.handle('x'); A.handle({}); A.handle([null, undefined, 5, 'x', {}, { type: null }]); });
  run('unlock', () => { A.unlock(); A.unlock(); });
  run('setEnabled', () => { A.setEnabled(false); A.setEnabled(true); A.setEnabled(0); A.setEnabled(); A.setEnabled(1); });
  check(typeof A.unlock === 'function' && typeof A.setEnabled === 'function' && typeof A.play === 'function' && typeof A.handle === 'function', 'API present');
  console.log('  node, no AudioContext: ' + calls + ' call groups, ' + (NAMES.length * 3 + EVENTS.length * 3 + 8) + '+ calls, no throw: ' + (failures === 0));

  // AudioContext constructor that throws / webkit-only / stub that throws everywhere
  const bad = [
    ['ctor throws', function () { throw new Error('nope'); }],
    ['all methods throw', function () { return new Proxy({}, { get() { throw new Error('boom'); } }); }]
  ];
  for (const [label, ctor] of bad) {
    A = fresh();
    globalThis.AudioContext = ctor;
    run(label, () => { A.unlock(); A.play('zap'); A.handle(EVENTS, {}); A.setEnabled(false); A.setEnabled(true); });
    delete globalThis.AudioContext;
  }
  // a minimal recording mock context: validates that the graph is wired and that sounds get scheduled
  A = fresh();
  const mk = () => {
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), detune: param(), Q: param(),
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    return { state: 'suspended', currentTime: 0, sampleRate: 44100, destination: {}, resumed: 0, resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); },
      createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node, createDynamicsCompressor: node, createWaveShaper: node,
      createBuffer: (c, n) => ({ duration: n / 44100, getChannelData: () => new Float32Array(n) }) };
  };
  globalThis.AudioContext = function () { return mk(); };
  A = fresh();
  run('mock unlock', () => { A.unlock(); });
  run('mock play all', () => { for (const n of NAMES) A.play(n); A.handle(EVENTS, {}); });
  check(A._stats.sounds >= NAMES.length, 'mock context: sounds scheduled (' + A._stats.sounds + ')');
  check(A._stats.errors === 0, 'mock context: no internal errors (' + A._stats.errors + ' ' + A._state().lastError + ')');
  delete globalThis.AudioContext;
  console.log('  throwing / mock contexts: ok=' + (failures === 0) + ', mock sounds scheduled=' + A._stats.sounds);
}

async function chromePhase() {
  console.log('== Phase 2: headless Chrome (OfflineAudioContext renders, 44.1 kHz, 4.5 s each) ==');
  const { chromium } = require('/opt/npm-tools/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await p.goto('file://' + path.join(root, 'tools', 'audio-test.html'));
  const ev = (fn, ...a) => p.evaluate(fn, ...a);

  const un = await ev(() => window.AT.unlockReal());
  console.log('  real unlock(): thrown=' + un.thrown + ' state=' + JSON.stringify(un.state));
  check(!un.thrown && un.state.hasCtx, 'unlock created a context');

  const names = await ev(() => window.AT.names());
  for (const n of NAMES) check(names.indexOf(n) >= 0, 'recipe missing: ' + n);
  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  console.log('\n  ' + pad('sound', 10) + pad('peak', 8) + pad('dur>-50dB', 11) + pad('dom Hz', 8) + pad('<160Hz%', 9) + pad('>4kHz%', 8) + pad('osc', 5) + pad('noise', 6) + 'err');
  const rows = [];
  for (const n of names) {
    const r = await ev(nm => window.AT.sound(nm), n);
    rows.push(r);
    if (r.thrown) { check(false, n + ' threw ' + r.thrown); continue; }
    console.log('  ' + pad(n, 10) + pad(r.peak.toFixed(3), 8) + pad(r.dur.toFixed(3) + 's', 11) + pad(Math.round(r.domHz), 8) + pad(r.lowPct.toFixed(1), 9) + pad(r.hiPct.toFixed(1), 8) + pad(r.osc, 5) + pad(r.noise, 6) + r.errors);
    check(r.peak > 0.02, n + ' peak too low ' + r.peak);
    check(r.peak <= 1.0, n + ' clips ' + r.peak);
    check(r.errors === 0, n + ' internal errors ' + r.lastError);
    check(r.bad === 0, n + ' NaN samples');
    check(Math.abs(r.firstSample) < 0.02, n + ' starts abruptly ' + r.firstSample);
  }

  const st = await ev(() => window.AT.stress());
  console.log('\n  STRESS  (40 zap + 25 kill + 60 pickup in one handle() call): ' + JSON.stringify(st));
  check(!st.thrown, 'stress threw');
  check(st.peak <= 1.0 && st.peak > 0.02, 'stress peak ' + st.peak);
  check(st.sounds <= 20, 'stress sounds ' + st.sounds + ' exceeds cap 20');
  check((st.byName.pickup || 0) >= 4 && (st.byName.pickup || 0) <= 8, 'pickup run present and capped');
  check(st.errors === 0, 'stress internal errors');

  const mx = await ev(() => window.AT.mixed());
  console.log('  MIXED   (30 kill + 21 explode + hurt/slam/bossDead/end in one call): ' + JSON.stringify(mx));
  check(mx.peak <= 1.0, 'mixed peak');
  check((mx.byName.hurt || 0) === 1 && (mx.byName.bossDead || 0) === 1 && (mx.byName.slam || 0) === 1, 'critical sounds must bypass the budget');
  check(!mx.byName.shiftEnd, 'victory end must be silent');

  const lad = await ev(() => window.AT.ladder());
  const fs = lad.fundamentals;
  console.log('\n  LADDER  (pickup plays at t=0,.1,...,1.3 then 2.5,2.6,2.7): ' + fs.map(x => x.f).join(' '));
  let rising = true; for (let i = 1; i < 11; i++) if (!(fs[i].f > fs[i - 1].f)) rising = false;
  check(rising, 'first 11 pickups must strictly rise');
  check(fs[11].f === fs[10].f && fs[13].f === fs[10].f, 'ladder holds at top');
  check(fs[14].f === fs[0].f && fs[15].f > fs[14].f, 'ladder resets after a >0.6 s gap');
  check(fs[10].f < 4000, 'ladder top below 4 kHz (' + fs[10].f + ')');

  const po = await ev(() => window.AT.pitchOpt());
  console.log('  PITCH   combo at pitch 1, 1.5, 99(clamped 4), -3(default 1), junk(default 1): ' + po.join(' '));
  check(po[1] === Math.round(po[0] * 1.5) || Math.abs(po[1] - po[0] * 1.5) <= 1, 'pitch 1.5 multiplies freq');
  check(po[3] === po[0] && po[4] === po[0], 'invalid pitch -> 1');

  const dis = await ev(() => window.AT.disabled());
  console.log('  DISABLED peak: scheduled-then-disabled=' + dis.scheduledThenDisabled + '  disabled play/handle=' + dis.disabledPlay + '  re-enabled zap=' + dis.reenabledZap.toFixed(3));
  check(dis.scheduledThenDisabled === 0 && dis.disabledPlay === 0, 'disabled must be silent');
  check(dis.reenabledZap > 0.02, 're-enable restores sound');

  const hm = await ev(() => window.AT.handleMap());
  console.log('\n  HANDLE MAP (event -> sounds started):\n  ' + Object.entries(hm).map(([k, v]) => k + '=' + v).join('  '));
  const exp = { pulse: '-', hit: '-', spawn: '-', bossPhase: '-', sectorClear: '-', endVictory: '-', killBoss: '-', zapCrit: 'crit', zapDrone: 'zap', kill: 'kill', killElite: 'killBig',
    killBigR: 'killBig', pickupCore: 'core', pickupCell: 'cell', pickupBolt: 'pickup', endBattery: 'shiftEnd', endClock: 'shiftEnd', telegraph: 'telegraph', shield: 'shield', spare: 'cell+ocStart',
    laser: 'laser', storm: 'storm', wellOpen: 'well', wellBoom: 'wellBoom', steal: 'steal', refund: 'refund', intern: 'intern', internEnd: '-', infect: '-', stock: '-',
    severance: 'severance', overtime: 'overtime', budgetOn: 'budget', budgetOff: '-', blink: 'blink', print: 'print', mimicWake: 'mimic', classified: '-',
    hold: 'hold', injunction: 'injunction', clawback: 'clawback', orbital: 'orbital', burst: 'burst', copy: 'copy', founder: '-' };
  for (const k in exp) check(hm[k] === exp[k], 'handle map ' + k + ' expected ' + exp[k] + ' got ' + hm[k]);

  const at = await ev(() => window.AT.attract());
  console.log('  ATTRACT (Act II + Act III events in an attract run): sounds=' + at.sounds);
  check(at.sounds === 0, 'attract run must be silent (' + at.sounds + ' sounds)');

  const rt = await ev(() => window.AT.rate());
  console.log('  RATE (10 storm + 10 intern + 10 print + 10 burst + 10 copy per call, two calls, one frame): ' + JSON.stringify(rt));
  check(rt.storm === 1 && rt.intern === 1 && rt.print === 1, 'rate limits must hold (storm/intern/print = 1 each)');
  check(rt.burst === 1 && rt.copy === 1, 'rate limits must hold (burst/copy = 1 each)');

  const rb = await ev(() => window.AT.robustness());
  console.log('  ROBUSTNESS in page (no ctx / closed fake ctx / junk args): thrown=' + JSON.stringify(rb.thrown));
  check(rb.thrown.length === 0, 'robustness threw');

  const lk = await ev(() => window.AT.realLeak());
  console.log('  REAL CONTEXT 150 frames x 30 events: ' + JSON.stringify(lk));
  check(lk.activeAfterWait === 0, 'voices leaked: active=' + lk.activeAfterWait);
  check(lk.errors === 0, 'real context errors');

  console.log('  page errors: ' + JSON.stringify(pageErrors));
  check(pageErrors.length === 0, 'page errors');
  await b.close();
}

(async () => {
  nodePhase();
  try { await chromePhase(); } catch (e) { failures++; console.log('  FAIL: chrome phase crashed: ' + e.stack); }
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})();
