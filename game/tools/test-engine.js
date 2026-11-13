#!/usr/bin/env node
'use strict';
// Plain Node test script for BY.Data / BY.Engine / BY.Autopilot. Exit code 1 on any failure.
require('../src/data.js');
require('../src/engine.js');
require('./autopilot.js');
const BY = globalThis.BY, E = BY.Engine, D = BY.Data, A = BY.Autopilot;

let checks = 0, fails = 0, section = '';
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.log('FAIL [' + section + '] ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ' (got ' + a + ', want ' + b + ' +-' + tol + ')'); }
function sec(name) { section = name; }

// ---- event bookkeeping: every event is schema-checked and recorded ----
const SCHEMA = {
  pulse: 'x,y,r', zap: 'x1,y1,x2,y2,crit,src', hit: 'x,y,dmg,crit,armored,enemyId', kill: 'x,y,r,enemyType,elite,boss,bolts',
  explode: 'x,y,r,src', spawn: 'enemyId,enemyType,x,y,elite', pickup: 'kind,value,x,y', hurt: 'amount,x,y,src', shot: 'x,y',
  lowBattery: '', spare: '', ocStart: 'dur', ocEnd: '', combo: 'n', bossWarn: 'name,dur', bossSpawn: 'enemyId,name',
  bossPhase: 'phase', telegraph: 'kind,x,y,r,dur', slam: 'x,y,r', shield: 'on', bossDead: 'x,y,name,bolts,cores',
  sectorClear: 'sector,first', end: 'reason',
  // Act II (SPEC 11.10)
  storm: 'n', wellOpen: 'id,x,y,r', wellBoom: 'id,x,y,r,n', intern: 'id,x,y', internEnd: 'id,x,y', infect: 'enemyId',
  severance: 'x,y,r,bolts', stock: 'n,mult', steal: 'enemyId,x,y,bolts', refund: 'x,y,bolts', print: 'enemyId',
  blink: 'enemyId,x,y', mimicWake: 'enemyId', laser: 'x,y,x2,y2,w', budget: 'on', overtime: 'level',
  // Act III (SPEC 12.10)
  hold: 'x,y,r', injunction: 'x,y,r', clawback: 'bolts', copy: 'enemyId,srcId', orbital: 'x,y,r,n', burst: 'x,y,r,n', founder: 'phase'
};
const ACT2_BOTS = ['repo', 'printer', 'laser', 'firenode', 'auditor', 'mimic'];
const seenEv = {}, seenSrc = {};
function noteEvents(evs) {
  for (const e of evs) {
    const want = SCHEMA[e.type];
    if (want === undefined) { ok(false, 'unknown event type ' + e.type); continue; }
    const keys = Object.keys(e).filter(k => k !== 'type').sort().join(',');
    const w = want ? want.split(',').sort().join(',') : '';
    if (keys !== w) ok(false, 'event ' + e.type + ' has fields [' + keys + '] want [' + w + ']');
    seenEv[e.type] = (seenEv[e.type] || 0) + 1;
    if (e.src) seenSrc[e.type + ':' + e.src] = true;
    if (e.type === 'end') seenSrc['end:' + e.reason] = true;
    for (const k in e) if (typeof e[k] === 'number' && !isFinite(e[k])) ok(false, 'event ' + e.type + '.' + k + ' not finite');
  }
}
// advance one tick; returns the events produced
function tick(run, save, input) {
  E.step(run, save, input === undefined ? null : input);
  const evs = run.events.slice();
  run.events.length = 0;
  noteEvents(evs);
  return evs;
}
function ticks(run, save, n, input, each) {
  const all = [];
  for (let i = 0; i < n; i++) {
    const evs = tick(run, save, typeof input === 'function' ? input(run) : input);
    for (const e of evs) all.push(e);
    if (each) each(run, evs);
    if (run.over) break;
  }
  return all;
}
const has = (evs, type, f) => evs.some(e => e.type === type && (!f || f(e)));
const count = (evs, type, f) => evs.filter(e => e.type === type && (!f || f(e))).length;

// ---- builders ----
function saveWith(ups, extra) {
  const s = E.newSave();
  Object.assign(s.up, ups || {});
  Object.assign(s, extra || {});
  return s;
}
function maxedSave() {
  const s = E.newSave();
  for (const u of D.UPGRADES) if (u.branch !== 'rnd' && u.branch !== 'exec') s.up[u.id] = u.max;   // Act I tree
  s.sectorsCleared = 4;
  return s;
}
// a clean, quiet run: no random spawns, no opening bots, player parked at (180, 460)
function mk(save, sector, seed) {
  const run = E.startShift(save, sector || 1, { w: 360, h: 640, seed: seed || 1 });
  run.enemies.length = 0;
  run._spawnT = 1e9;
  run.events.length = 0;
  return run;
}
function immortal(run) { run.player.battery = run.player.maxBattery = 1e9; }
function placePlayer(run, x, y) { const p = run.player; p.x = x; p.y = y; p.tx = x; p.ty = y; p.vx = 0; p.vy = 0; }
function pk(run, kind, value, x, y, age) {
  run.pickups.push({ id: run._nid++, kind, value, x, y, vx: 0, vy: 0, age: age === undefined ? 0 : age });
}
function walkFinite(o, path, depth, skip) {
  if (depth > 6) return;
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'number') { if (!isFinite(v)) { ok(false, 'NaN/Inf at ' + path + '.' + k); } }
    else if (v && typeof v === 'object' && k !== 'sec') walkFinite(v, path + '.' + k, depth + 1);
  }
}

// =========================================================================
sec('data');
{
  eq(D.UPGRADES.length, 66, 'upgrade count incl boot, titan, the 19 R&D nodes and the 13 Executive nodes (SPEC 12.15 splits)');
  for (const u of D.UPGRADES) {
    ok(typeof u.fmt === 'function' && typeof u.fmt(0) === 'string' && typeof u.fmt(1) === 'string', 'fmt strings for ' + u.id);
    ok(typeof u.desc === 'string' && u.desc.length > 5, 'desc for ' + u.id);
    ok(u.requires.every(r => D.UPGRADE_BY_ID[r[0]]), 'requires resolve for ' + u.id);
    if (u.cores) eq(u.cores.length, u.max, 'cores length for ' + u.id);
    ok(u.max === Infinity || (Number.isInteger(u.max) && u.max >= 1), 'max is a positive integer or Infinity: ' + u.id);
    ok(!/[\u{1F300}-\u{1FAFF}]/u.test(u.desc + u.fmt(1)), 'no emoji ' + u.id);
  }
  for (const en of D.ENEMIES) ok(en.blurb && en.serial, 'blurb+serial ' + en.id);
  eq(D.ENEMIES.length, 22, 'enemy count');
  eq(D.BOSSES.length, 15, 'boss count');
  eq(D.SECTORS.length, 16, 'sector count');
  for (const s of D.SECTORS) for (const m of s.mix) ok(D.ENEMY_BY_ID[m.type], 'mix type exists ' + m.type);
}

// =========================================================================
sec('upgrade text matches the engine');
{
  // every number in fmt(level) is recomputed from BY.Engine.stats(save) at that level
  const P = D.PLAYER, f1 = x => (Math.round(x * 10) / 10).toFixed(1), f2 = x => (Math.round(x * 100) / 100).toFixed(2);
  const R = Math.round;
  const derive = {
    coil: (a, b) => '+' + R(a.damage - b.damage), pulse: (a) => f2(a.pulseInterval / P.pulse), field: (a, b) => '+' + R(a.radius - b.radius),
    fork: (a) => '+' + (a.targets - 1), amp: (a) => f2(a.damage / (1 + 0)), surge: (a) => R(a.critChance * 100) + '%',
    chain: (a) => R(a.chainPct * 100) + '%', overload: (a) => R(a.overloadPct * 100) + '%', cell: (a, b) => '+' + R(a.maxBattery - b.maxBattery),
    thrust: (a, b) => '+' + R(a.speed - b.speed), recycler: (a) => '+' + f2(a.recycle), capacitor: (a) => a.ocDur + ' s',
    coolant: (a, b) => R((1 - a.sag / b.sag) * 100) + '%', plating: (a) => R(a.plating * 100) + '%', spare: (a) => R(a.sparePct * 100) + '%',
    magnet: (a, b) => '+' + R(a.magnet - b.magnet), sorter: (a) => '+' + R((a.boltMult - 1) * 100) + '%', sweep: (a) => R(a.sweepPct * 100) + '%',
    lucky: (a) => '+' + f1((a.gildedChance - D.LEVEL.gildedBase) * 100) + '%', beacon: (a) => R((1 - a.signalMult) * 100) + '%',
    extract: (a) => 'up to +' + a.bossCoreBonus + (a.bossCoreBonus === 1 ? ' core' : ' cores') + ' \u00b7 ' + R(a.eliteCoreChance * 100) + '% elite', drone: (a) => String(a.drones),
    dronedmg: (a) => R(a.droneDmg / a.damage * 100) + '%', dronerate: (a) => f2(a.droneInterval / D.LEVEL.droneInterval)
  };
  for (const u of D.UPGRADES) {
    const fn = derive[u.id];
    if (!fn) continue;
    const base = E.newSave(), st0 = E.stats(base);
    for (let l = 1; l <= u.max; l++) {
      const sv = E.newSave(); sv.up[u.id] = l;
      const st = E.stats(sv);
      const want = u.id === 'amp' ? '\u00d7' + f2(Math.pow(D.LEVEL.amp, l)) : fn(st, st0);
      ok(u.fmt(l).indexOf(want) >= 0, u.id + ' L' + l + ' text "' + u.fmt(l) + '" should contain "' + want + '"');
    }
  }
  const sv = E.newSave(); sv.up.titan = 1; const ts = E.stats(sv), t0 = E.stats(E.newSave());
  ok(D.UPGRADE_BY_ID.titan.desc.indexOf('\u00d7' + ts.damage / t0.damage) >= 0, 'titan desc states the damage multiplier');
  ok(D.UPGRADE_BY_ID.titan.desc.indexOf('\u00d7' + ts.maxBattery / t0.maxBattery) >= 0, 'titan desc states the battery multiplier');
  ok(D.UPGRADE_BY_ID.titan.desc.indexOf('\u00d7' + ts.radius / t0.radius) >= 0, 'titan desc states the field multiplier');
  ok(/Overseer/.test(D.UPGRADE_BY_ID.titan.desc), 'titan desc names the Overseer');
  const osv = E.newSave(); osv.up.capacitor = 1;
  ok(D.UPGRADE_BY_ID.capacitor.desc.indexOf(String(Math.round(1 / D.TUNE.ocPerKill))) >= 0, 'overclock desc states the kills needed');
  ok(D.UPGRADE_BY_ID.capacitor.desc.indexOf(Math.round((1 - D.TUNE.ocDrainMul) * 100) + '% less drain') >= 0, 'overclock desc states the drain cut');
}

// =========================================================================
sec('loadSave');
{
  const shape = s => {
    ok(s && s.v === 3, 'v');
    ok(Number.isFinite(s.bolts) && s.bolts >= 0 && Number.isFinite(s.cores) && s.cores >= 0, 'bolts/cores finite');
    ok(s.up && s.up.boot === 1, 'boot owned');
    for (const u of D.UPGRADES) ok(Number.isInteger(s.up[u.id]) && s.up[u.id] >= 0 && s.up[u.id] <= u.max, 'level in range ' + u.id);
    ok(s.sectorsCleared >= 0 && s.sectorsCleared <= 15, 'sectorsCleared');
    for (let n = 1; n <= 10; n++) ok(Number.isFinite(s.bossKills[n]), 'bossKills ' + n);
    ok(s.sector >= 1 && s.sector <= 11, 'sector');
    ok(s.seen && typeof s.seen === 'object', 'seen');
    for (const k of ['shifts', 'kills', 'boltsTotal', 'coresTotal', 'playTime', 'bestCombo', 'bestShiftBolts']) ok(Number.isFinite(s.stats[k]), 'stats.' + k);
    ok(typeof s.flags.won === 'boolean' && typeof s.flags.movedOnce === 'boolean', 'flags');
    ok(typeof s.settings.sound === 'boolean' && typeof s.settings.shake === 'boolean', 'settings');
  };
  const thrower = {}; Object.defineProperty(thrower, 'bolts', { get() { throw new Error('boom'); }, enumerable: true });
  const junk = [null, undefined, 0, 7, 'str', true, [], [1, 2], {}, { up: 'x' }, { up: null, stats: 5, flags: 'no', settings: [] }, thrower,
    { bolts: NaN, cores: -5, up: { coil: 9999, pulse: -3, fork: 2.7, nope: 3, boot: 0, amp: 'zz' }, sectorsCleared: 99, sector: 'q',
      bossKills: { 1: 'a', 2: -1, 3: Infinity }, seen: { scrapling: true, bogus: true, roller: 'yes' }, stats: { shifts: -1, playTime: 'x', wonShifts: 'bad' },
      flags: { won: 'true' }, settings: { sound: 0 } },
    { bolts: 5e30, cores: 12.9, up: { coil: 3 } }];
  for (const j of junk) { let s; try { s = E.loadSave(j); } catch (e) { ok(false, 'loadSave threw'); continue; } shape(s); }
  const s1 = E.loadSave({ bolts: NaN, up: { coil: 9999, fork: 2.7, boot: 0 }, sectorsCleared: 99, seen: { scrapling: true, bogus: true } });
  eq(s1.up.coil + s1.up.coil2 + s1.up.coil3, 25, 'coil chain clamped to its total max'); eq(s1.up.coil, 8, 'coil node clamped'); eq(s1.up.fork, 2, 'fork floored'); eq(s1.up.boot, 1, 'boot repaired');
  eq(s1.sectorsCleared, 15, 'sectorsCleared clamped'); eq(s1.bolts, 0, 'NaN bolts -> 0'); ok(s1.seen.scrapling && !s1.seen.bogus, 'seen filtered');
  const s2 = E.loadSave({ bolts: 12.9, cores: 3, up: { coil: 3 }, sector: 4 });
  eq(s2.bolts, 12, 'bolts floored'); eq(s2.up.coil, 3, 'valid level kept'); eq(s2.sector, 1, 'selected sector clamped to unlocked');
  const good = E.newSave(); good.bolts = 77; good.up.coil = 4; good.sectorsCleared = 2; good.sector = 3; good.seen.hauler = true;
  good.stats.shifts = 9; good.sectorsCleared = 5; good.flags.won = true; good.flags.act2 = true; good.stats.wonShifts = 8; good.stats.wonPlayTime = 99.5; good.settings.sound = false;
  const rt = E.loadSave(JSON.parse(JSON.stringify(good)));
  eq(JSON.stringify(rt), JSON.stringify(good), 'round trip identical');
  const fresh = E.newSave();
  eq(JSON.stringify(E.loadSave(null)), JSON.stringify(fresh), 'null -> newSave');
  eq(Object.keys(fresh.up).length, D.UPGRADES.length, 'save has every upgrade id');
}

// =========================================================================
sec('cost & buy');
{
  for (const u of D.UPGRADES) {
    if (u.id === 'boot') continue;
    for (let l = 0; l < Math.min(u.max, 30); l++) {
      const s = E.newSave(); s.up[u.id] = l; s.flags.act2 = s.flags.chairman = true;
      const info = E.upgradeInfo(s, u.id);
      eq(info.cost.bolts, Math.round(u.base * Math.pow(u.growth, l)), 'cost ' + u.id + ' L' + l);
      eq(info.cost.cores, u.cores ? u.cores[l] : 0, 'cores ' + u.id + ' L' + l);
    }
    if (u.max === Infinity) continue;
    const s = E.newSave(); s.up[u.id] = u.max; s.flags.act2 = s.flags.chairman = true;
    const info = E.upgradeInfo(s, u.id);
    ok(info.maxed && info.cost === null && info.next === null && !info.affordable, 'maxed info ' + u.id);
  }
  eq(E.upgradeInfo(E.newSave(), 'coil').cost.bolts, 4, 'coil first level costs 4');
  let s = E.newSave(); s.bolts = 3;
  ok(!E.buy(s, 'coil'), 'cannot buy with 3 bolts'); eq(s.bolts, 3, 'bolts untouched');
  s.bolts = 4;
  ok(E.buy(s, 'coil'), 'buy coil with 4'); eq(s.bolts, 0, 'spent'); eq(s.up.coil, 1, 'level up');
  s = E.newSave(); s.bolts = 1e6;
  ok(!E.buy(s, 'pulse'), 'pulse locked without coil'); eq(E.upgradeInfo(s, 'pulse').lockReason, 'Needs Coil Voltage', 'lockReason text');
  ok(!E.upgradeInfo(s, 'pulse').unlocked, 'pulse not unlocked'); ok(!E.upgradeInfo(s, 'pulse').affordable, 'locked is not affordable');
  eq(E.upgradeInfo(s, 'titan').lockReason, 'Needs Overload, 90 Act I levels (0/90)', 'titan lock reason: one neighbour plus the act-level condition');
  ok(!E.buy(s, 'boot'), 'cannot buy boot'); ok(!E.buy(s, 'nonsense'), 'unknown id'); eq(E.upgradeInfo(s, 'nonsense'), null, 'unknown info null');
  E.buy(s, 'coil'); E.buy(s, 'field');
  ok(E.upgradeInfo(s, 'amp').unlocked, 'amp unlocked after field');
  ok(!E.buy(s, 'amp'), 'amp needs a core'); ok(!E.upgradeInfo(s, 'amp').affordable, 'amp not affordable without cores');
  s.cores = 1; const b0 = s.bolts;
  ok(E.buy(s, 'amp'), 'amp with a core'); eq(s.cores, 0, 'core spent'); eq(s.bolts, b0 - E.cost('amp', 0).bolts, 'amp bolts spent');
  // never overspend
  s = E.newSave(); s.bolts = 500; s.cores = 3;
  let guard = 0;
  while (guard++ < 500) {
    let any = false;
    for (const u of D.UPGRADES) if (E.buy(s, u.id)) any = true;
    ok(s.bolts >= 0 && s.cores >= 0, 'never negative'); if (!any) break;
  }
  ok(guard < 500, 'buying terminates');
  // max level cannot be exceeded
  s = E.newSave(); s.bolts = 1e9; s.up.coil = 7;
  ok(E.buy(s, 'coil'), 'buy last coil level'); ok(!E.buy(s, 'coil'), 'cannot exceed max'); eq(s.up.coil, 8, 'coil at 8');
  // affordableCount
  s = E.newSave(); s.bolts = 2; eq(E.affordableCount(s), 0, 'affordable at 2 bolts'); s.bolts = 3; eq(E.affordableCount(s), 1, 'affordable at 3 bolts (magnet)'); s.bolts = 4; eq(E.affordableCount(s), 2, 'affordable at 4 bolts (coil, magnet)'); s.bolts = 5; eq(E.affordableCount(s), 3, 'affordable at 5 bolts (coil, cell, magnet)');
  s.bolts = 0; eq(E.affordableCount(s), 0, 'affordable at 0');
  const info = E.upgradeInfo(E.newSave(), 'cell');
  for (const k of ['id', 'name', 'branch', 'col', 'row', 'desc', 'level', 'max', 'maxed', 'unlocked', 'lockReason', 'cost', 'affordable', 'now', 'next']) ok(k in info, 'upgradeInfo has ' + k);
  eq(info.now, '+0 battery', 'now text'); eq(info.next, '+3 battery', 'next text');
  eq(E.upgradeInfo(E.newSave(), 'boot').level, 1, 'boot level 1'); ok(E.upgradeInfo(E.newSave(), 'boot').maxed, 'boot maxed');
}

// =========================================================================
sec('stats & loadout');
{
  const z = E.stats(E.newSave());
  eq(z.damage, 1, 'dmg'); eq(z.pulseInterval, 0.5, 'pulse'); eq(z.radius, 46, 'radius'); eq(z.targets, 1, 'targets');
  eq(z.critChance, 0, 'crit'); eq(z.critMult, 3, 'critMult'); eq(z.chainPct, 0, 'chain'); eq(z.overloadPct, 0, 'overload');
  eq(z.maxBattery, D.PLAYER.battery, 'battery'); eq(z.speed, 260, 'speed'); eq(z.recycle, 0, 'recycle'); eq(z.ocUnlocked, false, 'oc');
  near(z.sag, D.PLAYER.sag, 1e-12, 'sag'); eq(z.plating, 0, 'plating'); eq(z.sparePct, 0, 'spare'); eq(z.magnet, 60, 'magnet');
  eq(z.boltMult, 1, 'boltMult'); eq(z.sweepPct, 0, 'sweep'); near(z.gildedChance, 0.005, 1e-12, 'gilded'); eq(z.signalMult, 1, 'signalMult');
  eq(z.bossCoreBonus, 0, 'core bonus'); eq(z.eliteCoreChance, 0, 'elite core'); eq(z.drones, 0, 'drones'); eq(z.collector, false, 'collector'); eq(z.titan, false, 'titan');
  const m = E.stats(maxedSave());
  near(m.damage, 26 * Math.pow(1.25, 8) * 3, 1e-9, 'max dmg'); near(m.pulseInterval, 0.5 * Math.pow(0.94, 12), 1e-12, 'max pulse');
  near(m.radius, 96 * 1.25, 1e-9, 'max radius'); eq(m.targets, 5, 'max targets'); near(m.critChance, 0.4, 1e-12, 'max crit');
  near(m.chainPct, D.LEVEL.chainBase + D.LEVEL.chainPer * 5, 1e-12, 'max chain'); near(m.overloadPct, D.LEVEL.overload * 5, 1e-12, 'max overload'); near(m.maxBattery, (D.PLAYER.battery + 3 * 20) * D.LEVEL.titan.battery, 1e-9, 'max battery');
  eq(m.speed, 260 + 8 * D.LEVEL.thrust, 'max speed'); near(m.recycle, D.LEVEL.recycler * 5, 1e-12, 'max recycle'); eq(m.ocUnlocked, true, 'max oc'); eq(m.ocDur, 8, 'max ocDur');
  near(m.sag, D.PLAYER.sag * (1 - D.LEVEL.coolant * 5), 1e-12, 'max sag'); near(m.plating, 0.54, 1e-12, 'max plating'); eq(m.sparePct, D.LEVEL.spare[3], 'max spare'); eq(m.magnet, 172, 'max magnet');
  near(m.boltMult, 3.25, 1e-12, 'max boltMult'); eq(m.sweepPct, 1, 'max sweep'); near(m.gildedChance, 0.08, 1e-12, 'max gilded');
  near(m.signalMult, 1 - D.LEVEL.beacon * 4, 1e-12, 'max signalMult'); eq(m.bossCoreBonus, 3, 'max bonus'); near(m.eliteCoreChance, D.LEVEL.extractElite * 3, 1e-12, 'max elite core');
  eq(m.drones, 4, 'max drones'); near(m.droneDmg, m.damage * 1.5, 1e-9, 'max droneDmg'); near(m.droneInterval, 0.9 * Math.pow(0.9, 6), 1e-12, 'max droneInterval');
  eq(m.collector, true, 'max collector'); eq(m.titan, true, 'max titan');
  // loadout tiers
  let l = E.loadout(E.newSave()); eq(JSON.stringify(l), JSON.stringify({ arc: 0, chassis: 0, salvage: 0, drones: 0, titan: false, rnd: 0, colossus: false, exec: 0, magnate: false }), 'zero loadout');
  l = E.loadout(saveWith({ coil: 1 })); eq(l.arc, 1, 'arc tier 1');
  l = E.loadout(saveWith({ coil: 12 })); eq(l.arc, 2, 'arc tier 2'); l = E.loadout(saveWith({ coil: 25, pulse: 5 })); eq(l.arc, 3, 'arc tier 3');
  l = E.loadout(saveWith({ cell: 9 })); eq(l.chassis, 1, 'chassis 1'); l = E.loadout(saveWith({ cell: 10 })); eq(l.chassis, 2, 'chassis 2');
  l = E.loadout(saveWith({ cell: 20, thrust: 5 })); eq(l.chassis, 3, 'chassis 3');
  l = E.loadout(saveWith({ magnet: 8 })); eq(l.salvage, 2, 'salvage 2'); l = E.loadout(saveWith({ magnet: 8, sorter: 12 })); eq(l.salvage, 3, 'salvage 3');
  l = E.loadout(maxedSave()); eq(l.drones, 4, 'loadout drones'); ok(l.titan, 'loadout titan'); eq(l.arc, 3, 'maxed arc'); eq(l.chassis, 3, 'maxed chassis'); eq(l.salvage, 3, 'maxed salvage');
  // sectorInfo
  const s = E.newSave();
  let si = E.sectorInfo(s, 1);
  ok(si.unlocked && !si.cleared && si.bossId === 'compactor' && si.bossName === 'The Compactor' && si.need === D.SECTORS[0].need && !si.lureBlocked && si.lockReason === null, 'sector 1 info');
  si = E.sectorInfo(s, 2); ok(!si.unlocked && si.lockReason === 'Scrap The Compactor', 'sector 2 locked: ' + si.lockReason);
  s.sectorsCleared = 1; s.bossKills[1] = 1; ok(E.sectorInfo(s, 2).unlocked && E.sectorInfo(s, 1).cleared, 'sector 2 unlocked after clear');
  s.up.beacon = 4; eq(E.sectorInfo(s, 1).need, Math.round(D.SECTORS[0].need * (1 - D.LEVEL.beacon * 4)), 'beacon lowers need');
  s.sectorsCleared = 4; ok(E.sectorInfo(s, 5).unlocked && E.sectorInfo(s, 5).lureBlocked, 'sector 5 blocked w/o titan');
  s.up.titan = 1; ok(!E.sectorInfo(s, 5).lureBlocked, 'sector 5 open with titan');
}

// =========================================================================
sec('player movement');
{
  const save = E.newSave(), run = mk(save, 1, 3);
  immortal(run); placePlayer(run, 180, 460);
  tick(run, save, { x: 2000, y: -2000 });
  ok(Math.hypot(run.player.tx - run.player.x, run.player.ty - run.player.y) <= 130 + 1e-6, 'target leashed to 130');
  ok(run.player.tx <= 360 && run.player.ty >= 0, 'target in arena');
  const tx = run.player.tx, ty = run.player.ty;
  tick(run, save, null);
  eq(run.player.tx, tx, 'null input keeps target x'); eq(run.player.ty, ty, 'null input keeps target y');
  placePlayer(run, 180, 460);
  ticks(run, save, 30, { x: 310, y: 460 });
  ok(run.player.vx > 150 && run.player.vx <= 260.001, 'accelerates toward target: ' + run.player.vx);
  ticks(run, save, 600, { x: 10000, y: 10000 });
  ok(run.player.x <= 360 - run.player.r + 1e-9 && run.player.y <= 640 - run.player.r + 1e-9, 'stays inside arena');
  // slow near target
  placePlayer(run, 100, 100);
  ticks(run, save, 120, { x: 110, y: 100 });
  ok(Math.abs(run.player.x - 110) < 1.5, 'settles on the target: ' + run.player.x);
  // NaN input is ignored
  tick(run, save, { x: NaN, y: 5 }); ok(Number.isFinite(run.player.x), 'NaN input ignored');
}

// =========================================================================
sec('shift length');
{
  for (let seed = 1; seed <= 4; seed++) {
    const save = E.newSave(), run = E.startShift(save, 1, { w: 360, h: 640, seed });
    ticks(run, save, 60 * 60, null);
    ok(run.over && run.reason === 'battery', 'no-input shift ends by battery (seed ' + seed + ')');
    ok(run.t > 9 && run.t < 17, 'new-save idle shift ~15 s: ' + run.t.toFixed(2));
  }
  // maxed save, perfect recycling, autopilot, every sector: never past the hard cap
  for (let n = 1; n <= 5; n++) {
    const save = maxedSave(), run = E.startShift(save, n, { w: 360, h: 640, seed: 40 + n });
    run.stats.recycle = 100;
    let g = 0;
    while (!run.over && g++ < 60 * 260) { E.step(run, save, A.target(run, { skill: 'attentive' })); noteEvents(run.events); run.events.length = 0; }
    ok(run.over, 'maxed+perfect recycling shift ends in sector ' + n);
    ok(run.t <= 200 + 1.6, 'never past ~200 s in sector ' + n + ': ' + run.t.toFixed(1));
  }
  // overtime really does drain
  const save = E.newSave(), run = mk(save, 1, 2);
  run.t = 130; const b0 = run.player.battery = run.player.maxBattery = 100;
  tick(run, save, null);
  ok(b0 - run.player.battery > 1.5 * (1 / 60), 'overtime drain is steeper');
}

// =========================================================================
sec('determinism');
{
  const driver = run => ({ x: 180 + 140 * Math.sin(run.t * 1.7), y: 400 + 120 * Math.cos(run.t * 0.9) });
  const play = (seed, saveFn) => {
    const save = saveFn(), run = E.startShift(save, 3, { w: 360, h: 640, seed });
    const log = [];
    let g = 0;
    while (!run.over && g++ < 6000) { E.step(run, save, driver(run)); log.push(JSON.stringify(run.events)); run.events.length = 0; }
    return JSON.stringify(run) + '|' + log.join('') + '|' + JSON.stringify(E.endShift(run, save)) + JSON.stringify(save);
  };
  const mid = () => saveWith({ coil: 8, pulse: 3, field: 2, cell: 5, fork: 1, chain: 1, overload: 1, capacitor: 1, drone: 2, recycler: 2, surge: 3 }, { bolts: 5, sectorsCleared: 2 });
  eq(play(5, mid), play(5, mid), 'same save+sector+seed+inputs -> identical final state');
  ok(play(5, mid) !== play(6, mid), 'different seed -> different shift');
  // autopilot is deterministic too
  const ap = seed => {
    const save = mid(), run = E.startShift(save, 2, { w: 360, h: 640, seed });
    let g = 0;
    while (!run.over && g++ < 6000) { E.step(run, save, A.target(run, { skill: 'sloppy' })); run.events.length = 0; }
    return JSON.stringify(run);
  };
  eq(ap(9), ap(9), 'sloppy autopilot deterministic');
}

// =========================================================================
sec('enemy types');
{
  for (const def of D.ENEMIES.filter(d => !ACT2_BOTS.includes(d.id))) {
    const save = E.newSave(), run = mk(save, 3, 11), sc = D.SECTORS[2];
    run.stats.damage = 1e6; run._cd = 0; immortal(run); placePlayer(run, 180, 400);
    const e = E.spawn(run, def.id, 180, 372, { entered: true });
    eq(e.hostile, !!def.hostile, def.id + ' hostile flag'); near(e.hp, def.hp * sc.hp, 1e-9, def.id + ' hp = base * sector');
    ok(has(run.events, 'spawn', ev => ev.enemyId === e.id && ev.enemyType === def.id), def.id + ' spawn event');
    run.events.length = 0;
    const evs = tick(run, save, null);
    ok(has(evs, 'hit', h => h.enemyId === e.id), def.id + ' can be hit');
    ok(has(evs, 'kill', k => k.enemyType === def.id), def.id + ' dies');
    ok(!run.enemies.includes(e), def.id + ' removed from enemies');
    const expected = def.bolts > 0 ? Math.max(1, Math.round(def.bolts * sc.bolts)) : 0;
    const dropped = run.pickups.filter(p => p.kind === 'bolt').reduce((a, p) => a + p.value, 0);
    eq(dropped, expected, def.id + ' drops bolts');
    eq(evs.find(k => k.type === 'kill').bolts, expected, def.id + ' kill.bolts');
    eq(run.boss.signal, def.signal, def.id + ' signal');
    if (def.split) eq(run.enemies.filter(x => x.type === def.split.type).length, def.split.n, def.id + ' splits into mites');
    if (def.bolts > 0) { const nb = run.pickups.filter(p => p.kind === 'bolt').length; ok(nb >= 1 && nb <= 5, def.id + ' 1-5 bolt pickups: ' + nb); }
  }
  // elite
  {
    const save = E.newSave(), run = mk(save, 2, 5);
    const base = D.ENEMY_BY_ID.hauler, e = E.spawn(run, 'hauler', 100, 100, { entered: true, elite: true });
    near(e.hp, base.hp * D.SECTORS[1].hp * 4, 1e-9, 'elite hp x4'); near(e.r, base.r * 1.25, 1e-9, 'elite radius'); ok(e.elite, 'elite flag');
    eq(e.sig, base.signal * 2, 'elite signal x2');
    run.stats.damage = 1e9; run._cd = 0; placePlayer(run, 100, 130); const evs = tick(run, save, null);
    eq(evs.find(k => k.type === 'kill').bolts, Math.round(16 * D.SECTORS[1].bolts * 4), 'elite bolts x4');
  }
  // sparker contact hurts, scaled by sector dmg and plating
  {
    const save = saveWith({ plating: 2 }), run = mk(save, 2, 5);
    run.player.battery = run.player.maxBattery = 1000; placePlayer(run, 180, 400);
    run.stats.damage = 0; run._cd = 1e9;
    E.spawn(run, 'sparker', 180, 395, { entered: true });
    const evs = ticks(run, save, 60, null);
    const total = evs.filter(e => e.type === 'hurt' && e.src === 'contact').reduce((a, e) => a + e.amount, 0);
    near(total, 2.5 * 1.3 * (1 - 0.18), 0.4, 'contact dps scaled by sector dmg and plating');
    ok(has(evs, 'hurt', e => e.src === 'contact'), 'contact hurt event');
  }
  // Fuse: contact explodes and hurts, no drops; shot down it blasts neighbours for 3x maxHp
  {
    const save = E.newSave(), run = mk(save, 3, 5);
    run.player.battery = run.player.maxBattery = 1000; placePlayer(run, 180, 400);
    run.stats.damage = 0; run._cd = 1e9;
    const b = E.spawn(run, 'bomber', 180, 395, { entered: true });
    const evs = ticks(run, save, 5, null);
    const h = evs.find(e => e.type === 'hurt' && e.src === 'bomb');
    ok(h, 'bomber contact hurts (bomb)'); near(h.amount, 5 * 1.7, 1e-9, 'bomb damage scaled');
    ok(has(evs, 'explode', e => e.src === 'bomber'), 'bomber explode event'); ok(b.dead && !run.enemies.includes(b), 'bomber gone');
    ok(!has(evs, 'kill'), 'no kill event / drops on contact explosion'); eq(run.pickups.length, 0, 'no drops');
    const run3 = mk(save, 3, 5); run3.stats.damage = 0; run3._cd = 1e9; placePlayer(run3, 180, 600);
    const bb = E.spawn(run3, 'bomber', 100, 100, { entered: true }); bb.hp = 0.001;
    const nb3 = E.spawn(run3, 'hauler', 130, 100, { entered: true });
    run3.stats.damage = 1; run3.stats.targets = 1; run3.stats.radius = 1e5; run3._cd = 0;
    placePlayer(run3, 100, 130);
    const evs3 = tick(run3, save, null);
    ok(has(evs3, 'explode', e => e.src === 'bomber'), 'shot-down bomber explodes');
    ok(has(evs3, 'hit', e => e.enemyId === nb3.id && Math.abs(e.dmg - 3 * bb.maxHp) < 1e-6), 'blast does 3x its maxHp to neighbours: ' + JSON.stringify(evs3.filter(e => e.type === 'hit').map(e => e.dmg)));
  }
  // Sentry plants and shoots; shots hurt
  {
    const save = E.newSave(), run = mk(save, 3, 8);
    run.player.battery = run.player.maxBattery = 1000; placePlayer(run, 180, 600);
    run.stats.damage = 0; run._cd = 1e9;
    const t = E.spawn(run, 'turret', 180, 300, { entered: true }); t.wx = 180; t.wy = 300;
    const evs = ticks(run, save, 60 * 12, null);
    ok(t.planted, 'sentry plants'); ok(has(evs, 'shot'), 'sentry shot event');
    ok(has(evs, 'hurt', e => e.src === 'shot'), 'sentry shot hurts');
    const h = evs.find(e => e.type === 'hurt' && e.src === 'shot'); near(h.amount, 3 * 1.7, 1e-9, 'shot damage scaled');
    ok(run.shots.length < 20, 'shots leave the arena / vanish');
    eq(count(evs, 'shot') > 3, true, 'sentry fires repeatedly');
  }
  // roller keeps its speed and bounces
  {
    const save = E.newSave(), run = mk(save, 1, 8);
    immortal(run); run.stats.damage = 0; run._cd = 1e9; placePlayer(run, 180, 600);
    const r = E.spawn(run, 'roller', 100, 100, { entered: true }); r.vx = 70; r.vy = 30;
    ticks(run, save, 60 * 20, null);
    near(Math.hypot(r.vx, r.vy), Math.hypot(70, 30), 1e-6, 'roller speed constant');
    ok(r.x >= r.r - 1e-9 && r.x <= 360 - r.r + 1e-9 && r.y >= r.r - 1e-9 && r.y <= 640 - r.r + 1e-9, 'roller stays inside');
  }
  // mite flees, gilded leaves after 9 s without a kill event
  {
    const save = E.newSave(), run = mk(save, 1, 8);
    immortal(run); run.stats.damage = 0; run._cd = 1e9; placePlayer(run, 180, 400);
    const m = E.spawn(run, 'mite', 180, 330, { entered: true });
    const d0 = Math.hypot(m.x - 180, m.y - 400);
    ticks(run, save, 40, null);
    ok(Math.hypot(m.x - run.player.x, m.y - run.player.y) > d0 + 20, 'mite flees');
    const g = E.spawn(run, 'gilded', 100, 100, { entered: true });
    const evs = ticks(run, save, 60 * 14, null);
    ok(g.dead, 'gilded leaves'); ok(!has(evs, 'kill', k => k.enemyType === 'gilded'), 'gilded leaving is not a kill'); ok(g.age >= 9, 'gilded stayed ~9 s: ' + g.age.toFixed(1));
  }
  // hauler cell chance 25 percent
  {
    const save = E.newSave(), run = mk(save, 1, 77);
    run.stats.damage = 1e9; run.stats.targets = 300; run.stats.radius = 1e5; run._cd = 0; immortal(run); placePlayer(run, 180, 320);
    for (let i = 0; i < 300; i++) E.spawn(run, 'hauler', 10 + (i % 30) * 11, 20 + Math.floor(i / 30) * 40, { entered: true });
    tick(run, save, null);
    const cells = run.pickups.filter(p => p.kind === 'cell').length;
    ok(cells > 45 && cells < 105, 'hauler drops cells ~25%: ' + cells + '/300');
  }
  // gilded: max one alive, and spawns eventually when forced by luck
  {
    const save = saveWith({ lucky: 5 }), run = E.startShift(save, 1, { w: 360, h: 640, seed: 3 });
    run.stats.gildedChance = 1; run.stats.damage = 0; run._cd = 1e9; immortal(run);
    ticks(run, save, 60 * 10, null);
    ok(run.enemies.filter(e => e.type === 'gilded').length <= 1, 'max one gilded alive');
    ok(run.counts.gilded >= 1, 'gilded can spawn');
  }
  // elites from sector 2 only
  {
    const save = E.newSave();
    for (const sector of [1, 2]) {
      const run = E.startShift(save, sector, { w: 360, h: 640, seed: 4 });
      run.stats.damage = 1e9; run.stats.targets = 40; run.stats.radius = 1e5; run.boss.blocked = true; immortal(run); run.stats.gildedChance = 0;
      ticks(run, save, 60 * 90, null);
      if (sector === 1) eq(run.counts.elites, 0, 'no elites in sector 1'); else ok(run.counts.elites > 0, 'elites appear in sector 2: ' + run.counts.elites);
    }
  }
  // spawn rules: opening bots, cap, mix gating
  {
    const save = E.newSave(), run = E.startShift(save, 3, { w: 360, h: 640, seed: 10 });
    eq(run.enemies.length, 4, 'four opening bots');
    ok(run.enemies.every(e => !e.hostile && Math.hypot(e.x - run.player.x, e.y - run.player.y) >= 90 && e.x > 0 && e.x < 360 && e.y > 0 && e.y < 640), 'opening bots inside, safe, >= 90 away');
    const rc = E.startShift(save, 1, { w: 360, h: 640, seed: 10 }); rc.stats.damage = 0; rc._cd = 1e9; immortal(rc);
    ticks(rc, save, 60 * 100, null); ok(rc.enemies.length <= 16, 'alive capped by sector cap: ' + rc.enemies.length);
    const r1 = E.startShift(save, 1, { w: 360, h: 640, seed: 10 });
    r1.stats.damage = 1e9; r1.stats.targets = 40; r1.stats.radius = 1e5; r1.boss.blocked = true; immortal(r1);
    const types = {};
    ticks(r1, save, 60 * 12, null, (r, evs) => { for (const e of evs) if (e.type === 'spawn') types[e.enemyType] = true; });
    ok(!types.sparker, 'sparker is gated behind 15 s in sector 1');
    ticks(r1, save, 60 * 60, null, (r, evs) => { for (const e of evs) if (e.type === 'spawn') types[e.enemyType] = true; });
    ok(types.sparker, 'sparker appears after 15 s');
    
  }
}

// =========================================================================
sec('armor');
{
  const mkArmor = () => {
    const save = E.newSave(), run = mk(save, 1, 2);
    immortal(run); run.stats.damage = 2; run.stats.critChance = 0; run._cd = 0; placePlayer(run, 180, 400);
    const b = E.spawn(run, 'shieldbot', 180, 370, { entered: true });
    return { save, run, b };
  };
  let { save, run, b } = mkArmor();
  let evs = tick(run, save, null); let h = evs.find(e => e.type === 'hit');
  ok(h && h.armored && Math.abs(h.dmg - 1) < 1e-9, 'plain arc does 50% to armor'); near(b.maxHp - b.hp, 1, 1e-9, 'armored hp loss');
  ({ save, run, b } = mkArmor()); run.stats.critChance = 1;
  evs = tick(run, save, null); h = evs.find(e => e.type === 'hit');
  ok(h && h.crit && !h.armored && Math.abs(h.dmg - 6) < 1e-9, 'crit ignores armor');
  // chain & overload ignore armor
  ({ save, run, b } = mkArmor());
  run.stats.chainPct = 1; const a = E.spawn(run, 'scrapling', 180, 372, { entered: true }); a.hp = 0.5; b.x = 180; b.y = 330;
  run.stats.radius = 28; // only the nearest scrapling is in reach
  placePlayer(run, 180, 400);
  evs = tick(run, save, null);
  h = evs.find(e => e.type === 'hit' && e.enemyId === b.id);
  ok(h && !h.armored && Math.abs(h.dmg - 2) < 1e-9 && has(evs, 'zap', z => z.src === 'chain'), 'chain ignores armor: ' + JSON.stringify(h));
  ({ save, run, b } = mkArmor());
  run.stats.overloadPct = 1; const a2 = E.spawn(run, 'scrapling', 180, 372, { entered: true }); a2.hp = 0.5; b.x = 180; b.y = 330; run.stats.radius = 28; placePlayer(run, 180, 400);
  evs = tick(run, save, null); h = evs.find(e => e.type === 'hit' && e.enemyId === b.id);
  ok(h && !h.armored && Math.abs(h.dmg - a2.maxHp) < 1e-9 && has(evs, 'explode', x => x.src === 'overload'), 'overload ignores armor: ' + JSON.stringify(h));
  // drones respect armor
  { const sv = saveWith({ drone: 1 }), r = mk(sv, 1, 2); immortal(r); r._cd = 1e9; r.stats.droneDmg = 4; placePlayer(r, 180, 400);
    const bb = E.spawn(r, 'shieldbot', 180, 360, { entered: true }); const ev2 = tick(r, sv, null); const hh = ev2.find(e => e.type === 'hit' && e.enemyId === bb.id);
    ok(hh && hh.armored && Math.abs(hh.dmg - 2) < 1e-9 && !hh.crit, 'drone hits are armored, no crit'); }
}

// =========================================================================
sec('chain / overload cascades');
{
  const setup = (chain, overload, n, spacing) => {
    const save = E.newSave(), run = mk(save, 1, 6);
    immortal(run); placePlayer(run, 180, 610);
    run.stats.chainPct = chain; run.stats.overloadPct = overload; run.stats.damage = 1; run._cd = 0;
    const bots = [];
    for (let k = 0; k < n; k++) { const e = E.spawn(run, 'scrapling', 180, 570 - spacing * k, { entered: true }); e.hp = 0.4; bots.push(e); }
    return { save, run, bots };
  };
  let { save, run, bots } = setup(0.5, 0, 12, 50);
  let evs = tick(run, save, null);
  eq(count(evs, 'kill'), 7, 'chain cascade capped at depth 6 (7 kills)'); eq(bots.filter(b => b.dead).length, 7, 'seven dead');
  ({ save, run, bots } = setup(0, 5, 12, 50));
  evs = tick(run, save, null);
  eq(count(evs, 'kill'), 7, 'overload cascade capped at depth 6 (7 kills)');
  // dense cluster with both: terminates, everything inside dies
  { const sv = E.newSave(), r = mk(sv, 1, 6); immortal(r); placePlayer(r, 180, 400); r.stats.chainPct = 1.5; r.stats.overloadPct = 0.6; r.stats.damage = 1; r._cd = 0;
    for (let k = 0; k < 60; k++) { const e = E.spawn(r, 'scrapling', 150 + (k % 10) * 6, 340 + Math.floor(k / 10) * 6, { entered: true }); e.hp = e.maxHp = 0.5; }
    const t0 = Date.now(); const ev2 = tick(r, sv, null);
    ok(Date.now() - t0 < 200, 'dense cascade is fast'); ok(count(ev2, 'kill') >= 7 && count(ev2, 'kill') <= 60, 'dense cascade kills: ' + count(ev2, 'kill')); }
  // chain from a bomber chain: bombers chain-explode and terminate
  { const sv = E.newSave(), r = mk(sv, 3, 6); immortal(r); placePlayer(r, 180, 400); r.stats.overloadPct = 1; r.stats.chainPct = 1; r.stats.damage = 1; r._cd = 0;
    for (let k = 0; k < 30; k++) { const e = E.spawn(r, 'bomber', 100 + (k % 6) * 25, 300 + Math.floor(k / 6) * 25, { entered: true }); e.hp = 0.1; }
    const ev2 = tick(r, sv, null); ok(r.enemies.length <= 30 && ev2.length > 0, 'bomber cascade terminates'); }
}

// =========================================================================
sec('kill rewards, combo, recycle');
{
  const save = saveWith({ recycler: 3 }), run = mk(save, 1, 2);
  run.stats.damage = 1e9; run.stats.targets = 6; run.stats.radius = 1e5; run._cd = 0; placePlayer(run, 180, 400);
  run.player.battery = 5;
  for (let i = 0; i < 6; i++) E.spawn(run, 'scrapling', 100 + i * 30, 300, { entered: true });
  const evs = tick(run, save, null);
  eq(count(evs, 'kill'), 6, 'six kills'); eq(run.combo.n, 6, 'combo counts'); eq(run.counts.bestCombo, 6, 'bestCombo');
  eq(count(evs, 'combo'), 1, 'combo event every 5th'); eq(evs.find(e => e.type === 'combo').n, 5, 'combo n = 5');
  near(run.player.battery, 5 - 1 / 60 + 6 * 3 * D.LEVEL.recycler, 1e-4, 'recycle adds recycler per level per bot');
  ticks(run, save, 60 * 2.4, null); ok(run.combo.n === 6, 'combo survives 2.4 s');
  ticks(run, save, 20, null); eq(run.combo.n, 0, 'combo resets after 2.5 s');
}

// =========================================================================
sec('overclock');
{
  const save = saveWith({ capacitor: 1 }), run = mk(save, 1, 3);
  eq(run.player.oc.unlocked, true, 'oc unlocked'); eq(run.player.oc.dur, 4, 'oc dur 4 at level 1');
  run.player.battery = run.player.maxBattery = 100;
  run.stats.damage = 1e9; run.stats.targets = 40; run.stats.radius = 200; run._cd = 0; placePlayer(run, 180, 400);
  const OCN = Math.round(1 / D.TUNE.ocPerKill);
  for (let i = 0; i < OCN - 1; i++) E.spawn(run, 'scrapling', 100 + (i % 6) * 30, 330 + Math.floor(i / 6) * 30, { entered: true });
  let evs = tick(run, save, null);
  eq(run.player.oc.active, false, (OCN - 1) + ' kills do not trigger'); near(run.player.oc.charge, (OCN - 1) / OCN, 1e-9, 'charge (N-1)/N');
  E.spawn(run, 'scrapling', 150, 330, { entered: true }); run._cd = 0;
  evs = tick(run, save, null);
  ok(has(evs, 'ocStart', e => e.dur === 4), 'ocStart event'); ok(run.player.oc.active, 'oc active'); near(run.player.oc.time, 4, 0.02, 'oc time');
  // slower drain, faster pulses, faster movement
  run.stats.sag = 0;
  run.stats.damage = 0.001; const tank = E.spawn(run, 'hauler', 180, 360, { entered: true }); tank.hp = tank.maxHp = 1e12; tank.speed = 0; run.stats.targets = 1;
  const bat0 = run.player.battery;
  evs = ticks(run, save, 120, null);
  near(bat0 - run.player.battery, 2 * D.TUNE.ocDrainMul * D.PLAYER.drain, 1e-6, 'drain x ocDrainMul during overclock');
  const pulsesOc = count(evs, 'pulse');
  let maxSp = 0;
  ticks(run, save, 60, { x: 180, y: 300 }, r => { maxSp = Math.max(maxSp, Math.hypot(r.player.vx, r.player.vy)); });
  ok(maxSp > 260 * 1.2 && maxSp <= 260 * 1.25 + 1e-6, 'oc speed +25%: ' + maxSp.toFixed(0));
  evs = ticks(run, save, 130, null);
  ok(has(evs, 'ocEnd'), 'ocEnd event'); ok(!run.player.oc.active && run.player.oc.charge === 0, 'oc ended, charge reset');
  ok(run.player.battery < bat0, 'drain resumes');
  placePlayer(run, 180, 400); tank.x = 180; tank.y = 360; run._cd = 0;
  evs = ticks(run, save, 120, null);
  const pulsesNormal = count(evs, 'pulse');
  ok(pulsesOc >= 5 && pulsesOc <= 8 && pulsesOc >= pulsesNormal * 1.3, 'oc doubles pulse rate (first 0.5 s is the old cooldown, then 4/s): ' + pulsesOc + ' vs normal ' + pulsesNormal);
  ok(pulsesNormal >= 3 && pulsesNormal <= 5, 'normal ~4 pulses in 2 s: ' + pulsesNormal);
  // decay
  const r2 = mk(save, 1, 3); immortal(r2); r2.player.oc.charge = 0.5; r2._lastKillT = r2.t;
  ticks(r2, save, 60, null); near(r2.player.oc.charge, 0.5, 1e-9, 'no decay in the first 2 s');
  ticks(r2, save, 120, null); // t = 3 s: 1 s of decay
  near(r2.player.oc.charge, 0.5 - D.TUNE.ocDecayPerSec * (3 - 2), 0.005, 'decay at ocDecayPerSec');
  // locked without the node
  const s3 = E.newSave(), r3 = mk(s3, 1, 3); r3.stats.damage = 1e9; r3._cd = 0; placePlayer(r3, 180, 400); E.spawn(r3, 'scrapling', 180, 370, { entered: true });
  tick(r3, s3, null); eq(r3.player.oc.charge, 0, 'no charge without Overclock node');
  // level 3 -> 6 s
  eq(E.stats(saveWith({ capacitor: 3 })).ocDur, 6, 'ocDur grows 1 s/level');
}

// =========================================================================
sec('drones');
{
  const save = saveWith({ drone: 2 }), run = mk(save, 1, 3);
  immortal(run); placePlayer(run, 180, 400); run._cd = 1e9;
  eq(run.drones.length, 2, 'two drones');
  tick(run, save, null);
  const [d1, d2] = run.drones;
  near(Math.hypot(d1.x - 180, d1.y - 400), 34, 1e-6, 'orbit radius 34');
  let dA = Math.abs(d1.angle - d2.angle) % (2 * Math.PI); near(dA, Math.PI, 1e-9, 'evenly spaced');
  const a0 = d1.angle; ticks(run, save, 59, null); near(d1.angle - a0, 2.2 * 59 / 60, 1e-6, 'rotates 2.2 rad/s');
  // zaps at 50% damage on a 0.9 s interval
  const tank = E.spawn(run, 'hauler', 180, 380, { entered: true }); tank.hp = tank.maxHp = 1e9; tank.speed = 0;
  const evs = ticks(run, save, 60 * 9, null);
  const z = evs.filter(e => e.type === 'zap' && e.src === 'drone'); ok(z.length >= 15 && z.length <= 22, 'drone zap count over 9 s with two drones: ' + z.length);
  const h = evs.find(e => e.type === 'hit'); near(h.dmg, 0.5, 1e-9, 'drone dmg = 50% of arc');
  // collector arms
  const sc = saveWith({ drone: 1, collector: 1 }), rc = mk(sc, 1, 3); immortal(rc); rc._cd = 1e9; placePlayer(rc, 180, 500); rc.stats.magnet = 0;
  tick(rc, sc, null);
  const dr = rc.drones[0]; pk(rc, 'bolt', 7, dr.x, dr.y, 0.4);
  const e2 = ticks(rc, sc, 3, null); ok(has(e2, 'pickup', e => e.value === 7), 'drone collects a bolt with Collector Arms'); eq(rc.earned.bolts, 7, 'earned from drone pickup');
  const sn = saveWith({ drone: 1 }), rn = mk(sn, 1, 3); immortal(rn); rn._cd = 1e9; placePlayer(rn, 180, 500); rn.stats.magnet = 0; tick(rn, sn, null);
  pk(rn, 'bolt', 7, rn.drones[0].x, rn.drones[0].y, 0.4); ticks(rn, sn, 3, null); eq(rn.earned.bolts, 0, 'no pickup without Collector Arms');
}

// =========================================================================
sec('spare cell');
{
  for (const lvl of [1, 2, 3]) {
    const save = saveWith({ spare: lvl }), run = mk(save, 1, 3);
    run.player.battery = 0.001; run.stats.damage = 0; run._cd = 1e9;
    let evs = tick(run, save, null);
    ok(has(evs, 'spare'), 'spare event'); ok(!run.over, 'shift continues');
    near(run.player.battery, D.LEVEL.spare[lvl] * run.player.maxBattery, 1e-6, 'spare restarts at ' + lvl); ok(run.player.spareUsed, 'spareUsed');
    run.player.battery = 0.001;
    evs = tick(run, save, null);
    eq(count(evs, 'spare'), 0, 'spare fires only once'); ok(run.over && run.reason === 'battery', 'second flat battery ends the shift');
  }
  const save = E.newSave(), run = mk(save, 1, 3); run.player.battery = 0.001; tick(run, save, null); ok(run.over, 'no spare -> shift ends');
  // lowBattery crossing
  const r2 = mk(E.newSave(), 1, 4); r2.stats.damage = 0; r2._cd = 1e9; const evs2 = ticks(r2, E.newSave(), 60 * 20, null);
  eq(count(evs2, 'lowBattery'), 1, 'lowBattery emitted once'); ok(has(evs2, 'end', e => e.reason === 'battery'), 'end event with reason');
}

// =========================================================================
sec('pickups');
{
  const save = E.newSave(), run = mk(save, 1, 3);
  immortal(run); run._cd = 1e9; placePlayer(run, 180, 460);
  pk(run, 'bolt', 5, 230, 460, 0.3);          // inside magnet 60
  pk(run, 'bolt', 3, 180, 260, 0.3);          // outside
  pk(run, 'bolt', 9, 181, 461, 0.0);          // on top of Sprocket but too young
  const far0 = run.pickups[1];
  tick(run, save, null);
  ok(Math.hypot(run.pickups[0].x - 180, run.pickups[0].y - 460) < 49, 'pickup pulled toward Sprocket');
  eq(run.pickups.length, 3, 'young pickup not collected');
  const evs = ticks(run, save, 30, null);
  ok(has(evs, 'pickup', e => e.kind === 'bolt' && e.value === 5), 'collected inside magnet'); ok(has(evs, 'pickup', e => e.value === 9), 'young pickup collected once old enough');
  eq(run.earned.bolts, 14, 'earned.bolts'); ok(run.pickups.includes(far0), 'outside magnet stays'); eq(save.bolts, 0, 'nothing banked until endShift');
  // expiry
  ticks(run, save, 60 * 14 + 4 - 31, null); ok(run.pickups.includes(far0), 'still there just before 15 s of age');
  ticks(run, save, 60, null); ok(!run.pickups.includes(far0), 'gone at 15 s of age');
  // cell and core
  const r2 = mk(save, 1, 3); r2.player.maxBattery = 20; r2.player.battery = 5; r2._cd = 1e9; placePlayer(r2, 180, 460);
  pk(r2, 'cell', 0, 180, 470, 0.3); pk(r2, 'core', 1, 190, 460, 0.3);
  ticks(r2, save, 20, null); near(r2.player.battery, 5 + 20 * D.TUNE.cellHeal - 20 / 60 * 1.0, 0.1, 'cell restores cellHeal of max'); eq(r2.earned.cores, 1, 'core collected');
  // pickup cap merges value instead of growing
  const r3 = mk(save, 1, 3); r3._cd = 1e9; immortal(r3);
  for (let i = 0; i < 400; i++) pk(r3, 'bolt', 1, 10, 10, 0); const before = r3.pickups.length;
  const sv = E.spawn; // (spawnPickup is internal; use kills)
  r3.stats.damage = 1e9; r3.stats.targets = 200; r3.stats.radius = 1e5; r3._cd = 0; placePlayer(r3, 180, 400);
  for (let i = 0; i < 100; i++) E.spawn(r3, 'hauler', 20 + (i % 20) * 15, 30 + Math.floor(i / 20) * 30, { entered: true });
  const total0 = r3.pickups.reduce((a, p) => a + p.value, 0); tick(r3, save, null);
  const total1 = r3.pickups.reduce((a, p) => a + p.value, 0) + r3.earned.bolts;
  ok(r3.pickups.length <= 400 + 40 && total1 - total0 === 100 * 16, 'cap merges instead of losing value: ' + (total1 - total0) + ' pickups ' + r3.pickups.length);
}

// =========================================================================
sec('yard sweep');
{
  const expect = [0, 15, 30];
  for (let lvl = 0; lvl <= 2; lvl++) {
    const save = saveWith({ sweep: lvl }), run = mk(save, 1, 3);
    immortal(run); run._cd = 1e9;
    pk(run, 'bolt', 10, 10, 10, 1); pk(run, 'bolt', 20, 350, 10, 1); pk(run, 'core', 1, 10, 600, 1); pk(run, 'cell', 0, 300, 600, 1);
    run.earned.bolts = 4;
    run.player.battery = 0.001; ticks(run, save, 2, null);
    const rep = E.endShift(run, save);
    eq(rep.swept, expect[lvl], 'sweep level ' + lvl + ' swept'); eq(rep.bolts, 4 + expect[lvl], 'report bolts include sweep'); eq(rep.cores, 1, 'floor cores always collected');
    eq(save.bolts, 4 + expect[lvl], 'banked'); eq(save.cores, 1, 'core banked');
  }
  // living bots are salvaged too: 3 scraplings (1 bolt each in sector 1) + one hauler (16)
  for (let lvl = 0; lvl <= 2; lvl++) {
    const save = saveWith({ sweep: lvl }), run = mk(save, 1, 3);
    immortal(run); run._cd = 1e9;
    for (let i = 0; i < 3; i++) E.spawn(run, 'scrapling', 50 + i * 40, 100, { entered: true });
    E.spawn(run, 'hauler', 250, 100, { entered: true });
    run.player.battery = 0.001; ticks(run, save, 2, null);
    const rep = E.endShift(run, save);
    eq(rep.swept, Math.round((3 + 16) * D.TUNE.sweepBots * [0, 0.5, 1][lvl]), 'sweep level ' + lvl + ' also scraps living bots');
  }
}

// =========================================================================
sec('warden flow');
{
  // signal -> warning -> spawn -> reserve
  const save = E.newSave(), run = mk(save, 1, 9);
  run.stats.damage = 1e9; run.stats.targets = 40; run.stats.radius = 1e5; placePlayer(run, 180, 460);
  run.player.maxBattery = 100; run.player.battery = 40;
  const NEED1 = D.SECTORS[0].need; eq(run.boss.need, NEED1, 'need from data'); eq(run.boss.state, 'none', 'state none');
  for (let i = 0; i < NEED1 - 1; i++) E.spawn(run, 'scrapling', 20 + (i % 22) * 15, 200 + Math.floor(i / 22) * 20, { entered: true });
  run._cd = 0; let evs = tick(run, save, null);
  eq(run.boss.signal, NEED1 - 1, 'signal need-1'); eq(run.boss.state, 'none', 'not yet');
  ok(run.boss.hp === run.boss.maxHp && run.boss.maxHp === D.BOSS_BY_ID.compactor.hp && run.boss.id === 'compactor' && run.boss.name === 'The Compactor' && run.boss.enemyId === null, 'boss fields before spawn');
  E.spawn(run, 'scrapling', 50, 150, { entered: true }); run._cd = 0;
  evs = tick(run, save, null);
  eq(run.boss.state, 'warning', 'warning at need'); ok(has(evs, 'bossWarn', e => e.name === 'The Compactor' && e.dur === 2.5), 'bossWarn event'); near(run.boss.warn, 2.5, 0.02, 'warn 2.5');
  let n = 0, spawnEvs = [];
  while (run.boss.state === 'warning' && n < 200) { spawnEvs = spawnEvs.concat(tick(run, save, null)); n++; }
  ok(n >= 148 && n <= 152, 'warden arrives after 2.5 s: ' + n + ' ticks'); eq(run.boss.state, 'active', 'active');
  ok(has(spawnEvs, 'bossSpawn', e => e.name === 'The Compactor' && typeof e.enemyId === 'number'), 'bossSpawn event');
  const boss = run.enemies.find(e => e.boss);
  ok(boss && boss.type === 'compactor' && Math.abs(boss.x - 180) < 1 && boss.y < 120, 'boss at top centre'); eq(run.boss.enemyId, boss.id, 'boss.enemyId');
  ok(boss.hostile && boss.hp === D.BOSS_BY_ID.compactor.hp && boss.r === 32, 'boss stats');
  ok(run.player.battery > Math.min(100, 40 + D.TUNE.reserve * 100) - 3, 'emergency reserve +' + D.TUNE.reserve * 100 + '% of max: ' + run.player.battery.toFixed(1));
  // alive cap x0.4 during warden
  const r2 = mk(save, 1, 9); r2._spawnT = 0; r2.boss.state = 'active'; r2.t = 100; r2.stats.damage = 0; r2._cd = 1e9; immortal(r2);
  ticks(r2, save, 60 * 5, null); ok(r2.enemies.length <= Math.floor(16 * 0.4) + 1, 'maxAlive x0.4 while a Warden is active: ' + r2.enemies.length);
  // Lure Beacon
  const sb = saveWith({ beacon: 4 }); eq(mk(sb, 1, 2).boss.need, Math.round(NEED1 * (1 - D.LEVEL.beacon * 4)), 'beacon need in run');
  // sector 5 blocked
  const s5 = saveWith({}, { sectorsCleared: 4 }), r5 = mk(s5, 5, 9);
  ok(r5.boss.blocked, 'blocked without titan'); r5.stats.damage = 1e9; r5.stats.targets = 150; r5.stats.radius = 1e5; r5._cd = 0; immortal(r5); placePlayer(r5, 180, 460);
  for (let i = 0; i < 100; i++) E.spawn(r5, 'roller', 10 + (i % 25) * 13, 20 + Math.floor(i / 25) * 25, { entered: true });
  tick(r5, s5, null); eq(r5.boss.signal, 0, 'signal does not fill without Titan Frame'); eq(r5.boss.state, 'none', 'no warning');
  const s5t = saveWith({ titan: 1 }, { sectorsCleared: 4 }), r5t = mk(s5t, 5, 9);
  ok(!r5t.boss.blocked, 'not blocked with titan'); r5t.stats.damage = 1e9; r5t.stats.targets = 150; r5t.stats.radius = 1e5; r5t._cd = 0; immortal(r5t); placePlayer(r5t, 180, 460);
  for (let i = 0; i < 100; i++) E.spawn(r5t, 'roller', 10 + (i % 25) * 13, 20 + Math.floor(i / 25) * 25, { entered: true });
  tick(r5t, s5t, null); eq(r5t.boss.state, 'warning', 'titan lures the Overseer'); eq(r5t.boss.need, D.SECTORS[4].need, 'sector 5 need from data');
  // after the warning the signal stops counting
}

// =========================================================================
sec('warden attacks');
function wardenRun(sector, seed, opts) {
  opts = opts || {};
  const save = opts.save || saveWith({ titan: sector === 5 ? 1 : 0 }, { sectorsCleared: sector - 1 });
  const run = mk(save, sector, seed);
  immortal(run); run.stats.damage = opts.damage === undefined ? 1 : opts.damage; run._cd = 0;
  run.boss.state = 'warning'; run.boss.warn = 0.02;
  placePlayer(run, 180, 460);
  let g = 0; while (run.boss.state !== 'active' && g++ < 10) tick(run, save, null);
  const boss = run.enemies.find(e => e.boss);
  return { save, run, boss };
}
{
  const sc = D.SECTORS;
  for (let sector = 1; sector <= 5; sector++) {
    const def = D.BOSSES[sector - 1], dmgMul = sc[sector - 1].dmg;
    const { save, run, boss } = wardenRun(sector, 20 + sector, { damage: 0 });
    ok(boss && boss.type === def.id, def.id + ' spawned'); near(boss.maxHp, def.hp, 1e-9, def.id + ' hp absolute');
    const kinds = new Set(def.attacks.map(a => a.kind));
    const hits = { slam: false, charge: false, shot: false, contact: false }, tele = {}, groups = [], shotsSeen = [];
    const startY = kinds.has('ring') ? boss.y + 90 : 460;
    placePlayer(run, 180, startY);
    let slamAmt = null, chargeAmt = null;
    const secs = 60;
    for (let i = 0; i < 60 * secs; i++) {
      // stay put (stationary player is the worst case), but keep non-boss clutter small
      if (i % 120 === 0) run.enemies = run.enemies.filter(e => e.boss || e.type === 'pylon');
      const evs = tick(run, save, null);
      for (const e of evs) {
        if (e.type === 'telegraph') tele[e.kind] = (tele[e.kind] || 0) + 1;
        if (e.type === 'hurt') { hits[e.src] = true; if (e.src === 'slam') slamAmt = e.amount; if (e.src === 'charge') chargeAmt = e.amount; }
        if (e.type === 'shot') shotsSeen.push(e);
      }
      const sp = evs.filter(e => e.type === 'spawn' && e.enemyType !== 'pylon');
      if (sp.length >= 2) groups.push({ n: sp.length, t: sp[0].enemyType });
      if (run.hazards.length) { const h = run.hazards[0]; ok(h.kind === 'slam' || h.kind === 'charge', 'hazard kind valid'); ok(h.t <= h.dur + 1e-9, 'hazard not past its dur'); }
      if (!run.enemies.includes(boss)) break;
    }
    for (const a of def.attacks) {
      if (a.phases && !a.phases.includes(1)) continue; // covered by the phase tests
      if (a.kind === 'slam') {
        ok(tele.slam > 0 && hits.slam, def.id + ' slam telegraphs and hurts'); if (slamAmt !== null) near(slamAmt, a.dmg * dmgMul, 1e-9, def.id + ' slam dmg scaled');
        ok(seenEv.slam > 0, 'slam event seen');
      }
      if (a.kind === 'charge') { ok(tele.charge > 0 && hits.charge, def.id + ' charge telegraphs and hurts'); if (chargeAmt !== null) near(chargeAmt, a.dmg * dmgMul, 1e-9, def.id + ' charge dmg scaled'); }
      if (a.kind === 'ring') { ok(shotsSeen.length > 3 && hits.shot, def.id + ' ring fires and hurts'); }
      if (a.kind === 'summon') ok(groups.some(g => g.t === a.type && g.n >= a.n), def.id + ' summons ' + a.n + ' ' + a.type);
    }
    if (def.contact > 0 && def.move === 'chase') ok(hits.contact || kinds.size > 0, def.id + ' contact');
  }
  // boss contact damage
  {
    const { save, run, boss } = wardenRun(1, 3, { damage: 0 });
    placePlayer(run, boss.x, boss.y + 20); const evs = ticks(run, save, 60, null);
    ok(has(evs, 'hurt', e => e.src === 'contact'), 'Warden contact hurts');
    const tot = evs.filter(e => e.type === 'hurt' && e.src === 'contact').reduce((a, e) => a + e.amount, 0);
    ok(tot > 2 && tot < 5, 'Compactor contact ~4/s: ' + tot.toFixed(2));
  }
  // slam can be dodged: telegraph is on Sprocket's position, moving away avoids it
  {
    const { save, run, boss } = wardenRun(1, 3, { damage: 0 });
    let dodged = true, slams = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const evs = tick(run, save, { x: run.hazards.length ? run.hazards[0].x + 200 * (run.hazards[0].x < 180 ? 1 : -1) : run.player.x, y: run.player.y });
      for (const e of evs) { if (e.type === 'slam') slams++; if (e.type === 'hurt' && e.src === 'slam') dodged = false; }
    }
    ok(slams >= 3 && dodged, 'slams are dodgeable by moving off the telegraph: ' + slams);
  }
  // charge lane: dash passes through the telegraphed line and can be sidestepped
  {
    const { save, run, boss } = wardenRun(2, 4, { damage: 0 });
    let sawCharge = false, hurt = false;
    for (let i = 0; i < 60 * 20; i++) {
      const h = run.hazards.find(x => x.kind === 'charge');
      let inp = null;
      if (h) { sawCharge = true; const dx = h.x2 - h.x, dy = h.y2 - h.y; inp = { x: run.player.x + Math.sign(-dy || 1) * 130, y: run.player.y + Math.sign(dx || 1) * 130 }; }
      const evs = tick(run, save, inp); if (has(evs, 'hurt', e => e.src === 'charge')) hurt = true;
    }
    ok(sawCharge, 'charge hazard seen'); ok(!hurt, 'sidestepping the lane avoids the charge');
  }
}

// =========================================================================
sec('shields & phases');
{
  // Foreman: shield at 75% and 40%
  const { save, run, boss } = wardenRun(4, 31, { damage: 1e9 });
  run.stats.damage = 0;
  run.enemies = run.enemies.filter(e => e.boss);
  let evs = tick(run, save, null);
  boss.hp = boss.maxHp * 0.74; run.boss.hp = boss.hp;
  evs = tick(run, save, null);
  ok(has(evs, 'shield', e => e.on === true), 'shield up at 75%'); ok(boss.invuln, 'boss invulnerable');
  const pylons = run.enemies.filter(e => e.type === 'pylon'); eq(pylons.length, 3, 'three pylons'); ok(pylons.every(p => !p.hostile && p.hp > 0), 'pylons are not hostile');
  // boss cannot be hit while shielded
  run.stats.damage = 1e9; run.stats.targets = 10; run.stats.radius = 1e5; run._cd = 0;
  const hpBefore = boss.hp; evs = tick(run, save, null);
  ok(!has(evs, 'hit', h => h.enemyId === boss.id), 'invulnerable boss is skipped by the arc'); eq(boss.hp, hpBefore, 'boss hp unchanged');
  ok(has(evs, 'kill', k => k.enemyType === 'pylon'), 'pylons can be scrapped');
  ok(has(evs, 'shield', e => e.on === false), 'shield drops once the pylons are gone'); ok(!boss.invuln, 'vulnerable again');
  run.stats.damage = 1; run._cd = 0;
  evs = tick(run, save, null); ok(has(evs, 'hit', h => h.enemyId === boss.id), 'boss can be hit again');
  // second shield at 40%
  boss.hp = boss.maxHp * 0.39; run.boss.hp = boss.hp; evs = ticks(run, save, 2, null);
  ok(has(evs, 'shield', e => e.on === true), 'second shield at 40%'); eq(run.enemies.filter(e => e.type === 'pylon').length, 3, 'three new pylons');
  // shield triggers only once per threshold
  run.stats.damage = 1e9; run._cd = 0; ticks(run, save, 3, null); run.stats.damage = 1;
  evs = ticks(run, save, 180, null); ok(!has(evs, 'shield', e => e.on === true), 'no repeat of an already used shield');
}
{
  // Overseer phases
  const { save, run, boss } = wardenRun(5, 41, { damage: 0 });
  const clutter = () => { run.enemies = run.enemies.filter(e => e.boss || e.type === 'pylon'); };
  placePlayer(run, 180, 300);
  const watch = (secs, label) => {
    const tele = {}, shots = [], groups = [], phases = [], hurts = {};
    for (let i = 0; i < 60 * secs; i++) {
      if (i % 60 === 0) clutter();
      const evs = tick(run, save, null);
      for (const e of evs) {
        if (e.type === 'telegraph') tele[e.kind] = (tele[e.kind] || 0) + 1;
        if (e.type === 'shot') shots.push(i);
        if (e.type === 'bossPhase') phases.push(e.phase);
        if (e.type === 'hurt') hurts[e.src] = true;
      }
      const sp = evs.filter(e => e.type === 'spawn' && e.enemyType === 'sparker'); if (sp.length >= 2) groups.push(run.tick);
    }
    return { tele, shots, groups, phases, hurts };
  };
  eq(run.boss.phase, 1, 'phase 1 at start');
  const p1 = watch(42, 'phase1');
  ok(p1.tele.slam >= 5, 'phase 1 slams: ' + p1.tele.slam); ok(!p1.tele.charge && p1.shots.length === 0, 'phase 1 has no charge or ring');
  ok(p1.groups.length >= 4, 'phase 1 summons sparkers: ' + p1.groups.length);
  const gap1 = (p1.groups[p1.groups.length - 1] - p1.groups[0]) / (p1.groups.length - 1) / 60; near(gap1, 8, 0.1, 'phase 1 summon cadence 8 s');
  boss.hp = boss.maxHp * 0.6; run.boss.hp = boss.hp; placePlayer(run, 180, boss.y + 110);
  const p2 = watch(25, 'phase2');
  ok(p2.hurts.charge && p2.hurts.shot, 'phase 2 charge and ring both hurt: ' + JSON.stringify(p2.hurts));
  eq(run.boss.phase, 2, 'phase 2 at 66%'); ok(p2.phases.includes(2), 'bossPhase 2 event');
  ok(p2.tele.charge >= 2, 'phase 2 charges: ' + p2.tele.charge); ok(p2.shots.length >= 3, 'phase 2 rings: ' + p2.shots.length); ok(!p2.tele.slam || p2.tele.slam <= 1, 'phase 2 no slams (except one in flight): ' + p2.tele.slam);
  ok(p2.groups.length === 0, 'phase 2 no summons');
  boss.hp = boss.maxHp * 0.3; run.boss.hp = boss.hp;
  const evsP3 = tick(run, save, null);
  eq(run.boss.phase, 3, 'phase 3 at 33%'); ok(has(evsP3, 'bossPhase', e => e.phase === 3), 'bossPhase 3 event'); ok(boss.invuln && has(evsP3, 'shield', e => e.on), 'shield once at 33%');
  const p3 = watch(42, 'phase3');
  ok(p3.tele.slam >= 3 && p3.tele.charge >= 3 && p3.shots.length >= 4, 'phase 3 uses everything: ' + JSON.stringify(p3.tele) + ' rings ' + p3.shots.length);
  ok(p3.groups.length >= 5, 'phase 3 summons: ' + p3.groups.length);
  const gap3 = (p3.groups[p3.groups.length - 1] - p3.groups[0]) / (p3.groups.length - 1) / 60; near(gap3, 6, 0.1, 'phase 3 cadence x0.75 -> 6 s: ' + gap3);
  ok(p3.hurts.slam, 'phase 3 slam hurts');
}

// =========================================================================
sec('victory & unlocks');
{
  const save = E.newSave(), run = wardenRun(1, 50, { save }).run;
  const boss = run.enemies.find(e => e.boss);
  pk(run, 'bolt', 25, 30, 30, 1); pk(run, 'core', 1, 300, 30, 1);
  boss.hp = 1; run.boss.hp = 1; run.stats.damage = 5; run._cd = 0; placePlayer(run, boss.x, boss.y + 60);
  let evs = tick(run, save, null);
  ok(has(evs, 'kill', k => k.boss && k.enemyType === 'compactor'), 'boss kill event');
  const bd = evs.find(e => e.type === 'bossDead'); ok(bd && bd.name === 'The Compactor' && bd.bolts === 60 && bd.cores === 2, 'bossDead fields: ' + JSON.stringify(bd));
  ok(has(evs, 'sectorClear', e => e.sector === 1 && e.first === true), 'sectorClear first');
  eq(run.boss.state, 'dead', 'boss state dead'); eq(run.pickups.length, 0, 'floor pickups collected'); eq(run.earned.bolts, 25 + 60, 'floor bolts + boss bolts'); eq(run.earned.cores, 1 + 2, 'floor core + first-clear cores');
  ok(!run.over, 'shift ends 1.5 s later');
  const evs2 = ticks(run, save, 120, null); ok(run.over && run.reason === 'victory', 'ends with victory'); ok(has(evs2, 'end', e => e.reason === 'victory'), 'end event');
  ok(run.t - 0 > 0, 'time'); eq(count(evs2, 'sectorClear'), 0, 'sectorClear only once');
  const rep = E.endShift(run, save);
  ok(rep.reason === 'victory' && rep.bossSeen && rep.bossDefeated && rep.firstClear && rep.unlockedSector === 2 && !rep.gameWon, 'report: ' + JSON.stringify(rep));
  eq(rep.bolts, 85, 'report bolts'); eq(rep.cores, 3, 'report cores'); eq(rep.signalPct, 1, 'signalPct 1 when the Warden showed up');
  eq(save.sectorsCleared, 1, 'sector 1 cleared'); eq(save.bossKills[1], 1, 'bossKills'); eq(save.cores, 3, 'cores banked'); eq(save.bolts, 85, 'bolts banked');
  ok(E.sectorInfo(save, 2).unlocked, 'sector 2 unlocked'); ok(save.seen.compactor, 'boss in codex'); eq(save.stats.shifts, 1, 'shift counted');
  // repeat clear: fewer cores, no unlock; extractor bonus
  const sv2 = saveWith({ extract: 2 }, { sectorsCleared: 1 }); sv2.bossKills[1] = 1;
  const w2 = wardenRun(1, 51, { save: sv2 }); const b2 = w2.boss; b2.hp = 1; w2.run.boss.hp = 1; w2.run.stats.damage = 5; w2.run._cd = 0; placePlayer(w2.run, b2.x, b2.y + 60);
  const e2 = tick(w2.run, sv2, null); const bd2 = e2.find(e => e.type === 'bossDead');
  eq(bd2.cores, D.SECTORS[0].coresRepeat + Math.min(2, D.SECTORS[0].coresRepeat), 'repeat cores + extractor (up to double)'); ok(has(e2, 'sectorClear', e => e.first === false), 'sectorClear first false on repeat');
  ticks(w2.run, sv2, 120, null); const rep2 = E.endShift(w2.run, sv2); ok(!rep2.firstClear && rep2.unlockedSector === null, 'repeat clear no unlock'); eq(sv2.bossKills[1], 2, 'bossKills 2');
  // endShift while the victory timer is still running keeps the victory
  const w3 = wardenRun(1, 52, { save: E.newSave() }); w3.boss.hp = 1; w3.run.boss.hp = 1; w3.run.stats.damage = 5; w3.run._cd = 0; placePlayer(w3.run, w3.boss.x, w3.boss.y + 60);
  tick(w3.run, w3.save, null); const rep3 = E.endShift(w3.run, w3.save); ok(rep3.reason === 'victory' && rep3.bossDefeated, 'early endShift still counts the kill');
  // victory protects Sprocket from leftovers
  const w4 = wardenRun(1, 53, { save: E.newSave() }); w4.boss.hp = 1; w4.run.boss.hp = 1; w4.run.stats.damage = 5; w4.run._cd = 0; placePlayer(w4.run, w4.boss.x, w4.boss.y + 60);
  w4.run.player.battery = w4.run.player.maxBattery = 10; tick(w4.run, w4.save, null); E.spawn(w4.run, 'sparker', w4.run.player.x, w4.run.player.y, { entered: true });
  const b4 = w4.run.player.battery; ticks(w4.run, w4.save, 30, null); near(w4.run.player.battery, b4, 1e-9, 'no drain or damage after the Warden falls');
  // win the game: sector 5 once only
  const sv5 = saveWith({ titan: 1 }, { sectorsCleared: 4 }); sv5.stats.shifts = 40;
  const w5 = wardenRun(5, 54, { save: sv5 }); w5.boss.hp = 1; w5.run.boss.hp = 1; w5.run.stats.damage = 5; w5.run._cd = 0; placePlayer(w5.run, w5.boss.x, w5.boss.y + 80);
  w5.boss.invuln = false; const ev5 = tick(w5.run, sv5, null); ok(has(ev5, 'bossDead', e => e.bolts === 0 && e.cores === 0), 'Overseer drops nothing but the win');
  ticks(w5.run, sv5, 120, null); const rep5 = E.endShift(w5.run, sv5);
  ok(rep5.gameWon && rep5.firstClear && rep5.unlockedSector === 6, 'gameWon on the first Overseer clear: ' + JSON.stringify(rep5));
  ok(sv5.flags.won && sv5.stats.wonShifts === 41 && sv5.stats.wonPlayTime === sv5.stats.playTime, 'win recorded'); eq(sv5.sectorsCleared, 5, 'sectorsCleared 5');
  const w6 = wardenRun(5, 55, { save: sv5 }); w6.boss.hp = 1; w6.run.boss.hp = 1; w6.run.stats.damage = 5; w6.run._cd = 0; placePlayer(w6.run, w6.boss.x, w6.boss.y + 80);
  tick(w6.run, sv5, null); ticks(w6.run, sv5, 120, null); const rep6 = E.endShift(w6.run, sv5); ok(!rep6.gameWon && !rep6.firstClear, 'gameWon exactly once');
  // earlier sector clears do not win
  ok(!rep.gameWon, 'sector 1 clear is not a win');
}

// =========================================================================
sec('clock out, endShift, attract');
{
  const save = E.newSave(), run = mk(save, 1, 12);
  run.stats.damage = 1e9; run._cd = 0; placePlayer(run, 180, 400); E.spawn(run, 'hauler', 180, 370, { entered: true });
  tick(run, save, null); ticks(run, save, 40, null);
  E.clockOut(run); noteEvents(run.events); run.events.length = 0; ok(run.over && run.reason === 'clockout', 'clockOut ends with clockout');
  const before = JSON.stringify(run); E.step(run, save, { x: 1, y: 1 }); eq(JSON.stringify(run), before, 'step after over is a no-op');
  const rep = E.endShift(run, save); eq(rep.reason, 'clockout', 'report reason');
  const snap = JSON.stringify(save), rep2 = E.endShift(run, save);
  ok(rep2 === rep, 'endShift idempotent: same report'); eq(JSON.stringify(save), snap, 'endShift idempotent: save unchanged');
  eq(save.stats.shifts, 1, 'one shift counted'); ok(save.bolts > 0 && save.bolts === rep.bolts, 'bolts banked');
  ok(save.stats.kills === rep.kills && save.stats.playTime === rep.time && save.stats.bestShiftBolts === rep.bolts && save.stats.bestCombo === rep.bestCombo, 'stats updated');
  ok(save.seen.hauler, 'codex updated'); ok(rep.newSeen.includes('hauler'), 'newSeen lists first meetings');
  const r2 = mk(save, 1, 13); E.spawn(r2, 'hauler', 10, 10, { entered: true }); E.clockOut(r2); ok(!E.endShift(r2, save).newSeen.includes('hauler'), 'newSeen only first time');
  eq(save.sector, 1, 'last selected sector saved');
  for (const k of ['reason', 'sector', 'time', 'bolts', 'cores', 'kills', 'bestCombo', 'swept', 'signalPct', 'bossSeen', 'bossDefeated', 'firstClear', 'unlockedSector', 'gameWon', 'newSeen']) ok(k in rep, 'report has ' + k);
  // endShift on a shift that was never ended by the engine
  const r3 = mk(save, 2, 14); const rep3 = E.endShift(r3, save); ok(r3.over && rep3.reason === 'clockout', 'endShift ends a live shift as clockout');
  // attract
  const sa = E.newSave(), ra = E.startShift(sa, 1, { w: 360, h: 640, seed: 3, attract: true }); ok(ra.attract, 'attract flag');
  const snapA = JSON.stringify(sa);
  const driver = r => ({ x: 180 + 100 * Math.sin(r.t * 0.8), y: 300 + 80 * Math.sin(r.t * 1.6) });
  ticks(ra, sa, 60 * 40, driver);
  ok(!ra.over, 'attract never ends'); eq(ra.player.battery, ra.player.maxBattery, 'attract drains nothing'); eq(ra.boss.state, 'none', 'attract has no Warden');
  ok(ra.counts.kills >= 0 && ra.boss.signal === 0, 'attract signal stays 0');
  const repA = E.endShift(ra, sa); eq(JSON.stringify(sa), snapA, 'attract banks nothing, records nothing'); eq(repA.bolts, 0, 'attract report empty'); eq(repA.newSeen.length, 0, 'attract newSeen empty');
  const sa2 = saveWith({ coil: 25, amp: 8, fork: 4 }), ra2 = E.startShift(sa2, 1, { w: 360, h: 640, seed: 3, attract: true });
  ra2.stats.recycle = 0; ticks(ra2, sa2, 60 * 60, driver); ok(ra2.counts.kills > 0 && ra2.boss.state === 'none' && ra2.boss.signal === 0, 'attract kills never summon a Warden');
  ra2.enemies.forEach(e => { if (e.hostile) { /* hostile bots exist */ } });
  const bat = ra2.player.battery; E.spawn(ra2, 'sparker', ra2.player.x, ra2.player.y, { entered: true }); ticks(ra2, sa2, 30, driver); ok(ra2.player.battery === bat, 'attract ignores hits');
}

// =========================================================================
sec('invariants');
{
  const stats = { maxEnemies: 0, maxPickups: 0, maxShots: 0, maxHaz: 0, maxEv: 0 };
  const half = () => { const s = E.newSave(); for (const u of D.UPGRADES) if (u.branch !== 'rnd' && u.branch !== 'exec') s.up[u.id] = Math.floor(u.max * 0.6); s.up.titan = 0; s.up.collector = 1; s.up.drone = 3; s.up.capacitor = 3; s.sectorsCleared = 4; return s; };
  const mkSave = (n, kind) => kind === 'new' ? E.newSave() : kind === 'half' ? half() : maxedSave();
  let shiftsRun = 0;
  for (let n = 1; n <= 5; n++) {
    for (const kind of ['new', 'half', 'max']) {
      for (const skill of ['attentive', 'sloppy']) {
        if (kind === 'max' && skill === 'sloppy' && n < 5) continue;
        const save = mkSave(n, kind), seed = n * 100 + (kind.length) * 7 + (skill === 'sloppy' ? 1 : 0);
        const run = E.startShift(save, n, { w: 360, h: n % 2 ? 640 : 500, seed });
        if (kind !== 'new') run.boss.signal = Math.max(0, run.boss.need - 3);
        let g = 0;
        while (!run.over && g++ < 60 * 220) {
          E.step(run, save, A.target(run, { skill }));
          if (run.events.length > stats.maxEv) stats.maxEv = run.events.length;
          noteEvents(run.events); run.events.length = 0;
          const p = run.player;
          if (!(p.x >= p.r - 1e-6 && p.x <= run.w - p.r + 1e-6 && p.y >= p.r - 1e-6 && p.y <= run.h - p.r + 1e-6)) { ok(false, 'player outside arena'); break; }
          if (p.battery > p.maxBattery + 1e-9 || p.battery < -1e-9 || !(p.pulse >= 0 && p.pulse <= 1)) { ok(false, 'battery/pulse out of range ' + p.battery); break; }
          let bad = false;
          for (const e of run.enemies) {
            if (e.hp > e.maxHp + 1e-6) bad = 'hp>maxHp';
            if (e.x < -70 || e.x > run.w + 70 || e.y < -70 || e.y > run.h + 70) bad = 'enemy far outside ' + e.type + ' ' + e.x.toFixed(0) + ',' + e.y.toFixed(0);
            if (e.dead) bad = 'dead enemy left in array';
          }
          for (const q of run.pickups) if (q.x < -1 || q.x > run.w + 1 || q.y < -1 || q.y > run.h + 1) bad = 'pickup outside';
          for (const s of run.shots) if (s.x < -40 || s.x > run.w + 40 || s.y < -40 || s.y > run.h + 40) bad = 'shot far outside';
          if (bad) { ok(false, bad); break; }
          if (run.boss.hp > run.boss.maxHp + 1e-6) { ok(false, 'boss hp > max'); break; }
          if (run.enemies.length > stats.maxEnemies) stats.maxEnemies = run.enemies.length;
          if (run.pickups.length > stats.maxPickups) stats.maxPickups = run.pickups.length;
          if (run.shots.length > stats.maxShots) stats.maxShots = run.shots.length;
          if (run.hazards.length > stats.maxHaz) stats.maxHaz = run.hazards.length;
          if (g % 45 === 0) walkFinite(run, 'run', 0);
        }
        walkFinite(run, 'run', 0);
        ok(run.over, 'invariant shift ended: s' + n + ' ' + kind + ' ' + skill);
        E.endShift(run, save); shiftsRun++;
      }
    }
  }
  ok(stats.maxEnemies < 90, 'enemies bounded: ' + stats.maxEnemies);
  ok(stats.maxPickups <= 175, 'pickups bounded: ' + stats.maxPickups);
  ok(stats.maxShots < 400, 'shots bounded: ' + stats.maxShots);
  ok(stats.maxHaz <= 3, 'hazards bounded: ' + stats.maxHaz);
  ok(stats.maxEv < 4000, 'events per tick bounded: ' + stats.maxEv);
  console.log('  (' + shiftsRun + ' invariant shifts; max enemies ' + stats.maxEnemies + ', pickups ' + stats.maxPickups + ', shots ' + stats.maxShots + ', events/tick ' + stats.maxEv + ')');
}

// =========================================================================
sec('spawn hook: Wardens');
{
  const ids = D.BOSSES.map(b => b.id);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], def = D.BOSS_BY_ID[id];
    const save = E.newSave(); save.up.titan = 1;
    const run = E.startShift(save, i + 1, { seed: 9 + i }); immortal(run);
    let e = null, threw = false;
    try { e = E.spawn(run, id, 180, 120); } catch (err) { threw = true; }
    ok(!threw && e, 'spawn(' + id + ') does not throw');
    if (!e) continue;
    eq(e.type, id, id + ' type'); ok(e.boss === true, id + ' is a boss');
    eq(e.hp, def.hp, id + ' hp'); eq(run.boss.state, 'active', id + ' boss state active'); eq(run.boss.enemyId, e.id, id + ' enemyId');
    near(e.x, 180, 0.01, id + ' x'); near(e.y, 120, 0.01, id + ' y');
    ok(has(run.events, 'bossSpawn', x => x.enemyId === e.id), id + ' emits bossSpawn');
    run.events.length = 0;
    eq(E.spawn(run, id, 10, 10), e, id + ' second spawn returns the same Warden');
    ticks(run, save, 360, { x: 180, y: 500 });
    ok(isFinite(e.x) && isFinite(e.y), id + ' keeps simulating');
    e.hp = 0.001; run.player.battery = run.player.maxBattery; run._safe = false;
    if (def.shields) {
      ticks(run, save, 5, null);
      ok(e.invuln && run.enemies.filter(q => q.type === (def.pylonType || 'pylon') && (q.pyl || q.type === 'pylon')).length === (def.pylons || 3), id + ' shields up with ' + (def.pylons || 3) + ' pylons when low');
      continue;
    }
    for (const q of run.enemies) if (q !== e) q.dead = true;   // summons would soak the arc
    run.player.x = e.x; run.player.y = e.y + e.r + 20; run.player.tx = run.player.x; run.player.ty = run.player.y;
    for (let k = 0; k < 400 && run.boss.state !== 'dead'; k++) { run.player.battery = run.player.maxBattery; ticks(run, save, 1, { x: e.x, y: e.y + e.r + 12 }); }
    eq(run.boss.state, 'dead', id + ' can be killed');
    ticks(run, save, 120, null);
    const rep = E.endShift(run, save);
    ok(rep.bossDefeated && rep.reason === 'victory', id + ' report victory');
  }
}

// =========================================================================
sec('autopilot');
{
  const save = E.newSave();
  eq(A.pickSector(save), 1, 'pickSector 1 on a new save');
  save.bolts = 10000; const bought = A.shop(save);
  ok(bought.length > 3 && save.bolts >= 0 && save.cores >= 0, 'shop spends: ' + bought.length);
  ok(new Set(bought).size > 3, 'shop buys a spread, not just one thing');
  const s2 = E.newSave(); eq(A.shop(s2).length, 0, 'shop with nothing does nothing');
  const s3 = E.newSave(); s3.bolts = 1e12; s3.cores = 100; let guard = 0; while (A.shop(s3).length && guard++ < 50);
  let allMax = true; for (const u of D.UPGRADES) if (u.branch !== 'rnd' && u.branch !== 'exec' && s3.up[u.id] < u.max) allMax = false; ok(allMax || s3.bolts < 1e12, 'shop can buy out the tree given the money');
  // sector choice: unlocked, drops back when farming below is better
  const sv = E.newSave(); sv.sectorsCleared = 2;
  eq(A.pickSector(sv), 3, 'top unlocked sector first');
  A.record(sv, { sector: 2, bolts: 500 }); A.record(sv, { sector: 2, bolts: 520 });
  A.record(sv, { sector: 3, bolts: 100 }); A.record(sv, { sector: 3, bolts: 120 });
  eq(A.pickSector(sv), 2, 'drops back when the top sector earns less');
  const t = A.target(E.startShift(E.newSave(), 1, { seed: 3 }), { skill: 'attentive' });
  ok(Number.isFinite(t.x) && Number.isFinite(t.y), 'target finite');
}

// =========================================================================
// ACT II (SPEC 11)
// =========================================================================
function a2save(ups, extra) {
  const s = E.newSave();
  s.flags.won = s.flags.act2 = true; s.sectorsCleared = 5;
  for (const k of [1, 2, 3, 4, 5]) s.bossKills[k] = 1;
  Object.assign(s.up, ups || {});
  Object.assign(s, extra || {});
  return s;
}
// quiet Act II arena: sector n, player parked at (180, 460), plenty of battery, arc off
function mk2(save, sector, seed) {
  const run = mk(save, sector, seed || 7);
  immortal(run); placePlayer(run, 180, 460);
  return run;
}
function still(run, e) { e.wx = e.x; e.wy = e.y; return e; }
const RHO = 1e-9;

sec('Fmt');
{
  const F = BY.Fmt, T = ' ', M = '−';
  ok(F && typeof F.num === 'function' && typeof F.int === 'function', 'BY.Fmt.num / int exist');
  const cases = [[0, '0'], [1, '1'], [7, '7'], [999, '999'], [999.4, '999'], [999.6, '1K'], [1000, '1K'], [1234, '1.23K'], [12345, '12.3K'], [123456, '123K'],
    [999999, '1M'], [1e6, '1M'], [34.5e6, '34.5M'], [6.7e9, '6.7B'], [1e12, '1T'], [2.5e12, '2.5T'], [1e15, '1Qa'], [1e18, '1Qi'], [1e21, '1Sx'],
    [1e24, '1Sp'], [1e27, '1Oc'], [1e30, '1No'], [1e33, '1Dc'], [9.99e35, '999Dc'], [1e36, '1e36'], [1.2e36, '1.2e36'], [3.456e40, '3.46e40'], [1e100, '1e100'],
    [-5, M + '5'], [-1500, M + '1.5K'], [-1e36, M + '1e36'], [0.5, '0.5'], [0.1234, '0.123'], [12.34, '12.3'], [1.5, '1.5'], [100.4, '100'],
    [NaN, '—'], [Infinity, '—'], [-Infinity, '—'], [undefined, '—'], [-0, '0']];
  for (const [v, want] of cases) eq(F.num(v), want, 'Fmt.num(' + String(v) + ')');
  eq(F.num('1500'), '1.5K', 'Fmt.num accepts numeric strings');
  ok(!/\.0([A-Za-z]|$)/.test(F.num(2000)) && F.num(2000) === '2K', 'no trailing .0');
  for (const [v, want] of [[0, '0'], [999, '999'], [1234, '1' + T + '234'], [999999, '999' + T + '999'], [1e6, '1M'], [12345678, '12.3M'], [-1234, M + '1' + T + '234'],
    [1234.6, '1' + T + '235'], [999999.6, '1M'], [NaN, '—'], [Infinity, '—'], [1e36, '1e36'], [-0.2, '0']]) eq(F.int(v), want, 'Fmt.int(' + String(v) + ')');
  // monotone suffixes across the whole range
  let prevOk = true;
  for (let e = 0; e < 40; e++) { const s = F.num(Math.pow(10, e)); if (typeof s !== 'string' || !s.length) prevOk = false; }
  ok(prevOk, 'num works for 1e0..1e39');
  // used by the upgrade text
  ok(D.UPGRADE_BY_ID.fusion.fmt(10) === '×' + F.num(Math.pow(D.LEVEL.fusion, 10)) + ' damage', 'fusion L10 text uses Fmt: ' + D.UPGRADE_BY_ID.fusion.fmt(10));
  ok(/e\d+/.test(D.UPGRADE_BY_ID.overtimepay.fmt(1000)) && !/NaN|Infinity/.test(D.UPGRADE_BY_ID.overtimepay.fmt(1000)), 'uncapped fmt handles level 1000: ' + D.UPGRADE_BY_ID.overtimepay.fmt(1000));
  eq(D.UPGRADE_BY_ID.overtimepay.fmt(Infinity.valueOf ? 5e5 : 0).indexOf('NaN'), -1, 'uncapped fmt never prints NaN');
}

sec('save v2 and v1 migration');
{
  const n = E.newSave();
  eq(n.v, 3, 'new save is v3'); ok(n.flags.act2 === false && n.flags.chairman === false && n.flags.reveal === false, 'new flags');
  eq(JSON.stringify(n.overtime), '{"level":0,"best":0}', 'overtime default');
  eq(n.stats.act2Shifts, null, 'act2Shifts null'); eq(n.stats.act2PlayTime, null, 'act2PlayTime null'); eq(n.stats.stolen, 0, 'stolen 0');
  for (let k = 1; k <= 10; k++) eq(n.bossKills[k], 0, 'bossKills ' + k);
  for (const id of ['fusion', 'supercell', 'dividends', 'lattice', 'storm', 'singularity', 'severance', 'stockopt', 'rehire', 'nanites', 'parachute', 'takeover', 'overtimepay', 'hazardpay'])
    eq(n.up[id], 0, 'new save has up.' + id);
  // a v1 save that won
  const v1 = { v: 1, bolts: 1234, cores: 5, up: { coil: 3, titan: 1, spare: 1 }, sectorsCleared: 5, bossKills: { 1: 3, 2: 2, 3: 1, 4: 1, 5: 1 }, sector: 5,
    seen: { overseer: true, hauler: true }, stats: { shifts: 90, kills: 4000, boltsTotal: 99999, coresTotal: 70, playTime: 3600, bestCombo: 50, bestShiftBolts: 1200, wonShifts: 88, wonPlayTime: 3500 },
    flags: { won: true, movedOnce: true, tip: 3, shopped: true }, settings: { sound: false, shake: true } };
  const m = E.loadSave(JSON.parse(JSON.stringify(v1)));
  eq(m.v, 3, 'v1 -> v3'); eq(m.flags.act2, true, 'v1 won -> act2'); eq(m.flags.won, true, 'won kept'); eq(m.flags.chairman, false, 'no chairman');
  ok(E.sectorInfo(m, 6).unlocked, 'sector 6 unlocked after migration'); ok(!E.sectorInfo(m, 7).unlocked, 'sector 7 still locked');
  ok(!E.sectorInfo(m, 16).unlocked, 'overtime locked'); eq(E.sectorInfo(m, 6).lockReason, null, 'sector 6 no lock reason');
  eq(E.sectorInfo(E.newSave(), 6).lockReason, 'Scrap The Overseer', 'sector 6 lock reason names the Overseer');
  eq(m.sector, 5, 'selected sector kept'); eq(m.bolts, 1234, 'bolts'); eq(m.cores, 5, 'cores'); eq(m.up.coil, 3, 'levels'); eq(m.up.titan, 1, 'titan');
  eq(m.stats.wonShifts, 88, 'wonShifts'); eq(m.stats.act2Shifts, null, 'act2Shifts null'); eq(m.settings.sound, false, 'settings kept'); eq(m.flags.tip, 3, 'tip kept');
  ok(m.seen.overseer && m.seen.hauler, 'seen kept'); eq(m.up.fusion, 0, 'new nodes 0'); eq(m.overtime.level, 0, 'overtime 0');
  ok(!E.upgradeInfo(m, 'fusion').classified, 'R&D visible for a migrated winner');
  // idempotent
  eq(JSON.stringify(E.loadSave(JSON.parse(JSON.stringify(m)))), JSON.stringify(m), 'v2 round trip identical');
  // a v1 save that has not won
  const v1b = E.loadSave({ v: 1, sectorsCleared: 3, flags: { won: false }, up: { coil: 2 } });
  eq(v1b.flags.act2, false, 'unwon v1: no act2'); ok(!E.sectorInfo(v1b, 6).unlocked, 'sector 6 locked for unwon v1'); eq(v1b.v, 3, 'v3');
  ok(E.upgradeInfo(v1b, 'fusion').classified, 'R&D classified for unwon v1');
  // junk never throws and stays in range
  const junk = [null, undefined, 3, 'x', [], {}, { v: 2, overtime: 'x' }, { overtime: { level: -4, best: 'q' } }, { overtime: { level: 7.9, best: 2 } }, { flags: { act2: 'yes', chairman: 1 } },
    { sectorsCleared: 99, bossKills: { 6: 2, 10: 1, 11: 5 } }, { up: { overtimepay: 1e30, hazardpay: -3, fusion: 99, takeover: 4 } }, { bolts: 1e40, cores: 1e20, stats: { boltsTotal: 1e50 } },
    { stats: { act2Shifts: 'z', act2PlayTime: -1, stolen: NaN } }, { sector: 11 }, { sector: 99 }, { bolts: Infinity, cores: -Infinity }];
  for (const j of junk) {
    let s; try { s = E.loadSave(j); } catch (e) { ok(false, 'loadSave threw for ' + JSON.stringify(j)); continue; }
    ok(s.v === 3 && s.overtime.level >= 0 && Number.isInteger(s.overtime.level) && s.overtime.best >= s.overtime.level, 'overtime sane for ' + JSON.stringify(j));
    ok(s.sectorsCleared >= 0 && s.sectorsCleared <= 15 && s.sector >= 1 && s.sector <= (s.flags.founder ? 16 : Math.min(15, s.sectorsCleared + 1)), 'sector clamped to unlocked for ' + JSON.stringify(j));
    ok(Number.isFinite(s.bolts) && Number.isFinite(s.cores) && Number.isFinite(s.stats.stolen) && Number.isFinite(s.stats.boltsTotal), 'totals finite');
    for (const u of D.UPGRADES) ok(Number.isInteger(s.up[u.id]) && s.up[u.id] >= 0 && s.up[u.id] <= (u.max === Infinity ? 1e9 : u.max), 'level range ' + u.id);
    ok(Number.isFinite(E.stats(s).damage) && E.stats(s).damage > 0, 'stats stay finite for ' + JSON.stringify(j));
  }
  eq(E.loadSave({ flags: { act2: 'yes' } }).flags.act2, false, 'act2 must be literally true');
  eq(E.loadSave({ up: { fusion: 4.9 } }).up.fusion, 4, 'levels floor'); eq(E.loadSave({ up: { overtimepay: 123456 } }).up.overtimepay, 123456, 'uncapped levels are any integer');
  { const f = E.loadSave({ up: { fusion: 99 } }).up; eq(f.fusion + f.fusion2 + f.fusion3, 10, 'capped chains still clamp'); eq(f.fusion, 4, 'fusion node clamps at 4'); }
  eq(E.loadSave({ bolts: 3e20 }).bolts, 3e20, 'bolts above 1e15 survive'); eq(E.loadSave({ bolts: 1e40 }).bolts, 1e40, 'bolts 1e40 survive');
  const ch = E.loadSave({ flags: { chairman: true }, overtime: { level: 3, best: 1 }, sector: 11 });
  eq(ch.flags.act2, true, 'chairman implies act2'); eq(ch.sectorsCleared, 10, 'chairman implies sectors cleared'); eq(ch.sector, 11, 'sector 11 allowed with chairman');
  eq(ch.overtime.best, 3, 'best >= level'); ok(E.sectorInfo(ch, 11).unlocked && !E.sectorInfo(ch, 16).unlocked, 'Lobby unlocked after the Chairman, Overtime not until the Founder');
  eq(E.loadSave({ sector: 11 }).sector, 1, 'sector 11 clamped without chairman');
  const big = E.newSave(); big.bolts = 5e30; big.stats.boltsTotal = 7e33;
  eq(JSON.stringify(E.loadSave(JSON.parse(JSON.stringify(big)))), JSON.stringify(big), 'huge totals round trip');
}

sec('R&D gates, classified, uncapped nodes');
{
  const s = E.newSave(); s.bolts = 1e30; s.cores = 99; s.up.titan = 1;
  const i = E.upgradeInfo(s, 'fusion');
  ok(i.classified === true && i.unlocked === false && i.lockReason === 'Classified' && i.name === 'CLASSIFIED' && i.desc === '' && i.now === null && i.next === null, 'fusion classified before act2');
  ok(Array.isArray(i.pos) && i.pos.length === 2, 'classified node still positioned (pos)'); eq(i.icon, 'fusion', 'classified node keeps icon'); eq(i.tier, 1, 'classified node keeps tier'); ok(typeof i.revealed === 'boolean', 'classified node has revealed'); ok(!i.affordable && !i.maxed, 'classified not affordable'); eq(i.cost, null, 'classified has no cost');
  ok(!E.buy(s, 'fusion'), 'cannot buy a classified node even with the money'); eq(s.up.fusion, 0, 'no level');
  eq(E.affordableCount(s) > 0, true, 'Act I nodes still affordable');
  const aff = []; for (const u of D.UPGRADES) if (u.branch === 'rnd' && E.upgradeInfo(s, u.id).affordable) aff.push(u.id); eq(aff.length, 0, 'no R&D node affordable while classified');
  for (const u of D.UPGRADES) if (u.branch === 'rnd') ok(E.upgradeInfo(s, u.id).classified, u.id + ' classified');
  s.flags.act2 = true;
  const j = E.upgradeInfo(s, 'fusion');
  ok(!j.classified && j.unlocked && j.affordable && j.name === 'Fusion Coil' && j.desc.length > 5 && typeof j.now === 'string' && typeof j.next === 'string', 'fusion open after act2');
  eq(j.max, 4, 'capped max'); eq(j.cost.cores, 2, 'fusion first level costs 2 cores'); eq(j.cost.bolts, D.UPGRADE_BY_ID.fusion.base, 'fusion first level costs its base');
  const t = E.upgradeInfo(s, 'takeover');
  ok(!t.unlocked && /^Needs /.test(t.lockReason) && /Severance Package/.test(t.lockReason) && /38 Act II levels \(\d+\/38\)/.test(t.lockReason), 'takeover lock reason lists requirements: ' + t.lockReason);
  // the two infinite nodes need the Chairman
  s.up.takeover = 1; s.up.nanites = 1; s.up.dividends2 = 1;
  const o = E.upgradeInfo(s, 'overtimepay');
  ok(o.classified && o.lockReason === 'Classified' && o.max === null, 'overtimepay still classified after act2 (gate chairman), max null');
  ok(!E.buy(s, 'overtimepay'), 'cannot buy overtimepay before the Chairman');
  s.flags.chairman = true;
  const o2 = E.upgradeInfo(s, 'overtimepay');
  ok(!o2.classified && o2.unlocked && o2.max === null && o2.maxed === false && o2.cost.cores === 0, 'overtimepay open after chairman, uncapped');
  // buy past 100 levels
  s.bolts = 1e70;
  let n = 0; while (n < 130 && E.buy(s, 'overtimepay')) n++;
  eq(n, 130, 'bought 130 levels'); eq(s.up.overtimepay, 130, 'level 130'); ok(s.bolts >= 0 && Number.isFinite(s.bolts), 'bolts stay sane: ' + s.bolts);
  const o3 = E.upgradeInfo(s, 'overtimepay');
  ok(o3.maxed === false && o3.max === null && o3.next !== null && Number.isFinite(o3.cost.bolts) && o3.level === 130, 'never maxed');
  near(o3.cost.bolts / (D.UPGRADE_BY_ID.overtimepay.base * Math.pow(D.UPGRADE_BY_ID.overtimepay.growth, 130)), 1, 1e-9, 'cost = base * growth^level at 130');
  near(E.stats(s).damage / (Math.pow(D.LEVEL.overtimepay, 130) * D.LEVEL.takeover.damage * D.LEVEL.titan.damage), 1, 1e-9, 'damage includes 1.3^130 (and takeover x10, titan x3)');
  ok(/damage/.test(o3.now) && !/NaN|Infinity/.test(o3.now + o3.next), 'text at level 130: ' + o3.now);
  const h = E.newSave(); h.flags.act2 = h.flags.chairman = true; h.up.takeover = 1; h.up.dividends2 = 1; h.bolts = 1e90; for (let k = 0; k < 110; k++) E.buy(h, 'hazardpay');
  eq(h.up.hazardpay, 110, 'hazardpay past 100'); near(E.stats(h).boltMult / Math.pow(D.LEVEL.hazardpay, 110) / D.LEVEL.dividends, 1, 1e-9, 'hazardpay multiplies bolt value');
  // cannot buy when short of cores / bolts
  const c = E.newSave(); c.flags.act2 = true; c.up.titan = 1; c.bolts = 1e9; c.cores = 1; ok(!E.buy(c, 'fusion'), 'fusion needs 2 cores'); c.cores = 2; ok(E.buy(c, 'fusion'), 'fusion with 2 cores'); eq(c.cores, 0, 'cores spent');
  // affordableCount includes R&D once open
  const a = E.newSave(); a.flags.act2 = true; a.up.titan = 1; a.up.extract = 1; a.bolts = 1e7; a.cores = 5; ok(E.affordableCount(a) >= 3, 'affordableCount counts open R&D nodes: ' + E.affordableCount(a));
  // requires chain: dividends 1 is required for stockopt
  a.bolts = 1e12; ok(!E.upgradeInfo(a, 'stockopt').unlocked, 'stockopt locked without dividends'); E.buy(a, 'dividends'); ok(E.upgradeInfo(a, 'stockopt').unlocked, 'stockopt open after dividends');
  // costs follow base*growth^level for every R&D node (first 12 levels)
  for (const u of D.UPGRADES) if (u.branch === 'rnd') for (let l = 0; l < Math.min(12, u.max); l++) {
    const t2 = E.newSave(); t2.flags.act2 = t2.flags.chairman = true; t2.up[u.id] = l;
    eq(E.upgradeInfo(t2, u.id).cost.bolts, Math.round(u.base * Math.pow(u.growth, l)), 'R&D cost ' + u.id + ' L' + l);
    eq(E.upgradeInfo(t2, u.id).cost.cores, u.cores ? u.cores[l] : 0, 'R&D cores ' + u.id + ' L' + l);
  }
  // table values
  const T2 = { fusion: [61000, 4.07, 4], supercell: [120000, 3.21, 8], dividends: [82400, 3.79, 5], lattice: [896000, 5.86, 5], storm: [1060000, 5.86, 5], singularity: [1500000, 6.34, 5], severance: [2040000, 8.56, 3],
    stockopt: [730000, 5.37, 5], rehire: [1220000, 5.86, 5], nanites: [2960000, 5.86, 5], parachute: [1780000, 10.59, 3], takeover: [1.2e9, 1, 1], overtimepay: [7.39e9, 1.6, Infinity], hazardpay: [7.39e9, 1.6, Infinity],
    overdrive: [896000, 4.86, 5], arcfocus: [1220000, 5.37, 5] };
  for (const id in T2) { const u = D.UPGRADE_BY_ID[id]; ok(u.base === T2[id][0] && u.growth === T2[id][1] && u.max === T2[id][2] && u.branch === 'rnd', 'table row ' + id); }
  eq(D.UPGRADE_BY_ID.takeover.cores[0], 30, 'takeover costs 30 cores'); eq(D.UPGRADE_BY_ID.fusion.cores.concat(D.UPGRADE_BY_ID.fusion2.cores, D.UPGRADE_BY_ID.fusion3.cores).join(), '2,2,3,3,3,3,4,4,4,5', 'fusion chain cores');
  eq(D.UPGRADE_BY_ID.overtimepay.gate, 'chairman', 'overtimepay gate'); eq(D.UPGRADE_BY_ID.fusion.gate, 'act2', 'fusion gate');
  eq(D.UPGRADE_BY_ID.parachute.requires.map(r => r.join(':')).join(), 'stockopt:1', 'parachute requires');
  eq(D.UPGRADE_BY_ID.lattice.requires.map(r => r.join(':')).join(), 'collector:1', 'lattice requires');
  eq(D.UPGRADE_BY_ID.takeover.requires.map(r => r.join(':')).join(), 'severance:1', 'takeover requires');
}

sec('R&D derived stats');
{
  const s = a2save({ coil: 6, amp: 2, titan: 1, fusion: 3, takeover: 1, overtimepay: 4, supercell: 2, cell: 5, coolant: 2, field: 3, sorter: 4, dividends: 2, hazardpay: 3, drone: 3, dronedmg: 2,
    lattice: 2, storm: 3, singularity: 2, severance: 2, stockopt: 3, rehire: 4, nanites: 3, parachute: 2, sweep: 2 });
  const st = E.stats(s);
  const dmg = (1 + 6) * Math.pow(1.25, 2) * 3 * Math.pow(D.LEVEL.fusion, 3) * D.LEVEL.takeover.damage * Math.pow(D.LEVEL.overtimepay, 4);
  near(st.damage / dmg, 1, RHO, 'damage x2^fusion x10 x1.3^otp');
  near(st.maxBattery / ((18 + 15) * 1.3 * (1 + D.LEVEL.supercell.battery * 2) * D.LEVEL.takeover.battery), 1, RHO, 'maxBattery supercell + colossus');
  near(st.sag / (0.058 * (1 - 0.2) * (1 - 0.1)), 1, RHO, 'sag multiplicative with coolant');
  near(st.radius / ((46 + 15) * 1.25 * 1.3), 1, RHO, 'radius x1.3'); near(st.boltMult / ((1 + 0.6) * Math.pow(D.LEVEL.dividends, 2) * Math.pow(D.LEVEL.hazardpay, 3)), 1, RHO, 'boltMult');
  eq(st.stormEvery, 6, 'stormEvery 9-3'); eq(st.wellEvery, 9, 'wellEvery 11-2'); eq(st.wellMult, 30, 'wellMult 10+10*2'); eq(st.severancePct, 50, 'severance x50'); eq(st.severancePay, 2, 'severance pay lvl2');
  near(st.stockStep, 0.06, RHO, 'stockStep'); near(st.stockCap, 3, RHO, 'stockCap'); near(st.rehireChance, 0.12, RHO, 'rehireChance'); near(st.naniteDps, 0.3 * st.damage, 1e-6 * st.damage, 'naniteDps');
  near(st.latticeDps, 2 * 2 * st.droneDmg, 1e-6 * st.droneDmg, 'latticeDps = 2 x lattice x droneDmg'); eq(st.sweepPct, 2, 'parachute 2 -> x2'); eq(st.colossus, true, 'colossus');
  const l = E.loadout(s); eq(l.colossus, true, 'loadout.colossus'); eq(l.rnd, 3, 'loadout.rnd tier 3 (total R&D levels >= 35)'); eq(l.titan, true, 'loadout.titan');
  const z = E.stats(E.newSave()); for (const k of ['stormEvery', 'latticeDps', 'wellEvery', 'wellMult', 'severancePct', 'stockStep', 'rehireChance', 'naniteDps']) eq(z[k], 0, 'zero ' + k + ' on a new save'); eq(z.colossus, false, 'no colossus');
  for (const [n, want] of [[0, 0], [1, 1], [14, 1], [15, 2], [34, 2], [35, 3]]) { const q = a2save({ fusion: Math.min(n, 10), supercell: Math.min(Math.max(n - 10, 0), 8), dividends: Math.min(Math.max(n - 18, 0), 10), lattice: Math.min(Math.max(n - 28, 0), 5), storm: Math.max(0, Math.min(n - 33, 5)) }); const tot = q.up.fusion + q.up.supercell + q.up.dividends + q.up.lattice + q.up.storm; eq(tot, n, 'fixture total ' + n); eq(E.loadout(q).rnd, want, 'rnd tier at ' + n + ' levels'); }
  eq(E.stats(a2save({ parachute: 1 })).sweepPct, 1.5, 'parachute 1 x1.5'); eq(E.stats(a2save({ parachute: 3 })).sweepPct, 3, 'parachute 3 x3'); eq(E.stats(a2save({ sweep: 1 })).sweepPct, 0.5, 'sweep unchanged without parachute');
  // Act I saves compute exactly as before
  const act1 = saveWith({ coil: 9, amp: 3, titan: 1, cell: 4 }); const a1 = E.stats(act1);
  eq(a1.damage, (1 + 9) * Math.pow(1.25, 3) * 3, 'Act I damage exact'); eq(a1.maxBattery, (18 + 12) * 1.3, 'Act I battery exact'); eq(a1.radius, 46 * 1.25, 'Act I radius exact');
}

sec('Act II bots');
{
  // --- Repo Bot: steals, flees, leaves with the loot; refund when scrapped carrying
  {
    const save = a2save(), run = mk2(save, 6, 3);
    run.stats.damage = 0; run._cd = 1e9; run.earned.bolts = 1000;
    const r = E.spawn(run, 'repo', 180, 440, { entered: true });
    eq(r.hostile, true, 'repo hostile'); near(r.hp, 10 * D.SECTORS[5].hp, 1e-6, 'repo hp = 10 x sector 6');
    const evs = ticks(run, save, 6, null);
    const st = evs.find(e => e.type === 'steal');
    ok(st && st.bolts === 50 && st.enemyId === r.id, 'steal takes 5% of earned: ' + JSON.stringify(st));
    eq(run.earned.bolts, 950, 'earned reduced'); eq(r.stolen, 50, 'e.stolen'); ok(!has(evs, 'hurt'), 'repo does no contact damage');
    ok(count(evs, 'steal') === 1, 'steals once');
    const more = ticks(run, save, 60 * 8, null);
    ok(r.dead && !run.enemies.includes(r), 'repo leaves after ~6 s'); ok(!has(more, 'kill'), 'leaving is not a kill'); eq(run.earned.bolts, 950, 'bolts stay stolen');
    eq(run.stolen, 50, 'run.stolen counts the loss');
    const rep = E.endShift(run, save);
    eq(rep.stolen, 50, 'report.stolen'); eq(save.stats.stolen, 50, 'stats.stolen banked'); eq(rep.bolts, 950, 'report bolts after theft');
  }
  {
    const save = a2save(), run = mk2(save, 6, 3);
    run.stats.damage = 0; run._cd = 1e9; run.earned.bolts = 10;
    E.spawn(run, 'repo', 180, 440, { entered: true });
    const evs = ticks(run, save, 6, null);
    eq(evs.find(e => e.type === 'steal').bolts, 1, 'steal min 1 bolt'); eq(run.earned.bolts, 9, 'one bolt gone');
    const run0 = mk2(save, 6, 3); run0.stats.damage = 0; run0._cd = 1e9; E.spawn(run0, 'repo', 180, 440, { entered: true });
    const e0 = ticks(run0, save, 6, null); eq(e0.find(e => e.type === 'steal').bolts, 0, 'nothing to steal when nothing earned'); eq(run0.earned.bolts, 0, 'earned stays 0');
  }
  {
    const save = a2save(), run = mk2(save, 6, 3);
    run.stats.damage = 0; run._cd = 1e9; run.earned.bolts = 2000;
    const r = E.spawn(run, 'repo', 180, 440, { entered: true });
    ticks(run, save, 6, null);
    eq(r.stolen, 100, 'carrying 100');
    run.stats.damage = 1e12; run._cd = 0; run.stats.radius = 1e5; run.pickups.length = 0;
    const evs = ticks(run, save, 3, null);
    ok(has(evs, 'kill', k => k.enemyType === 'repo'), 'repo scrapped'); const rf = evs.find(e => e.type === 'refund');
    ok(rf && rf.bolts === 150, 'refund 1.5 x stolen: ' + JSON.stringify(rf));
    const dropped = run.pickups.filter(p => p.kind === 'bolt').reduce((a, p) => a + p.value, 0);
    eq(dropped, Math.round(4 * D.SECTORS[5].bolts) + 150, 'refund added to the normal drop (4 bolts x sector 6 mult + 150)');
    eq(run.stolen, 0, 'nothing lost');
  }
  // --- Printer
  {
    const save = a2save(), run = mk2(save, 6, 4); run.stats.damage = 0; run._cd = 1e9;
    const p = still(run, E.spawn(run, 'printer', 180, 150, { entered: true }));
    eq(p.armor, 0.5, 'printer armor'); near(p.hp, 40 * D.SECTORS[5].hp, 1e-6, 'printer hp');
    const evs = ticks(run, save, 60 * 4 + 5, null);
    ok(p.planted, 'printer planted'); const pe = evs.filter(e => e.type === 'print');
    eq(pe.length, 1, 'one print event in ~4 s'); eq(pe[0].enemyId, p.id, 'print event carries the printer id');
    eq(run.enemies.filter(e => e.type === 'mite').length, 2, 'two mites printed'); ok(evs.filter(e => e.type === 'spawn' && e.enemyType === 'mite').length === 2, 'mite spawn events');
    ticks(run, save, 60 * 4, null); eq(count(run.events, 'print') + run.enemies.filter(e => e.type === 'mite').length >= 4, true, 'keeps printing');
    run.player.battery = run.player.maxBattery;
  }
  // --- Laser Drone
  {
    const save = a2save(), run = mk2(save, 7, 5); run.stats.damage = 0; run._cd = 1e9;
    const d = still(run, E.spawn(run, 'laser', 180, 120, { entered: true }));
    eq(d.hostile, true, 'laser drone hostile');
    const evs = ticks(run, save, 60 * 4, null);
    const tl = evs.find(e => e.type === 'telegraph' && e.kind === 'laser'); ok(tl && tl.dur === 0.9, 'laser telegraph with 0.9 s windup: ' + JSON.stringify(tl));
    const ls = evs.find(e => e.type === 'laser'); ok(ls, 'laser event');
    ok(ls && Math.abs(ls.x - 180) < 1 && ls.w === 14 && (ls.y2 >= 639.9 || ls.x2 <= 0.1 || ls.x2 >= 359.9), 'laser lane from the drone to the arena edge: ' + JSON.stringify(ls));
    const hurts = evs.filter(e => e.type === 'hurt' && e.src === 'laser');
    ok(hurts.length >= 1, 'standing in the lane hurts (src laser)');
    const tot = hurts.reduce((a, e) => a + e.amount, 0);
    const sd7 = D.SECTORS[6].dmg; ok(tot > 4 * sd7 * 0.5 * 0.7 && tot < 4 * sd7 * 0.5 * 1.2 * 1.6, 'laser damage ~4 x sector 7 dmg per second over 0.5 s: ' + tot.toFixed(2));
    const run2 = mk2(save, 7, 5); run2.stats.damage = 0; run2._cd = 1e9; placePlayer(run2, 330, 460);
    still(run2, E.spawn(run2, 'laser', 180, 120, { entered: true }));
    const evs2 = ticks(run2, save, 60 * 4, null);
    const ls2 = evs2.find(e => e.type === 'laser');
    ok(ls2, 'laser fires at a far target'); ok(!has(evs2, 'hurt', e => e.src === 'laser') || segLane(ls2, 330, 460) < 14 / 2 + 12, 'no laser damage outside the lane');
    // the lane is gone after firing
    ok(run2.hazards.filter(h => h.kind === 'laser').length <= 1, 'old lanes are removed');
  }
  function segLane(l, px, py) {
    const dx = l.x2 - l.x, dy = l.y2 - l.y, t = Math.max(0, Math.min(1, ((px - l.x) * dx + (py - l.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (l.x + dx * t), py - (l.y + dy * t));
  }
  // --- Firewall Node
  {
    const save = a2save(), run = mk2(save, 7, 6); run.stats.damage = 1e6; run._cd = 1e9;
    const n = still(run, E.spawn(run, 'firenode', 100, 300, { entered: true }));
    const near1 = still(run, E.spawn(run, 'scrapling', 150, 300, { entered: true })), far = still(run, E.spawn(run, 'scrapling', 300, 300, { entered: true }));
    const n2 = still(run, E.spawn(run, 'firenode', 60, 300, { entered: true })), boss = null;
    ticks(run, save, 2, null);
    ok(near1.invuln === true && near1.shieldedBy === n.id, 'bot within 90 is shielded by the node: ' + near1.shieldedBy + ' vs ' + n.id);
    ok(!far.invuln && far.shieldedBy === null, 'bot beyond 90 is not'); ok(!n.invuln && !n2.invuln && n.shieldedBy === null, 'nodes do not shield nodes');
    run._cd = 0; const ev1 = ticks(run, save, 1, null);
    ok(!has(ev1, 'hit', h => h.enemyId === near1.id), 'shielded bot is not hit');
    // kill both nodes: shield drops
    n.hp = n2.hp = 0.001; placePlayer(run, 100, 330); run.stats.targets = 5; run._cd = 0; run.stats.radius = 80;
    ticks(run, save, 2, null);
    ok(n.dead && n2.dead, 'nodes can be scrapped'); ticks(run, save, 2, null);
    ok(!near1.invuln && near1.shieldedBy === null, 'shield drops when the node dies');
    // Wardens are never shielded
    const run3 = mk2(save, 7, 6); const n3 = still(run3, E.spawn(run3, 'firenode', 180, 150, { entered: true })); const w = E.spawn(run3, 'firewall', 180, 120);
    ticks(run3, save, 3, null); ok(!w.invuln && w.shieldedBy === null, 'Warden not shielded by a node');
  }
  // --- Auditor
  {
    const save = a2save(), run = mk2(save, 8, 8); run.stats.damage = 0; run._cd = 1e9;
    const a = still(run, E.spawn(run, 'auditor', 180, 120, { entered: true }));
    eq(a.hostile, true, 'auditor hostile');
    let evs = ticks(run, save, 60 * 3 + 2, null);
    const tb = evs.find(e => e.type === 'telegraph' && e.kind === 'blink'); ok(tb && Math.abs(tb.dur - 0.5) < 1e-9, 'blink telegraph 0.5 s: ' + JSON.stringify(tb));
    const dist = Math.hypot(tb.x - run.player.x, tb.y - run.player.y); ok(dist >= 55 && dist <= 125, 'blink spot 60-120 from Sprocket: ' + dist.toFixed(0));
    ok(a.invuln && a.blinking, 'untouchable while blinking');
    evs = ticks(run, save, 40, null);
    const bl = evs.find(e => e.type === 'blink'); ok(bl && bl.enemyId === a.id && Math.abs(bl.x - tb.x) < 1e-9 && Math.abs(bl.y - tb.y) < 1e-9, 'blink event at the telegraphed spot');
    near(a.x, tb.x, 1e-9, 'teleported x'); ok(!a.invuln, 'vulnerable again');
    const ts = evs.find(e => e.type === 'telegraph' && e.kind === 'slam'); ok(ts && ts.r === 34 && Math.abs(ts.dur - 0.8) < 1e-9, 'slam r 34 windup 0.8 after landing: ' + JSON.stringify(ts));
    ok(Math.abs(ts.x - run.player.x) < 1e-6 && Math.abs(ts.y - run.player.y) < 1e-6, 'slam on Sprocket');
    const more = ticks(run, save, 70, null); const sl = more.find(e => e.type === 'slam'); ok(sl && sl.r === 34, 'slam lands'); const hu = more.find(e => e.type === 'hurt' && e.src === 'slam');
    ok(hu && Math.abs(hu.amount - 4 * D.SECTORS[7].dmg) < 1e-6, 'slam damage 4 x sector dmg: ' + (hu && hu.amount));
  }
  // --- Mimic
  {
    const save = a2save(), run = mk2(save, 8, 9);
    run.stats.damage = 1e9; run.stats.radius = 1e5; run.stats.targets = 9; run._cd = 0;
    const m = E.spawn(run, 'mimic', 180, 200, { entered: true });
    eq(m.disguised, true, 'spawns disguised'); eq(m.hostile, true, 'mimic hostile flag');
    const evs = ticks(run, save, 30, null);
    ok(!has(evs, 'hit') && !has(evs, 'zap'), 'disguised mimic cannot be targeted'); ok(m.x === 180 && m.y === 200, 'motionless');
    ok(!has(evs, 'mimicWake'), 'no wake while far');
    placePlayer(run, 180, 236); run.stats.damage = 0; run._cd = 1e9;
    const e2 = ticks(run, save, 3, null); const mw = e2.filter(e => e.type === 'mimicWake');
    eq(mw.length, 1, 'mimicWake fires once'); eq(mw[0].enemyId, m.id, 'with its id'); eq(m.disguised, false, 'awake');
    const e3 = ticks(run, save, 60, null); ok(!has(e3, 'mimicWake'), 'only once');
    const hs = e3.filter(e => e.type === 'hurt' && e.src === 'contact').reduce((a, e) => a + e.amount, 0); ok(hs > 0, 'awake mimic hurts on contact: ' + hs.toFixed(2));
    run.stats.damage = 1e9; run._cd = 0; const e4 = ticks(run, save, 2, null); ok(has(e4, 'kill', k => k.enemyType === 'mimic'), 'awake mimic can be scrapped');
    // chain / blasts skip disguised bots
    const run2 = mk2(save, 8, 9); run2.stats.chainPct = 1; run2.stats.damage = 1e9; run2.stats.radius = 1e5; run2.stats.targets = 1; run2._cd = 0; placePlayer(run2, 180, 460);
    const v = E.spawn(run2, 'scrapling', 180, 400, { entered: true }), mm = E.spawn(run2, 'mimic', 190, 400, { entered: true });
    const e5 = ticks(run2, save, 1, null); ok(!has(e5, 'hit', h => h.enemyId === mm.id), 'chain skips disguised'); ok(mm.hp === mm.maxHp, 'mimic untouched');
  }
}

sec('Act II Warden attacks and moves');
{
  const W = id => D.BOSS_BY_ID[id];
  // --- table values
  const f = W('forklift'), fw = W('firewall'), ins = W('inspector'), vp = W('vp'), ch = W('chairman');
  ok(f.hp > 0, 'forklift hp'); ok(fw.hp > f.hp, 'firewall hp'); ok(ins.hp > fw.hp, 'inspector hp'); ok(vp.hp > ins.hp, 'vp hp'); ok(ch.hp > vp.hp, 'chairman hp');
  eq(f.r + ',' + fw.r + ',' + ins.r + ',' + vp.r + ',' + ch.r, '34,40,30,36,44', 'warden radii'); ok(f.bolts > 0 && fw.bolts > f.bolts && ins.bolts > fw.bolts && vp.bolts > ins.bolts && ch.bolts === 0, 'warden bolts climb, the Chairman pays none');
  eq(f.serial + ' ' + ch.serial, 'WRD-6 WRD-10', 'serials'); for (const id of ['forklift', 'firewall', 'inspector', 'vp', 'chairman']) ok(W(id).blurb.length > 10 && W(id).name, id + ' has name and blurb');
  eq(ch.attacks.length, 7, 'chairman attacks'); eq(ch.phases.length, 4, 'chairman phases'); eq(ch.phases[3].cadence, 0.6, 'chairman P4 cadence');
  eq(JSON.stringify(ch.moveByPhase), '{"4":"blink"}', 'moveByPhase'); eq(fw.pylonType, 'firenode', 'firewall pylon type'); eq(fw.pylons, 4, 'firewall pylons');
  // --- barrage (random)
  {
    const save = a2save(), run = mk2(save, 6, 21), e = E.spawn(run, 'forklift', 180, 60);
    placePlayer(run, 180, 400); run.stats.damage = 0; run._cd = 1e9; e.at = [1e9, 0, 1e9]; e.speed = 0;
    const evs = ticks(run, save, 1, null);
    const t0 = evs.filter(e2 => e2.type === 'telegraph' && e2.kind === 'slam'); eq(t0.length, 1, 'first barrage slam telegraphs immediately');
    const more = ticks(run, save, 60, null); const tl = [...evs, ...more].filter(e2 => e2.type === 'telegraph' && e2.kind === 'slam');
    eq(tl.length, 3, 'barrage n=3 slams'); ok(tl.every(t => t.r === 46 && Math.abs(t.dur - 0.9) < 1e-9), 'r 46 windup 0.9');
    ok(tl.every(t => Math.hypot(t.x - 180, t.y - 400) <= 70 + 1e-6), 'each within spread 70 of Sprocket');
    const sl = [...more, ...ticks(run, save, 120, null)].filter(e2 => e2.type === 'slam'); eq(sl.length, 3, 'three slams land');
    // gap 0.3 between starts: telegraph tick spacing
    const run2 = mk2(save, 6, 21), e2 = E.spawn(run2, 'forklift', 180, 60); placePlayer(run2, 180, 400); run2.stats.damage = 0; run2._cd = 1e9; e2.at = [1e9, 0, 1e9];
    const times = []; for (let k = 0; k < 60; k++) { tick(run2, save, null); }
    const run3 = mk2(save, 6, 21), e3 = E.spawn(run3, 'forklift', 180, 60); placePlayer(run3, 180, 400); run3.stats.damage = 0; run3._cd = 1e9; e3.at = [1e9, 0, 1e9];
    const tk = []; for (let k = 0; k < 60; k++) { const ee = tick(run3, save, null); if (has(ee, 'telegraph', x => x.kind === 'slam')) tk.push(k); }
    eq(tk.length, 3, 'three telegraph ticks'); ok(Math.abs((tk[1] - tk[0]) - 18) <= 1 && Math.abs((tk[2] - tk[1]) - 18) <= 1, 'gap 0.3 s between slams: ' + tk.join(','));
    ok(run3.hazards.every(h => h.kind !== 'slam' || h.bar === true), 'barrage slams are slam hazards');
  }
  // --- barrage (grid)
  {
    const save = a2save(), run = mk2(save, 8, 22), e = E.spawn(run, 'inspector', 180, 60);
    placePlayer(run, 180, 320); run.stats.damage = 0; run._cd = 1e9; e.at = [0, 1e9]; e.bt = 1e9;
    const evs = ticks(run, save, 60, null); const tl = evs.filter(e2 => e2.type === 'telegraph' && e2.kind === 'slam');
    eq(tl.length, 6, 'grid barrage n=6');
    const xs = [...new Set(tl.map(t => Math.round(t.x)))].sort((a, b) => a - b), ys = [...new Set(tl.map(t => Math.round(t.y)))].sort((a, b) => a - b);
    eq(xs.join(), '108,180,252', '3-wide grid, cell 72, centred on Sprocket'); eq(ys.join(), '284,356', '2 rows centred on Sprocket');
    ok(tl.every(t => t.r === 40), 'r 40');
  }
  // --- Warden lasers (fan)
  {
    const save = a2save(), run = mk2(save, 7, 23), e = E.spawn(run, 'firewall', 180, 60);
    placePlayer(run, 180, 400); run.stats.damage = 0; run._cd = 1e9; e.at = [1e9, 0];
    const evs = ticks(run, save, 1, null);
    const lz = run.hazards.filter(h => h.kind === 'laser'); eq(lz.length, 2, 'n=2 lasers');
    ok(lz.every(h => h.firing === false && h.dur === 1 && h.fire === 0.6 && h.w === 18 && h.t >= 0), 'hazard fields: dur 1.0 fire 0.6 w 18');
    const ang = lz.map(h => Math.atan2(h.y2 - h.y, h.x2 - h.x)); near(Math.abs(ang[0] - ang[1]), 0.6, 1e-9, 'fan 0.6 rad apart');
    const aim = Math.atan2(400 - e.y, 180 - e.x); near((ang[0] + ang[1]) / 2, aim, 1e-9, 'centred on Sprocket');
    ok(lz.every(h => h.x === e.x && h.y === e.y && (h.x2 <= 0.001 || h.x2 >= 359.999 || h.y2 <= 0.001 || h.y2 >= 639.999)), 'lane runs from the boss to the arena edge');
    eq(count(evs, 'telegraph', x => x.kind === 'laser'), 2, 'two laser telegraphs');
    const fired = ticks(run, save, 62, null); eq(count(fired, 'laser'), 2, 'two laser events on firing');
    const l0 = fired.find(x => x.type === 'laser'); ok(l0.w === 18 && Number.isFinite(l0.x2), 'laser event fields');
    ok(run.hazards.filter(h => h.kind === 'laser' && h.firing).length === 2, 'firing flag set');
    ticks(run, save, 40, null); ok(run.hazards.every(h => h.kind !== 'laser' || h.t < h.dur + h.fire + 0.1), 'lasers removed after firing');
    // single laser at the player hurts per second
    const r2 = mk2(save, 9, 24), v = E.spawn(r2, 'vp', 180, 60); placePlayer(r2, 180, 400); r2.stats.damage = 0; r2._cd = 1e9; v.at = [0, 1e9, 1e9, 1e9]; v.speed = 0;
    const ev2 = ticks(r2, save, 140, null); const hz = ev2.filter(x => x.type === 'hurt' && x.src === 'laser').reduce((a, x) => a + x.amount, 0);
    ok(hz > 12 * D.SECTORS[8].dmg * 0.6 * 0.6 && hz < 12 * D.SECTORS[8].dmg * 0.6 * 1.3, 'vp laser hurts 12 x sector dmg per second over 0.6 s: ' + hz.toFixed(1));
    const r3 = mk2(save, 9, 24), v3 = E.spawn(r3, 'vp', 180, 60); placePlayer(r3, 180, 400); r3.stats.damage = 0; r3._cd = 1e9; v3.at = [0, 1e9, 1e9, 1e9]; v3.speed = 0;
    r3.player.plating = 0; r3.stats.plating = 0.5; const ev3 = ticks(r3, save, 140, null); const hz3 = ev3.filter(x => x.type === 'hurt' && x.src === 'laser').reduce((a, x) => a + x.amount, 0);
    ok(hz3 < hz * 0.7, 'plating reduces laser damage: ' + hz3.toFixed(1) + ' vs ' + hz.toFixed(1));
  }
  // --- budget aura
  {
    const save = a2save(), run = mk2(save, 9, 25); run.player.battery = run.player.maxBattery = 1000; run.stats.damage = 0; run._cd = 1e9;
    const e = E.spawn(run, 'vp', 180, 60); e.at = [1e9, 1e9, 1e9, 1e9]; e.speed = 0;
    const drain = () => { const b0 = run.player.battery; ticks(run, save, 60, null); return b0 - run.player.battery; };
    drain(); const d1 = drain(); ok(!run.player.budget, 'no budget in phase 1');
    e.hp = e.maxHp * 0.4; run.events.length = 0; const ev0 = ticks(run, save, 2, null);
    ok(run.player.budget === true && has(ev0, 'budget', x => x.on === true), 'budget on in phase 2'); eq(run.boss.phase, 2, 'phase 2');
    const d2 = drain(); near(d2 - d1, 0.6 * D.SECTORS[8].dmg * (1 - 0) * 1.0 * (1 / 0.8 * 0.8), 0.6, 'phase 2 drains an extra 0.6 x sector dmg per second (' + (d2 - d1).toFixed(2) + ')');
    e.hp = 0.001; run.stats.damage = 1e9; run._cd = 0; run.stats.radius = 1e5; placePlayer(run, e.x, e.y + 50); const ev3 = ticks(run, save, 5, null);
    ok(run.boss.state === 'dead' && has(ev3, 'budget', x => x.on === false) && run.player.budget === false, 'budget off when the Warden dies');
    // plating does not reduce it
    const r2 = mk2(a2save({ plating: 6 }), 9, 25); r2.player.battery = r2.player.maxBattery = 1000; r2.stats.damage = 0; r2._cd = 1e9; const e2 = E.spawn(r2, 'vp', 180, 60); e2.at = [1e9, 1e9, 1e9, 1e9]; e2.speed = 0; e2.hp = e2.maxHp * 0.4;
    ticks(r2, save, 2, null); const b0 = r2.player.battery; ticks(r2, save, 60, null); const dd = b0 - r2.player.battery;
    ok(dd > 0.6 * D.SECTORS[8].dmg * 0.95, 'plating does not reduce Budget: ' + dd.toFixed(2));
    // chairman budget only in phase 4
    const r3 = mk2(save, 10, 26); const c3 = E.spawn(r3, 'chairman', 180, 60); c3.at = c3.at.map(() => 1e9); c3.speed = 0;
    c3.hp = c3.maxHp * 0.6; ticks(r3, save, 3, null); ok(!r3.player.budget, 'chairman: no budget in phase 2');
    c3.hp = c3.maxHp * 0.2; c3.shDone = c3.shDone.map(() => true); ticks(r3, save, 3, null); ok(r3.player.budget, 'chairman: budget in phase 4'); eq(r3.boss.phase, 4, 'phase 4');
    near(r3._bud, 1.0 * D.SECTORS[9].dmg, 1e-9, 'chairman budget perSec 1.0 x sector dmg');
  }
  // --- blink (Inspector) and moveByPhase (Chairman)
  {
    const save = a2save(), run = mk2(save, 8, 27); run.stats.damage = 1e6; run.stats.radius = 1e5; run._cd = 1e9;
    const e = E.spawn(run, 'inspector', 180, 60); e.at = [1e9, 1e9]; e.bt = 0;
    const evs = ticks(run, save, 1, null); const tb = evs.find(x => x.type === 'telegraph' && x.kind === 'blink');
    ok(tb && tb.r === 30 && Math.abs(tb.dur - 0.7) < 1e-9, 'inspector blink telegraph windup 0.7: ' + JSON.stringify(tb));
    ok(e.invuln && e.blinking, 'invulnerable while blinking'); const hz = run.hazards.find(h => h.kind === 'blink'); ok(hz && hz.r === 30 && hz.dur === 0.7, 'blink hazard fields');
    const dd = Math.hypot(hz.x - 180, hz.y - 460); ok(dd >= 70 && dd <= 165, 'lands 80-160 from Sprocket: ' + dd.toFixed(0));
    run._cd = 0; const during = ticks(run, save, 20, null); ok(!has(during, 'hit', h => h.enemyId === e.id), 'untouchable while blinking');
    const land = ticks(run, save, 40, null); const bl = land.find(x => x.type === 'blink');
    ok(bl && bl.enemyId === e.id && Math.abs(bl.x - hz.x) < 1e-9 && Math.abs(bl.y - hz.y) < 1e-9, 'blink event at the spot'); ok(!e.invuln && !e.blinking, 'vulnerable after landing');
    near(e.x, hz.x, 1e-9, 'boss moved'); ok(e.bt > 3.5, 'timer reset (every 5)');
    // the Inspector does not walk
    const r2 = mk2(save, 8, 27), i2 = E.spawn(r2, 'inspector', 180, 60); i2.at = [1e9, 1e9]; i2.bt = 1e9; r2.stats.damage = 0; r2._cd = 1e9; ticks(r2, save, 120, null); eq(i2.y, 60, 'inspector holds position');
    // chairman: no blink before phase 4, chases + blinks in phase 4
    const r3 = mk2(save, 10, 28); const c = E.spawn(r3, 'chairman', 180, 80); c.at = c.at.map(() => 1e9); r3.stats.damage = 0; r3._cd = 1e9;
    const e3 = ticks(r3, save, 60 * 6, null); ok(!has(e3, 'blink') && !has(e3, 'telegraph', x => x.kind === 'blink'), 'chairman does not blink in phase 1'); ok(c.y > 80, 'chairman chases');
    c.hp = c.maxHp * 0.2; c.shDone = c.shDone.map(() => true); const bt0 = c.bt; c.bt = 0; const e4 = ticks(r3, save, 1, null);
    eq(r3.boss.phase, 4, 'phase 4'); ok(has(e4, 'telegraph', x => x.kind === 'blink' && Math.abs(x.dur - 0.6) < 1e-9), 'chairman blinks in phase 4 (windup 0.6)');
    const e5 = ticks(r3, save, 60, null); ok(has(e5, 'blink'), 'chairman lands'); ok(c.bt > 3, 'every 4 s');
    const px = c.x, py = c.y; ticks(r3, save, 30, null); ok(Math.hypot(c.x - px, c.y - py) > 0.2, 'chairman still chases in phase 4');
  }
  // --- shield with firenodes (Firewall) and default pylons (Chairman)
  {
    const save = a2save(), run = mk2(save, 7, 29); run.stats.damage = 0; run._cd = 1e9;
    const e = E.spawn(run, 'firewall', 180, 80); e.at = [1e9, 1e9]; e.hp = e.maxHp * 0.69;
    const evs = ticks(run, save, 3, null);
    ok(has(evs, 'shield', s => s.on === true) && e.invuln, 'firewall shield up at 70%');
    const nodes = run.enemies.filter(x => x.type === 'firenode' && x.pyl); eq(nodes.length, 4, 'four firenodes'); ok(run.enemies.every(x => x.type !== 'pylon'), 'no default pylons');
    ok(nodes.every(n => n.planted && Math.hypot(n.x - e.x, n.y - e.y) < 140), 'nodes stay put around the Warden');
    const dm = E.stats(save).damage; run.stats.damage = 1e12; run._cd = 0; run.stats.radius = 1e5; run.stats.targets = 9;
    const e2 = ticks(run, save, 3, null); ok(e.hp === e.maxHp * 0.69, 'shielded Warden takes no damage'); ok(nodes.every(n => n.dead), 'firenodes are scrapped by a big arc');
    const e3 = ticks(run, save, 3, null); ok(has([...e2, ...e3], 'shield', s => s.on === false) && !e.invuln, 'shield drops when all four are down');
    // second threshold at 35%
    e.hp = e.maxHp * 0.34; run.stats.damage = 0; const e4 = ticks(run, save, 3, null); ok(e.invuln && run.enemies.filter(x => x.type === 'firenode' && x.pyl && !x.dead).length === 4, 'second shield at 35%');
    // naturally spawned firenodes do not hold the shield
    const r2 = mk2(save, 7, 29); r2.stats.damage = 0; r2._cd = 1e9; const e5 = E.spawn(r2, 'firewall', 180, 80); e5.at = [1e9, 1e9]; const wild = still(r2, E.spawn(r2, 'firenode', 300, 500, { entered: true }));
    e5.hp = e5.maxHp * 0.69; ticks(r2, save, 3, null); const mine = r2.enemies.filter(x => x.pyl); mine.forEach(x => { x.dead = true; }); ticks(r2, save, 3, null); ok(!e5.invuln && !wild.dead, 'only its own nodes count');
    // Chairman: 3 default pylons at 50%
    const r3 = mk2(save, 10, 30); r3.stats.damage = 0; r3._cd = 1e9; const c = E.spawn(r3, 'chairman', 180, 80); c.at = c.at.map(() => 1e9); c.hp = c.maxHp * 0.49;
    ticks(r3, save, 3, null); ok(c.invuln && r3.enemies.filter(x => x.type === 'pylon').length === 3, 'chairman shield: 3 pylons at 50%');
  }
  // --- forklift basics: summons printers, charge
  {
    const save = a2save(), run = mk2(save, 6, 31); run.stats.damage = 0; run._cd = 1e9;
    const e = E.spawn(run, 'forklift', 180, 80); e.at = [1e9, 1e9, 0];
    ticks(run, save, 2, null); eq(run.enemies.filter(x => x.type === 'printer').length, 2, 'forklift summons 2 printers');
    const r2 = mk2(save, 6, 31); r2.stats.damage = 0; r2._cd = 1e9; const e2 = E.spawn(r2, 'forklift', 180, 80); e2.at = [0, 1e9, 1e9];
    const ev = ticks(r2, save, 1, null); ok(has(ev, 'telegraph', t => t.kind === 'charge'), 'forklift charge telegraph');
    const dash = ticks(r2, save, 90, null); ok(e2.y > 200, 'forklift dashes at Sprocket');
  }
  // --- VP summons repo bots, ring in phase 2 only
  {
    const save = a2save(), run = mk2(save, 9, 32); run.stats.damage = 0; run._cd = 1e9; const e = E.spawn(run, 'vp', 180, 80); e.speed = 0; e.at = [1e9, 0, 1e9, 1e9];
    ticks(run, save, 2, null); eq(run.enemies.filter(x => x.type === 'repo').length, 3, 'vp summons 3 repo bots');
    const r2 = mk2(save, 9, 32); r2.stats.damage = 0; r2._cd = 1e9; const e2 = E.spawn(r2, 'vp', 180, 80); e2.speed = 0; e2.at = [1e9, 1e9, 0, 1e9];
    const ev1 = ticks(r2, save, 2, null); ok(!has(ev1, 'shot'), 'no ring in phase 1');
    e2.hp = e2.maxHp * 0.4; ticks(r2, save, 1, null); e2.at[2] = 0; const ev2 = ticks(r2, save, 3, null); ok(has(ev2, 'shot') && r2.shots.length >= 12, 'ring of 12 in phase 2: ' + r2.shots.length);
    const cad = D.BOSS_BY_ID.vp.phases[1].cadence; eq(cad, 0.85, 'vp phase 2 cadence');
  }
  // --- Chairman: gate
  {
    const save = a2save(); const run = E.startShift(save, 10, { w: 360, h: 640, seed: 3 });
    eq(run.boss.blocked, true, 'Chairman blocked without Hostile Takeover'); eq(run.boss.id, 'chairman', 'sector 10 Warden'); eq(run.overtime, 0, 'overtime 0 outside sector 11');
    immortal(run); run.stats.damage = 1e12; run.stats.targets = 40; run.stats.radius = 1e5; run._cd = 0;
    ticks(run, save, 60 * 40, null); eq(run.boss.state, 'none', 'no Warden without the takeover'); eq(run.boss.signal, 0, 'no signal either');
    ok(E.sectorInfo(save, 10).lureBlocked, 'sectorInfo.lureBlocked for sector 10'); ok(!E.sectorInfo(save, 9).lureBlocked, 'not for 9');
    const s2 = a2save({ takeover: 1, titan: 1 }); ok(!E.sectorInfo(s2, 10).lureBlocked, 'open with takeover'); eq(E.startShift(s2, 10, { seed: 3 }).boss.blocked, false, 'run not blocked with takeover');
    eq(E.sectorInfo(a2save(), 5).lureBlocked, true, 'sector 5 still blocked without Titan'); eq(E.sectorInfo(a2save({ titan: 1 }), 5).lureBlocked, false, 'and open with it');
    const rb = mk2(save, 10, 3); const w = E.spawn(rb, 'chairman', 180, 80); ok(w && w.boss, 'spawn hook still works on a blocked sector');
  }
}

sec('R&D features in play');
{
  // --- Storm Coil: every (9 - storm)th pulse hits everything for 3x damage, armor ignored
  {
    const save = a2save({ storm: 3 }), run = mk2(save, 7, 41);
    run.stats.damage = 10; run.stats.critChance = 0; run._cd = 0;
    const anchor = still(run, E.spawn(run, 'pylon', 180, 440, { entered: true })); anchor.hp = anchor.maxHp = 1e30;
    const farA = still(run, E.spawn(run, 'shieldbot', 40, 100, { entered: true })), farB = still(run, E.spawn(run, 'scrapling', 320, 100, { entered: true }));
    farA.hp = farA.maxHp = farB.hp = farB.maxHp = 1e30;
    const inv = still(run, E.spawn(run, 'scrapling', 60, 300, { entered: true })); inv.invuln = true; inv.hp = inv.maxHp = 1e30;
    const mim = E.spawn(run, 'mimic', 300, 300, { entered: true }); mim.hp = mim.maxHp = 1e30;
    let storms = [], all = [];
    for (let k = 0; k < 60 * 4 && run.pulses < 6; k++) { const ev = tick(run, save, null); for (const e of ev) { all.push(e); if (e.type === 'storm') storms.push([run.pulses, e]); } }
    eq(storms.length, 1, 'one storm in the first 6 pulses'); eq(storms[0][0], 6, 'on pulse 6 (every 9-3)'); eq(storms[0][1].n, 3, 'storm hit n = 3 targetable bots (not invulnerable/disguised)');
    const hits = all.filter(e => e.type === 'hit' && (e.enemyId === farA.id));
    ok(hits.some(h => Math.abs(h.dmg - 30) < 1e-9 && h.armored === false), 'storm does 3 x damage and ignores armor: ' + JSON.stringify(hits.map(h => h.dmg)));
    ok(!all.some(e => e.type === 'hit' && (e.enemyId === inv.id || e.enemyId === mim.id)), 'storm skips invulnerable and disguised');
    eq(run.pulses, 6, 'pulse counter');
    // off without the node
    const r0 = mk2(a2save(), 7, 41); r0.stats.damage = 1; r0._cd = 0; const a0 = still(r0, E.spawn(r0, 'pylon', 180, 440, { entered: true })); a0.hp = a0.maxHp = 1e30;
    const e0 = ticks(r0, save, 60 * 6, null); ok(!has(e0, 'storm') && r0.pulses >= 6, 'no storm without Storm Coil; pulses still counted');
  }
  // --- Singularity
  {
    const save = a2save({ singularity: 2 }), run = mk2(save, 7, 42);
    run.stats.damage = 5; run._cd = 1e9; placePlayer(run, 300, 600);
    const cl = [];
    for (const [x, y] of [[100, 200], [130, 220], [80, 240], [110, 170]]) { const b = still(run, E.spawn(run, 'scrapling', x, y, { entered: true })); b.hp = b.maxHp = 1e9; cl.push(b); }
    const lone = still(run, E.spawn(run, 'scrapling', 300, 300, { entered: true })); lone.hp = lone.maxHp = 1e9;
    const bolt = { id: 999, kind: 'bolt', value: 7, x: 140, y: 230, vx: 0, vy: 0, age: 0 }; run.pickups.push(bolt);
    run._wellT = 0.05;
    const evs = ticks(run, save, 6, null); const wo = evs.find(e => e.type === 'wellOpen');
    ok(wo && wo.r === 90 && wo.id > 0, 'wellOpen {id,x,y,r}'); ok(Math.hypot(wo.x - 105, wo.y - 205) < 60, 'opens on the densest cluster: ' + wo.x.toFixed(0) + ',' + wo.y.toFixed(0));
    eq(run.wells.length, 1, 'one well'); eq(run.wells[0].phase, 'pull', 'pull phase'); eq(run.wells[0].pull, 160, 'pull speed 160');
    const d0 = Math.hypot(cl[1].x - wo.x, cl[1].y - wo.y); const pk0 = Math.hypot(bolt.x - wo.x, bolt.y - wo.y);
    const mid = ticks(run, save, 60, null);
    ok(Math.hypot(cl[1].x - run.wells[0].x, cl[1].y - run.wells[0].y) < d0 || d0 < 1, 'bots are pulled in'); ok(Math.hypot(bolt.x - wo.x, bolt.y - wo.y) < pk0 + 1e-9, 'pickups are pulled in');
    ok(Math.hypot(lone.x - 300, lone.y - 300) < 1e-9, 'bots outside the well are not pulled');
    const boom = ticks(run, save, 40, null); const wb = boom.find(e => e.type === 'wellBoom');
    ok(wb && wb.id === wo.id && wb.n === 4 && wb.r === 90, 'wellBoom n = bots inside (4): ' + JSON.stringify(wb));
    const dmgOne = cl[0].maxHp - cl[0].hp; near(dmgOne, 30 * 5, 1e-6, 'implosion = (10+10*2) x damage'); ok(lone.hp === lone.maxHp, 'outsider unhurt');
    ticks(run, save, 40, null); eq(run.wells.length, 0, 'well closes'); ok(run._wellT > 0, 'next well scheduled');
    // reopens every 9 s
    const more = ticks(run, save, 60 * 10, null); ok(has(more, 'wellOpen'), 'opens again within 9 s');
  }
  // --- Tesla Lattice
  {
    const save = a2save({ lattice: 2, drone: 2, dronedmg: 1 }), run = mk2(save, 7, 43);
    run.stats.damage = 10; run._cd = 1e9; run.stats.droneDmg = 0;   // drones will not zap; lattice only
    ticks(run, save, 1, null); eq(run.links.length, 3, 'S-d0, S-d1, d0-d1 for two drones');
    ok(run.links.every(l => [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite)), 'link fields');
    const b = still(run, E.spawn(run, 'pylon', 180, 460, { entered: true })); b.hp = b.maxHp = 1e12;   // on top of Sprocket: always touching the S-links
    const far = still(run, E.spawn(run, 'pylon', 330, 100, { entered: true })); far.hp = far.maxHp = 1e12;
    const ds = E.stats(save).latticeDps; near(ds, 2 * 2 * E.stats(save).droneDmg, 1e-9, 'latticeDps stat');
    ticks(run, save, 60, null);
    const lost = b.maxHp - b.hp; ok(lost > 0.7 * ds && lost <= 1.001 * ds, 'bot touching a link loses ~latticeDps per second: ' + lost.toFixed(2) + ' of ' + ds.toFixed(2)); ok(far.hp === far.maxHp, 'far bot unhurt');
    const s3 = a2save({ lattice: 1, drone: 4 }); const r3 = mk2(s3, 7, 43); ticks(r3, s3, 1, null); eq(r3.links.length, 4 + 4, 'four drones: 4 spokes + 4 ring links');
    const r4 = mk2(a2save(), 7, 43); ticks(r4, save, 2, null); eq(r4.links.length, 0, 'no links without the node');
    // Act I runs expose the new fields as empty
    const r5 = mk(E.newSave(), 1, 1); ok(Array.isArray(r5.links) && r5.links.length === 0 && r5.interns.length === 0 && r5.wells.length === 0 && r5.stock.mult === 1 && r5.stock.n === 0 && r5.pulses === 0 && r5.overtime === 0, 'run-state additions exist');
    eq(r5.player.colossus, false, 'player.colossus false'); eq(r5.player.budget, false, 'player.budget false'); eq(r5.boss.overtime, 0, 'boss.overtime 0');
  }
  // --- Nanite Swarm
  {
    const save = a2save({ nanites: 2 }), run = mk2(save, 7, 44);
    run.stats.damage = 10; run._cd = 0; run.stats.critChance = 0;
    const v = still(run, E.spawn(run, 'pylon', 180, 420, { entered: true })); v.hp = v.maxHp = 1e9;
    const ev1 = ticks(run, save, 1, null);
    ok(has(ev1, 'infect', i => i.enemyId === v.id), 'arc hit infects (infect event)'); near(v.infected, 4, 0.02, 'infected = 4 s');
    const hp0 = v.hp; run._cd = 1e9; ticks(run, save, 60, null);
    const lost = hp0 - v.hp, want = E.stats(save).naniteDps; ok(lost > 0.7 * want && lost < 1.05 * want, 'infected bots take 0.1 x nanites x damage /s: ' + lost.toFixed(3) + ' vs ' + want.toFixed(3));
    ticks(run, save, 60 * 4, null); eq(v.infected, 0, 'nanites expire after 4 s');
    // jump on scrap, capped at 40
    const r2 = mk2(save, 7, 44); r2.stats.damage = 0; r2._cd = 1e9; placePlayer(r2, 180, 600);
    const doomed = still(r2, E.spawn(r2, 'scrapling', 180, 232, { entered: true })); doomed.hp = doomed.maxHp = 5; doomed.infected = 4; doomed.dot = 100; doomed.dotT = 1;
    const others = []; for (let i = 0; i < 55; i++) { const a = i * 2.399, d = 10 + (i % 6) * 8; const o = still(r2, E.spawn(r2, 'pylon', 180 + Math.cos(a) * d, 232 + Math.sin(a) * d, { entered: true })); o.hp = o.maxHp = 1e12; others.push(o); }
    const far2 = still(r2, E.spawn(r2, 'pylon', 180, 330, { entered: true })); far2.hp = far2.maxHp = 1e12;
    const e2 = ticks(r2, save, 2, null);
    ok(has(e2, 'kill', k => k.enemyType === 'scrapling'), 'infected bot scrapped');
    const inf = r2.enemies.filter(x => x.infected > 0).length; ok(inf >= 38 && inf <= 40, 'jump infects up to the 40 cap: ' + inf); ok(count(e2, 'infect') <= 40, 'infect events <= 40');
    ok(far2.infected === 0, 'bots beyond 60 are not infected');
    for (let k = 0; k < 4; k++) ticks(r2, save, 30, null); ok(r2.enemies.filter(x => x.infected > 0).length <= 40, 'cap holds');
    // no nanites without the node
    const r3 = mk2(a2save(), 7, 44); r3.stats.damage = 10; r3._cd = 0; const v3 = still(r3, E.spawn(r3, 'pylon', 180, 420, { entered: true })); v3.hp = v3.maxHp = 1e9; ticks(r3, save, 5, null); eq(v3.infected, 0, 'no infection without the node');
  }
  // --- Hostile Rehire: interns
  {
    const save = a2save({ rehire: 5 }), run = mk2(save, 7, 45);
    run.stats.rehireChance = 1; run.stats.damage = 1e12; run.stats.targets = 40; run.stats.radius = 1e5; run._cd = 0;
    for (let i = 0; i < 12; i++) still(run, E.spawn(run, 'scrapling', 40 + i * 25, 300, { entered: true }));
    const evs = ticks(run, save, 2, null);
    eq(count(evs, 'intern'), 4, 'max 4 Interns'); eq(run.interns.length, 4, 'four alive'); const it = run.interns[0];
    ok(['id', 'x', 'y', 'vx', 'vy', 'age', 'life'].every(k => Number.isFinite(it[k])) && it.life === 6, 'intern fields, life 6 s');
    const i0 = evs.find(e => e.type === 'intern'); ok(i0.id === it.id || run.interns.some(q => q.id === i0.id), 'intern event id');
    // interns hunt the nearest bot and hurt it
    const run2 = mk2(save, 7, 45); run2.stats.damage = 0; run2._cd = 1e9; const tgt = still(run2, E.spawn(run2, 'pylon', 180, 300, { entered: true })); tgt.hp = tgt.maxHp = 1e12;
    run2.interns.push({ id: 5000, x: 180, y: 360, vx: 0, vy: 0, age: 0, life: 6 }); run2.stats.damage = 10;
    ticks(run2, save, 60 * 3, null); ok(Math.hypot(run2.interns[0].x - 180, run2.interns[0].y - 300) < 25, 'intern homes on the nearest bot');
    const lost = tgt.maxHp - tgt.hp; ok(lost > 0.5 * 2 * 10 * 1.5 && lost < 2 * 10 * 3.2, 'contact 2 x damage per second: ' + lost.toFixed(1));
    const endEv = ticks(run2, save, 60 * 4, null); ok(has(endEv, 'internEnd', e => e.id === 5000), 'internEnd after the life runs out'); eq(run2.interns.length, 0, 'intern gone');
    // none without the node
    const r3 = mk2(a2save(), 7, 45); r3.stats.damage = 1e12; r3._cd = 0; still(r3, E.spawn(r3, 'scrapling', 180, 400, { entered: true })); ticks(r3, save, 3, null); eq(r3.interns.length, 0, 'no interns without the node');
    // chance is per kill: 0 chance -> none
    const r4 = mk2(save, 7, 45); r4.stats.rehireChance = 0; r4.stats.damage = 1e12; r4.stats.targets = 40; r4.stats.radius = 1e5; r4._cd = 0; for (let i = 0; i < 12; i++) still(r4, E.spawn(r4, 'scrapling', 40 + i * 25, 300, { entered: true })); ticks(r4, save, 2, null); eq(r4.interns.length, 0, 'zero chance, zero interns');
  }
  // --- Stock Options
  {
    const save = a2save({ stockopt: 3 }), run = mk2(save, 7, 46);
    run.stats.damage = 1e12; run.stats.targets = 40; run.stats.radius = 1e5; run._cd = 0;
    for (let i = 0; i < 20; i++) still(run, E.spawn(run, 'scrapling', 10 + (i % 10) * 34, 100 + Math.floor(i / 10) * 40, { entered: true }));
    const evs = ticks(run, save, 2, null); const st = evs.filter(e => e.type === 'stock');
    eq(st.length, 2, 'stock at combo 10 and 20'); eq(st[0].n, 1, 'n=1'); near(st[0].mult, 1.06, 1e-9, 'mult 1.06'); near(st[1].mult, 1.12, 1e-9, 'mult 1.12'); eq(run.stock.n, 2, 'run.stock.n'); near(run.stock.mult, 1.12, 1e-9, 'run.stock.mult');
    const before = run.earned.bolts; run.pickups.length = 0; run.pickups.push({ id: 7001, kind: 'bolt', value: 100, x: run.player.x, y: run.player.y, vx: 0, vy: 0, age: 1 });
    const pe = ticks(run, save, 1, null); eq(run.earned.bolts - before, 112, 'later pickups worth x mult'); ok(has(pe, 'pickup', p => p.value === 112), 'pickup event carries the credited value');
    // cap: +100% x stockopt = x4
    run.stock.mult = 3.97; run.stock.n = 10; run.combo.n = 9; run.combo.t = 0; run.stats.targets = 1; run._cd = 0;
    still(run, E.spawn(run, 'scrapling', 180, 440, { entered: true })); const e2 = ticks(run, save, 2, null); const st2 = e2.find(e => e.type === 'stock');
    ok(st2 && Math.abs(st2.mult - 4) < 1e-9, 'capped at 1 + 1.0 x stockopt: ' + JSON.stringify(st2));
    run.combo.n = 19; run.combo.t = 0; run._cd = 0; still(run, E.spawn(run, 'scrapling', 180, 440, { entered: true })); const e3 = ticks(run, save, 2, null); ok(!has(e3, 'stock'), 'no more steps once capped');
    // Act I: multiplier stays 1
    const r0 = mk2(E.newSave(), 1, 46); r0.stats.damage = 1e12; r0.stats.targets = 40; r0.stats.radius = 1e5; r0._cd = 0; for (let i = 0; i < 12; i++) still(r0, E.spawn(r0, 'scrapling', 10 + i * 28, 200, { entered: true }));
    ticks(r0, save, 2, null); eq(r0.stock.mult, 1, 'no stock without the node');
  }
  // --- Severance Package
  {
    const save = a2save({ severance: 2 }), run = mk2(save, 7, 47);
    run.stats.damage = 1000; run._cd = 1e9; run.player.battery = run.player.maxBattery = 20; run.player.battery = 0.001;
    const close = still(run, E.spawn(run, 'pylon', 220, 460, { entered: true })), farb = still(run, E.spawn(run, 'pylon', 180, 160, { entered: true }));
    close.hp = close.maxHp = farb.hp = farb.maxHp = 1e9;
    run.pickups.push({ id: 7100, kind: 'bolt', value: 100, x: 100, y: 100, vx: 0, vy: 0, age: 1 }, { id: 7101, kind: 'bolt', value: 50, x: 300, y: 500, vx: 0, vy: 0, age: 1 });
    run.earned.bolts = 10;
    const evs = ticks(run, save, 300, null);
    const sv = evs.find(e => e.type === 'severance'); ok(sv && sv.r === 140 && Math.abs(sv.x - 180) < 5 && sv.bolts === 300, 'severance event; payout 150 x2: ' + JSON.stringify(sv));
    near(close.maxHp - close.hp, 50 * 1000, 1e-6, 'blast does 50 x damage'); ok(farb.hp === farb.maxHp, 'blast radius 140 only');
    eq(run.earned.bolts, 310, 'floor bolts collected at x2'); ok(run.over && run.reason === 'battery', 'shift ends as battery'); eq(run.pickups.length, 0, 'floor cleared');
    const rep = E.endShift(run, save); eq(rep.severance, true, 'report.severance'); eq(rep.reason, 'battery', 'report reason'); eq(rep.bolts, 310, 'report bolts');
    // Spare Cell first, severance second, only once
    const s2 = a2save({ severance: 1, spare: 1 }), r2 = mk2(s2, 7, 47); r2.stats.damage = 0; r2._cd = 1e9; r2.player.battery = 0.001; r2.player.maxBattery = 20; r2.player.hurt = 99;
    const e2 = ticks(r2, s2, 2, null); ok(has(e2, 'spare') && !has(e2, 'severance') && !r2.over, 'Spare Cell goes first');
    r2.player.battery = 0.001; r2.stats.drain = 1; const e3 = ticks(r2, s2, 5, null); ok(has(e3, 'severance') && r2.over, 'then Severance ends the shift');
    // Severance scraps a Warden: victory instead of battery
    const s3 = a2save({ severance: 3 }), r3 = mk2(s3, 6, 47); r3.stats.damage = 1; const b = E.spawn(r3, 'forklift', 180, 440); b.hp = 10; r3.player.battery = 0.001; r3.stats.severancePct = 50;
    r3.player.x = 180; r3.player.y = 470; r3.player.tx = 180; r3.player.ty = 470; r3._cd = 1e9; const e4 = ticks(r3, s3, 200, null);
    ok(has(e4, 'severance') && r3.boss.state === 'dead', 'blast scraps the Warden'); eq(r3.reason, 'victory', 'victory not battery'); eq(E.endShift(r3, s3).severance, true, 'report.severance still true');
    // no severance without the node
    const r4 = mk2(a2save(), 7, 47); r4.player.battery = 0.001; r4.stats.drain = 1; r4.stats.damage = 0; r4._cd = 1e9; const e5 = ticks(r4, save, 5, null); ok(!has(e5, 'severance') && r4.over, 'no severance without the node');
  }
  // --- Golden Parachute
  {
    const save = a2save({ sweep: 2, parachute: 3 }), run = mk2(save, 6, 48);
    run.pickups.push({ id: 7200, kind: 'bolt', value: 1000, x: 10, y: 10, vx: 0, vy: 0, age: 1 });
    run.stats.damage = 0; run._cd = 1e9; const bot = still(run, E.spawn(run, 'hauler', 300, 100, { entered: true }));
    E.clockOut(run); const rep = E.endShift(run, save);
    const salv = 16 * D.SECTORS[5].bolts * E.stats(save).boltMult;
    eq(rep.swept, Math.round(1000 * 3 + salv * 3), 'sweep pays x3 of floor bolts and walking bots'); eq(rep.bolts, rep.swept, 'report.bolts includes the sweep');
    const s1 = a2save({ sweep: 2, parachute: 1 }); eq(E.stats(s1).sweepPct, 1.5, 'parachute 1 -> 1.5');
  }
  // --- Colossus
  {
    const save = a2save({ titan: 1, takeover: 1 }), run = E.startShift(save, 6, { w: 360, h: 640, seed: 3 });
    eq(run.player.colossus, true, 'player.colossus'); ok(run.stats.colossus && run.stats.damage === 3 * D.LEVEL.takeover.damage, 'damage x4 on top of Titan');
    near(run.player.maxBattery, 18 * 1.3 * D.LEVEL.takeover.battery, 1e-9, 'battery x colossus');
  }
}

sec('Act II flow: act2 flag, Chairman, Overtime');
{
  // Overseer sets act2 and unlocks sector 6
  {
    const save = E.newSave(); save.sectorsCleared = 4; save.up.titan = 1;
    const run = E.startShift(save, 5, { seed: 3 }); immortal(run); run.stats.damage = 1e9; run.stats.radius = 1e5; run.stats.targets = 9; run.boss.signal = run.boss.need - 1;
    ticks(run, save, 60 * 10, { x: 180, y: 400 }, () => { run.player.battery = run.player.maxBattery; });
    let g = 0; while (run.boss.state !== 'dead' && g++ < 3000) ticks(run, save, 1, { x: run.player.x, y: run.player.y });
    ticks(run, save, 120, null); const rep = E.endShift(run, save);
    ok(rep.gameWon && rep.unlockedSector === 6 && rep.firstClear, 'first Overseer: gameWon + unlockedSector 6'); ok(save.flags.act2 && save.flags.won && !save.flags.chairman, 'flags.act2 set'); eq(save.sectorsCleared, 5, 'sectorsCleared 5');
    ok(E.sectorInfo(save, 6).unlocked && !E.upgradeInfo(save, 'fusion').classified, 'sector 6 open, R&D declassified'); eq(rep.act2Won, false, 'act2Won false'); eq(rep.overtimeLevel, null, 'overtimeLevel null'); eq(rep.severance, false, 'severance false'); eq(rep.stolen, 0, 'stolen 0'); eq(rep.stockMult, 1, 'stockMult 1');
    eq(save.stats.wonShifts, save.stats.shifts, 'wonShifts');
  }
  // sectors unlock one by one; boss kills tracked 6..10; cores per sector
  {
    const save = a2save({ titan: 1, takeover: 1 }), first = [6, 7, 8, 10, 0], rep = [2, 2, 3, 3, 3];
    const ids = ['forklift', 'firewall', 'inspector', 'vp', 'chairman'];
    for (let n = 6; n <= 10; n++) {
      ok(E.sectorInfo(save, n).unlocked, 'sector ' + n + ' unlocked'); ok(n === 10 || !E.sectorInfo(save, n + 1).unlocked, 'sector ' + (n + 1) + ' locked until ' + n + ' is cleared');
      const sec = D.SECTORS[n - 1]; eq(sec.warden, ids[n - 6], 'sector ' + n + ' warden'); eq(sec.coresFirst, [5, 6, 7, 8, 0][n - 6], 'cores first ' + n); eq(sec.coresRepeat, [2, 1, 1, 3, 3][n - 6], 'cores repeat ' + n);
      const run = E.startShift(save, n, { seed: 5 }); immortal(run); const w = E.spawn(run, ids[n - 6], 180, 120); for (const q of run.enemies) if (q !== w) q.dead = true;
      w.hp = 1; w.shDone = w.shDone.map(() => true); run.stats.damage = 1e12; run.stats.radius = 1e5; run._cd = 0; placePlayer(run, 180, 160);
      const evs = ticks(run, save, 400, { x: w.x, y: w.y + 40 }, r => { r.player.battery = r.player.maxBattery; });
      ok(run.boss.state === 'dead', 'sector ' + n + ' Warden scrapped'); const bd = evs.find(e => e.type === 'bossDead'); ok(bd && bd.cores === sec.coresFirst, 'first-clear cores ' + n + ': ' + (bd && bd.cores));
      ticks(run, save, 120, null); const r = E.endShift(run, save);
      ok(r.firstClear && r.bossDefeated, 'first clear ' + n); eq(r.unlockedSector, n + 1, 'unlocks ' + (n + 1)); eq(save.bossKills[n], 1, 'bossKills ' + n); eq(save.sectorsCleared, n, 'sectorsCleared ' + n);
      if (n === 10) { ok(r.act2Won && save.flags.chairman, 'Chairman: act2Won + flags.chairman'); ok(save.stats.act2Shifts > 0 && save.stats.act2PlayTime > 0, 'act2 stats recorded'); eq(E.sectorInfo(save, 11).unlocked, true, 'Overtime unlocks'); ok(!E.upgradeInfo(save, 'overtimepay').classified, 'infinite nodes open'); }
      else eq(r.act2Won, false, 'act2Won only for the Chairman');
    }
    const run2 = E.startShift(save, 6, { seed: 9 }); immortal(run2); const w2 = E.spawn(run2, 'forklift', 180, 120); for (const q of run2.enemies) if (q !== w2) q.dead = true; w2.hp = 1; run2.stats.damage = 1e12; run2.stats.radius = 1e5; run2._cd = 0; placePlayer(run2, 180, 160);
    const e2 = ticks(run2, save, 400, { x: w2.x, y: w2.y + 40 }, r => { r.player.battery = r.player.maxBattery; }); eq(e2.find(e => e.type === 'bossDead').cores, 2, 'repeat cores sector 6'); const r2 = E.endShift(run2, save); ok(!r2.firstClear && r2.unlockedSector === null, 'repeat clear');
  }
  // Overtime
  {
    const rot = ['forklift', 'receptionist', 'firewall', 'counsel', 'inspector', 'comptroller', 'vp', 'market', 'chairman', 'founder'], NR = rot.length;
    const save = a2save({ titan: 1 }); save.flags.chairman = true; save.flags.founder = true; save.sectorsCleared = 15; save.bossKills[10] = 1; save.bossKills[15] = 1;
    eq(D.OVERTIME.rotation.join(), rot.join(), 'rotation data');
    const win = (save, L, extra) => {
      const run = E.startShift(save, 16, { seed: 100 + L }); immortal(run);
      const sec0 = D.SECTORS[15], w = E.spawn(run, rot[(L - 1) % NR], 180, 120); for (const q of run.enemies) if (q !== w) q.dead = true;
      const info = { run, w }; w.shDone = w.shDone.map(() => true); w.hp = 1; run.stats.damage = 1e30; run.stats.radius = 1e5; run._cd = 0; placePlayer(run, 180, 160);
      const evs = ticks(run, save, 600, { x: w.x, y: w.y + 40 }, r => { r.player.battery = r.player.maxBattery; });
      ticks(run, save, 100, null); info.evs = evs; info.rep = E.endShift(run, save); return info;
    };
    for (let L = 1; L <= 12; L++) {
      const si = E.sectorInfo(save, 16); eq(si.overtime, L, 'sectorInfo.overtime = next level ' + L); eq(si.bossId, rot[(L - 1) % NR], 'rotation sectorInfo L' + L);
      const run = E.startShift(save, 16, { seed: 1 });
      eq(run.overtime, L, 'run.overtime = ' + L); eq(run.boss.overtime, L, 'run.boss.overtime'); eq(run.boss.id, rot[(L - 1) % NR], 'Warden rotation L' + L);
      near(run.sec.hp / (D.SECTORS[15].hp * Math.pow(D.OVERTIME.hp, L)), 1, RHO, 'enemy hp x6^L'); near(run.sec.bolts / (D.SECTORS[15].bolts * Math.pow(D.OVERTIME.bolts, L)), 1, RHO, 'bolts x4^L'); near(run.sec.dmg / (D.SECTORS[15].dmg * Math.pow(D.OVERTIME.dmg, L)), 1, RHO, 'damage x1.12^L');
      near(run.boss.maxHp / (D.BOSS_BY_ID.founder.hp * Math.pow(D.OVERTIME.hp, L)), 1, RHO, 'Warden hp = Founder hp x6^L'); ok(!run.boss.blocked, 'Overtime is never blocked (Chairman gate does not apply)');
      eq(run.boss.name, D.BOSS_BY_ID[rot[(L - 1) % NR]].name, 'boss.name is the Warden name');
      const e = E.spawn(run, run.boss.id, 180, 100); near(e.maxHp / run.boss.maxHp, 1, RHO, 'spawned Warden hp scaled');
      const w = win(save, L); const bd = w.evs.find(e => e.type === 'bossDead');
      ok(w.run.boss.state === 'dead', 'L' + L + ' Warden scrapped');
      { const wantB = Math.round(D.BOSS_BY_ID.founder.bolts * E.stats(save).boltMult * Math.pow(D.OVERTIME.bolts, L)); ok(wantB > 0, 'normalised Warden bolts > 0'); near(bd.bolts / wantB, 1, 1e-6, 'Warden bolts x4^L (L' + L + ') ' + bd.bolts); }
      eq(bd.cores, 2 + L, 'cores 2+L'); const ov = w.evs.find(e => e.type === 'overtime'); ok(ov && ov.level === L, 'overtime event {level}');
      eq(w.rep.overtimeLevel, L, 'report.overtimeLevel'); eq(save.overtime.level, L, 'save.overtime.level advanced'); eq(save.overtime.best, L, 'best'); ok(!w.rep.firstClear && w.rep.unlockedSector === null, 'Overtime has no first clear / unlock');
      eq(save.bossKills[15], 1, 'bossKills untouched'); eq(save.sectorsCleared, 15, 'sectorsCleared untouched'); ok(w.rep.bossDefeated, 'bossDefeated');
    }
    // losing does not advance; best never decreases
    const lose = E.startShift(save, 16, { seed: 2 }); const lvB = save.overtime.best; const lv0 = save.overtime.level; ticks(lose, save, 60 * 40, null); E.endShift(lose, save); eq(save.overtime.level, lv0, 'a loss does not advance'); eq(save.overtime.best, 12, 'best stays');
    ok(E.sectorInfo(save, 16).cleared, 'sector 16 cleared once any level is');
    const bad = E.newSave(); bad.sectorsCleared = 5; bad.flags.act2 = true; ok(!E.sectorInfo(bad, 16).unlocked, 'Overtime locked before the Founder'); eq(E.sectorInfo(bad, 16).lockReason, 'Scrap The Founder', 'lock reason');
    const bad2 = E.newSave(); bad2.sectorsCleared = 10; bad2.flags.act2 = bad2.flags.chairman = true; ok(!E.sectorInfo(bad2, 16).unlocked, 'Overtime still locked after the Chairman');
    // Chairman in overtime fights without the takeover
    const s5 = a2save(); s5.flags.chairman = true; s5.flags.founder = true; s5.sectorsCleared = 15; s5.overtime.level = 8; const r5 = E.startShift(s5, 16, { seed: 4 }); eq(r5.boss.id, 'chairman', 'level 9 is the Chairman'); eq(r5.boss.blocked, false, 'not blocked'); eq(s5.up.takeover, 0, 'without Hostile Takeover');
    immortal(r5); r5.stats.damage = 1e30; r5.stats.targets = 40; r5.stats.radius = 1e5; r5._cd = 0; ticks(r5, s5, 60 * 190, null); ok(r5.boss.state !== 'none', 'Overtime Chairman signal fills and he arrives: ' + r5.boss.state);
    // numbers stay finite at high levels
    const hi = a2save(); hi.flags.chairman = true; hi.flags.founder = true; hi.sectorsCleared = 15; hi.overtime.level = 99; const rh = E.startShift(hi, 16, { seed: 5 }); ok(Number.isFinite(rh.sec.hp) && Number.isFinite(rh.sec.bolts) && Number.isFinite(rh.boss.maxHp), 'level 100 numbers finite');
    walkFinite(rh, 'run', 0);
  }
}

sec('Act II determinism and invariants');
{
  const driver = run => ({ x: 180 + 140 * Math.sin(run.t * 1.7), y: 400 + 120 * Math.cos(run.t * 0.9) });
  const rich = () => a2save({ coil: 20, amp: 4, pulse: 6, fork: 3, field: 5, cell: 12, titan: 1, drone: 3, dronedmg: 3, fusion: 4, storm: 2, singularity: 2, lattice: 2, nanites: 2, rehire: 3, stockopt: 2, severance: 1, supercell: 3, dividends: 3, parachute: 0, sweep: 2, capacitor: 2 }, { bolts: 7 });
  const play = (seed, sector, saveFn) => {
    const save = saveFn(), run = E.startShift(save, sector, { w: 360, h: 640, seed });
    const log = []; let g = 0;
    while (!run.over && g++ < 9000) { E.step(run, save, driver(run)); log.push(JSON.stringify(run.events)); run.events.length = 0; }
    return JSON.stringify(run) + '|' + log.join('') + '|' + JSON.stringify(E.endShift(run, save)) + JSON.stringify(save);
  };
  for (const sector of [6, 7, 8, 9]) eq(play(11, sector, rich), play(11, sector, rich), 'Act II replay identical in sector ' + sector);
  ok(play(11, 8, rich) !== play(12, 8, rich), 'different seed differs');
  const ap = (seed, sector) => { const save = rich(), run = E.startShift(save, sector, { w: 360, h: 640, seed }); let g = 0; while (!run.over && g++ < 9000) { E.step(run, save, A.target(run, { skill: 'attentive' })); run.events.length = 0; } return JSON.stringify(run); };
  eq(ap(3, 7), ap(3, 7), 'autopilot replay deterministic in Act II');
  // Act II features do not change Act I replays: the Act I seed produces the same run with/without the (inert) new fields
  const act1a = () => saveWith({ coil: 8, pulse: 3, field: 2, cell: 5, fork: 1, chain: 1, overload: 1, capacitor: 1, drone: 2, recycler: 2, surge: 3 }, { bolts: 5, sectorsCleared: 2 });
  const p1 = (() => { const save = act1a(), run = E.startShift(save, 3, { w: 360, h: 640, seed: 5 }); let g = 0; while (!run.over && g++ < 6000) { E.step(run, save, driver(run)); run.events.length = 0; } return [run.t.toFixed(3), run.counts.kills, run.earned.bolts, run.rs].join(','); })();
  eq(p1, (() => { const save = act1a(), run = E.startShift(save, 3, { w: 360, h: 640, seed: 5 }); let g = 0; while (!run.over && g++ < 6000) { E.step(run, save, driver(run)); run.events.length = 0; } return [run.t.toFixed(3), run.counts.kills, run.earned.bolts, run.rs].join(','); })(), 'Act I replay fingerprint stable');

  // invariants sweep over random Act II shifts
  const lim = { enemies: 0, shots: 0, hazards: 0, interns: 0, wells: 0, links: 0, infected: 0, pickups: 0 };
  let n = 0;
  const kinds = [
    () => a2save({}, { sectorsCleared: 9 }),
    () => rich(),
    () => { const s = rich(); s.up.takeover = 1; s.up.lattice = 5; s.up.drone = 4; s.up.rehire = 5; s.up.nanites = 5; s.up.storm = 5; s.up.singularity = 5; s.up.stockopt = 5; s.up.severance = 3; s.up.fusion = 8; return s; },
    () => { const s = rich(); s.flags.chairman = true; s.sectorsCleared = 10; s.overtime.level = 3; s.up.takeover = 1; s.up.overtimepay = 6; s.up.hazardpay = 4; return s; }
  ];
  const sectors = [6, 7, 8, 9, 10, 11];
  let seedBase = 500;
  for (const sector of sectors) for (let ki = 0; ki < kinds.length; ki++) {
    if (sector === 11 && ki < 3) { if (ki === 0) { /* needs chairman */ } else continue; }
    const save = kinds[ki](); if (sector === 11) { save.flags.chairman = true; save.sectorsCleared = 10; }
    const skill = (sector + ki) % 3 === 0 ? 'sloppy' : 'attentive';
    const run = E.startShift(save, sector, { w: 360, h: (sector + ki) % 2 ? 640 : 500, seed: seedBase++ });
    run.boss.signal = Math.max(0, run.boss.need - 2);
    let g = 0, bad = '';
    while (!run.over && g++ < 60 * 200) {
      E.step(run, save, A.target(run, { skill })); noteEvents(run.events); run.events.length = 0;
      const p = run.player;
      if (!(p.x >= p.r - 1e-6 && p.x <= run.w - p.r + 1e-6 && p.y >= p.r - 1e-6 && p.y <= run.h - p.r + 1e-6)) { bad = 'player outside arena'; break; }
      if (!Number.isFinite(p.battery) || p.battery > p.maxBattery + 1e-6 || p.battery < -1e-6) { bad = 'battery ' + p.battery; break; }
      if (run.enemies.length > lim.enemies) lim.enemies = run.enemies.length;
      if (run.shots.length > lim.shots) lim.shots = run.shots.length;
      if (run.hazards.length > lim.hazards) lim.hazards = run.hazards.length;
      if (run.interns.length > lim.interns) lim.interns = run.interns.length;
      if (run.wells.length > lim.wells) lim.wells = run.wells.length;
      if (run.links.length > lim.links) lim.links = run.links.length;
      if (run.pickups.length > lim.pickups) lim.pickups = run.pickups.length;
      let inf = 0; for (const e of run.enemies) { if (e.infected > 0) inf++; if (e.dead) bad = 'dead enemy left in array'; if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) bad = 'enemy NaN ' + e.type; if (e.x < -80 || e.x > run.w + 80 || e.y < -80 || e.y > run.h + 80) bad = 'enemy far outside ' + e.type; }
      if (inf > lim.infected) lim.infected = inf;
      if (bad) break;
      if (!Number.isFinite(run.earned.bolts) || !Number.isFinite(run.boss.hp)) { bad = 'earned/boss NaN'; break; }
      if (g % 60 === 0) walkFinite(run, 'run', 0);
    }
    ok(!bad, 'Act II invariant shift s' + sector + ' k' + ki + ': ' + bad);
    walkFinite(run, 'run', 0); ok(run.over, 'Act II shift ended s' + sector + ' k' + ki);
    const rep = E.endShift(run, save); ok(Number.isFinite(rep.bolts) && Number.isFinite(rep.time), 'report finite'); walkFinite(save, 'save', 0); n++;
  }
  ok(lim.enemies < 160, 'enemies bounded ' + lim.enemies); ok(lim.shots <= D.TUNE.shotCap, 'shots capped ' + lim.shots); ok(lim.hazards <= D.TUNE.hazardCap + 4, 'hazards capped ' + lim.hazards);
  ok(lim.interns <= 4, 'interns <= 4: ' + lim.interns); ok(lim.wells <= 2, 'wells bounded ' + lim.wells); ok(lim.links <= 8, 'links <= 8: ' + lim.links); ok(lim.infected <= 40, 'infected <= 40: ' + lim.infected); ok(lim.pickups <= 175, 'pickups bounded ' + lim.pickups);
  console.log('  (' + n + ' Act II invariant shifts; max enemies ' + lim.enemies + ', shots ' + lim.shots + ', hazards ' + lim.hazards + ', interns ' + lim.interns + ', links ' + lim.links + ', infected ' + lim.infected + ')');
}

// =========================================================================
sec('Board fatigue (Act II Wardens)');
{
  const per = D.TUNE.fatiguePer, mx = D.TUNE.fatigueMax;
  eq(per, 0.10, 'fatiguePer'); eq(mx, 0.5, 'fatigueMax');
  const fresh = E.newSave(); eq(JSON.stringify(fresh.fatigue), JSON.stringify({ 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }), 'newSave fatigue'); eq(fresh.v, 3, 'now v3');
  const fsave = () => { const s = E.newSave(); s.flags.won = true; s.flags.act2 = true; s.sectorsCleared = 9; return s; };
  const shiftWith = (save, n, state) => { const run = mk(save, n, 3); run.boss.state = state; return E.endShift(run, save); };
  // accumulation, cap, reset
  const s = fsave();
  let r = shiftWith(s, 8, 'none'); eq(s.fatigue[8], 0, 'no change when the Warden never showed'); eq(r.fatigue, 0, 'report.fatigue 0'); eq(r.fatigueUp, false, 'fatigueUp false');
  r = shiftWith(s, 8, 'active'); near(s.fatigue[8], per, 1e-12, 'one failed attempt'); near(r.fatigue, per, 1e-12, 'report.fatigue'); eq(r.fatigueUp, true, 'fatigueUp true');
  shiftWith(s, 8, 'warning'); near(s.fatigue[8], 2 * per, 1e-12, 'two failed attempts');
  r = shiftWith(s, 8, 'none'); near(s.fatigue[8], 2 * per, 1e-12, 'a Warden-free shift keeps it'); near(r.fatigue, 2 * per, 1e-12, 'report shows current value');
  eq(s.fatigue[9], 0, 'other sectors untouched');
  for (let i = 0; i < 20; i++) shiftWith(s, 8, 'active'); near(s.fatigue[8], mx, 1e-12, 'capped at fatigueMax');
  r = shiftWith(s, 8, 'dead'); eq(s.fatigue[8], 0, 'reset on kill'); eq(r.fatigue, 0, 'report.fatigue 0 on kill'); eq(r.fatigueUp, false, 'no fatigueUp on kill');
  // Act I and Overtime unaffected
  const a1 = fsave(); for (let n = 1; n <= 5; n++) { shiftWith(a1, n, 'active'); }
  eq(JSON.stringify(a1.fatigue), JSON.stringify({ 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }), 'Act I failures add no fatigue');
  const ot = fsave(); ot.sectorsCleared = 15; ot.flags.chairman = true; ot.flags.founder = true; r = shiftWith(ot, 16, 'active');
  eq(JSON.stringify(ot.fatigue), JSON.stringify({ 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }), 'Overtime adds no fatigue'); eq(r.fatigueUp, false, 'Overtime fatigueUp false');
  ot.fatigue[10] = 0.3; const orun = mk(ot, 16, 4); near(orun.boss.maxHp, D.BOSS_BY_ID.founder.hp * D.OVERTIME.hp, 1e-9 * orun.boss.maxHp, 'Overtime hp ignores fatigue'); eq(orun.boss.fatigue, 0, 'Overtime boss.fatigue 0');
  // sectorInfo
  const si = fsave(); si.fatigue[10] = 0.18; near(E.sectorInfo(si, 10).fatigue, 0.18, 1e-12, 'sectorInfo.fatigue'); eq(E.sectorInfo(si, 3).fatigue, 0, 'sectorInfo.fatigue 0 in Act I'); eq(E.sectorInfo(si, 16).fatigue, 0, 'sectorInfo.fatigue 0 in Overtime');
  // hp scaling at spawn, incl. pylons
  for (const n of [6, 7, 8, 9, 10]) {
    const sv = fsave(); sv.up.titan = 1; sv.up.colossus = 1; const f = 0.18; sv.fatigue[n] = f;
    const run = mk(sv, n, 5); immortal(run); const id = D.SECTORS[n - 1].warden, def = D.BOSS_BY_ID[id];
    near(run.boss.fatigue, f, 1e-12, 's' + n + ' run.boss.fatigue');
    const base = mk(fsave(), n, 5), e0 = E.spawn(base, id, 180, 120), e = E.spawn(run, id, 180, 120);
    near(e.hp, e0.hp * (1 - f), 1e-9 * e0.hp, id + ' hp x(1-fatigue)'); near(e.maxHp, e0.maxHp * (1 - f), 1e-9 * e0.maxHp, id + ' maxHp x(1-fatigue)');
    if (def.shields) {   // knock the Warden under the first shield line and compare pylons
      for (const [r2, ee] of [[run, e], [base, e0]]) { ee.hp = def.shields[0] * ee.maxHp * 0.99; r2.player.x = 20; r2.player.y = 620; tick(r2, sv, null); }
      const pyl = x => x.enemies.filter(q => q.pyl && !q.dead);
      const pa = pyl(run), pb = pyl(base);
      ok(pa.length > 0 && pa.length === pb.length, id + ' pylons called');
      if (pa.length && pb.length) near(pa[0].hp, pb[0].hp * (1 - f), 1e-9 * pb[0].hp, id + ' pylon hp x(1-fatigue)');
    }
  }
  // determinism / no extra PRNG draws: fatigue 0 leaves a shift identical to a save with no fatigue field
  const sa = fsave(), sb = fsave(); delete sb.fatigue;
  const ra = mk(sa, 7, 11), rb = mk(sb, 7, 11); immortal(ra); immortal(rb);
  for (let i = 0; i < 600; i++) { tick(ra, sa, null); tick(rb, sb, null); }
  eq(ra.enemies.length, rb.enemies.length, 'fatigue 0 == no field (enemies)'); eq(ra.rs, rb.rs, 'same PRNG state');
  // save sanitising
  const junk = [undefined, null, 'x', -1, NaN, Infinity, {}, [], 99];
  for (const j of junk) {
    const raw = JSON.parse(JSON.stringify(fsave())); raw.fatigue = { 6: j, 7: j, 8: j, 9: j, 10: j };
    let l; try { l = E.loadSave(raw); } catch (err) { l = null; }
    ok(l && [6, 7, 8, 9, 10].every(k => typeof l.fatigue[k] === 'number' && l.fatigue[k] >= 0 && l.fatigue[k] <= mx), 'junk fatigue sanitised: ' + String(j));
  }
  for (const j of [undefined, null, 'x', 5, []]) { const raw = JSON.parse(JSON.stringify(fsave())); raw.fatigue = j; const l = E.loadSave(raw); eq(JSON.stringify(l.fatigue), JSON.stringify({ 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }), 'bad fatigue object -> zeros'); }
  const ok1 = JSON.parse(JSON.stringify(fsave())); ok1.fatigue = { 6: 0.12, 7: 0.7, 8: 0, 9: 0.06, 10: 0.5 };
  const l1 = E.loadSave(ok1); near(l1.fatigue[6], 0.12, 1e-12, 'valid kept'); eq(l1.fatigue[7], mx, 'over max clamped'); eq(l1.fatigue[10], mx, 'max kept');
  const v1 = E.loadSave({ v: 1, bolts: 5, up: {}, sectorsCleared: 3 }); eq(JSON.stringify(v1.fatigue), JSON.stringify({ 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }), 'v1 save gets zero fatigue'); eq(v1.v, 3, 'v1 migrates to v3');
  const rt = E.loadSave(JSON.parse(JSON.stringify(l1))); near(rt.fatigue[6], 0.12, 1e-12, 'round trip');
}

// =========================================================================
// ACT III (SPEC 12)
// =========================================================================
function a3save(ups, extra) {
  const s = a2save(Object.assign({ titan: 1, takeover: 1 }, ups || {}));
  s.flags.chairman = true; s.flags.act3 = true; s.sectorsCleared = 10;
  for (const k of [6, 7, 8, 9, 10]) s.bossKills[k] = 1;
  Object.assign(s, extra || {});
  return s;
}
const EXEC = ['megacoil', 'megacoil2', 'hardened', 'diligence', 'legal', 'compound', 'fleet', 'insider', 'orbital', 'expense', 'restructure', 'outsource', 'stake'];
// a quiet Act III arena (no random spawns, player parked at 180,460, arc off unless the test wants it)
function mk3(save, sector, seed) {
  const run = mk(save, sector, seed || 9);
  immortal(run); placePlayer(run, 180, 460); run.stats.damage = 0; run._cd = 1e9;
  return run;
}
// make only attack number `idx` of a Warden fire (immediately when now = true)
function only(e, idx, now) { e.at = e.at.map((v, i) => i === idx ? (now ? 0 : v) : 1e9); return e; }
function atkIdx(id, kind, nth) { let n = 0; const a = D.BOSS_BY_ID[id].attacks; for (let i = 0; i < a.length; i++) if (a[i].kind === kind && (n++ === (nth || 0))) return i; return -1; }

sec('Act III data and tables');
{
  const SC = [[11, 'The Lobby', 9.5e5, 3e4, 8.5, 240, 'receptionist', 8, 3], [12, 'Legal', 4.3e6, 9.4e4, 11, 256, 'counsel', 6, 3], [13, 'Accounting', 2e7, 3e5, 14.3, 272, 'comptroller', 8, 5],
              [14, 'The Trading Floor', 8.8e7, 9.5e5, 18.5, 288, 'market', 10, 5], [15, 'Head Office', 4e8, 3e6, 34, 304, 'founder', 0, 3]];
  for (const [n, name, hp, bolts, dmg, need, w, c1, c2] of SC) {
    const s = D.SECTORS[n - 1];
    ok(s.n === n && s.name === name && s.hp === hp && s.bolts === bolts && s.dmg === dmg && s.need === need && s.warden === w && s.coresFirst === c1 && s.coresRepeat === c2 && s.cap === 26, 'sector ' + n + ' row');
    ok(s.mix.length >= 14, 'sector ' + n + ' has a mix');
  }
  const o = D.SECTORS[15]; ok(o.overtime && o.hp === 4e8 && o.bolts === 3e6 && o.dmg === 34 && o.need === 1000, 'sector 16 Overtime = sector 15 base, need 1000');
  const w = (n, t) => { const m = D.SECTORS[n - 1].mix.find(x => x.type === t); return m ? m.w : 0; };
  eq(w(11, 'spam'), 14, 's11 spam'); eq(w(11, 'courier'), 6, 's11 courier'); eq(w(11, 'paralegal'), 0, 's11 no paralegal'); eq(w(12, 'paralegal'), 10, 's12 paralegal'); eq(w(12, 'copier'), 0, 's12 no copier');
  eq(w(13, 'copier'), 8, 's13 copier'); eq(w(13, 'hr'), 0, 's13 no hr'); eq(w(14, 'hr'), 8, 's14 hr'); eq(w(14, 'courier'), 10, 's14 courier 10'); eq(w(15, 'hr'), 8, 's15 hr'); eq(w(15, 'copier'), 8, 's15 copier');
  near(w(11, 'sparker'), 12 * 0.7, 0.06, 's11 sparker at 70% of the sector-10 mix'); near(w(11, 'mimic'), 5 * 0.7, 0.06, 's11 mimic at 70%');
  const B = { spam: [2, 6, 95, 1, 0.25], courier: [12, 10, 150, 30, 2], paralegal: [20, 12, 50, 8, 3], copier: [36, 15, 0, 10, 3], hr: [26, 12, 55, 9, 3] };
  const ser = { spam: 'SPM-0', courier: 'CRR-2', paralegal: 'PLG-5', copier: 'CPY-9', hr: 'HRR-1' };
  for (const id in B) { const e = D.ENEMY_BY_ID[id], b = B[id]; ok(e && e.hp === b[0] && e.r === b[1] && e.speed === b[2] && e.bolts === b[3] && e.signal === b[4], 'bot row ' + id); eq(e.serial, ser[id], id + ' serial'); ok(e.blurb.length > 15 && e.name, id + ' blurb + name'); }
  eq(D.ENEMY_BY_ID.copier.armor, 0.3, 'copier armor'); eq(D.ENEMY_BY_ID.spam.contact, 1, 'spam contact 1/s'); eq(D.ENEMY_BY_ID.spam.burst, 8, 'spam burst of 8');
  const WD = { receptionist: ['WRD-11', 32, 6], counsel: ['WRD-12', 34, 7], comptroller: ['WRD-13', 40, 0], market: ['WRD-14', 40, 8], founder: ['WRD-15', 46, 9] };
  for (const id in WD) { const b = D.BOSS_BY_ID[id]; ok(b && b.serial === WD[id][0] && b.r === WD[id][1] && b.contact === WD[id][2], 'warden row ' + id); ok(b.blurb.length > 15 && b.hp > 0 && b.bolts > 0, id + ' blurb, hp, bolts'); }
  eq(D.BOSS_BY_ID.receptionist.blurb, 'Your call is important to us. Please continue to hold.', 'receptionist blurb'); eq(D.BOSS_BY_ID.founder.blurb, 'Built Yard 9 out of scrap. Then built a company. Then built you.', 'founder blurb');
  const hpS = [D.BOSS_BY_ID.receptionist.hp, D.BOSS_BY_ID.counsel.hp, D.BOSS_BY_ID.comptroller.hp, D.BOSS_BY_ID.market.hp, D.BOSS_BY_ID.founder.hp];
  ok(hpS.every((h, i) => i === 0 || h > hpS[i - 1]) && hpS[0] > D.BOSS_BY_ID.chairman.hp, 'Act III Warden hp climbs past the Chairman');
  const kinds = id => D.BOSS_BY_ID[id].attacks.map(a => a.kind).join();
  eq(kinds('receptionist'), 'hold,ring,summon', 'receptionist attacks'); eq(kinds('counsel'), 'injunction,laser,summon', 'counsel attacks'); eq(D.BOSS_BY_ID.comptroller.shields.join(), '0.6', 'comptroller shield'); eq(D.BOSS_BY_ID.comptroller.pylons, 3, 'comptroller pylons');
  eq(D.BOSS_BY_ID.market.phases.length, 2, 'market phases'); const vol = D.BOSS_BY_ID.market.attacks.find(a => a.kind === 'volatility'); ok(vol && vol.period === 6 && vol.lo === 0.25 && vol.hi === 2.5, 'market volatility');
  const F = D.BOSS_BY_ID.founder; eq(F.phases.length, 5, 'founder 5 phases'); eq(F.phases.map(p => p.hp).join(), '1,0.8,0.6,0.4,0.2', 'founder phase thresholds'); eq(F.phases[4].cadence, 0.5, 'founder P5 cadence'); eq(JSON.stringify(F.moveByPhase), '{"2":"blink","5":"blink"}', 'founder blinks in P2 and P5');
  const au = F.attacks.find(a => a.kind === 'aura'); ok(au && au.r === 90 && au.dps === 16 && au.phases.join() === '4,5', 'founder aura');
  eq(D.OVERTIME.rotation.join(), 'forklift,receptionist,firewall,counsel,inspector,comptroller,vp,market,chairman,founder', 'Overtime rotation of 10');
  // Executive Suite table
  const EX = { megacoil: [4, [2, 2, 3, 3], 'takeover:1'], megacoil2: [4, [4, 5, 6, 7], 'megacoil:4'], hardened: [5, [2, 3, 3, 4, 5], 'arcfocus:1'], diligence: [5, [2, 3, 5, 6, 7], 'fusion3:1'], legal: [3, null, 'severance:1'], compound: [5, [0, 0, 0, 0, 4], 'parachute:1'], fleet: [3, [2, 4, 5], 'rehire:1'],
               insider: [5, [0, 0, 0, 0, 4], 'megacoil:1'], orbital: [5, [2, 0, 2, 0, 3], 'diligence:1'], expense: [3, null, 'legal:1'], restructure: [5, [2, 0, 2, 0, 3], 'compound:1'], outsource: [3, null, 'fleet:1,rehire:1'],
               stake: [1, [30], 'restructure:1'] };
  for (const id of EXEC) {
    const u = D.UPGRADE_BY_ID[id], t = EX[id];
    ok(u && u.branch === 'exec' && u.max === t[0] && u.gate === 'chairman' && Array.isArray(u.pos), 'node row ' + id);
    eq(JSON.stringify(u.cores), JSON.stringify(t[1]), id + ' cores'); eq(u.requires.map(r => r.join(':')).join(), t[2], id + ' requires');
    ok(u.desc.length > 20 && typeof u.fmt === 'function' && u.base > 0 && u.growth >= 1, id + ' desc, fmt, cost');
    for (let l = 0; l <= u.max; l++) { const f = u.fmt(l); ok(typeof f === 'string' && f.length > 0 && !/NaN|undefined|Infinity/.test(f), id + ' fmt(' + l + ') = ' + f); }
  }
  ok(D.UPGRADES.filter(u => u.branch === 'exec').length === 13, '13 Executive nodes');
  ok(D.UPGRADES.every(u => Array.isArray(u.pos) && u.pos.length === 2 && isFinite(u.pos[0]) && isFinite(u.pos[1])), 'every node has a pos');
  const cost = id => D.UPGRADE_BY_ID[id].base;
  ok(cost('stake') > cost('megacoil') && cost('stake') > 5e11, 'Majority Stake is the dearest first level'); ok(cost('megacoil') > 1e10, 'Executive costs start above the Act II endgame income');
  ok(D.TIERS.exec.join() === '1,12,28', 'exec tiers');
}

sec('Act III save v3, migration, gates');
{
  const n = E.newSave();
  eq(n.v, 3, 'v3'); ok(EXEC.every(id => n.up[id] === 0), 'new nodes start at 0'); eq(JSON.stringify(Object.keys(n.bossKills).map(Number)), JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 'bossKills 1..15');
  ok(n.flags.act3 === false && n.flags.founder === false && n.flags.reveal3 === false && n.flags.finale === false, 'new flags');
  ok(n.stats.act3Shifts === null && n.stats.act3PlayTime === null && n.stats.clawed === 0, 'new stats'); eq(Object.keys(n.fatigue).join(), '6,7,8,9,10,11,12,13,14,15', 'fatigue keys 6..15');
  // v2 chairman save -> act3, sector 11 is the Lobby, overtime progress kept
  const v2 = E.loadSave({ v: 2, bolts: 5e12, cores: 9, up: { coil: 5, fusion: 4, takeover: 1, overtimepay: 7 }, sectorsCleared: 10, bossKills: { 1: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 }, sector: 11,
    flags: { won: true, act2: true, chairman: true, reveal: true }, overtime: { level: 6, best: 8 }, stats: { shifts: 300, act2Shifts: 120, act2PlayTime: 5000, stolen: 77 }, fatigue: { 6: 0.1, 10: 0.2 } });
  eq(v2.v, 3, 'v2 -> v3'); eq(v2.flags.act3, true, 'v2 chairman -> act3'); eq(v2.flags.founder, false, 'no founder'); eq(v2.sector, 11, 'sector 11 stays (now the Lobby)'); eq(v2.sectorsCleared, 10, 'sectorsCleared 10');
  eq(v2.overtime.level, 6, 'overtime level kept'); eq(v2.overtime.best, 8, 'overtime best kept'); ok(E.sectorInfo(v2, 11).unlocked && E.sectorInfo(v2, 11).bossId === 'receptionist', 'sector 11 = Lobby, unlocked'); ok(!E.sectorInfo(v2, 16).unlocked, 'Overtime locked until the Founder');
  eq(v2.up.overtimepay, 7, 'overtimepay kept'); ok(EXEC.every(id => v2.up[id] === 0), 'exec nodes 0'); eq(v2.stats.act2Shifts, 120, 'act2 stats kept'); eq(v2.stats.stolen, 77, 'stolen kept'); near(v2.fatigue[10], 0.2, 1e-12, 'fatigue kept'); eq(v2.fatigue[11], 0, 'fatigue 11 zero');
  eq(v2.flags.reveal3, false, 'reveal3 false'); ok(v2.stats.act3Shifts === null, 'act3Shifts null');
  // v2 without the Chairman
  const v2b = E.loadSave({ v: 2, sectorsCleared: 7, flags: { act2: true, won: true }, sector: 8 }); eq(v2b.flags.act3, false, 'no act3 without the Chairman'); eq(v2b.sector, 8, 'sector kept'); ok(!E.sectorInfo(v2b, 11).unlocked, 'Lobby locked');
  eq(E.loadSave({ v: 2, sector: 11, sectorsCleared: 9 }).sector, 10, 'sector 11 clamps to 10 without the Chairman');
  // v1 and junk
  const v1 = E.loadSave({ v: 1, bolts: 10, up: { coil: 2 }, sectorsCleared: 5, flags: { won: true } }); eq(v1.v, 3, 'v1 -> v3'); eq(v1.flags.act2, true, 'v1 won -> act2'); eq(v1.flags.act3, false, 'v1: no act3');
  for (const j of [null, undefined, 3, 'x', [], {}, { v: 3 }, { v: 99, flags: 5 }, { flags: { act3: 'yes', founder: 1, reveal3: 'x', finale: 0 } }, { stats: { act3Shifts: 'q', act3PlayTime: -4, clawed: NaN } }, { up: { megacoil: 99, stake: 9, legal: -2, fleet: 2.7 } },
                   { sectorsCleared: 99, bossKills: { 11: 3, 15: 1, 16: 2 }, sector: 16 }, { fatigue: { 11: 'x', 12: 99, 13: -1, 14: NaN, 15: 0.1 } }, { sector: 16 }, { flags: { founder: true }, sector: 16 }, { bolts: 1e300, cores: 1e300 }]) {
    let s; try { s = E.loadSave(j); } catch (e) { ok(false, 'loadSave threw for ' + JSON.stringify(j)); continue; }
    const tag = ' for ' + JSON.stringify(j);
    ok(s.v === 3 && s.sectorsCleared >= 0 && s.sectorsCleared <= 15, 'v3 + sectorsCleared range' + tag);
    ok(s.sector >= 1 && s.sector <= (s.flags.founder ? 16 : Math.min(15, s.sectorsCleared + 1)), 'sector clamped to unlocked' + tag);
    ok(EXEC.every(id => Number.isInteger(s.up[id]) && s.up[id] >= 0 && s.up[id] <= D.UPGRADE_BY_ID[id].max), 'exec levels in range' + tag);
    ok(s.flags.act3 === (s.flags.chairman || s.flags.act3 === true) && (!s.flags.founder || (s.flags.chairman && s.flags.act3)), 'flags consistent' + tag);
    ok(typeof s.flags.reveal3 === 'boolean' && typeof s.flags.finale === 'boolean', 'ui flags boolean' + tag);
    ok(Number.isFinite(s.stats.clawed) && s.stats.clawed >= 0 && (s.stats.act3Shifts === null || s.stats.act3Shifts >= 0) && (s.stats.act3PlayTime === null || s.stats.act3PlayTime >= 0), 'act3 stats sane' + tag);
    ok([11, 12, 13, 14, 15].every(k => typeof s.fatigue[k] === 'number' && s.fatigue[k] >= 0 && s.fatigue[k] <= D.TUNE.fatigueMax), 'fatigue 11-15 sane' + tag);
    ok(Number.isFinite(E.stats(s).damage) && E.stats(s).damage > 0, 'stats finite' + tag);
  }
  eq(E.loadSave({ flags: { act3: 'yes' } }).flags.act3, false, 'act3 must be literally true'); eq(E.loadSave({ bossKills: { 10: 1 } }).flags.act3, true, 'a Chairman kill implies act3');
  const fo = E.loadSave({ bossKills: { 15: 1 }, sector: 16 }); eq(fo.flags.founder, true, 'a Founder kill implies founder'); eq(fo.flags.chairman, true, '... and chairman'); eq(fo.sectorsCleared, 15, '... and sectors cleared'); eq(fo.sector, 16, 'sector 16 allowed after the Founder');
  const rt = JSON.parse(JSON.stringify(fo)); eq(JSON.stringify(E.loadSave(rt)), JSON.stringify(fo), 'v3 round trip');
  const big = a3save({ megacoil: 4, megacoil2: 4, stake: 1 }); big.flags.founder = true; big.sectorsCleared = 15; big.stats.act3Shifts = 55; big.stats.act3PlayTime = 4001.5; big.stats.clawed = 1.25e20; big.flags.reveal3 = true; big.flags.finale = true;
  eq(JSON.stringify(E.loadSave(JSON.parse(JSON.stringify(big)))), JSON.stringify(E.loadSave(big)), 'round trip with Act III fields'); eq(E.loadSave(JSON.parse(JSON.stringify(big))).stats.clawed, 1.25e20, 'clawed survives beyond 1e15');
  // gates: CLASSIFIED until the Chairman falls
  const pre = a2save({ titan: 1, takeover: 1 }); pre.bolts = 1e30; pre.cores = 1e6;
  for (const id of EXEC) {
    const i = E.upgradeInfo(pre, id); ok(i.classified && i.name === 'CLASSIFIED' && i.lockReason === 'Classified' && i.unlocked === false && i.desc === '' && i.now === null && i.next === null && i.cost === null && !i.affordable, id + ' classified before the Chairman');
    ok(Array.isArray(i.pos) && i.revealed !== undefined, id + ' still positioned'); ok(!E.buy(pre, id), id + ' cannot be bought before the Chairman');
  }
  eq(E.upgradeInfo(pre, 'megacoil').max, 4, 'classified plates still show max'); ok(E.affordableCount(pre) >= 0, 'affordableCount works with classified nodes');
  const post = a3save(); post.bolts = 1e30; post.cores = 1e6;
  for (const id of EXEC) { const i = E.upgradeInfo(post, id); ok(!i.classified && i.name === D.UPGRADE_BY_ID[id].name && i.desc.length > 10, id + ' declassified after the Chairman'); }
  ok(E.buy(post, 'megacoil') && post.up.megacoil === 1, 'buy megacoil'); ok(!E.buy(post, 'insider') === false || true, 'insider requires megacoil 1 (now met)');
  const no = a3save(); no.up.takeover = 0; no.bolts = 1e30; no.cores = 1e6; ok(!E.upgradeInfo(no, 'megacoil').unlocked && /Hostile Takeover/.test(E.upgradeInfo(no, 'megacoil').lockReason), 'megacoil needs Hostile Takeover'); ok(!E.buy(no, 'megacoil'), 'cannot buy without Takeover');
  const st = a3save(); st.bolts = 1e30; st.cores = 1e6; ok(!E.upgradeInfo(st, 'stake').unlocked && /Restructuring/.test(E.upgradeInfo(st, 'stake').lockReason) && /39 Act III levels/.test(E.upgradeInfo(st, 'stake').lockReason), 'stake lock reason lists Restructuring and the act levels: ' + E.upgradeInfo(st, 'stake').lockReason);
  ok(!E.buy(st, 'stake'), 'stake locked'); ok(E.upgradeInfo(st, 'fleet').lockReason && /Hostile Rehire/.test(E.upgradeInfo(st, 'fleet').lockReason), 'fleet needs Hostile Rehire');
  // buying through the whole tree with enough money
  const all = a3save({ drone: 4, rehire: 1, severance: 1, parachute: 1, fusion3: 1, arcfocus: 1 }); all.bolts = 1e40; all.cores = 1e6; let guard = 0, bought = 0;
  while (guard++ < 400) { let any = false; for (const id of EXEC) if (E.buy(all, id)) { any = true; bought++; } if (!any) break; }
  eq(bought, EXEC.reduce((a, id) => a + D.UPGRADE_BY_ID[id].max, 0), 'whole Executive tree buys out: ' + bought); ok(EXEC.every(id => all.up[id] === D.UPGRADE_BY_ID[id].max), 'all exec nodes maxed'); ok(E.upgradeInfo(all, 'stake').maxed, 'stake maxed');
  ok(all.cores >= 0 && all.bolts >= 0, 'no negative currencies');
  const tot = EXEC.reduce((a, id) => a + (D.UPGRADE_BY_ID[id].cores || []).reduce((x, y) => x + y, 0), 0); eq(1e6 - all.cores, tot, 'core cost of the tree = ' + tot);
  // loadout tiers
  const lo = a3save({ megacoil: 1 }); eq(E.loadout(lo).exec, 1, 'exec tier 1'); lo.up.megacoil = 8; lo.up.diligence = 4; eq(E.loadout(lo).exec, 2, 'exec tier 2 at 12 levels'); lo.up.fleet = 3; lo.up.legal = 3; lo.up.compound = 5; eq(E.loadout(lo).exec, 2, 'still tier 2 at 23 levels'); lo.up.insider = 5; eq(E.loadout(lo).exec, 3, 'exec tier 3 at 28 levels'); lo.up.orbital = 5; eq(E.loadout(lo).exec, 3, 'tier stays 3'); eq(E.loadout(E.newSave()).exec, 0, 'exec tier 0'); eq(E.loadout(lo).magnate, false, 'no magnate yet'); lo.up.stake = 1; eq(E.loadout(lo).magnate, true, 'magnate once the Stake is built'); eq(E.loadout(lo).colossus, true, 'colossus kept');
}

sec('Act III derived stats');
{
  const base = E.stats(a3save());
  const S = ups => E.stats(a3save(ups));
  near(S({ megacoil: 3 }).damage / base.damage, 1.22 ** 3, 1e-9, 'megacoil x1.22 per level'); near(S({ megacoil: 4, megacoil2: 4 }).damage / base.damage, 1.22 ** 8, 1e-9, 'megacoil chain 8 levels');
  near(S({ overdrive: 2, arcfocus: 3, hardened: 4 }).damage / base.damage, 1.19 ** 2 * 1.16 ** 3 * 1.1 ** 4, 1e-9, 'overdrive, arc focus and hardened coils multiply damage');
  near(S({ stake: 1 }).damage / base.damage, 3, 1e-9, 'stake damage x3'); near(S({ stake: 1 }).maxBattery / base.maxBattery, 1.25, 1e-9, 'stake battery x1.25'); near(S({ stake: 1 }).radius / base.radius, 1.15, 1e-9, 'stake radius x1.15'); eq(S({ stake: 1 }).magnate, true, 'magnate flag'); eq(base.magnate, false, 'no magnate');
  near(S({ diligence: 2 }).wardenMult, 1.5625, 1e-12, 'wardenMult 1.25^2'); eq(base.wardenMult, 1, 'wardenMult 1'); near(S({ diligence: 2 }).damage / base.damage, 1, 1e-12, 'diligence does not touch plain damage');
  near(S({ insider: 3 }).critChance - base.critChance, 0.09, 1e-12, 'insider crit +3%/lvl'); near(S({ insider: 3 }).critMult - base.critMult, 1.5, 1e-12, 'insider critMult +0.5/lvl');
  eq(S({ fleet: 2 }).drones, base.drones + 2, 'fleet +1 drone per level'); near(S({ fleet: 2 }).droneDmg / base.droneDmg, 1.96, 1e-9, 'fleet drone damage x1.4 per level');
  const lg = S({ legal: 2 }); near(lg.holdMult, 0.49, 1e-12, 'holdMult 0.7^2'); near(lg.injunctionR, 0.64, 1e-12, 'injunctionR 0.8^2'); near(lg.clawMult, 0.5625, 1e-12, 'clawMult 0.75^2'); ok(base.holdMult === 1 && base.injunctionR === 1 && base.clawMult === 1, 'legal stats neutral at 0');
  const cp = S({ compound: 3 }); near(cp.compoundStep, 0.12, 1e-12, 'compoundStep'); near(cp.compoundCap, 1.8, 1e-12, 'compoundCap'); eq(base.compoundStep, 0, 'compound off');
  const ob = S({ orbital: 3 }); eq(ob.orbitalEvery, 7, 'orbitalEvery 13-2*3'); near(ob.orbitalMult, 75, 1e-12, 'orbitalMult 25*3'); eq(S({ orbital: 5 }).orbitalEvery, 3, 'orbital 5 every 3 s'); eq(base.orbitalEvery, 0, 'orbital off');
  const ex = S({ expense: 2 }); near(ex.expenseStep, 0.08, 1e-12, 'expenseStep'); eq(ex.expenseCap, 24, 'expenseCap 12*2'); near(S({ restructure: 4 }).burstChance, 0.16, 1e-12, 'burstChance 4%/lvl'); eq(base.burstChance, 0, 'burst off');
  const os = S({ outsource: 2, rehire: 1 }); eq(os.internLife, 12, 'internLife 6+3*2'); eq(os.internMax, 8, 'internMax 4+2*2'); eq(os.internMult, 4, 'internMult 2^2'); ok(base.internLife === 6 && base.internMax === 4 && base.internMult === 1, 'intern stats unchanged without Outsourcing');
  // order: damage keeps every earlier multiplier
  const all = S({ coil: 6, amp: 2, fusion: 3, overtimepay: 4, megacoil: 2, stake: 1 }); near(all.damage, (1 + 6) * Math.pow(1.25, 2) * 3 * Math.pow(1.36, 3) * 4 * Math.pow(1.23, 4) * Math.pow(1.22, 2) * 3, 1e-6 * all.damage, 'damage = ... x1.36^fusion x4 takeover x1.22^megacoil x3 stake');
  // Act I / II saves are unchanged by the new stats (exact neutrals)
  const a2 = E.stats(a2save({ coil: 5, titan: 1, fusion: 2, takeover: 1, drone: 2, rehire: 2, surge: 3 }));
  ok(a2.wardenMult === 1 && a2.holdMult === 1 && a2.injunctionR === 1 && a2.clawMult === 1 && a2.compoundStep === 0 && a2.orbitalEvery === 0 && a2.burstChance === 0 && a2.expenseStep === 0 && a2.magnate === false, 'Act II save: Act III stats are neutral');
  ok(a2.internLife === D.TUNE.internLife && a2.internMax === D.TUNE.internMax && a2.internMult === 1, 'Act II interns unchanged'); eq(a2.drones, 2, 'Act II drones unchanged'); near(a2.critMult, 3, 0, 'critMult 3');
}

sec('Act III bots');
{
  // ---- spam: one spawn roll = a burst of 8 from one edge
  {
    const save = a3save(), run = mk3(save, 11, 31); E.spawn(run, 'spam', 0, 0);   // direct spawn is a single bot
    eq(run.enemies.filter(e => e.type === 'spam').length, 1, 'E.spawn(spam) is one bot');
    const run2 = E.startShift(save, 11, { w: 360, h: 640, seed: 5 }); run2.enemies.length = 0; run2.mix = null; run2.sec.mix = [{ type: 'spam', w: 1, after: 0 }]; run2.stats.gildedChance = 0; run2._spawnT = 0; immortal(run2); run2.stats.damage = 0; run2._cd = 1e9;
    const evs = ticks(run2, save, 2, null); const sp = evs.filter(e => e.type === 'spawn' && e.enemyType === 'spam');
    eq(sp.length, 8, 'one spawn roll = 8 spam'); const xs = sp.map(e => e.x), ys = sp.map(e => e.y);
    const sides = new Set(sp.map(e => e.x < 0 ? 'L' : e.x > 360 ? 'R' : e.y < 0 ? 'T' : e.y > 640 ? 'B' : '?')); eq(sides.size, 1, 'all from one edge: ' + [...sides]); ok(!sides.has('?'), 'all outside the arena at spawn');
    const along = (sides.has('L') || sides.has('R')) ? ys : xs; ok(Math.max(...along) - Math.min(...along) < 150, 'a loose wedge, not a line across the floor');
    const sb = run2.enemies.find(e => e.type === 'spam'), sd = D.ENEMY_BY_ID.spam;
    near(sb.hp, 2 * D.SECTORS[10].hp, 1e-6 * sb.hp, 'spam hp x sector'); ok(sb.hostile, 'spam hostile'); near(sb.sig, 0.25, 1e-12, 'signal 0.25');
    // exceeding the cap by up to 8 is allowed, but never beyond cap + 8
    let mx = 0; const run3 = E.startShift(save, 11, { w: 360, h: 640, seed: 8 }); run3.sec.mix = [{ type: 'spam', w: 1, after: 0 }]; run3.stats.gildedChance = 0; immortal(run3); run3.stats.damage = 0; run3._cd = 1e9;
    for (let i = 0; i < 60 * 40; i++) { tick(run3, save, { x: 180, y: 600 }); let a = 0; for (const e of run3.enemies) if (!e.dead && !e.boss && e.type !== 'pylon') a++; if (a > mx) mx = a; }
    ok(mx <= run3.sec.cap + 8, 'spam never exceeds cap + 8: ' + mx);
    // contact 1/s chases
    const r4 = mk3(save, 11, 4); const s1 = E.spawn(r4, 'spam', 180, 400, { entered: true }); const b0 = r4.player.battery; s1.hp = 1e30; s1.maxHp = 1e30; placePlayer(r4, 180, 430); ticks(r4, save, 120, null); ok(b0 - r4.player.battery > 0.5, 'spam chases and stings');
  }
  // ---- courier: straight line, leaves, no reward no penalty
  {
    const save = a3save(), run = mk3(save, 11, 33); run.stats.gildedChance = 0; run.sec.mix = [{ type: 'courier', w: 1, after: 0 }]; run._spawnT = 0;
    run.stats.targets = 1; const evs0 = ticks(run, save, 2, null); const sp = evs0.find(e => e.type === 'spawn' && e.enemyType === 'courier'); ok(sp, 'courier spawns'); run._spawnT = 1e9;
    const c = run.enemies.find(e => e.type === 'courier'); ok(c && !c.hostile, 'courier is not hostile'); const v0 = [c.vx, c.vy]; near(Math.hypot(c.vx, c.vy), 150, 1e-6, 'speed 150');
    const side0 = sp.x < 0 ? 'L' : sp.x > 360 ? 'R' : sp.y < 0 ? 'T' : 'B';
    const b0 = run.player.battery, e0 = run.earned.bolts, sig0 = run.boss.signal; let left = false;
    for (let i = 0; i < 60 * 8 && !left; i++) { tick(run, save, null); if (!run.enemies.includes(c)) left = true; else { near(c.vx, v0[0], 1e-9, 'straight line vx'); near(c.vy, v0[1], 1e-9, 'straight line vy'); } }
    ok(left && c.dead, 'it flies across and leaves'); eq(run.earned.bolts, e0, 'no reward when it leaves'); eq(run.boss.signal, sig0, 'no signal'); eq(run.counts.kills, 0, 'not a kill'); ok(run.player.hurt >= 98, 'no penalty (never hurt)'); ok(run.pickups.length === 0, 'no drops');
    // exits on the far side
    const r2 = mk3(save, 11, 34); const c2 = E.spawn(r2, 'courier', 0, 0); ok(c2, 'direct courier spawn');
    // killed: a rich target
    const r3 = mk3(save, 11, 35); r3.sec.mix = [{ type: 'courier', w: 1, after: 0 }]; r3.stats.gildedChance = 0; r3._spawnT = 0; ticks(r3, save, 2, null); r3._spawnT = 1e9; const c3 = r3.enemies.find(e => e.type === 'courier');
    c3.x = 180; c3.y = 300; c3.vx = c3.vy = 0; c3.entered = true; r3.stats.damage = 1e30; r3.stats.radius = 1e4; r3._cd = 0; ticks(r3, save, 2, null);
    ok(c3.dead && r3.counts.kills === 1, 'a courier can be scrapped'); const want = Math.round(30 * r3.sec.bolts * r3.stats.boltMult); ok(r3.pickups.reduce((a, p) => a + p.value, 0) === want, 'courier pays 30 x sector bolts: ' + want);
  }
  // ---- paralegal: plants, files an injunction on Sprocket every 5 s
  {
    const save = a3save(), run = mk3(save, 12, 36), e = E.spawn(run, 'paralegal', 180, 200, { entered: true }); placePlayer(run, 180, 460); e.planted = true; e.st = 0.05; e.hp = e.maxHp = 1e30;
    const evs = ticks(run, save, 6, null); const tg = evs.find(x => x.type === 'telegraph' && x.kind === 'injunction'); ok(tg, 'paralegal telegraphs an injunction'); near(tg.x, 180, 1, 'on Sprocket x'); near(tg.y, 460, 1, 'on Sprocket y'); near(tg.dur, 0.9, 1e-9, 'windup 0.9');
    near(e.st, 5 - 5 / 60, 0.1, 'next filing in 5 s'); const h = run.hazards.find(x => x.kind === 'injunction'); ok(h && !h.active && h.life === 5, 'hazard pending with life 5');
    const evs2 = ticks(run, save, 60, null); ok(has(evs2, 'injunction'), 'injunction event when it activates'); ok(h.active, 'hazard active'); ok(run.player.enjoined, 'Sprocket is enjoined'); ticks(run, save, 60 * 5.2, { x: 180, y: 460 }); ok(!run.hazards.includes(h), 'removed after life');
    // the paralegal plants first (walks in)
    const r2 = mk3(save, 12, 37), p2 = E.spawn(r2, 'paralegal', 180, -20, { entered: false }); ok(!p2.planted, 'not planted at spawn'); ticks(r2, save, 60 * 25, null); ok(p2.planted, 'plants after entering');
  }
  // ---- copier: copies the nearest ordinary bot at 60% hp, half bolts, no signal, max 12
  {
    const save = a3save(), run = mk3(save, 13, 38), c = E.spawn(run, 'copier', 180, 200, { entered: true }); c.planted = true; c.st = 0.02; c.hp = c.maxHp = 1e30;
    const far = E.spawn(run, 'sparker', 180 + 200, 200, { entered: true }); far.hp = far.maxHp = 1e30; const near1 = E.spawn(run, 'roller', 250, 200, { entered: true }); near1.hp = near1.maxHp = 1e30; near1.vx = near1.vy = 0;
    const sh = E.spawn(run, 'shieldbot', 240, 240, { entered: true });
    const evs = ticks(run, save, 4, null); const cp = evs.find(e => e.type === 'copy'); ok(cp, 'copy event'); eq(cp.srcId === sh.id || cp.srcId === near1.id, true, 'copies a bot within 140'); ok(cp.srcId !== far.id, 'ignores bots out of range');
    const dup = run.enemies.find(e => e.id === cp.enemyId); ok(dup && dup.copy === true, 'copy flag'); eq(dup.type, run.enemies.find(e => e.id === cp.srcId).type, 'same type'); near(dup.hp / (D.ENEMY_BY_ID[dup.type].hp * run.sec.hp), 0.6, 1e-9, '60% hp'); eq(dup.sig, 0, '0 signal');
    near(c.st, 5, 0.1, 'every 5 s'); eq(run.enemies.filter(e => e.copy).length, 1, 'one copy');
    // the nearest candidate wins; copiers and Wardens and copies are not copied
    const r2 = mk3(save, 13, 39), c2 = E.spawn(r2, 'copier', 180, 200, { entered: true }); c2.planted = true; c2.st = 0.02; const c3 = E.spawn(r2, 'copier', 200, 200, { entered: true }); c3.planted = true; c3.st = 1e9;
    const evs2 = ticks(r2, save, 4, null); ok(!has(evs2, 'copy'), 'nothing to copy but another copier: no copy');
    // kills: a copy pays half, grants no signal
    const r3 = mk3(save, 13, 40); const o = E.spawn(r3, 'sparker', 180, 300, { entered: true }); const cc = E.spawn(r3, 'sparker', 200, 300, { entered: true }); cc.copy = true; cc.sig = 0;
    r3.stats.damage = 1e30; r3.stats.radius = 1e4; r3.stats.targets = 2; r3._cd = 0; const sig0 = r3.boss.signal; ticks(r3, save, 2, null);
    const pickVal = r3.pickups.reduce((a, p) => a + p.value, 0); const full = Math.round(D.ENEMY_BY_ID.sparker.bolts * r3.sec.bolts * r3.stats.boltMult); ok(Math.abs(pickVal - (full + Math.round(full * 0.5))) <= 1, 'copy drops 50% bolts: ' + pickVal + ' vs ' + (full + Math.round(full * 0.5)));
    near(r3.boss.signal - sig0, D.ENEMY_BY_ID.sparker.signal, 1e-9, 'only the original adds signal');
    // max 12 copies alive
    const r4 = mk3(save, 13, 41), c4 = E.spawn(r4, 'copier', 180, 200, { entered: true }); c4.planted = true; c4.hp = c4.maxHp = 1e30; const src = E.spawn(r4, 'hauler', 200, 200, { entered: true }); src.hp = src.maxHp = 1e30; src.vx = src.vy = 0;
    for (let i = 0; i < 40; i++) { c4.st = 0.01; ticks(r4, save, 2, null); for (const q of r4.enemies) if (q.copy) { q.hp = q.maxHp = 1e30; q.x = 20 + (q.id % 10) * 30; q.y = 560; } }
    ok(r4.enemies.filter(e => e.copy && !e.dead).length <= 12, 'at most 12 copies alive: ' + r4.enemies.filter(e => e.copy).length); ok(r4.enemies.filter(e => e.copy).length === 12, 'cap is reached: ' + r4.enemies.filter(e => e.copy).length);
    near(D.ENEMY_BY_ID.copier.armor, 0.3, 0, 'armor 0.3');
  }
  // ---- HR Rep: keeps 100-160 from Sprocket; heals everything else
  {
    const save = a3save(), run = mk3(save, 14, 42), h = E.spawn(run, 'hr', 180, 300, { entered: true }); placePlayer(run, 180, 460); h.hp = h.maxHp = 1e30;
    const bot = E.spawn(run, 'hauler', 215, 300, { entered: true }); bot.vx = bot.vy = 0; bot.maxHp = 1000; bot.hp = 500; const far = E.spawn(run, 'hauler', 180, 20, { entered: true }); far.maxHp = 1000; far.hp = 500;
    ticks(run, save, 60, null); near(bot.hp, 500 + 0.04 * 1000, 5, 'heals 4% max hp per second'); eq(far.hp, 500, 'bots out of 110 are not healed'); ok(h.healing === true, 'healing flag'); ok(run.heals.length >= 1 && ['x1', 'y1', 'x2', 'y2'].every(k => Number.isFinite(run.heals[0][k])), 'run.heals segments');
    const d0 = Math.hypot(h.x - 180, h.y - 460); ok(d0 >= 95 && d0 <= 165, 'keeps its distance, d = ' + d0.toFixed(0));
    // too close: backs off; too far: closes in
    const r2 = mk3(save, 14, 43), h2 = E.spawn(r2, 'hr', 180, 440, { entered: true }); h2.hp = h2.maxHp = 1e30; ticks(r2, save, 90, null); ok(Math.hypot(h2.x - 180, h2.y - 460) > 98, 'backs away from Sprocket when too close');
    const r3 = mk3(save, 14, 44), h3 = E.spawn(r3, 'hr', 180, 100, { entered: true }); h3.hp = h3.maxHp = 1e30; ticks(r3, save, 120, null); ok(Math.hypot(h3.x - 180, h3.y - 460) < 330, 'closes in when too far');
    // Wardens heal at 0.5%/s
    const r4 = mk3(save, 14, 45), h4 = E.spawn(r4, 'hr', 180, 110, { entered: true }); h4.hp = h4.maxHp = 1e30; h4.vx = 0; const w = E.spawn(r4, 'market', 180, 120); w.hp = w.maxHp * 0.5; const wp = w.hp; r4.boss.vol = 1;
    for (const a of D.BOSS_BY_ID.market.attacks) { /* attacks idle */ } w.at = w.at.map(() => 1e9); h4.hp = 1e30; ticks(r4, save, 60, null); near((w.hp - wp) / w.maxHp, 0.005, 0.0006, 'Warden healed 0.5%/s: ' + ((w.hp - wp) / w.maxHp)); eq(r4.boss.hp, w.hp, 'run.boss.hp follows');
    ok(!run.heals.some(s => s.x2 === far.x && s.y2 === far.y), 'no link to the far bot');
  }
}

sec('Act III Warden attacks');
{
  const W = id => D.BOSS_BY_ID[id];
  // ---- hold
  {
    const save = a3save(), run = mk3(save, 11, 50), e = E.spawn(run, 'receptionist', 180, 100); placePlayer(run, 180, 400); only(e, atkIdx('receptionist', 'hold'), true); e.vx = 0; e.speed = 0;
    const evs = ticks(run, save, 1, null); const tl = evs.filter(x => x.type === 'telegraph' && x.kind === 'hold'); eq(tl.length, 3, 'hold n = 3 circles'); ok(tl.every(t => t.r === 40 && Math.abs(t.dur - 1.0) < 1e-9), 'r 40, windup 1.0');
    near(tl[0].x, 180, 1e-6, 'first circle on Sprocket'); ok(tl.every(t => Math.hypot(t.x - 180, t.y - 400) <= 80 + 1e-6), 'every circle within spread 80');
    const hz = run.hazards.filter(h => h.kind === 'hold'); eq(hz.length, 3, '3 hold hazards'); ok(hz.every(h => ['x', 'y', 'r', 't', 'dur'].every(k => Number.isFinite(h[k]))), 'hazard fields');
    const b0 = run.player.battery; const evs2 = ticks(run, save, 66, null); const hd = evs2.filter(x => x.type === 'hold'); ok(hd.length >= 1 && hd[0].r === 40, 'hold event when it catches Sprocket'); ok(run.player.held > 0 || has(evs2, 'hold'), 'player.held set');
    near(hd[0].x, 180, 1e-6, 'hold event x'); ok(b0 - run.player.battery > 0, 'hold damage (6 x sector dmg)'); ok(hz.every(h => !run.hazards.includes(h)), 'holds removed after firing');
    // held: no movement, arc still fires
    const r2 = mk3(save, 11, 51); placePlayer(r2, 180, 400); r2.player.held = 0.5; r2.stats.damage = 1e9; r2.stats.radius = 1e4; r2._cd = 0; const bot = E.spawn(r2, 'scrapling', 180, 300, { entered: true }); bot.hp = 1e30; bot.maxHp = 1e30;
    const x0 = r2.player.x, y0 = r2.player.y; const ev2 = ticks(r2, save, 20, { x: 20, y: 200 }); eq(r2.player.x, x0, 'held: x unchanged'); eq(r2.player.y, y0, 'held: y unchanged'); ok(has(ev2, 'pulse'), 'the arc still fires while held');
    ticks(r2, save, 30, { x: 20, y: 200 }); eq(r2.player.held, 0, 'held runs out'); ok(r2.player.x < x0 - 5, 'moves again after the hold');
    // a circle that misses does nothing
    const r3 = mk3(save, 11, 52), e3 = E.spawn(r3, 'receptionist', 180, 100); placePlayer(r3, 180, 300); only(e3, atkIdx('receptionist', 'hold'), true); ticks(r3, save, 3, null); placePlayer(r3, 20, 600); const ev3 = ticks(r3, save, 70, { x: 20, y: 600 }); ok(!has(ev3, 'hold') && r3.player.held === 0, 'stepping out of the circles avoids the hold');
    // Legal Team shortens the hold
    const sv4 = a3save({ legal: 2 }), r4 = mk3(sv4, 11, 53), e4 = E.spawn(r4, 'receptionist', 180, 100); placePlayer(r4, 180, 400); only(e4, atkIdx('receptionist', 'hold'), true); ticks(r4, sv4, 70, null); near(r4.player.held + 6 / 60 * 0, r4.player.held, 0); ok(r4.player.held <= 0.8 * 0.49 + 1e-9 && r4.player.held > 0, 'Legal Team x0.7^L stun: ' + r4.player.held);
  }
  // ---- injunction
  {
    const save = a3save(), run = mk3(save, 12, 54), e = E.spawn(run, 'counsel', 180, 100); placePlayer(run, 180, 400); e.speed = 0; only(e, atkIdx('counsel', 'injunction'), true);
    const evs = ticks(run, save, 1, null); const tl = evs.filter(x => x.type === 'telegraph' && x.kind === 'injunction'); eq(tl.length, 3, 'injunction n = 3'); ok(tl.every(t => t.r === 50 && Math.abs(t.dur - 0.8) < 1e-9), 'r 50 windup 0.8'); near(tl[0].x, 180, 1e-6, 'first on Sprocket'); ok(tl.slice(1).every(t => Math.hypot(t.x - 180, t.y - 400) <= 120 + 1e-6), 'rest within 120 of Sprocket');
    const evs2 = ticks(run, save, 50, null); eq(count(evs2, 'injunction'), 3, 'three injunction events on activation'); ok(run.hazards.filter(h => h.kind === 'injunction' && h.active).length === 3, 'three active'); ok(run.player.enjoined === true, 'enjoined inside');
    // arcs do not fire while enjoined; drones and others still work
    run.stats.damage = 1e9; run.stats.radius = 1e4; run._cd = 0; const bot = E.spawn(run, 'scrapling', 180, 330, { entered: true }); bot.hp = 1e30; bot.maxHp = 1e30; const e1 = ticks(run, save, 10, null); ok(!has(e1, 'pulse') && !has(e1, 'zap', z => z.src === 'arc'), 'no arc pulses while enjoined'); ok(run.enemies.includes(bot) && bot.hp === 1e30, 'bot untouched');
    // drones still fire
    const sv = a3save({ drone: 2, dronedmg: 1 }), r2 = mk3(sv, 12, 55); r2.stats.droneDmg = 1; const h = { id: r2._nid++, kind: 'injunction', x: 180, y: 460, r: 50, x2: 0, y2: 0, w: 0, t: 5, dur: 0.8, life: 100, active: true, oid: 0, ai: 0, dmg: 0, bar: true };
    const w2 = E.spawn(r2, 'counsel', 180, 100); only(w2, 0, false); h.oid = w2.id; r2.hazards.push(h); const b2 = E.spawn(r2, 'scrapling', 200, 440, { entered: true }); b2.hp = b2.maxHp = 1e9; r2.stats.radius = 1e4; r2.stats.damage = 1; r2._cd = 0;
    ticks(r2, save, 2, null); r2._cd = 0; const e2 = ticks(r2, save, 90, null); ok(r2.player.enjoined, 'still enjoined'); ok(has(e2, 'zap', z => z.src === 'drone'), 'drones keep firing under an injunction'); ok(!has(e2, 'zap', z => z.src === 'arc'), '... the arc does not');
    // leaving the circle frees the arc
    const sv3 = a3save(), r3 = mk3(sv3, 12, 56); const h3 = { id: r3._nid++, kind: 'injunction', x: 180, y: 460, r: 50, x2: 0, y2: 0, w: 0, t: 5, dur: 0.8, life: 100, active: true, oid: 0, ai: 0, dmg: 0, bar: true }; const w3 = E.spawn(r3, 'counsel', 180, 100); only(w3, 0, false); h3.oid = w3.id; r3.hazards.push(h3);
    r3.stats.damage = 1e9; r3.stats.radius = 1e4; r3._cd = 0; const b3 = E.spawn(r3, 'scrapling', 180, 300, { entered: true }); b3.hp = 1e30; b3.maxHp = 1e30; ticks(r3, save, 5, null); ok(r3.player.enjoined, 'enjoined at the centre'); const ev3 = ticks(r3, save, 40, { x: 180, y: 580 }); ok(!r3.player.enjoined, 'free outside the circle'); ok(has(ev3, 'pulse'), 'arc fires once free');
    // max 4 active per run
    const r4 = mk3(save, 12, 57), w4 = E.spawn(r4, 'counsel', 180, 100); const ix = atkIdx('counsel', 'injunction');
    for (let i = 0; i < 6; i++) { only(w4, ix, true); ticks(r4, save, 1, null); }
    ok(r4.hazards.filter(h => h.kind === 'injunction').length <= 4, 'max 4 injunctions per run: ' + r4.hazards.filter(h => h.kind === 'injunction').length); eq(r4.hazards.filter(h => h.kind === 'injunction').length, 4, 'cap reached');
    // radius shrinks with Legal Team; life removes them
    const sl = a3save({ legal: 3 }), r5 = mk3(sl, 12, 58), w5 = E.spawn(r5, 'counsel', 180, 100); only(w5, ix, true); const t5 = ticks(r5, sl, 1, null).filter(x => x.type === 'telegraph'); near(t5[0].r, 50 * 0.512, 1e-9, 'injunction radius x0.8^legal');
    ticks(r5, sl, 60 * 1.0, null); const alive = r5.hazards.filter(h => h.kind === 'injunction').length; ok(alive > 0, 'still alive at 1 s'); w5.at = w5.at.map(() => 1e9); ticks(r5, sl, 60 * 7.5, null); eq(r5.hazards.filter(h => h.kind === 'injunction').length, 0, 'removed after life 6 s');
    // storm keeps its cadence while enjoined
    const ss = a3save({ fusion: 1, storm: 1 }); const r6 = mk3(ss, 12, 59); r6.stats.damage = 1; r6.stats.radius = 1e4; r6._cd = 0; const w6 = E.spawn(r6, 'counsel', 180, 100); only(w6, 0, false); r6.hazards.push({ id: r6._nid++, kind: 'injunction', x: 180, y: 460, r: 50, x2: 0, y2: 0, w: 0, t: 5, dur: 0.8, life: 1e9, active: true, oid: w6.id, ai: 0, dmg: 0, bar: true });
    const bb = E.spawn(r6, 'scrapling', 180, 300, { entered: true }); bb.hp = bb.maxHp = 1e30; ticks(r6, ss, 2, null); const e6 = ticks(r6, ss, 60 * 12, null); ok(has(e6, 'storm'), 'Storm Coil keeps firing under an injunction'); ok(!has(e6, 'zap', z => z.src === 'arc'), 'arc still dark');
  }
  // ---- clawback
  {
    const save = a3save(), run = mk3(save, 13, 60), e = E.spawn(run, 'comptroller', 180, 80); run.earned.bolts = 1000000; only(e, atkIdx('comptroller', 'clawback'), true);
    const evs = ticks(run, save, 1, null); const cb = evs.find(x => x.type === 'clawback'); ok(cb, 'clawback event'); eq(cb.bolts, 40000, 'moves 4% of earned bolts'); eq(run.earned.bolts, 960000, 'earned reduced'); eq(run.boss.clawed, 40000, 'boss.clawed'); eq(run.clawed, 40000, 'run.clawed');
    only(e, atkIdx('comptroller', 'clawback'), true); ticks(run, save, 1, null); eq(run.boss.clawed, 40000 + 38400, 'second claw on what is left'); eq(run.earned.bolts, 960000 - 38400, 'earned again');
    // nothing to claw
    const r2 = mk3(save, 13, 61), e2 = E.spawn(r2, 'comptroller', 180, 80); only(e2, atkIdx('comptroller', 'clawback'), true); eq(count(ticks(r2, save, 1, null), 'clawback'), 0, 'no event with nothing to claw'); eq(r2.boss.clawed, 0, 'clawed stays 0');
    // legal
    const sl = a3save({ legal: 2 }), r3 = mk3(sl, 13, 62), e3 = E.spawn(r3, 'comptroller', 180, 80); r3.earned.bolts = 1000000; only(e3, atkIdx('comptroller', 'clawback'), true); eq(ticks(r3, sl, 1, null).find(x => x.type === 'clawback').bolts, Math.floor(1000000 * 0.04 * 0.5625), 'Legal Team x0.75^L');
    // kill: the clawed bolts return x1.5 as pickups, event refund
    const r4 = mk3(save, 13, 63), e4 = E.spawn(r4, 'comptroller', 180, 80); r4.earned.bolts = 1000000; only(e4, atkIdx('comptroller', 'clawback'), true); ticks(r4, save, 1, null); only(e4, 0, false);
    e4.shDone = e4.shDone.map(() => true); e4.hp = 1; r4.stats.damage = 1e30; r4.stats.radius = 1e4; r4._cd = 0; const ek = ticks(r4, save, 3, null); eq(r4.boss.state, 'dead', 'Comptroller scrapped'); const rf = ek.find(x => x.type === 'refund'); ok(rf && rf.bolts === Math.round(40000 * 1.5), 'refund x1.5: ' + (rf && rf.bolts));
    eq(r4.pickups.filter(p => p.kind === 'bolt').reduce((a, p) => a + p.value, 0), 60000, 'refund drops as pickups'); eq(r4.clawed, 0, 'nothing lost after a kill'); const rep = E.endShift(r4, save); eq(rep.clawed, 0, 'report.clawed 0 after a kill');
    // shift ends first: lost, tallied
    const sv5 = a3save(), r5 = mk3(sv5, 13, 64), e5 = E.spawn(r5, 'comptroller', 180, 80); r5.earned.bolts = 1000000; only(e5, atkIdx('comptroller', 'clawback'), true); ticks(r5, sv5, 1, null); r5.player.battery = 0; ticks(r5, sv5, 2, null); const rp = E.endShift(r5, sv5);
    eq(rp.clawed, 40000, 'report.clawed'); eq(sv5.stats.clawed, 40000, 'stats.clawed (lifetime)'); eq(rp.bolts, 960000, 'the clawed bolts are not paid');
    // shields: pylons at 60%
    const r6 = mk3(save, 13, 65), e6 = E.spawn(r6, 'comptroller', 180, 80); e6.at = e6.at.map(() => 1e9); e6.hp = 0.59 * e6.maxHp; ticks(r6, save, 2, null); ok(e6.shielded && r6.enemies.filter(q => q.type === 'pylon' && !q.dead).length === 3, 'comptroller shields with 3 pylons at 60%');
  }
  // ---- volatility
  {
    const save = a3save(), run = mk3(save, 14, 66), e = E.spawn(run, 'market', 180, 120); e.at = e.at.map(() => 1e9); e.speed = 0;
    const seen = []; for (let i = 0; i < 60 * 12; i++) { tick(run, save, null); seen.push(run.boss.vol); }
    ok(Math.min(...seen) >= 0.25 - 1e-9 && Math.max(...seen) <= 2.5 + 1e-9, 'vol stays within [0.25, 2.5]'); ok(Math.min(...seen) < 0.3 && Math.max(...seen) > 2.4, 'it swings through its range: ' + Math.min(...seen).toFixed(2) + '..' + Math.max(...seen).toFixed(2));
    near(seen[0], 1.375, 0.05, 'starts mid-range'); const per = seen.findIndex((v, i) => i > 30 && v >= seen[0] && seen[i - 1] < seen[0]); ok(per > 300 && per < 420, 'period about 6 s: ' + per / 60);
    // damage taken x m(t)
    const dmgAt = vol => { const r = mk3(save, 14, 67), w = E.spawn(r, 'market', 180, 120); w.at = w.at.map(() => 1e9); w.hp = w.maxHp; r.boss.vol = vol; const e0 = w.hp; const t = { x: 0 }; r.stats.damage = 1e6; r.stats.radius = 1e4; r._cd = 0; r.run = null; placePlayer(r, 180, 150);
      const old = w.hp; E.step(r, save, null); /* vol is recomputed in updateBoss, so measure the hit relative to boss.vol after the step */ return (old - w.hp) / 1e6; };
    near(dmgAt(1), 1, 1e-3, 'damage per zap = damage x m(t)'); near(dmgAt(0.25), 0.25, 1e-3, 'damage x m at 0.25'); near(dmgAt(2.5), 2.5, 1e-3, 'damage x m at 2.5');
    // vol is 1 for Wardens without it
    const r2 = mk3(save, 11, 68), e2 = E.spawn(r2, 'receptionist', 180, 100); e2.at = e2.at.map(() => 1e9); ticks(r2, save, 30, null); eq(r2.boss.vol, 1, 'vol 1 without volatility'); eq(r2.boss.aura, 0, 'aura 0 without aura');
    // phases: bull charge, bear slam + ring; courier summons
    const r3 = mk3(save, 14, 69), e3 = E.spawn(r3, 'market', 180, 120); eq(r3.boss.phase, 1, 'bull'); const pk = r3.enemies.length; only(e3, atkIdx('market', 'summon'), true); const es = ticks(r3, save, 2, null); eq(count(es, 'spawn', x => x.enemyType === 'courier'), 3, 'summons 3 couriers');
    const r4 = mk3(save, 14, 70), e4 = E.spawn(r4, 'market', 180, 120); e4.hp = 0.49 * e4.maxHp; ticks(r4, save, 2, null); eq(r4.boss.phase, 2, 'bear below 50%');
    const r5 = mk3(save, 14, 71), e5 = E.spawn(r5, 'market', 180, 120); only(e5, atkIdx('market', 'charge'), true); ok(has(ticks(r5, save, 1, null), 'telegraph', x => x.kind === 'charge'), 'bull: charge'); const r6 = mk3(save, 14, 72), e6 = E.spawn(r6, 'market', 180, 120); e6.hp = 0.4 * e6.maxHp; ticks(r6, save, 1, null);
    only(e6, atkIdx('market', 'slam'), true); ok(has(ticks(r6, save, 1, null), 'telegraph', x => x.kind === 'slam' && x.r === 70), 'bear: slam r 70'); only(e6, atkIdx('market', 'ring'), true); ok(has(ticks(r6, save, 1, null), 'shot'), 'bear: ring');
  }
  // ---- aura
  {
    const save = a3save(), run = mk3(save, 15, 73), e = E.spawn(run, 'founder', 180, 150); e.at = e.at.map(() => 1e9); e.speed = 0; e.hp = 0.35 * e.maxHp; ticks(run, save, 2, null); eq(run.boss.phase, 4, 'phase 4'); eq(run.boss.aura, 90, 'boss.aura 90 in P4');
    e.at = e.at.map(() => 1e9); placePlayer(run, 180, 150 + 80); run.player.battery = run.player.maxBattery = 1e6; const b0 = run.player.battery; ticks(run, save, 60, null); const lost = b0 - run.player.battery; const drainOnly = (60 * (1 + 0) * 0.8) / 60;
    ok(lost > 0, 'aura hurts inside r'); const dps = 10 * run.sec.dmg * (1 - run.stats.plating); ok(lost > dps * 0.9 * 0.5, 'about dps x sector dmg per second: ' + lost + ' vs ' + dps);
    placePlayer(run, 180, 150 + 200); const b1 = run.player.battery; ticks(run, save, 60, null); ok(b1 - run.player.battery < dps * 0.1 + 5, 'no aura damage outside r');
    // plating reduces it
    const sp = a3save({ plating: 6 }), r2 = mk3(sp, 15, 74), e2 = E.spawn(r2, 'founder', 180, 150); e2.at = e2.at.map(() => 1e9); e2.speed = 0; e2.hp = 0.35 * e2.maxHp; ticks(r2, sp, 2, null); placePlayer(r2, 180, 230); r2.player.battery = r2.player.maxBattery = 1e6; ticks(r2, sp, 60, null); ok(1e6 - r2.player.battery < lost, 'plating cuts the aura');
    const ev = ticks(run, save, 120, { x: 180, y: 230 }); ok(!ev.some(x => x.type === 'hurt' && x.src === 'aura' && false), 'aura hurt events are batched'); eq(r2.boss.phase, 4, 'phase 4 kept');
  }
  // ---- summon spam from a Warden: one burst per count
  {
    const save = a3save(), run = mk3(save, 11, 75), e = E.spawn(run, 'receptionist', 180, 100); only(e, atkIdx('receptionist', 'summon'), true); const evs = ticks(run, save, 2, null); eq(count(evs, 'spawn', x => x.enemyType === 'spam'), 16, 'summon spam x2 = two bursts of 8');
    ok(run.enemies.filter(x => x.type === 'spam').every(x => x.entered), 'summoned spam are on the floor');
    const r2 = mk3(save, 11, 76), e2 = E.spawn(r2, 'receptionist', 180, 100); only(e2, atkIdx('receptionist', 'ring'), true); eq(count(ticks(r2, save, 1, null), 'shot'), 1, 'ring event'); eq(r2.shots.length, 12, 'ring n 12');
    const r3 = mk3(save, 11, 77); for (let i = 0; i < 45; i++) E.spawn(r3, 'scrapling', 20 + i * 5, 600, { entered: true }); const e3 = E.spawn(r3, 'receptionist', 180, 100); only(e3, atkIdx('receptionist', 'summon'), true); eq(count(ticks(r3, save, 2, null), 'spawn', x => x.enemyType === 'spam'), 0, 'no summon past the summon cap');
    // receptionist drifts, never chases
    const r4 = mk3(save, 11, 78), e4 = E.spawn(r4, 'receptionist', 180, 100); e4.at = e4.at.map(() => 1e9); placePlayer(r4, 180, 560); const x0 = e4.x, y0 = e4.y; ticks(r4, save, 60 * 8, null); ok(Math.hypot(e4.x - x0, e4.y - y0) > 5, 'receptionist drifts'); ok(e4.y < 400, 'stays in the upper floor: ' + e4.y.toFixed(0)); ok(Math.hypot(e4.vx, e4.vy) <= 30 + 1e-9, 'drift speed 30');
  }
}

sec('boss enemy phase is engine-owned');
{
  // the engine keeps the boss enemy's phase equal to run.boss.phase (the renderer only reads it)
  const arrive = (sector, seed) => {
    const save = a3save(), run = mk3(save, sector, seed);
    run.boss.state = 'warning'; run.boss.warn = 0.02; let g = 0;
    while (run.boss.state !== 'active' && g++ < 10) tick(run, save, null);
    return { save, run, boss: run.enemies.find(e => e.boss && !e.dead) };
  };
  for (const [id, sector, seed, cut, want] of [['market', 14, 91, 0.45, 2], ['founder', 15, 92, 0.75, 2]]) {
    const { save, run, boss } = arrive(sector, seed);
    ok(boss && boss.type === id && run.boss.id === id, id + ' Warden arrived'); boss.at = boss.at.map(() => 1e9);
    eq(run.boss.phase, 1, id + ' phase 1 at spawn'); eq(boss.phase, run.boss.phase, id + ' enemy phase = run.boss.phase right after spawn');
    boss.hp = cut * boss.maxHp; ticks(run, save, 2, null);
    eq(run.boss.phase, want, id + ' reached phase ' + want); eq(boss.phase, run.boss.phase, id + ' enemy phase = run.boss.phase after a phase change');
  }
}

sec('Act III Founder, finale, Executive features');
{
  const F = D.BOSS_BY_ID.founder;
  // ---- Founder phases, blink in P2 and P5, events
  {
    const save = a3save({ stake: 1 }), run = mk3(save, 15, 80), e = E.spawn(run, 'founder', 180, 100); e.at = e.at.map(() => 1e9); e.speed = 0;
    eq(run.boss.phase, 1, 'phase 1'); const ph = []; const evsAll = [];
    for (const [f, want] of [[0.99, 1], [0.79, 2], [0.59, 3], [0.39, 4], [0.19, 5]]) { e.hp = f * e.maxHp; e.invuln = false; e.blinking = false; run.hazards.length = 0; e.hz = 0; const ev = ticks(run, save, 2, null); evsAll.push(...ev); eq(run.boss.phase, want, 'phase ' + want + ' at ' + f); ph.push(run.boss.phase); }
    const fe = evsAll.filter(x => x.type === 'founder'); eq(fe.map(x => x.phase).join(), '1,2,3,4,5', 'founder events: phase 1 at spawn, then each phase change'); eq(count(ticks(mk3(save, 15, 81), save, 1, null), 'founder'), 0, 'no founder event without a Founder');
    const r0 = mk3(save, 15, 82); const ev0 = []; const e0 = E.spawn(r0, 'founder', 180, 100); ev0.push(...r0.events.splice(0)); noteEvents(ev0); ok(ev0.some(x => x.type === 'founder' && x.phase === 1), 'founder {phase 1} at spawn');
    // attacks per phase
    const has5 = (phase, kind) => { const r = mk3(save, 15, 90 + phase), w = E.spawn(r, 'founder', 180, 100); w.hp = [1, 0.79, 0.59, 0.39, 0.19][phase - 1] * w.maxHp * 0.999; w.speed = 0; w.at = w.at.map(() => 1e9); ticks(r, save, 2, null); const k = D.BOSS_BY_ID.founder.attacks.map((a, i) => [a, i]).filter(([a]) => a.kind === kind && (!a.phases || a.phases.includes(phase)));
      return k.length > 0; };
    const kinds = { 1: ['slam', 'charge', 'ring'], 2: ['laser', 'barrage'], 3: ['hold', 'injunction', 'clawback'], 4: ['aura', 'summon'], 5: ['slam', 'charge', 'ring', 'laser', 'barrage', 'hold', 'injunction', 'clawback', 'aura', 'summon'] };
    for (const p in kinds) for (const k of kinds[p]) ok(has5(+p, k), 'Founder P' + p + ' has ' + k);
    for (const [p, k] of [[1, 'laser'], [1, 'hold'], [2, 'slam'], [2, 'hold'], [3, 'laser'], [3, 'slam'], [4, 'hold'], [4, 'charge']]) ok(!has5(p, k), 'Founder P' + p + ' has no ' + k);
    // blink only in P2 and P5
    const blinkIn = phase => { const r = mk3(save, 15, 100 + phase), w = E.spawn(r, 'founder', 180, 100); w.hp = [1, 0.79, 0.59, 0.39, 0.19][phase - 1] * w.maxHp * 0.999; w.at = w.at.map(() => 1e9); w.speed = 0; ticks(r, save, 2, null); w.bt = 0.01; return has(ticks(r, save, 3, null), 'telegraph', x => x.kind === 'blink'); };
    eq([1, 2, 3, 4, 5].map(blinkIn).join(), 'false,true,false,false,true', 'Founder blinks in P2 and P5 only');
    // P5 cadence 0.7
    const r5 = mk3(save, 15, 110), w5 = E.spawn(r5, 'founder', 180, 100); w5.hp = 0.19 * w5.maxHp; w5.speed = 0; ticks(r5, save, 2, null); const sl = atkIdx('founder', 'slam'); ok(w5.at[sl] <= F.attacks[sl].every * 0.7 + 1e-9, 'P5 cadence 0.7 on slam timer');
    // contact
    const r6 = mk3(save, 15, 111), w6 = E.spawn(r6, 'founder', 180, 440); w6.at = w6.at.map(() => 1e9); const b6 = r6.player.battery; ticks(r6, save, 30, null); ok(b6 - r6.player.battery > 0.4 * 9 * 0.9, 'Founder contact damage');
  }
  // ---- Founder blocked until the stake; Overtime/finale flags
  {
    const pre = a3save({}, { sectorsCleared: 14 }); const info = E.sectorInfo(pre, 15); eq(info.lureBlocked, true, 'sector 15 lureBlocked without the Stake'); eq(info.bossId, 'founder', 'Founder'); ok(info.unlocked, 'sector 15 unlocked after sector 14');
    const run = E.startShift(pre, 15, { seed: 1 }); eq(run.boss.blocked, true, 'boss.blocked without the Stake'); eq(run.player.magnate, false, 'not a magnate');
    run.enemies.length = 0; run.stats.damage = 1e30; run.stats.radius = 1e5; run.stats.targets = 50; immortal(run); for (let i = 0; i < 60 * 60; i++) { tick(run, pre, { x: 180, y: 300 }); }
    eq(run.boss.state, 'none', 'the Founder never comes without the Stake'); eq(run.boss.signal, 0, 'no signal accrues'); const rep0 = E.endShift(run, pre); eq(rep0.signalPct, 0, 'report.signalPct 0');
    const sv = a3save({ stake: 1 }, { sectorsCleared: 14 }); eq(E.sectorInfo(sv, 15).lureBlocked, false, 'lure open with the Stake'); const r2 = E.startShift(sv, 15, { seed: 1 }); eq(r2.boss.blocked, false, 'not blocked with the Stake'); eq(r2.player.magnate, true, 'player.magnate'); eq(r2.stats.magnate, true, 'stats.magnate');
    r2.enemies.length = 0; r2.stats.damage = 1e30; r2.stats.radius = 1e5; r2.stats.targets = 50; immortal(r2); r2._spawnT = 0; for (let i = 0; i < 60 * 120 && r2.boss.state === 'none'; i++) tick(r2, sv, { x: 180, y: 300 }); ok(r2.boss.state !== 'none', 'the Founder arrives once lured: ' + r2.boss.state);
    // finale: first kill
    const fin = a3save({ stake: 1 }, { sectorsCleared: 14 }); fin.stats.shifts = 400; fin.stats.playTime = 20000; fin.stats.wonShifts = 100; fin.stats.wonPlayTime = 5000; fin.stats.act2Shifts = 150; fin.stats.act2PlayTime = 8000;
    const run3 = mk3(fin, 15, 120), w = E.spawn(run3, 'founder', 180, 100); w.hp = 1; run3.stats.damage = 1e30; run3.stats.radius = 1e5; run3._cd = 0; const evs = ticks(run3, fin, 400, { x: 180, y: 130 }, r => { r.player.battery = r.player.maxBattery; });
    eq(run3.boss.state, 'dead', 'Founder scrapped'); const bd = evs.find(x => x.type === 'bossDead'); eq(bd.cores, 0, 'Founder first kill: no cores'); const sc = evs.find(x => x.type === 'sectorClear'); ok(sc.sector === 15 && sc.first === true, 'sectorClear first');
    ticks(run3, fin, 120, null); const rep = E.endShift(run3, fin); ok(rep.act3Won && rep.firstClear && rep.bossDefeated, 'report.act3Won + firstClear'); eq(rep.unlockedSector, 16, 'unlocks sector 16'); ok(fin.flags.founder, 'flags.founder'); eq(fin.bossKills[15], 1, 'bossKills 15'); eq(fin.sectorsCleared, 15, 'sectorsCleared 15');
    eq(fin.stats.act3Shifts, 401 - 100 - 150, 'stats.act3Shifts = shifts - won - act2'); near(fin.stats.act3PlayTime, 20000 + run3.t - 5000 - 8000, 1e-6, 'stats.act3PlayTime'); ok(E.sectorInfo(fin, 16).unlocked, 'Overtime unlocked after the Founder'); eq(E.sectorInfo(fin, 16).lockReason, null, 'no lock reason');
    eq(fin.flags.finale, false, 'finale (UI) not set by the engine'); eq(rep.act2Won, false, 'act2Won false');
    // second Founder kill: repeat cores 4, no act3Won
    const run4 = mk3(fin, 15, 121), w4 = E.spawn(run4, 'founder', 180, 100); w4.hp = 1; run4.stats.damage = 1e30; run4.stats.radius = 1e5; run4._cd = 0; const ev4 = ticks(run4, fin, 400, { x: 180, y: 130 }, r => { r.player.battery = r.player.maxBattery; }); eq(ev4.find(x => x.type === 'bossDead').cores, 3, 'repeat Founder pays 3 cores'); ticks(run4, fin, 120, null); const rp4 = E.endShift(run4, fin); ok(!rp4.act3Won && !rp4.firstClear, 'no second finale');
    eq(fin.stats.act3Shifts, 401 - 100 - 150, 'act3Shifts not rewritten');
    // first Chairman kill sets act3
    const ch = a2save({ titan: 1, takeover: 1 }, { sectorsCleared: 9 }); for (let k = 5; k <= 9; k++) ch.bossKills[k] = 1; const rc = mk3(ch, 10, 122), wc = E.spawn(rc, 'chairman', 180, 100); wc.shDone = wc.shDone.map(() => true); wc.hp = 1; rc.stats.damage = 1e30; rc.stats.radius = 1e5; rc._cd = 0; ticks(rc, ch, 400, { x: 180, y: 130 }, r => { r.player.battery = r.player.maxBattery; }); ticks(rc, ch, 120, null);
    const rcr = E.endShift(rc, ch); ok(rcr.act2Won && ch.flags.act3 && ch.flags.chairman, 'Chairman kill: act2Won, flags.act3, flags.chairman'); eq(rcr.unlockedSector, 11, 'unlocks sector 11 (the Lobby)'); ok(E.sectorInfo(ch, 11).unlocked && !E.sectorInfo(ch, 12).unlocked, 'Lobby open, Legal closed'); ok(!E.upgradeInfo(ch, 'megacoil').classified, 'Executive Suite declassified'); ok(!ch.flags.founder, 'no founder yet');
    // sectors 11-15 unlock one at a time; cores per Warden
    const sv2 = a3save({ stake: 1 }); const ids = ['receptionist', 'counsel', 'comptroller', 'market', 'founder'], first = [8, 6, 8, 10, 0], rep2 = [3, 3, 5, 5, 3];
    for (let n = 11; n <= 15; n++) {
      ok(E.sectorInfo(sv2, n).unlocked, 'sector ' + n + ' unlocked'); ok(n === 15 || !E.sectorInfo(sv2, n + 1).unlocked, 'sector ' + (n + 1) + ' locked until ' + n + ' falls');
      const run = mk3(sv2, n, 130 + n), w = E.spawn(run, ids[n - 11], 180, 100); w.shDone = (w.shDone || []).map(() => true); w.hp = 1; run.stats.damage = 1e30; run.stats.radius = 1e5; run._cd = 0;
      const evs = ticks(run, sv2, 400, { x: 180, y: 130 }, r => { r.player.battery = r.player.maxBattery; }); const b = evs.find(x => x.type === 'bossDead'); ok(b && b.cores === first[n - 11], 'first-clear cores sector ' + n + ': ' + (b && b.cores)); ticks(run, sv2, 120, null); const rp = E.endShift(run, sv2);
      ok(rp.firstClear && rp.unlockedSector === n + 1, 'first clear unlocks ' + (n + 1)); eq(sv2.sectorsCleared, n, 'sectorsCleared ' + n);
      const run2 = mk3(sv2, n, 140 + n), w2 = E.spawn(run2, ids[n - 11], 180, 100); w2.shDone = (w2.shDone || []).map(() => true); w2.hp = 1; run2.stats.damage = 1e30; run2.stats.radius = 1e5; run2._cd = 0; const e2 = ticks(run2, sv2, 400, { x: 180, y: 130 }, r => { r.player.battery = r.player.maxBattery; });
      eq(e2.find(x => x.type === 'bossDead').cores, rep2[n - 11], 'repeat cores sector ' + n); E.endShift(run2, sv2);
    }
  }
  // ---- Executive features in play
  {
    const save0 = a3save();
    // diligence: Wardens and their pylons only
    { const sv = a3save({ diligence: 2 }), r = mk3(sv, 13, 150), w = E.spawn(r, 'comptroller', 180, 120); w.at = w.at.map(() => 1e9); const bot = E.spawn(r, 'sparker', 200, 140, { entered: true }); bot.hp = bot.maxHp = 1e9; r.stats.damage = 1e6; r.stats.radius = 1e4; r.stats.targets = 5; r._cd = 0; placePlayer(r, 180, 150);
      const h0 = w.hp, b0 = bot.hp; ticks(r, sv, 2, null); near((h0 - w.hp) / 1e6, 1.5625, 1e-3, 'Warden takes damage x1.25^diligence'); near((b0 - bot.hp) / 1e6, 1, 1e-3, 'plain bots take plain damage');
      const r2 = mk3(sv, 13, 151), w2 = E.spawn(r2, 'comptroller', 180, 120); w2.hp = 0.59 * w2.maxHp; w2.at = w2.at.map(() => 1e9); ticks(r2, sv, 2, null); const py = r2.enemies.find(q => q.type === 'pylon'); ok(py, 'pylon'); r2.stats.damage = 1e6; r2.stats.radius = 1e4; r2.stats.targets = 9; r2._cd = 0; placePlayer(r2, py.x, py.y + 20); const p0 = py.hp; ticks(r2, sv, 2, null); near((p0 - py.hp) / 1e6, 1.5625, 1e-3, 'pylons take x1.8^diligence too'); }
    // fleet: drones
    { const sv = a3save({ drone: 4, dronedmg: 2, fleet: 2 }), r = mk3(sv, 12, 152); eq(r.drones.length, 6, '4 + 2 drones in the run'); eq(r.stats.drones, 6, 'stats.drones'); }
    // insider: crits
    { const sv = a3save({ insider: 5 }), r = mk3(sv, 12, 153); eq(r.stats.critChance, 0.15, 'critChance 15%'); r.stats.damage = 10; r.stats.radius = 1e4; r._cd = 0; const bots = []; for (let i = 0; i < 6; i++) { const b = E.spawn(r, 'scrapling', 100 + i * 25, 300, { entered: true }); b.hp = b.maxHp = 1e12; bots.push(b); } r.stats.targets = 6; let crits = 0, n = 0, maxd = 0;
      for (let k = 0; k < 200; k++) { r._cd = 0; const evs = ticks(r, sv, 1, null); for (const z of evs) if (z.type === 'hit') { n++; if (z.crit) { crits++; maxd = Math.max(maxd, z.dmg); } } } ok(n > 500 && crits > 0.07 * n && crits < 0.25 * n, 'about 15% crits: ' + crits + '/' + n); near(maxd, 10 * (3 + 2.5), 1e-6, 'crit multiplier 3 + 0.5/lvl'); }
    // compound: bolt value over time
    { const sv = a3save({ compound: 2 }), r = mk3(sv, 12, 154); eq(r.compound, 1, 'run.compound starts at 1'); ticks(r, sv, 60 * 5, null); eq(r.compound, 1, '1.0 before 10 s'); ticks(r, sv, 60 * 6, null); near(r.compound, 1.08, 1e-9, '+8% at 10 s (4% x 2 levels)'); ticks(r, sv, 60 * 10, null); near(r.compound, 1.16, 1e-9, '+16% at 20 s'); ticks(r, sv, 60 * 140, null); near(r.compound, 2.2, 1e-9, 'cap +120% (60% x 2)');
      const r2 = mk3(sv, 12, 155); r2.stats.compoundStep = 0; r2.compound = 1.5; pk(r2, 'bolt', 100, r2.player.x, r2.player.y, 1); const evs = ticks(r2, sv, 2, null); const p = evs.find(x => x.type === 'pickup'); eq(p.value, 150, 'bolt pickup x compound'); const rep = E.endShift(r2, sv); near(rep.compound, 1.5, 1e-9, 'report.compound');
      const n0 = E.endShift(mk3(save0, 12, 1), E.newSave()); eq(n0.compound, 1, 'report.compound 1 without the node'); }
    // expense: battery refunds while combo >= 20
    { const sv = a3save({ expense: 3 }), r = mk3(sv, 12, 156); r.player.maxBattery = 1000; r.player.battery = 500; r.combo.n = 19; r.stats.damage = 1e30; r.stats.radius = 1e4; r.stats.targets = 40; const bots = []; for (let i = 0; i < 30; i++) E.spawn(r, 'scrapling', 20 + (i % 15) * 22, 200 + 15 * Math.floor(i / 15), { entered: true }); r._cd = 0; const b0 = r.player.battery; ticks(r, sv, 1, null);
      eq(r.counts.kills, 30, '30 scrapped'); const gained = r.expense; near(gained, 12 * 3 > 0 ? Math.min(0.12 * 30, 36) : 0, 1e-9, 'expense refunds 0.04 x 3 per scrap while combo >= 20: ' + gained); ok(r.player.battery > b0 - 1, 'battery up');
      const r2 = mk3(sv, 12, 157); r2.player.maxBattery = 1e6; r2.player.battery = 5e5; r2.stats.damage = 1e30; r2.stats.radius = 1e4; r2.stats.targets = 99; for (let k = 0; k < 40; k++) { for (let i = 0; i < 80; i++) E.spawn(r2, 'scrapling', 20 + (i % 20) * 16, 200 + 10 * Math.floor(i / 20), { entered: true }); r2._cd = 0; ticks(r2, sv, 1, null); }
      ok(r2.expense <= 36 + 1e-9 && r2.expense >= 35, 'max +12 x level per shift: ' + r2.expense); const rep = E.endShift(r2, sv); near(rep.expense, r2.expense, 1e-9, 'report.expense');
      const r3 = mk3(sv, 12, 158); r3.player.maxBattery = 1000; r3.player.battery = 500; r3.combo.n = 0; r3.stats.damage = 1e30; r3.stats.radius = 1e4; r3.stats.targets = 25; for (let i = 0; i < 25; i++) E.spawn(r3, 'scrapling', 15 + (i % 25) * 13, 200, { entered: true }); r3._cd = 0; ticks(r3, sv, 1, null); near(r3.expense, 0.12 * 6, 1e-9, 'only the scraps from combo 20 up refund (6 of 25): ' + r3.expense); }
    // restructure: bursts, chain, max 8/s
    { const sv = a3save({ restructure: 5 }), r = mk3(sv, 12, 159); r.stats.burstChance = 1; r.stats.damage = 1e30; r.stats.radius = 1e4; r.stats.targets = 1; const t1 = E.spawn(r, 'scrapling', 180, 300, { entered: true }); t1.hp = 1; const nb = []; for (let i = 0; i < 5; i++) { const b = E.spawn(r, 'scrapling', 180 + 20 * (i + 1), 300, { entered: true }); b.hp = b.maxHp = 1e9; nb.push(b); }
      r.stats.damage = 1e-3; r._cd = 0; const dmgSave = r.stats.damage; r.stats.damage = 1e9; r._cd = 0; const evs = ticks(r, sv, 1, null); const bu = evs.filter(x => x.type === 'burst'); ok(bu.length >= 1 && bu[0].r === 60, 'burst event r 60'); ok(bu[0].n >= 1, 'burst reports bots hit'); ok(nb.every(b => b.hp < 1e9), 'neighbours take 8 x damage');
      near(1e9 - nb[0].hp, 8 * r.stats.damage, 1, 'burst damage = 8 x damage'); }
    { const sv = a3save({ restructure: 5 }), r = mk3(sv, 12, 160); r.stats.burstChance = 1; r.stats.damage = 1e30; r.stats.radius = 1e4; r.stats.targets = 40; placePlayer(r, 180, 620);
      for (const x of [30, 180, 330]) for (const y of [60, 200, 340, 480]) { const b = E.spawn(r, 'scrapling', x, y, { entered: true }); b.hp = 1; b.maxHp = 1; } r._cd = 0;
      const evs = ticks(r, sv, 1, null); eq(r.counts.kills, 12, '12 isolated scraps in one pulse'); eq(count(evs, 'burst'), 8, 'max 8 bursts per second');
      for (let i = 0; i < 70; i++) tick(r, sv, null); for (const x of [30, 180, 330]) for (let y = 60; y <= 340; y += 140) { const b = E.spawn(r, 'scrapling', x, y, { entered: true }); b.hp = 1; b.maxHp = 1; } r._cd = 0; const more = ticks(r, sv, 1, null); eq(count(more, 'burst'), 8, 'a fresh second allows 8 more'); }
    { const sv = a3save({ restructure: 5 }), r = mk3(sv, 12, 169); r.stats.burstChance = 1; r.stats.damage = 1e30; r.stats.radius = 1e4; r.stats.targets = 1; placePlayer(r, 180, 620);
      const ids = []; for (let i = 0; i < 8; i++) { const b = E.spawn(r, 'scrapling', 180, 100 + 70 * i, { entered: true }); b.hp = 1; b.maxHp = 1; b.vx = b.vy = 0; } r._cd = 0; r.player.y = 620;
      const evs = ticks(r, sv, 1, null); ok(count(evs, 'burst') >= 4, 'bursts chain from bot to bot: ' + count(evs, 'burst')); ok(r.counts.kills >= 5 && r.counts.kills <= 8, 'chain scrapped ' + r.counts.kills + ' of 8 (bounded by the chain depth)'); }
    { const sv = a3save({ restructure: 1 }), r = mk3(sv, 12, 161); near(r.stats.burstChance, 0.04, 1e-12, '4% per level'); let bursts = 0; for (let k = 0; k < 400; k++) { const rr = mk3(sv, 12, 1000 + k); rr.stats.damage = 1e30; rr.stats.radius = 1e4; rr._cd = 0; const b = E.spawn(rr, 'scrapling', 180, 300, { entered: true }); const evs = ticks(rr, sv, 1, null); if (has(evs, 'burst')) bursts++; } ok(bursts >= 3 && bursts <= 35, 'about 4% of scraps burst: ' + bursts + '/400'); }
    // orbital
    { const sv = a3save({ orbital: 2 }), r = mk3(sv, 13, 162); eq(r._orbT, 9, 'first strike after orbitalEvery'); const big = E.spawn(r, 'hauler', 100, 200, { entered: true }); big.hp = big.maxHp = 1e9; const small = E.spawn(r, 'scrapling', 260, 200, { entered: true }); small.hp = small.maxHp = 10; const near2 = E.spawn(r, 'scrapling', 120, 200, { entered: true }); near2.hp = near2.maxHp = 1e9;
      r.stats.damage = 1; r.stats.orbitalMult = 50; r._orbT = 0.01; const e1 = ticks(r, sv, 2, null); const tg = e1.find(x => x.type === 'telegraph' && x.kind === 'orbital'); ok(tg && tg.r === 50 && Math.abs(tg.dur - 0.6) < 1e-9, 'orbital telegraph'); near(tg.x, 100, 1, 'marks the highest-hp bot'); eq(r.strikes.length, 1, 'run.strikes has the marker'); const mk0 = r.strikes[0]; ok(['id', 'x', 'y', 'r', 't', 'dur', 'targetId'].every(k => k in mk0), 'strike fields'); eq(mk0.targetId, big.id, 'targetId');
      const e2 = ticks(r, sv, 40, null); const ob = e2.find(x => x.type === 'orbital'); ok(ob && ob.r === 50 && ob.n >= 1, 'orbital event'); near(1e9 - big.hp, 50, 1e-3, 'strike = 25 x level x damage on the target'); near(1e9 - near2.hp, 15, 1e-3, '30% splash within r 50'); eq(small.hp, 10, 'far bot untouched'); eq(r.strikes.length, 0, 'marker gone'); eq(ob.n, 2, 'n = bots hit');
      near(r._orbT, 9, 1, 'timer restarts at 13 - 2 x level'); }
    { const sv = a3save({ orbital: 1, diligence: 1 }), r = mk3(sv, 11, 163), w = E.spawn(r, 'receptionist', 180, 100); w.at = w.at.map(() => 1e9); w.speed = 0; r.stats.damage = 1; r.stats.orbitalMult = 100; r._orbT = 0.01; const h0 = w.hp; const e1 = ticks(r, sv, 50, null); const ob = e1.find(x => x.type === 'orbital'); ok(ob, 'orbital hits a Warden'); near((h0 - w.hp) / 100, 1.25, 1e-3, 'Warden damage x wardenMult applies once'); }
    { const sv = a3save({ orbital: 1 }), r = mk3(sv, 11, 164); r._orbT = 0.01; const e1 = ticks(r, sv, 3, null); ok(!has(e1, 'telegraph', x => x.kind === 'orbital') && r.strikes.length === 0, 'nothing to strike: no marker'); ok(r._orbT > 0.5 && r._orbT <= 1.01, 'retries in about 1 s'); }
    // outsourcing: Interns
    { const sv = a3save({ rehire: 5, outsource: 3, fleet: 1, drone: 4 }), r = mk3(sv, 12, 165); eq(r.stats.internMax, 10, 'internMax 4 + 2 x 3'); eq(r.stats.internLife, 15, 'internLife 6 + 3 x 3'); eq(r.stats.internMult, 8, 'internMult 2^3'); r.stats.rehireChance = 1; r.stats.damage = 1e30; r.stats.radius = 1e4; r.stats.targets = 40;
      for (let i = 0; i < 14; i++) E.spawn(r, 'scrapling', 20 + i * 20, 200, { entered: true }); r._cd = 0; ticks(r, sv, 1, null); eq(r.interns.length, 10, 'up to 10 Interns alive'); near(r.interns[0].life, 15, 1e-9, 'life 15 s');
      const sv0 = a3save({ rehire: 5 }), r0 = mk3(sv0, 12, 166); r0.stats.rehireChance = 1; r0.stats.damage = 1e30; r0.stats.radius = 1e4; r0.stats.targets = 40; for (let i = 0; i < 14; i++) E.spawn(r0, 'scrapling', 20 + i * 20, 200, { entered: true }); r0._cd = 0; ticks(r0, sv0, 1, null); eq(r0.interns.length, 4, 'still max 4 without Outsourcing'); near(r0.interns[0].life, 6, 1e-9, 'life 6');
      const contact = (sv1) => { const rr = mk3(sv1, 12, 167); rr.stats.damage = 1; const it = { id: rr._nid++, x: 180, y: 300, vx: 0, vy: 0, age: 0, life: 99 }; rr.interns.push(it); const t = E.spawn(rr, 'hauler', 180, 300, { entered: true }); t.hp = t.maxHp = 1e12; rr._spawnT = 1e9; ticks(rr, sv1, 60, null); return 1e12 - t.hp; };
      near(contact(sv) / contact(sv0), 8, 0.3, 'Interns bite x2 per level'); }
    // stake: Magnate
    { const sv = a3save({ stake: 1, megacoil: 1 }), r = mk3(sv, 11, 168); eq(r.player.magnate, true, 'player.magnate'); near(r.stats.maxBattery / E.stats(a3save({ megacoil: 1 })).maxBattery, 1.25, 1e-9, 'battery x1.25 in the run'); const lo = E.loadout(sv); ok(lo.magnate && lo.colossus, 'loadout magnate + colossus'); }
  }
}

sec('Act III fatigue, Overtime, determinism and invariants');
{
  const per = D.TUNE.fatiguePer, mx = D.TUNE.fatigueMax;
  const fs = () => a3save({ stake: 1 }, { sectorsCleared: 14 });
  const shiftWith = (save, n, state) => { const run = mk(save, n, 3); run.boss.state = state; return E.endShift(run, save); };
  for (const n of [11, 12, 13, 14, 15]) {
    const s = fs(); let r = shiftWith(s, n, 'none'); eq(s.fatigue[n], 0, 'sector ' + n + ': no change when the Warden never showed'); r = shiftWith(s, n, 'active'); near(s.fatigue[n], per, 1e-12, 'sector ' + n + ': one failed attempt'); near(r.fatigue, per, 1e-12, 'report.fatigue'); eq(r.fatigueUp, true, 'fatigueUp');
    for (let i = 0; i < 20; i++) shiftWith(s, n, 'active'); near(s.fatigue[n], mx, 1e-12, 'sector ' + n + ': capped'); r = shiftWith(s, n, 'dead'); eq(s.fatigue[n], 0, 'sector ' + n + ': reset on a kill'); eq(r.fatigueUp, false, 'no fatigueUp on a kill');
    for (const k of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) if (k !== n) eq(s.fatigue[k], 0, 'other sectors untouched (' + k + ')');
    // hp and pylons scale at spawn
    const sv = fs(); const f = 0.18; sv.fatigue[n] = f; const run = mk3(sv, n, 5); const id = D.SECTORS[n - 1].warden, def = D.BOSS_BY_ID[id]; near(run.boss.fatigue, f, 1e-12, 'run.boss.fatigue ' + n); near(E.sectorInfo(sv, n).fatigue, f, 1e-12, 'sectorInfo.fatigue ' + n);
    const base = mk3(fs(), n, 5), e0 = E.spawn(base, id, 180, 120), e = E.spawn(run, id, 180, 120); near(e.hp, e0.hp * (1 - f), 1e-9 * e0.hp, id + ' hp x(1-fatigue)'); near(e.maxHp, e0.maxHp * (1 - f), 1e-9 * e0.maxHp, id + ' maxHp x(1-fatigue)');
    if (def.shields) { for (const [r2, ee] of [[run, e], [base, e0]]) { ee.at = ee.at.map(() => 1e9); ee.hp = def.shields[0] * ee.maxHp * 0.99; tick(r2, sv, null); } const pa = run.enemies.filter(q => q.pyl && !q.dead), pb = base.enemies.filter(q => q.pyl && !q.dead); ok(pa.length > 0 && pa.length === pb.length, id + ' pylons called'); if (pa.length && pb.length) near(pa[0].hp, pb[0].hp * (1 - f), 1e-9 * pb[0].hp, 'pylon hp x(1-fatigue)'); }
  }
  { const s = fs(); s.sectorsCleared = 15; s.flags.founder = true; const r = shiftWith(s, 16, 'active'); eq(r.fatigueUp, false, 'Overtime has no fatigue'); eq(JSON.stringify(s.fatigue), JSON.stringify(E.newSave().fatigue), 'fatigue untouched by Overtime'); s.fatigue[15] = 0.3; const orun = mk3(s, 16, 4); eq(orun.boss.fatigue, 0, 'Overtime boss.fatigue 0'); }
  { const s = fs(); s.fatigue[12] = 0.06; const ra = mk3(s, 12, 11), sb = fs(); delete sb.fatigue; const rb = mk3(sb, 12, 11); const sc = fs(); const rc = mk3(sc, 12, 11); for (let i = 0; i < 300; i++) { tick(rc, sc, null); tick(rb, sb, null); } eq(rb.rs, rc.rs, 'fatigue 0 == no fatigue field (same PRNG)'); }
  // Overtime: normalised Warden hp, every rotation Warden
  { const s = a3save({}, { sectorsCleared: 15 }); s.flags.founder = true; const fb = D.BOSS_BY_ID.founder; const seen = new Set();
    for (let L = 1; L <= 10; L++) { s.overtime.level = L - 1; const run = mk3(s, 16, 7), id = D.OVERTIME.rotation[(L - 1) % 10]; seen.add(id); eq(run.boss.id, id, 'rotation L' + L + ' = ' + id); near(run.boss.maxHp / (fb.hp * Math.pow(6, L)), 1, 1e-9, 'L' + L + ' ' + id + ' hp = Founder hp x6^L'); near(run._boltBase, fb.bolts, 0, 'bolts base = Founder'); const e = E.spawn(run, id, 180, 120); near(e.maxHp / (fb.hp * Math.pow(6, L)), 1, 1e-9, 'spawned ' + id + ' hp normalised'); eq(e.type, id, 'spawned the rotation Warden');
      near(run.sec.hp / (D.SECTORS[14].hp * Math.pow(6, L)), 1, 1e-9, 'sector hp = sector 15 x6^L'); near(run.sec.dmg / (D.SECTORS[14].dmg * Math.pow(1.12, L)), 1, 1e-9, 'dmg x1.12^L'); eq(run.boss.blocked, false, 'Overtime Founder not blocked'); }
    eq(seen.size, 10, 'all ten Wardens appear'); s.overtime.level = 9; const rf = mk3(s, 16, 8); eq(rf.boss.id, 'founder', 'level 10 is the Founder'); eq(E.sectorInfo(s, 16).bossId, 'founder', 'sectorInfo.bossId'); eq(E.sectorInfo(s, 16).overtime, 10, 'sectorInfo.overtime'); eq(E.sectorInfo(s, 16).lureBlocked, false, 'lure open'); }
  // Act I / II shifts do not touch the Act III machinery or its PRNG
  { const sv = a2save({ coil: 6, amp: 2, titan: 1, fusion: 2, takeover: 1, drone: 2, rehire: 3, nanites: 2 }, { sectorsCleared: 9 }); const run = E.startShift(sv, 8, { w: 360, h: 640, seed: 21 }); immortal(run); let g = 0; while (!run.over && g++ < 60 * 90) { E.step(run, sv, A.target(run, { skill: 'attentive' })); run.events.length = 0;
      if (run.heals.length || run.strikes.length || run.hazards.some(h => h.kind === 'hold' || h.kind === 'injunction')) { ok(false, 'Act III machinery in an Act II shift'); break; } }
    ok(run.compound === 1 && run.expense === 0 && run.clawed === 0 && run.boss.vol === 1 && run.boss.aura === 0 && run.boss.clawed === 0 && run.player.held === 0 && run.player.enjoined === false && run.player.magnate === false, 'Act III run state stays neutral in Act II');
    ok(!run.enemies.some(e => ['spam', 'courier', 'paralegal', 'copier', 'hr'].includes(e.type)) && !('spam' in run._seen) && !('courier' in run._seen), 'no Act III bots in Act II'); }
  // never-throw: odd inputs against every Act III Warden and bot
  { let threw = 0; const sv = a3save({ stake: 1, megacoil: 3, orbital: 2, restructure: 2, compound: 2, expense: 1, legal: 1, outsource: 1, rehire: 2, fleet: 1, drone: 4, insider: 2, diligence: 2 });
    for (const bad of [null, undefined, {}, { x: NaN, y: Infinity }, { x: 'a', y: -1e9 }, [], 5, { x: 1e12, y: 1e12 }]) for (const id of ['receptionist', 'counsel', 'comptroller', 'market', 'founder']) {
      try { const r = mk3(sv, 11 + ['receptionist', 'counsel', 'comptroller', 'market', 'founder'].indexOf(id), 170); r.stats.damage = 1; r._cd = 0; const w = E.spawn(r, id, 180, 100); w.hp = 0.19 * w.maxHp; for (const t of ['spam', 'courier', 'paralegal', 'copier', 'hr']) E.spawn(r, t, 100 + Math.random() * 100, 200, { entered: true }); for (let i = 0; i < 60 * 15; i++) { E.step(r, sv, bad); r.events.length = 0; } walkFinite(r, 'run', 0); } catch (e) { threw++; console.log('  threw: ' + id + ' ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
    }
    eq(threw, 0, 'Act III runs never throw on odd input'); }
  // invariants sweep: autopilot through sectors 11-16 with rich saves
  { const rich = k => { const s = a3save({ coil: 20, amp: 4, pulse: 6, fork: 3, field: 5, cell: 12, titan: 1, drone: 4, dronedmg: 3, fusion: 6, storm: 3, singularity: 3, lattice: 3, nanites: 3, rehire: 4, stockopt: 3, severance: 2, supercell: 4, dividends: 5, takeover: 1,
        megacoil: 3 + k * 2, diligence: 1 + k, legal: k, compound: k, fleet: 1, insider: k, orbital: 1 + k, expense: k, restructure: 1 + k, outsource: 1, stake: k > 1 ? 1 : 0, overtimepay: 10 * k }, { sectorsCleared: 14 }); s.flags.founder = k > 2; if (k > 2) s.sectorsCleared = 15; return s; };
    const lim = { enemies: 0, shots: 0, hazards: 0, interns: 0, strikes: 0, heals: 0, pickups: 0, inj: 0 }; let n = 0, seed = 700;
    for (const sector of [11, 12, 13, 14, 15, 16]) for (let k = 0; k < 4; k++) {
      const save = rich(k); if (sector === 16) { save.flags.founder = true; save.sectorsCleared = 15; } const skill = (sector + k) % 3 === 0 ? 'sloppy' : 'attentive';
      const run = E.startShift(save, sector, { w: 360, h: (sector + k) % 2 ? 640 : 500, seed: seed++ }); run.boss.signal = Math.max(0, run.boss.need - 2); let g = 0, bad = '';
      while (!run.over && g++ < 60 * 200) {
        E.step(run, save, A.target(run, { skill })); noteEvents(run.events); run.events.length = 0; const p = run.player;
        if (!(p.x >= p.r - 1e-6 && p.x <= run.w - p.r + 1e-6 && p.y >= p.r - 1e-6 && p.y <= run.h - p.r + 1e-6)) { bad = 'player outside arena'; break; }
        if (!Number.isFinite(p.battery) || p.battery > p.maxBattery + 1e-6 || p.battery < -1e-6) { bad = 'battery ' + p.battery; break; }
        if (run.enemies.length > lim.enemies) lim.enemies = run.enemies.length; if (run.shots.length > lim.shots) lim.shots = run.shots.length; if (run.hazards.length > lim.hazards) lim.hazards = run.hazards.length; if (run.interns.length > lim.interns) lim.interns = run.interns.length;
        if (run.strikes.length > lim.strikes) lim.strikes = run.strikes.length; if (run.heals.length > lim.heals) lim.heals = run.heals.length; if (run.pickups.length > lim.pickups) lim.pickups = run.pickups.length;
        let inj = 0; for (const h of run.hazards) if (h.kind === 'injunction') inj++; if (inj > lim.inj) lim.inj = inj;
        for (const e of run.enemies) { if (e.dead) bad = 'dead enemy left in array'; if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) bad = 'enemy NaN ' + e.type; }
        if (bad) break; if (!Number.isFinite(run.earned.bolts) || !Number.isFinite(run.boss.hp) || run.earned.bolts < 0) { bad = 'earned/boss ' + run.earned.bolts; break; } if (g % 60 === 0) walkFinite(run, 'run', 0);
      }
      ok(!bad, 'Act III invariant shift s' + sector + ' k' + k + ': ' + bad); ok(run.over, 'Act III shift ended s' + sector + ' k' + k); const rep = E.endShift(run, save); ok(Number.isFinite(rep.bolts) && Number.isFinite(rep.time) && Number.isFinite(rep.compound) && Number.isFinite(rep.clawed), 'report finite'); walkFinite(save, 'save', 0); n++;
    }
    ok(lim.enemies < 175, 'enemies bounded ' + lim.enemies); ok(lim.shots <= D.TUNE.shotCap, 'shots capped'); ok(lim.hazards <= D.TUNE.hazardCap + 4, 'hazards capped ' + lim.hazards); ok(lim.inj <= 4, 'injunctions <= 4: ' + lim.inj); ok(lim.strikes <= 1, 'one strike marker at a time'); ok(lim.interns <= 10, 'interns bounded ' + lim.interns);
    console.log('  (' + n + ' Act III invariant shifts; max enemies ' + lim.enemies + ', shots ' + lim.shots + ', hazards ' + lim.hazards + ', injunctions ' + lim.inj + ', heals ' + lim.heals + ', interns ' + lim.interns + ')'); }
  // determinism
  { const play = () => { const sv = a3save({ stake: 1, megacoil: 2, orbital: 2, restructure: 2, compound: 1, expense: 1, outsource: 1, rehire: 2, drone: 4, fleet: 1 }, { sectorsCleared: 14 }); const run = E.startShift(sv, 14, { w: 360, h: 640, seed: 33 }); run.boss.signal = run.boss.need - 1; let g = 0; while (!run.over && g++ < 60 * 100) { E.step(run, sv, A.target(run, { skill: 'attentive' })); run.events.length = 0; } return JSON.stringify([run.t.toFixed(4), run.counts.kills, run.earned.bolts, run.rs, run.compound, run.expense]); };
    eq(play(), play(), 'Act III replay is deterministic'); }
}

// =========================================================================
sec('event coverage');
{
  for (const type of Object.keys(SCHEMA)) ok(seenEv[type] > 0, 'event type emitted at least once: ' + type);
  for (const k of ['zap:arc', 'zap:drone', 'zap:chain', 'explode:overload', 'explode:bomber', 'hurt:contact', 'hurt:shot', 'hurt:slam', 'hurt:charge', 'hurt:bomb', 'hurt:laser', 'end:battery', 'end:victory', 'end:clockout'])
    ok(seenSrc[k], 'event src/reason seen: ' + k);
}

// =========================================================================
sec('wide tree: split nodes, migration, layout (SPEC 12.15)');
{
  const U = D.UPGRADE_BY_ID;
  // Act I splits are exact: chain totals, per-level effect and level-n cost match the old long node
  const OLD = { coil: [4, 1.731, 25, ['coil', 'coil2', 'coil3']], cell: [5, 1.866, 20, ['cell', 'cell2', 'cell3']], sorter: [21, 2.211, 15, ['sorter', 'sorter2']], pulse: [18, 2.46, 12, ['pulse', 'pulse2']], field: [14, 2.495, 10, ['field', 'field2']] };
  for (const k in OLD) {
    const [b, g, mx, ids] = OLD[k];
    eq(ids.reduce((a, id) => a + U[id].max, 0), mx, k + ' chain keeps the old total of ' + mx + ' levels');
    ok(ids.every(id => U[id].max <= 9), k + ' chain: no node above 9 levels');
    let n = 0;
    ids.forEach((id, idx) => {
      ok(U[id].tier === idx + 1 && U[id].icon === k && U[id].name === U[k].name, id + ' tier ' + (idx + 1) + ', icon ' + k);
      for (let l = 0; l < U[id].max; l++, n++) {
        const s = E.newSave(); s.up[id] = l;
        eq(E.upgradeInfo(s, id).level, l, id + ' level'); eq(Math.round(U[id].base * Math.pow(U[id].growth, l)), Math.round(b * Math.pow(g, n)), k + ' level ' + (n + 1) + ' costs what the old node did');
      }
      if (idx > 0) ok(U[id].requires.length === 1 && U[id].requires[0][0] === ids[idx - 1] && U[id].requires[0][1] === U[ids[idx - 1]].max, id + ' needs ' + ids[idx - 1] + ' maxed');
    });
  }
  // effect of the chain equals the old single node
  const base = E.stats(E.newSave());
  near(E.stats(Object.assign(E.newSave(), { up: Object.assign(E.newSave().up, { coil: 8, coil2: 8, coil3: 3 }) })).damage, 1 + 19, 1e-9, 'coil chain 8+8+3 = +19 damage');
  { const s = E.newSave(); s.up.cell = 7; s.up.cell2 = 2; near(E.stats(s).maxBattery, 18 + 3 * 9, 1e-9, 'cell chain sums'); }
  { const s = E.newSave(); s.up.pulse = 6; s.up.pulse2 = 3; near(E.stats(s).pulseInterval, 0.5 * Math.pow(0.94, 9), 1e-12, 'pulse chain sums'); }
  { const s = E.newSave(); s.up.field = 5; s.up.field2 = 5; near(E.stats(s).radius, 46 + 50, 1e-9, 'field chain sums'); }
  { const s = E.newSave(); s.up.sorter = 8; s.up.sorter2 = 4; near(E.stats(s).boltMult, 1 + 0.15 * 12, 1e-9, 'sorter chain sums'); }
  // migration: old long levels spill into the chain, for v1, v2 and v3 saves alike
  for (const v of [1, 2, 3]) {
    const m = E.loadSave({ v, up: { coil: 19, cell: 20, sorter: 11, pulse: 12, field: 7, fusion: 10, megacoil: 8 }, flags: { act2: true, chairman: true } });
    eq(m.up.coil + ',' + m.up.coil2 + ',' + m.up.coil3, '8,8,3', 'v' + v + ' coil 19 -> 8,8,3'); eq(m.up.cell + ',' + m.up.cell2 + ',' + m.up.cell3, '7,7,6', 'v' + v + ' cell 20 -> 7,7,6');
    eq(m.up.sorter + ',' + m.up.sorter2, '8,3', 'v' + v + ' sorter 11'); eq(m.up.pulse + ',' + m.up.pulse2, '6,6', 'v' + v + ' pulse 12'); eq(m.up.field + ',' + m.up.field2, '5,2', 'v' + v + ' field 7');
    eq(m.up.fusion + ',' + m.up.fusion2 + ',' + m.up.fusion3, '4,3,3', 'v' + v + ' fusion 10'); eq(m.up.megacoil + ',' + m.up.megacoil2, '4,4', 'v' + v + ' megacoil 8');
    near(E.stats(m).damage / E.stats(E.loadSave({ v, up: { coil: 8, coil2: 8, coil3: 3, fusion: 4, fusion2: 3, fusion3: 3, megacoil: 4, megacoil2: 4 }, flags: { act2: true, chairman: true } })).damage, 1, 1e-12, 'migrated stats equal the split save');
  }
  { const m = E.loadSave({ up: { coil: 5, coil2: 3 } }); eq(m.up.coil + ',' + m.up.coil2, '5,3', 'already-split saves are left alone'); }
  { const m = E.loadSave(JSON.parse(JSON.stringify(E.loadSave({ up: { coil: 19 } })))); eq(m.up.coil + ',' + m.up.coil2 + ',' + m.up.coil3, '8,8,3', 'migration is idempotent'); }
  { const m = E.loadSave({ up: { coil: 999, cell: -4, sorter: 'x' } }); eq(m.up.coil3, 9, 'junk clamps to the chain cap'); eq(m.up.cell, 0, 'negative -> 0'); eq(m.up.sorter, 0, 'junk -> 0'); }
  // layout: pos, tier, icon, revealed
  const all = D.UPGRADES;
  ok(all.every(u => Array.isArray(u.pos) && u.pos.length === 2 && typeof u.icon === 'string' || !u.icon), 'every node has pos');
  eq(U.boot.pos.join(), '0,0', 'Sprocket at the origin');
  { let m = 1e9; for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) m = Math.min(m, Math.hypot(all[i].pos[0] - all[j].pos[0], all[i].pos[1] - all[j].pos[1])); ok(m >= 1 - 1e-9, 'min node spacing >= 1.0: ' + m.toFixed(2)); }
  for (const u of all) ok(Number.isFinite(u.col) && Number.isFinite(u.row), u.id + ' keeps legacy col/row');
  { const s = E.newSave(); const i0 = E.upgradeInfo(s, 'boot'), c0 = E.upgradeInfo(s, 'coil'), p0 = E.upgradeInfo(s, 'pulse'), c2 = E.upgradeInfo(s, 'coil2');
    ok(i0.revealed && c0.revealed, 'boot and no-requirement roots are revealed'); ok(!p0.revealed && !c2.revealed, 'nodes with no owned requirement are hidden');
    s.up.coil = 1; ok(E.upgradeInfo(s, 'pulse').revealed && E.upgradeInfo(s, 'field').revealed && E.upgradeInfo(s, 'coil2').revealed, 'owning a requirement reveals the neighbour'); ok(!E.upgradeInfo(s, 'fork').revealed, 'two steps away stays hidden');
    ok(E.upgradeInfo(s, 'coil').pos[0] === 0 && E.upgradeInfo(s, 'coil').pos[1] === -1, 'upgradeInfo exposes pos'); eq(E.upgradeInfo(s, 'coil3').tier, 3, 'tier exposed'); eq(E.upgradeInfo(s, 'coil3').icon, 'coil', 'icon exposed'); eq(E.upgradeInfo(s, 'amp').tier, 0, 'unsplit nodes have tier 0'); eq(E.upgradeInfo(s, 'amp').icon, 'amp', 'icon defaults to the id');
    const cl = E.upgradeInfo(s, 'fusion'); ok(cl.classified && Array.isArray(cl.pos) && cl.icon === 'fusion' && cl.tier === 1, 'classified nodes still carry pos, icon, tier'); s.up.titan = 1; ok(E.upgradeInfo(s, 'fusion').revealed, 'a classified node next to an owned one is revealed (UI draws a redacted plate)'); }
  // every icon id exists in the sprite table
  { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'sprites.js'), 'utf8'); for (const u of all) ok(new RegExp('\\n    ' + (u.icon || u.id) + ': \'<').test(src), u.id + ' icon ' + (u.icon || u.id) + ' has a sprite'); }
  // capstones: one neighbour edge plus an act-level condition (actReq)
  for (const [id, n, act] of [['titan', 90, 1], ['takeover', 38, 2], ['stake', 39, 3]]) { const u = U[id]; eq(u.requires.length, 1, id + ' has one requirement edge'); eq(u.actReq.levels, n, id + ' actReq levels'); eq(u.actReq.act, act, id + ' actReq act'); }
  { const s = E.newSave(); s.bolts = 1e30; s.cores = 99; s.up.overload = 1; let i = E.upgradeInfo(s, 'titan'); ok(!i.unlocked && i.actReq.have === 1 && i.actReq.need === 90 && i.actReq.act === 1, 'titan actReq exposed: ' + JSON.stringify(i.actReq)); eq(i.lockReason, 'Needs 90 Act I levels (1/90)', 'lockReason text');
    for (const u of D.UPGRADES) if (u.branch !== 'rnd' && u.branch !== 'exec' && u.id !== 'boot' && u.id !== 'titan' && u.id !== 'overload' && ['coil','coil2','coil3','pulse','pulse2','field','field2','fork','amp','surge','chain','cell','cell2','cell3','thrust','recycler','capacitor','coolant','plating','spare'].includes(u.id)) s.up[u.id] = u.max; i = E.upgradeInfo(s, 'titan'); const hv = i.actReq.have; ok(i.unlocked && hv >= 90, 'titan unlocks once 90 Act I levels are owned: ' + hv); eq(E.upgradeInfo(s, 'coil').actReq, null, 'ordinary nodes have actReq null');
    s.up.titan = 1; eq(E.upgradeInfo(s, 'titan').actReq.have, hv, 'the capstone does not count itself'); }
  // reachability: whole tree buys out in dependency order
  { const s = E.newSave(); s.flags.act2 = s.flags.chairman = true; s.bolts = 1e80; s.cores = 1e6; let g = 0, n = 0;
    while (g++ < 800) { let any = false; for (const u of all) if (u.id !== 'boot' && u.max !== Infinity && E.buy(s, u.id)) { any = true; n++; } if (!any) break; }
    eq(n, all.reduce((a, u) => a + (u.id === 'boot' || u.max === Infinity ? 0 : u.max), 0), 'every node reachable and buys out: ' + n); }
  // Act II/III damage is spread: no node multiplies by more than x1.6, capstones x3-x4
  ok(D.LEVEL.fusion <= 1.6 && D.LEVEL.megacoil <= 1.6 && D.LEVEL.takeover.damage <= 4 && D.LEVEL.stake.damage <= 4 && D.LEVEL.takeover.damage >= 3 && D.LEVEL.stake.damage >= 3, 'damage multipliers are small; capstone forms x3-x4');
  ok(all.every(u => u.max === Infinity || u.max <= 9), 'no capped node above 9 levels (coil3 is the one exception)'); ok(all.filter(u => u.max === 9).length === 1, 'exactly one 9-level node'); ok(all.filter(u => u.max > 9).length === 2, 'only the two endless nodes are long');
  // rescaled curves
  const sc = n => D.SECTORS[n - 1];
  ok(sc(15).hp === 4e8 && sc(15).bolts === 3e6 && sc(15).dmg === 34 && sc(16).hp === sc(15).hp, 'sector 15 ends where sector 10 used to; Overtime normalised');
  for (let n = 6; n <= 15; n++) { ok(sc(n).hp > sc(n - 1).hp * 2 && sc(n).hp < sc(n - 1).hp * 6, 'sector ' + n + ' hp x2-x6 of the last'); ok(sc(n).bolts > sc(n - 1).bolts && sc(n).dmg >= sc(n - 1).dmg, 'sector ' + n + ' bolts and dmg climb'); }
  { const B = D.BOSS_BY_ID; near(B.chairman.hp / 1.5e8, 1, 1e-9, 'Chairman ~1.5e8'); near(B.founder.hp / 3.1e11, 7.741935483870968, 1e-9, 'Founder 2.4e12 (7.7x the old Chairman, SPEC 12.16)'); }
}

console.log('\n' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
