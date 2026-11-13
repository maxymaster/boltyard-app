#!/usr/bin/env node
'use strict';
// Plays whole games headless with the autopilot and reports pacing / economy metrics.
//
//   node tools/simbot.js [--runs N] [--skill attentive|sloppy] [--seed S] [--max-shifts M]
//                        [--policy best|cheapest|random] [--cap id=N,id=N] [--force id:N,id:N]
//                        [--json] [--verbose] [--ablate [id,id,...]] [--quiet]
//                        [--act2] [--act3] [--overtime N]
//
// --act2      play Act I with the bot as usual, then keep going through sectors 6-10 until the Chairman falls
//             (times in the Act II block are measured from the first Overseer kill).
// --act3      like --act2, then keep going through sectors 11-15 until the Founder falls (times in the Act III block are
//             measured from the first Chairman kill). --snap DIR caches the state at that moment per seed.
// --assist N    after N Chairman attempts (Founder attempts with --act3/--overtime), set the flag by hand (debug aid)
// --overtime N  like --act3, then keep clocking into Overtime (sector 16) until level N is cleared.
//
// Game g of a batch uses game seed S*1000+g. "Attempt" = a shift in which the sector's Warden actually
// spawned, counted until (and including) the shift that first scraps it.
// --ablate runs every upgrade (or the listed ids) with its purchases capped at the minimum level the
// rest of the tree needs (0 for leaves), and prints time-to-win against the unrestricted baseline.
require('../src/data.js');
require('../src/engine.js');
require('./autopilot.js');
const BY = globalThis.BY, E = BY.Engine, A = BY.Autopilot, D = BY.Data;

function args() {
  const o = { runs: 5, skill: 'attentive', seed: 1, maxShifts: 400, verbose: false, json: false, quiet: false,
              policy: 'best', cap: {}, force: [], ablate: null, stopAt: 0, assist: 0, act2: false, act3: false, overtime: 0, maxShiftsSet: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--runs') o.runs = +a[++i];
    else if (a[i] === '--skill') o.skill = a[++i];
    else if (a[i] === '--seed') o.seed = +a[++i];
    else if (a[i] === '--max-shifts') { o.maxShifts = +a[++i]; o.maxShiftsSet = true; }
    else if (a[i] === '--act2') o.act2 = true;
    else if (a[i] === '--act3') { o.act3 = true; o.act2 = true; }
    else if (a[i] === '--snap') o.snap = a[++i];
    else if (a[i] === '--first') o.first = +a[++i];
    else if (a[i] === '--assist') o.assist = +a[++i];
    else if (a[i] === '--overtime') { o.overtime = +a[++i]; o.act2 = true; o.act3 = true; }
    else if (a[i] === '--verbose') o.verbose = true;
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--quiet') o.quiet = true;
    else if (a[i] === '--policy') o.policy = a[++i];
    else if (a[i] === '--stop-at') o.stopAt = +a[++i];
    else if (a[i] === '--cap') a[++i].split(',').forEach(x => { const [k, v] = x.split('='); o.cap[k] = +v; });
    else if (a[i] === '--force') o.force = a[++i].split(',').map(x => { const [k, v] = x.split(':'); return [k, +v]; });
    else if (a[i] === '--ablate-to') o.ablateTo = +a[++i];
    else if (a[i] === '--ablate') { o.ablate = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i].split(',') : []; }
  }
  if (o.overtime && !o.assist) o.assist = 25;   // Overtime needs the Chairman down; see --assist
  if (o.act2 && !o.maxShiftsSet) o.maxShifts = o.overtime ? 1800 : (o.act3 ? 1300 : 900);
  return o;
}

function mulberry(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = D.UPGRADES.filter(u => u.id !== 'boot' && u.branch !== 'rnd' && u.branch !== 'exec').map(u => u.id);   // Act I tree
const IDS2 = D.UPGRADES.filter(u => u.branch === 'rnd').map(u => u.id);                      // Act II R&D
const IDS3 = D.UPGRADES.filter(u => u.branch === 'exec').map(u => u.id);                     // Act III Executive Suite
const OTS = D.SECTORS.length;                                                                // Overtime sector (16)
const TOTAL_LEVELS = IDS.reduce((s, id) => s + D.UPGRADE_BY_ID[id].max, 0);
const TITAN_COST = D.UPGRADE_BY_ID.titan.base;

function dpsOf(save) { const st = E.stats(save); return st.damage * st.targets / st.pulseInterval * (1 + st.critChance * (st.critMult - 1)) + st.drones * st.droneDmg / st.droneInterval; }

function playShift(save, sector, seed, skill) {
  const run = E.startShift(save, sector, { w: 360, h: 640, seed });
  const opts = { skill };
  let guard = 0;
  while (!run.over && guard++ < 60 * 400) {
    E.step(run, save, A.target(run, opts));
    run.events.length = 0;
  }
  const report = E.endShift(run, save);
  report.bossSpawned = run.boss.enemyId !== null;
  return { run, report };
}

function playGame(o, gameSeed) {
  A.config.policy = o.policy; A.config.cap = o.cap; A.config.force = o.force; A.config.rs = gameSeed + 1;
  if (!(o.act2 || o.overtime > 0)) {   // Act I only: the bot must not spend the win shift's bank on R&D (keeps the Act I summary comparable)
    A.config.cap = Object.assign({}, o.cap);
    for (const id of IDS2) A.config.cap[id] = 0;
  }
  if (!o.act3) {                       // up to the Chairman only: keep the Executive Suite shut (keeps the Act II summary comparable)
    A.config.cap = Object.assign({}, A.config.cap);
    for (const id of IDS3) A.config.cap[id] = 0;
  }
  const zero = () => { const r = {}; for (let s = 1; s <= OTS; s++) r[s] = 0; return r; };
  const g = {
    seed: gameSeed, shifts: 0, time: 0, won: false, chairman: false, firstClear: {}, attempts: zero(),
    lenSum: {}, lenN: {}, lens: [], drySpell: 0, curDry: 0, wardenKills: 0, repeatKills: 0, buys: {},
    wardenShifts: zero(), sectorTime: zero(),
    shift1: null, buyShiftsFirst5: 0, coreIdle: 0, curCoreIdle: 0, coreWantShifts: 0, longShifts: 0,
    preSummon: {}, armStart: {},
    // Act II
    dry2: 0, curDry2: 0, scraps2: 0, coresBefore: 0, ot: {}, otLevel: 0, takeover: null, stolen: 0, severances: 0, act2Shifts: 0,
    // Act III
    cumT: [], dryKinds: { cap: 0, cores: 0, other: 0, after: 0, locked: 0 }, dpsAt: {}, capLv: {}, firstBuy2: {}, founder: false, dry3: 0, curDry3: 0, dry3c: 0, curDry3c: 0, firstBuy3: {}, act3Shifts: 0, scraps3: 0, stake: null, clawed: 0, coresAtChairman: 0, sparesAtFounder: null
  };
  const wantAct2 = o.act2 || o.overtime > 0;
  const done = () => {
    if (o.stopAt && g.firstClear[o.stopAt]) return true;
    if (!wantAct2) return g.won;
    if (o.overtime > 0) return g.otLevel >= o.overtime;
    if (o.act3) return g.founder;
    return g.chairman;
  };
  // --snap DIR: cache the state at the first Overseer kill per seed (Act I numbers are frozen) and resume Act II from it
  const fs = o.snap ? require('fs') : null, snapFile = o.snap ? `${o.snap}/${o.act3 ? 'c' : 's'}${gameSeed}.json` : null;
  const snapAt = save => o.act3 ? save.flags.chairman : save.flags.act2;
  let snapped = false, save = null, rnd = null;
  if (snapFile && fs.existsSync(snapFile)) {
    const j = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    save = j.save; Object.assign(g, j.g); snapped = true;
    rnd = mulberry(gameSeed ^ 0x5bd1e995);
  }
  if (!save) { save = E.newSave(); rnd = mulberry(gameSeed); }
  while (g.shifts < o.maxShifts && !done()) {
    if (snapFile && !snapped && snapAt(save)) { snapped = true; fs.writeFileSync(snapFile, JSON.stringify({ save, g })); }
    const sector = A.pickSector(save);
    g.bankBefore = save.bolts;
    const { report } = playShift(save, sector, Math.floor(rnd() * 1e9), o.skill);
    g.shifts++; g.time += report.time; g.cum = (g.cum || 0) + report.bolts; g.cumT.push([g.time, g.cum]);
    g.lenSum[sector] = (g.lenSum[sector] || 0) + report.time;
    g.lenN[sector] = (g.lenN[sector] || 0) + 1;
    g.sectorTime[sector] += report.time;
    g.lens.push([sector, report.time]);
    if (report.time > 90) g.longShifts++;
    A.record(save, report);
    if (g.won) { g.act2Shifts++; g.stolen += report.stolen || 0; if (report.severance) g.severances++; }
    if (g.chairman) { g.act3Shifts++; g.clawed += report.clawed || 0; }
    if (sector === OTS) {
      const L = report.overtimeLevel || (save.overtime.level + 1);   // level fought this shift
      const rec = g.ot[L] || (g.ot[L] = { shifts: 0, time: 0, attempts: 0, cleared: false, atShift: 0 });
      const fought = report.overtimeLevel ? report.overtimeLevel : L;
      rec.shifts++; rec.time += report.time;
      if (report.bossSeen) rec.attempts++;
      if (report.bossDefeated) { rec.cleared = true; rec.atShift = g.shifts; g.otLevel = Math.max(g.otLevel, fought); g.wardenKills++; g.scraps2++; }
    } else {
      if (report.bossSpawned) g.wardenShifts[sector]++;
      if (report.bossSpawned && !g.firstClear[sector]) {
        g.attempts[sector]++;
        if (g.preSummon[sector] === undefined) g.preSummon[sector] = g.shifts - 1 - (sector === 1 ? 0 : (g.firstClear[sector - 1] ? g.firstClear[sector - 1].shifts : 0));
      }
      if (report.bossDefeated) {
        g.wardenKills++;
        if (g.won) g.scraps2++;
        if (g.chairman) g.scraps3++;
        if (report.firstClear) { g.firstClear[sector] = { shifts: g.shifts, time: g.time }; g.dpsAt[sector] = dpsOf(save); if (sector === 5) g.act2Start = { shifts: g.shifts, time: g.time }; }
        else g.repeatKills++;
      }
    }
    if (g.shifts === 1) g.shift1 = { bolts: report.bolts, time: report.time, afford: E.affordableCount(save) };
    if (report.gameWon) g.won = true;
    if (report.act2Won) { g.dpsChairman = dpsOf(save); g.chairman = true; g.coresAtChairman = save.cores; g.chairShift = { shifts: g.shifts, time: g.time }; }
    if (report.act3Won) { g.dpsFounder = dpsOf(save); g.batFounder = E.stats(save).maxBattery; g.fTime = report.time; g.founder = true; g.sparesAtFounder = save.cores; }
    // --assist N: after N Chairman attempts the bot is handed the scrap (flag only) so later stages can be measured
    if (o.assist && o.act3 && sector === 15 && !save.flags.founder && g.attempts[15] >= o.assist) {
      save.flags.founder = true; g.founder = true; g.assisted = { shifts: g.shifts, time: g.time };
      g.firstClear[15] = { shifts: g.shifts, time: g.time };
    }
    if (o.assist && !o.act3 && sector === 10 && !save.flags.chairman && g.attempts[10] >= o.assist) {
      save.flags.chairman = true; g.chairman = true; g.assisted = { shifts: g.shifts, time: g.time };
      g.firstClear[10] = { shifts: g.shifts, time: g.time };
    }
    if (g.won && E.affordableCount(save) === 0) {   // classify: saving for the capstone vs core wall vs other
      const cap = g.chairman ? 'stake' : 'takeover', ci = E.upgradeInfo(save, cap);
      if (save.up[cap] < 1 && ci.unlocked && ci.cost.cores <= save.cores && ci.cost.bolts > save.bolts) g.dryKinds.cap++;
      else if (save.up[cap] < 1 && ci.unlocked && ci.cost.cores > save.cores && ci.cost.bolts <= save.bolts) g.dryKinds.cores++;
      else if (save.up[cap] >= 1) g.dryKinds.after++;
      else if (!ci.unlocked) {
        let nb = 0, nc = 0;   // unlocked, not maxed nodes: blocked by bolts or by cores?
        for (const u of D.UPGRADES) { if (u.id === 'boot' || u.max === Infinity) continue; const q = E.upgradeInfo(save, u.id); if (!q.unlocked || q.maxed) continue; if (q.cost.cores > save.cores) nc++; else nb++; }
        if (nc > 0 && nb === 0) g.dryKinds.cores++; else g.dryKinds.locked++;
      }
      else g.dryKinds.other++;
    }
    if (E.affordableCount(save) === 0) {
      g.curDry++; if (g.curDry > g.drySpell) g.drySpell = g.curDry;
      if (g.won && !g.chairman) { g.curDry2a = (g.curDry2a || 0) + 1; g.dry2a = Math.max(g.dry2a || 0, g.curDry2a); g.dry2aN = (g.dry2aN || 0) + 1; }
      if (g.won) { g.curDry2++; if (g.curDry2 > g.dry2) g.dry2 = g.curDry2; }
      if (g.chairman) { g.curDry3++; if (g.curDry3 > g.dry3) g.dry3 = g.curDry3; }
    } else { g.curDry = 0; g.curDry2 = 0; g.curDry2a = 0; g.curDry3 = 0; }
    if (g.chairman && !g.founder) {   // Act III: nothing CAPPED affordable (the uncapped Overtime Pay / Hazard Pay don't count)
      let capAff = 0;
      for (const u of D.UPGRADES) if (u.id !== 'boot' && u.max !== Infinity && E.upgradeInfo(save, u.id).affordable) capAff++;
      if (capAff === 0 && process.env.DBG) { const l = []; for (const u of D.UPGRADES) { if (u.id === 'boot' || u.max === Infinity) continue; const q = E.upgradeInfo(save, u.id); if (q.maxed) continue; l.push(u.id + (q.unlocked ? '' : '(locked)') + ':' + q.cost.bolts.toExponential(1) + '/' + q.cost.cores + 'c'); } console.log('DRY sector ' + sector + ' bank ' + save.bolts.toExponential(1) + ' cores ' + save.cores + ' :: ' + l.join(' ')); }
      if (capAff === 0) { (g.dryT3 = g.dryT3 || []).push(Math.round((g.time - g.chairShift.time) / 60)); g.curDry3c++; if (g.curDry3c > g.dry3c) g.dry3c = g.curDry3c; } else g.curDry3c = 0;
    }
    const bought = A.shop(save);
    if (g.shifts <= 5 && bought.length) g.buyShiftsFirst5++;
    for (const id of bought) g.buys[id] = (g.buys[id] || 0) + 1;
    if (g.chairman && g.chairShift) for (const id of bought) if (D.UPGRADE_BY_ID[id].branch === 'exec' && g.firstBuy3[id] === undefined) g.firstBuy3[id] = g.time - g.chairShift.time;
    for (const id of bought) {
      if ((id === 'titan' || id === 'takeover' || id === 'stake') && g.capLv[id] === undefined) g.capLv[id] = E.upgradeInfo(save, id).actReq.have;
      if (D.UPGRADE_BY_ID[id].branch === 'rnd' && g.firstClear[5] && g.firstBuy2[id] === undefined) g.firstBuy2[id] = g.time - g.firstClear[5].time;
    }
    for (const k of ['titan', 'takeover', 'stake']) if (g['at_' + k] === undefined && save.up[k] >= 1) { g['at_' + k] = { shifts: g.shifts, time: g.time / 60 }; const T = (globalThis.__T = globalThis.__T || {}); (T[k] = T[k] || []).push(g['at_' + k]); }
    if (g.takeover === null && save.up.takeover >= 1) g.takeover = { shifts: g.shifts, time: g.time };
    if (g.stake === null && save.up.stake >= 1) g.stake = { shifts: g.shifts, time: g.time };
    if (save._ap && save._ap.wantCores) g.coreWantShifts++;
    if (save.cores > 0) { g.curCoreIdle++; if (g.curCoreIdle > g.coreIdle) g.coreIdle = g.curCoreIdle; } else g.curCoreIdle = 0;
    if (o.verbose) {
      console.log(`  shift ${String(g.shifts).padStart(3)} s${sector}${sector === OTS ? '/L' + (report.overtimeLevel || save.overtime.level + 1) : ''} ${report.reason.padEnd(7)} ${report.time.toFixed(1).padStart(6)}s ` +
        `bolts ${BY.Fmt.num(report.bolts).padStart(7)} cores ${report.cores} kills ${String(report.kills).padStart(3)} ` +
        `sig ${(report.signalPct * 100).toFixed(0)}%${report.bossSeen ? ' W' : ''}${report.bossDefeated ? '*' : ''} ` +
        `| dps ${dpsOf(save).toExponential(1)} t ${(g.time/60).toFixed(0)}m | bought ${bought.length} L${IDS.reduce((a, id) => a + save.up[id], 0)}+${IDS2.reduce((a, id) => a + save.up[id], 0)}+${IDS3.reduce((a, id) => a + save.up[id], 0)} | bank ${BY.Fmt.num(save.bolts)}/${save.cores}c`);
    }
  }
  if (snapFile && !snapped && snapAt(save)) fs.writeFileSync(snapFile, JSON.stringify({ save, g }));
  g.coresEarned = save.stats.coresTotal;
  g.notBought = D.UPGRADES.filter(u => u.id !== 'boot' && u.max !== Infinity && (u.branch === 'rnd' || u.branch === 'exec') && save.up[u.id] < u.max).map(u => u.id);
  g.coresLeft = save.cores;
  g.up = Object.assign({}, save.up);
  g.levels = IDS.reduce((s, id) => s + save.up[id], 0);
  g.share = g.levels / TOTAL_LEVELS;
  g.unspent = save.bolts;
  g.unspentRatio = save.bolts / TITAN_COST;
  g.unspentPre = g.bankBefore / TITAN_COST;
  g.rndLevels = IDS2.reduce((s, id) => s + save.up[id], 0);
  g.execLevels = IDS3.reduce((s, id) => s + save.up[id], 0);
  g.overtimeBest = save.overtime.best;
  g.finalSave = save;   // for debugging scripts (not printed)
  // per-sector arc time (between first clears)
  g.arc = {};
  let prev = 0;
  for (let s = 1; s <= 15; s++) { if (g.firstClear[s]) { g.arc[s] = g.firstClear[s].time - prev; prev = g.firstClear[s].time; } }
  return g;
}

function fmtT(s) {
  const m = Math.floor(s / 60);
  return m + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function pct(a, p) { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; }

function summarize(games, o) {
  const n = games.length, avg = f => mean(games.map(f));
  const won = games.filter(g => g.won);
  const S = {
    skill: o.skill, policy: o.policy, n, won: won.length,
    shifts: avg(g => g.shifts), time: avg(g => g.time),
    timeMin: Math.min(...games.map(g => g.time)), timeMax: Math.max(...games.map(g => g.time)),
    shiftsMin: Math.min(...games.map(g => g.shifts)), shiftsMax: Math.max(...games.map(g => g.shifts)),
    dryAvg: avg(g => g.drySpell), dryMax: Math.max(...games.map(g => g.drySpell)),
    wardenKills: avg(g => g.wardenKills), repeatKills: avg(g => g.repeatKills),
    wardenKillsMin: Math.min(...games.map(g => g.wardenKills)), wardenKillsMax: Math.max(...games.map(g => g.wardenKills)),
    coresEarned: avg(g => g.coresEarned), coresLeft: avg(g => g.coresLeft), coreIdleMax: Math.max(...games.map(g => g.coreIdle)),
    share: avg(g => g.share), shareMin: Math.min(...games.map(g => g.share)), shareMax: Math.max(...games.map(g => g.share)),
    unspent: avg(g => g.unspent), unspentRatio: avg(g => g.unspentRatio), unspentRatioMax: Math.max(...games.map(g => g.unspentRatio)),
    unspentPre: avg(g => g.unspentPre), unspentPreMax: Math.max(...games.map(g => g.unspentPre)),
    shift1Bolts: avg(g => g.shift1.bolts), shift1Time: avg(g => g.shift1.time), shift1Afford: avg(g => g.shift1.afford > 0 ? 1 : 0),
    buyFirst5: avg(g => g.buyShiftsFirst5), longShifts: avg(g => g.longShifts),
    sector: {}, buys: {}, levels: {}
  };
  S.cumAt = function (t0key, mins) { return mean(games.filter(g => g[t0key]).map(g => { const t0 = g[t0key].time; let c0 = 0, c = 0; for (const [t, v] of g.cumT) { if (t <= t0) c0 = v; if (t <= t0 + mins * 60) c = v; } return c - c0; })); };
  S.dpsAt = {}; for (let s = 1; s <= 15; s++) S.dpsAt[s] = mean(games.filter(g => g.dpsAt[s]).map(g => g.dpsAt[s]));
  const allLens = [].concat(...games.map(g => g.lens.map(x => x[1])));
  S.lenP90 = pct(allLens, 0.9); S.lenMax = Math.max(...allLens);
  for (let s = 1; s <= (o.act3 ? 15 : o.act2 ? 10 : 5); s++) {
    const done = games.filter(g => g.firstClear[s]);
    const lens = [].concat(...games.map(g => g.lens.filter(x => x[0] === s).map(x => x[1])));
    // Act II rows are measured from the first Overseer kill
    const t0 = g => (s >= 11 && g.firstClear[10]) ? g.firstClear[10] : (s >= 6 && g.firstClear[5]) ? g.firstClear[5] : { shifts: 0, time: 0 };
    S.sector[s] = {
      cleared: done.length,
      atShift: mean(done.map(g => g.firstClear[s].shifts - t0(g).shifts)),
      atTime: mean(done.map(g => g.firstClear[s].time - t0(g).time)),
      atTimeMin: done.length ? Math.min(...done.map(g => g.firstClear[s].time - t0(g).time)) : NaN,
      atTimeMax: done.length ? Math.max(...done.map(g => g.firstClear[s].time - t0(g).time)) : NaN,
      arc: mean(done.map(g => g.arc[s])),
      attempts: avg(g => g.attempts[s]), preSummon: mean(games.filter(g => g.preSummon[s] !== undefined).map(g => g.preSummon[s])),
      attemptsMin: Math.min(...games.map(g => g.attempts[s])), attemptsMax: Math.max(...games.map(g => g.attempts[s])),
      avgLen: mean(lens), p90Len: pct(lens, 0.9), maxLen: lens.length ? Math.max(...lens) : NaN, shiftsPlayed: lens.length / n,
      timeShare: avg(g => g.sectorTime[s] / g.time)
    };
  }
  for (const id of IDS) { S.levels[id] = avg(g => g.up[id]); S.buys[id] = avg(g => g.buys[id] || 0); }
  if (o.act2) {
    const won = games.filter(g => g.won);
    S.act2 = {
      reachedAct2: won.length, chairman: games.filter(g => g.chairman && !g.assisted).length, assisted: games.filter(g => g.assisted).length,
      act2Shifts: mean(won.map(g => g.act2Shifts)), act2Time: mean(won.map(g => g.time - g.firstClear[5].time)),
      chairTime: mean(games.filter(g => g.chairman && !g.assisted).map(g => g.time - g.firstClear[5].time)),
      chairTimeMin: Math.min(...games.filter(g => g.chairman && !g.assisted).map(g => g.time - g.firstClear[5].time)),
      chairTimeMax: Math.max(...games.filter(g => g.chairman && !g.assisted).map(g => g.time - g.firstClear[5].time)),
      chairShifts: mean(games.filter(g => g.chairman && !g.assisted).map(g => g.firstClear[10].shifts - g.firstClear[5].shifts)),
      takeoverTime: mean(games.filter(g => g.takeover).map(g => g.takeover.time - g.firstClear[5].time)),
      takeoverShifts: mean(games.filter(g => g.takeover).map(g => g.takeover.shifts - g.firstClear[5].shifts)),
      dryAvg: mean(won.map(g => g.dry2)), dryMax: won.length ? Math.max(...won.map(g => g.dry2)) : NaN,
      scraps: mean(won.map(g => g.scraps2)), rndLevels: mean(won.map(g => g.rndLevels)),
      cores: mean(won.map(g => g.coresEarned)), coresLeft: mean(won.map(g => g.coresLeft)), stolen: mean(won.map(g => g.stolen)), severances: mean(won.map(g => g.severances)),
      dps: mean(games.filter(g => g.dpsChairman).map(g => g.dpsChairman)), capLv: {}, buyAt2: IDS2.map(id => [id, mean(games.filter(g => g.firstBuy2[id] !== undefined).map(g => g.firstBuy2[id]))]),
      levels2: {}, ot: {}
    };
    for (const id of ['titan', 'takeover']) S.act2.capLv[id] = mean(games.filter(g => g.capLv[id] !== undefined).map(g => g.capLv[id]));
    for (const id of IDS2) S.act2.levels2[id] = avg(g => g.up[id]);
    if (o.overtime) for (let L = 1; L <= o.overtime; L++) {
      const rs = games.map(g => g.ot[L]).filter(Boolean), cl = rs.filter(r => r.cleared);
      S.act2.ot[L] = { reached: rs.length, cleared: cl.length, shifts: mean(rs.map(r => r.shifts)), time: mean(rs.map(r => r.time)), attempts: mean(rs.map(r => r.attempts)),
                       attMin: rs.length ? Math.min(...rs.map(r => r.attempts)) : NaN, attMax: rs.length ? Math.max(...rs.map(r => r.attempts)) : NaN,
                       avgLen: rs.length ? mean(rs.map(r => r.time / r.shifts)) : NaN };
    }
  }
  if (o.act3) {
    const ch = games.filter(g => g.chairman && !g.assistedC), fo = games.filter(g => g.founder && !g.assisted);
    const since = g => g.chairShift || { shifts: 0, time: 0 };
    const dryInfo = `dry shifts per game (nothing affordable): capstone save-up ${mean(games.map(g => g.dryKinds.cap)).toFixed(1)}  core wall ${mean(games.map(g => g.dryKinds.cores)).toFixed(1)}  capstone locked ${mean(games.map(g => g.dryKinds.locked)).toFixed(1)}  after capstone ${mean(games.map(g => g.dryKinds.after)).toFixed(1)}  other ${mean(games.map(g => g.dryKinds.other)).toFixed(1)}   capped nodes not fully bought at the end: ` + (function () { const c = {}; for (const g of games) for (const id of g.notBought) c[id] = (c[id] || 0) + 1; return Object.keys(c).map(k => k + ' x' + c[k]).join(', ') || 'none'; })();
    S.act3 = { dry2aMax: Math.max(...games.map(g => g.dry2a || 0)), dry2aN: mean(games.map(g => g.dry2aN || 0)), dryInfo, dryT3: [].concat(...games.map(g => g.dryT3 || [])).sort((x, y) => x - y).join(','),
      reached: ch.length, founder: fo.length, assisted: games.filter(g => g.assisted).length,
      act3Shifts: mean(ch.map(g => g.act3Shifts)), act3Time: mean(ch.map(g => g.time - since(g).time)),
      founderTime: mean(fo.map(g => g.time - since(g).time)),
      founderTimeMin: fo.length ? Math.min(...fo.map(g => g.time - since(g).time)) : NaN,
      founderTimeMax: fo.length ? Math.max(...fo.map(g => g.time - since(g).time)) : NaN,
      founderShifts: mean(fo.map(g => g.firstClear[15].shifts - since(g).shifts)),
      stakeTime: mean(games.filter(g => g.stake).map(g => g.stake.time - since(g).time)),
      stakeShifts: mean(games.filter(g => g.stake).map(g => g.stake.shifts - since(g).shifts)),
      dryAvg: mean(ch.map(g => g.dry3)), dryMax: ch.length ? Math.max(...ch.map(g => g.dry3)) : NaN,
      dryCapMax: ch.length ? Math.max(...ch.map(g => g.dry3c)) : NaN, dryCapAvg: mean(ch.map(g => g.dry3c)),
      buyAt: IDS3.map(id => [id, mean(ch.filter(g => g.firstBuy3[id] !== undefined).map(g => g.firstBuy3[id]))]),
      scraps: mean(ch.map(g => g.scraps3)), execLevels: mean(ch.map(g => g.execLevels)),
      spares: mean(fo.map(g => g.sparesAtFounder)), sparesMax: fo.length ? Math.max(...fo.map(g => g.sparesAtFounder)) : NaN,
      coresAtChairman: mean(ch.map(g => g.coresAtChairman)), clawed: mean(ch.map(g => g.clawed)),
      dps: mean(fo.map(g => g.dpsFounder)), bat: mean(fo.map(g => g.batFounder)), fTime: mean(fo.map(g => g.fTime)), capStake: mean(games.filter(g => g.capLv.stake !== undefined).map(g => g.capLv.stake)),
      levels3: {}, ot: {}
    };
    for (const id of IDS3) S.act3.levels3[id] = avg(g => g.up[id]);
    if (o.overtime) for (let L = 1; L <= o.overtime; L++) {
      const rs = games.map(g => g.ot[L]).filter(Boolean), cl = rs.filter(r => r.cleared);
      S.act3.ot[L] = { reached: rs.length, cleared: cl.length, shifts: mean(rs.map(r => r.shifts)), time: mean(rs.map(r => r.time)), attempts: mean(rs.map(r => r.attempts)),
                       attMin: rs.length ? Math.min(...rs.map(r => r.attempts)) : NaN, attMax: rs.length ? Math.max(...rs.map(r => r.attempts)) : NaN,
                       avgLen: rs.length ? mean(rs.map(r => r.time / r.shifts)) : NaN };
    }
  }
  return S;
}

function printSummary(S) {
  const f1 = x => (isNaN(x) ? '  - ' : x.toFixed(1));
  console.log(`\n=== ${S.n} game(s), skill=${S.skill}, policy=${S.policy} ===`);
  console.log(`won ${S.won}/${S.n}   shifts ${S.shifts.toFixed(1)} (${S.shiftsMin}-${S.shiftsMax})   shift-time ${fmtT(S.time)} (min ${fmtT(S.timeMin)}  max ${fmtT(S.timeMax)})`);
  for (let s = 1; s <= 5; s++) {
    const c = S.sector[s];
    console.log(`  S${s}: cleared ${c.cleared}/${S.n} at ${fmtT(c.atTime)} (${fmtT(c.atTimeMin)}..${fmtT(c.atTimeMax)}) shift ${f1(c.atShift)}  arc ${fmtT(c.arc)}  pre-summon ${f1(c.preSummon)}sh  attempts ${f1(c.attempts)} (${c.attemptsMin}-${c.attemptsMax})` +
      `  shift len avg ${f1(c.avgLen)} p90 ${f1(c.p90Len)} max ${f1(c.maxLen)}  played ${f1(c.shiftsPlayed)}  time-share ${(c.timeShare * 100).toFixed(0)}%`);
  }
  console.log(`shift1: ${f1(S.shift1Bolts)} bolts in ${f1(S.shift1Time)}s, buy possible ${(S.shift1Afford * 100).toFixed(0)}%   buy-after shifts in first 5: ${f1(S.buyFirst5)}/5`);
  console.log(`shift len p90 ${f1(S.lenP90)}  max ${f1(S.lenMax)}  shifts>90s per game ${f1(S.longShifts)}`);
  console.log(`dry spell avg ${f1(S.dryAvg)} max ${S.dryMax}`);
  console.log(`warden scraps avg ${f1(S.wardenKills)} (${S.wardenKillsMin}-${S.wardenKillsMax}; repeats ${f1(S.repeatKills)})   cores earned ${f1(S.coresEarned)} left ${f1(S.coresLeft)}  longest cores-held streak ${S.coreIdleMax}`);
  console.log(`levels bought at win: ${(S.share * 100).toFixed(0)}% (${(S.shareMin * 100).toFixed(0)}-${(S.shareMax * 100).toFixed(0)}%)   unspent bolts ${Math.round(S.unspent)} = ${(S.unspentRatio * 100).toFixed(1)}% of Titan (max ${(S.unspentRatioMax * 100).toFixed(1)}%); before the final shift ${(S.unspentPre * 100).toFixed(1)}% (max ${(S.unspentPreMax * 100).toFixed(1)}%)`);
  let line = 'final levels: ';
  for (const id of IDS) {
    line += `${id}:${S.levels[id].toFixed(1)}/${D.UPGRADE_BY_ID[id].max}  `;
    if (line.length > 100) { console.log('  ' + line); line = ''; }
  }
  if (line) console.log('  ' + line);
  if (S.act2) printAct2(S);
  if (S.act3) printAct3(S);
}

function printAct2(S) {
  const f1 = x => (isNaN(x) ? '  - ' : x.toFixed(1));
  const a = S.act2;
  console.log(`\n--- ACT II (times measured from the first Overseer kill) ---`);
  console.log(`reached Act II ${a.reachedAct2}/${S.n}   Chairman scrapped ${a.chairman}/${S.n}` +
    (a.assisted ? `   (+${a.assisted} handed the scrap by --assist)` : '') +
    (a.chairman ? `   at +${fmtT(a.chairTime)} (${fmtT(a.chairTimeMin)}..${fmtT(a.chairTimeMax)})  +${f1(a.chairShifts)} shifts` : '') +
    `   Act II shifts avg ${f1(a.act2Shifts)}   shift-time so far +${fmtT(a.act2Time)}`);
  for (let s = 6; s <= 10; s++) {
    const c = S.sector[s];
    console.log(`  S${s}: cleared ${c.cleared}/${S.n} at +${fmtT(c.atTime)} (${fmtT(c.atTimeMin)}..${fmtT(c.atTimeMax)}) shift +${f1(c.atShift)}  arc ${fmtT(c.arc)}  pre-summon ${f1(c.preSummon)}sh  attempts ${f1(c.attempts)} (${c.attemptsMin}-${c.attemptsMax})` +
      `  shift len avg ${f1(c.avgLen)} p90 ${f1(c.p90Len)} max ${f1(c.maxLen)}  played ${f1(c.shiftsPlayed)}  time-share ${(c.timeShare * 100).toFixed(0)}%`);
  }
  console.log(`Hostile Takeover built at +${fmtT(a.takeoverTime)} (+${f1(a.takeoverShifts)} shifts)   dry spell avg ${f1(a.dryAvg)} max ${a.dryMax}   Warden scraps ${f1(a.scraps)}   cores earned ${f1(a.cores)} left ${f1(a.coresLeft)}   R&D levels ${f1(a.rndLevels)}   stolen by Repo Bots ${f1(a.stolen)}  Severance payouts ${f1(a.severances)}`);
  console.log('Dmg/s at each first Warden kill (hp ratio = Warden hp / dps): ' + [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].filter(s => S.sector[s]).map(s => `${s}:${S.dpsAt[s].toExponential(1)}/${(D.BOSS_BY_ID[D.SECTORS[s-1].warden].hp / S.dpsAt[s]).toFixed(1)}s`).join(' '));
  console.log('Bolts earned since the Overseer kill, at +10/22/35/48/65/80 min: ' + [10, 22, 35, 48, 65, 80].map(m => S.cumAt('act2Start', m).toExponential(1)).join(' / '));
  console.log(`Sprocket Dmg/s at the Chairman fight ${a.dps.toExponential(2)}   act levels owned at capstone buy: titan ${f1(a.capLv.titan)} takeover ${f1(a.capLv.takeover)}`);
  console.log('R&D first bought (min after Overseer): ' + a.buyAt2.slice().sort((x, y) => x[1] - y[1]).map(x => `${x[0]} ${isNaN(x[1]) ? '-' : (x[1] / 60).toFixed(1)}`).join(', '));
  let line = 'R&D levels: ';
  for (const id of IDS2) { line += `${id}:${a.levels2[id].toFixed(1)}/${D.UPGRADE_BY_ID[id].max}  `; if (line.length > 100) { console.log('  ' + line); line = ''; } }
  if (line) console.log('  ' + line);
}

function printAct3(S) {
  const f1 = x => (isNaN(x) ? '  - ' : x.toFixed(1));
  const a = S.act3;
  console.log(`\n--- ACT III (times measured from the first Chairman kill) ---`);
  console.log(`reached Act III ${a.reached}/${S.n}   Founder scrapped ${a.founder}/${S.n}` +
    (a.assisted ? `   (+${a.assisted} handed the scrap by --assist)` : '') +
    (a.founder ? `   at +${fmtT(a.founderTime)} (${fmtT(a.founderTimeMin)}..${fmtT(a.founderTimeMax)})  +${f1(a.founderShifts)} shifts` : '') +
    `   Act III shifts avg ${f1(a.act3Shifts)}   shift-time so far +${fmtT(a.act3Time)}`);
  for (let s = 11; s <= 15; s++) {
    const c = S.sector[s];
    console.log(`  S${s}: cleared ${c.cleared}/${S.n} at +${fmtT(c.atTime)} (${fmtT(c.atTimeMin)}..${fmtT(c.atTimeMax)}) shift +${f1(c.atShift)}  attempts ${f1(c.attempts)} (${c.attemptsMin}-${c.attemptsMax})` +
      `  shift len avg ${f1(c.avgLen)} p90 ${f1(c.p90Len)} max ${f1(c.maxLen)}  played ${f1(c.shiftsPlayed)}`);
  }
  console.log(`Majority Stake built at +${fmtT(a.stakeTime)} (+${f1(a.stakeShifts)} shifts)   longest nothing-affordable streak avg ${f1(a.dryAvg)} max ${a.dryMax} (capped-only: avg ${f1(a.dryCapAvg)} max ${a.dryCapMax})   Warden scraps ${f1(a.scraps)}   Exec levels ${f1(a.execLevels)}`);
  console.log(`spare cores: ${f1(a.coresAtChairman)} at the Chairman, ${f1(a.spares)} at the Founder (max ${a.sparesMax})   bolts clawed back-and-lost per game ${f1(a.clawed)}`);
  console.log(`Act II (before the Chairman) nothing-affordable streak: max ${a.dry2aMax}, shifts per game ${a.dry2aN.toFixed(1)}`);
  console.log(a.dryInfo + '  | Act III capped-dry shifts at minutes after Chairman: ' + a.dryT3);
  console.log('Bolts earned since the Chairman kill, at +10/22/34/46/58/70 min: ' + [10, 22, 34, 46, 58, 70].map(m => S.cumAt('chairShift', m).toExponential(1)).join(' / '));
  console.log(`Sprocket Dmg/s at the Founder fight ${a.dps.toExponential(2)}   act levels owned at stake buy: ${f1(a.capStake)}   battery ${a.bat.toFixed(0)}   final shift ${a.fTime.toFixed(0)}s`);
  console.log('Exec first bought (min after Chairman): ' + a.buyAt.slice().sort((x, y) => x[1] - y[1]).map(x => `${x[0]} ${isNaN(x[1]) ? '-' : (x[1] / 60).toFixed(1)}`).join(', '));
  let line = 'Exec levels: ';
  for (const id of IDS3) { line += `${id}:${a.levels3[id].toFixed(1)}/${D.UPGRADE_BY_ID[id].max}  `; if (line.length > 100) { console.log('  ' + line); line = ''; } }
  if (line) console.log('  ' + line);
  for (const L of Object.keys(a.ot)) {
    const t = a.ot[L], ward = D.OVERTIME.rotation[(L - 1) % D.OVERTIME.rotation.length];
    console.log(`  OT L${L} (${ward}): reached ${t.reached}/${S.n} cleared ${t.cleared}/${S.n}  shifts ${f1(t.shifts)}  attempts ${f1(t.attempts)} (${t.attMin}-${t.attMax})  time ${fmtT(t.time)}  shift len avg ${f1(t.avgLen)}`);
  }
}

function runBatch(o) {
  const games = [];
  for (let r = o.first || 0; r < (o.first || 0) + o.runs; r++) games.push(playGame(o, o.seed * 1000 + r));
  return games;
}

// minimal level each upgrade must keep so the rest of the tree stays reachable
function minNeeded(id) {
  let m = 0;
  for (const u of D.UPGRADES) for (const r of u.requires) if (r[0] === id) m = Math.max(m, r[1]);
  if (A.closure[id]) m = Math.max(m, 1);
  return m;
}

function main() {
  const o = args();
  const t0 = Date.now();
  if (o.ablate) {
    const ids = o.ablate.length ? o.ablate : IDS.filter(id => id !== 'titan');
    const base = summarize(runBatch(Object.assign({}, o, { cap: {}, force: [] })), o);
    const rows = [{ id: 'baseline', S: base }];
    for (const id of ids) {
      const cap = Object.assign({}, o.cap); cap[id] = o.ablateTo !== undefined ? o.ablateTo : minNeeded(id);
      const S = summarize(runBatch(Object.assign({}, o, { cap, force: [] })), o);
      rows.push({ id, cap: cap[id], S });
    }
    if (o.json) { console.log(JSON.stringify(rows.map(r => ({ id: r.id, cap: r.cap, won: r.S.won, n: r.S.n, time: r.S.time, shifts: r.S.shifts })))); return; }
    console.log(`\nABLATION skill=${o.skill} n=${o.runs}  (cap = highest level the bot may buy)`);
    console.log('id'.padEnd(11) + 'cap  won   time      shifts  dTime');
    for (const r of rows) {
      const d = (r.S.time - base.time) / base.time;
      console.log(r.id.padEnd(11) + String(r.cap === undefined ? '-' : r.cap).padEnd(5) + `${r.S.won}/${r.S.n}`.padEnd(6) + fmtT(r.S.time).padEnd(10) +
        r.S.shifts.toFixed(0).padEnd(8) + (r.id === 'baseline' ? '' : (d >= 0 ? '+' : '') + (d * 100).toFixed(0) + '%'));
    }
    console.log('cpu: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return;
  }
  const games = runBatch(o);
  if (o.verbose || !o.quiet) {
    for (const g of games) {
      const top = o.act3 ? 15 : o.act2 ? 10 : 5, idxs = Array.from({ length: top }, (_, i) => i + 1);
      const fc = idxs.map(n => g.firstClear[n] ? `${n}:${g.firstClear[n].shifts}sh/${fmtT(g.firstClear[n].time)}` : `${n}:-`).join('  ');
      if (!o.json) {
        console.log(`game ${g.seed % 1000 + 1}: ${g.won ? 'WON' : 'not won'}${o.act2 ? (g.chairman ? ' + CHAIRMAN' : ' (no chairman)') : ''}${o.act3 ? (g.founder ? ' + FOUNDER' : ' (no founder)') : ''} in ${g.shifts} shifts, ${fmtT(g.time)}  | ${fc}`);
        console.log(`   attempts ${idxs.map(n => g.attempts[n]).join('/')}  warden scraps ${g.wardenKills}  dry ${g.drySpell}  cores ${g.coresEarned}/${g.coresLeft} left  levels ${(g.share * 100).toFixed(0)}%  unspent ${g.unspent}`);
      }
    }
  }
  const S = summarize(games, o);
  if (o.json) console.log(JSON.stringify(S));
  else { printSummary(S); console.log('cpu: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
}
if (require.main === module) main();
module.exports = { playGame, summarize, runBatch, mulberry, fmtT, IDS, main };

process.on('exit', () => { const T = globalThis.__T || {}; for (const k in T) { const m = f => (T[k].reduce((a, x) => a + x[f], 0) / T[k].length).toFixed(1); console.log('CAPSTONE ' + k + ': n=' + T[k].length + ' mean shift ' + m('shifts') + ' mean time ' + m('time') + 'm'); } });
