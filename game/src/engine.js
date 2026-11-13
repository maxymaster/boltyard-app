(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};
  var D = BY.Data;
  if (!D) throw new Error('BY.Data must be loaded before BY.Engine');

  var TICK = D.TICK, T = D.TUNE, L = D.LEVEL, P = D.PLAYER;
  var UP = D.UPGRADES, UPID = D.UPGRADE_BY_ID, EN = D.ENEMY_BY_ID, BOSS = D.BOSS_BY_ID, SEC = D.SECTORS;
  var TWO_PI = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clampInt(v, lo, hi, def) {
    v = Number(v);
    if (!isFinite(v)) return def;
    v = Math.floor(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function nonNeg(v) {
    v = Number(v);
    if (!isFinite(v) || v < 0) return 0;
    return Math.min(Math.floor(v), 1e15);
  }
  function nonNegF(v) {
    v = Number(v);
    if (!isFinite(v) || v < 0) return 0;
    return Math.min(v, 1e12);
  }

  function rnd(run) {
    var a = (run.rs = (run.rs + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function ev(run, o) {
    var a = run.events;
    a.push(o);
    if (a.length > 4000) a.splice(0, 2000);
  }

  // ---------------------------------------------------------------------------
  // save (v3; v1 and v2 saves migrate)
  // ---------------------------------------------------------------------------
  var NSEC = SEC.length;           // 16 (15 sectors + Overtime)
  var LASTSEC = 15;                // highest sector with a clearable Warden (the Founder)
  var CHAIRSEC = 10;               // the Chairman's sector (end of Act II)
  var FIRSTFAT = 6;                // Board fatigue covers Wardens of sectors 6..15
  var OT = D.OVERTIME;

  function bigNum(v) {             // totals may exceed 1e15: plain doubles, never int32
    v = Number(v);
    if (!isFinite(v) || v < 0) return 0;
    v = Math.min(v, 1e300);
    return v < 9007199254740992 ? Math.floor(v) : v;
  }

  function newSave() {
    var up = {}, i, bk = {};
    for (i = 0; i < UP.length; i++) up[UP[i].id] = 0;
    up.boot = 1;
    for (i = 1; i <= LASTSEC; i++) bk[i] = 0;
    var fat = {};
    for (i = FIRSTFAT; i <= LASTSEC; i++) fat[i] = 0;
    return {
      v: 3,
      bolts: 0, cores: 0,
      up: up,
      sectorsCleared: 0,
      bossKills: bk,
      sector: 1,
      seen: {},
      stats: { shifts: 0, kills: 0, boltsTotal: 0, coresTotal: 0, playTime: 0, bestCombo: 0, bestShiftBolts: 0,
               wonShifts: null, wonPlayTime: null, act2Shifts: null, act2PlayTime: null, stolen: 0,
               act3Shifts: null, act3PlayTime: null, clawed: 0 },
      flags: { won: false, movedOnce: false, tip: 0, shopped: false, act2: false, chairman: false, reveal: false,
               act3: false, founder: false, reveal3: false, finale: false },
      overtime: { level: 0, best: 0 },
      fatigue: fat,
      settings: { sound: true, shake: true }
    };
  }

  function maxSector(s) {
    if (s.flags.founder) return NSEC;
    return Math.min(LASTSEC, s.sectorsCleared + 1);
  }

  // SPEC 12.15: old saves had single long nodes (coil 25, cell 20, ...). Spill any level above a chain node's cap
  // into the next node of its chain (old coil 19 -> coil 8, coil2 8, coil3 3). Works for v1/v2/v3 saves alike.
  var CHAINS = [['coil', 'coil2', 'coil3'], ['pulse', 'pulse2'], ['field', 'field2'], ['cell', 'cell2', 'cell3'],
                ['sorter', 'sorter2'], ['dividends', 'dividends2'], ['fusion', 'fusion2', 'fusion3'], ['megacoil', 'megacoil2']];
  function migrateChains(raw, up) {
    for (var c = 0; c < CHAINS.length; c++) {
      var ch = CHAINS[c], k, total = 0, anyOld = false;
      for (k = 0; k < ch.length; k++) total += clampInt(raw[ch[k]], 0, 1e6, 0);
      var first = clampInt(raw[ch[0]], 0, 1e6, 0);
      if (first <= UPID[ch[0]].max) {
        // already split (or short): keep the stored values, clamped per node
        for (k = 0; k < ch.length; k++) up[ch[k]] = clampInt(raw[ch[k]], 0, UPID[ch[k]].max, 0);
        continue;
      }
      var left = total;
      for (k = 0; k < ch.length; k++) { up[ch[k]] = Math.min(left, UPID[ch[k]].max); left -= up[ch[k]]; }
    }
  }

  function loadSave(any) {
    var s = newSave();
    try {
      if (!any || typeof any !== 'object' || Array.isArray(any)) return s;
      var i, k, u;
      s.bolts = bigNum(any.bolts);
      s.cores = bigNum(any.cores);
      if (any.up && typeof any.up === 'object') {
        for (i = 0; i < UP.length; i++) {
          u = UP[i];
          if (u.id === 'boot') continue;
          s.up[u.id] = clampInt(any.up[u.id], 0, u.max === Infinity ? 1e9 : u.max, 0);
        }
        migrateChains(any.up, s.up);
      }
      s.sectorsCleared = clampInt(any.sectorsCleared, 0, LASTSEC, 0);
      if (any.bossKills && typeof any.bossKills === 'object') {
        for (k = 1; k <= LASTSEC; k++) {
          s.bossKills[k] = nonNeg(any.bossKills[k]);
          if (s.bossKills[k] > 0 && s.sectorsCleared < k) s.sectorsCleared = k;
        }
      }
      if (any.seen && typeof any.seen === 'object') {
        for (k in any.seen) {
          if (Object.prototype.hasOwnProperty.call(any.seen, k) && any.seen[k] === true && (EN[k] || BOSS[k])) s.seen[k] = true;
        }
      }
      var as = any.stats;
      if (as && typeof as === 'object') {
        s.stats.shifts = nonNeg(as.shifts);
        s.stats.kills = nonNeg(as.kills);
        s.stats.boltsTotal = bigNum(as.boltsTotal);
        s.stats.coresTotal = bigNum(as.coresTotal);
        s.stats.playTime = nonNegF(as.playTime);
        s.stats.bestCombo = nonNeg(as.bestCombo);
        s.stats.bestShiftBolts = bigNum(as.bestShiftBolts);
        s.stats.wonShifts = (as.wonShifts === null || as.wonShifts === undefined) ? null : nonNeg(as.wonShifts);
        s.stats.wonPlayTime = (as.wonPlayTime === null || as.wonPlayTime === undefined) ? null : nonNegF(as.wonPlayTime);
        s.stats.act2Shifts = (as.act2Shifts === null || as.act2Shifts === undefined) ? null : nonNeg(as.act2Shifts);
        s.stats.act2PlayTime = (as.act2PlayTime === null || as.act2PlayTime === undefined) ? null : nonNegF(as.act2PlayTime);
        s.stats.stolen = bigNum(as.stolen);
        s.stats.act3Shifts = (as.act3Shifts === null || as.act3Shifts === undefined) ? null : nonNeg(as.act3Shifts);
        s.stats.act3PlayTime = (as.act3PlayTime === null || as.act3PlayTime === undefined) ? null : nonNegF(as.act3PlayTime);
        s.stats.clawed = bigNum(as.clawed);
      }
      if (any.flags && typeof any.flags === 'object') {
        var af = any.flags;
        s.flags.won = af.won === true;
        s.flags.movedOnce = af.movedOnce === true;
        s.flags.tip = clampInt(af.tip, 0, 9, 0);
        s.flags.shopped = af.shopped === true;
        s.flags.act2 = af.act2 === true;
        s.flags.chairman = af.chairman === true;
        s.flags.reveal = af.reveal === true;
        s.flags.act3 = af.act3 === true;
        s.flags.founder = af.founder === true;
        s.flags.reveal3 = af.reveal3 === true;
        s.flags.finale = af.finale === true;
      }
      if (any.fatigue && typeof any.fatigue === 'object') {
        for (i = FIRSTFAT; i <= LASTSEC; i++) {
          var fv = any.fatigue[i];
          s.fatigue[i] = (typeof fv === 'number' && isFinite(fv) && fv > 0) ? Math.min(T.fatigueMax, fv) : 0;
        }
      }
      if (any.overtime && typeof any.overtime === 'object') {
        s.overtime.level = clampInt(any.overtime.level, 0, 1e6, 0);
        s.overtime.best = Math.max(s.overtime.level, clampInt(any.overtime.best, 0, 1e6, 0));
      }
      // migration / repair: v1 saves that beat the Overseer are Act II saves; later flags imply earlier ones
      if (s.bossKills[CHAIRSEC] > 0) s.flags.chairman = true;
      if (s.bossKills[LASTSEC] > 0) s.flags.founder = true;
      if (s.flags.founder) { s.flags.chairman = true; s.sectorsCleared = LASTSEC; }
      if (s.flags.chairman) { s.flags.act3 = true; if (s.sectorsCleared < CHAIRSEC) s.sectorsCleared = CHAIRSEC; }
      if (s.flags.won || s.bossKills[5] > 0 || s.sectorsCleared >= 5) {
        s.flags.won = true; s.flags.act2 = true;
        if (s.sectorsCleared < 5) s.sectorsCleared = 5;
      }
      if (s.flags.act2 || s.flags.chairman) { s.flags.won = true; if (s.sectorsCleared < 5) s.sectorsCleared = 5; }
      s.sector = clampInt(any.sector, 1, maxSector(s), 1);
      if (any.settings && typeof any.settings === 'object') {
        s.settings.sound = any.settings.sound !== false;
        s.settings.shake = any.settings.shake !== false;
      }
      return s;
    } catch (err) {
      return newSave();
    }
  }

  // ---------------------------------------------------------------------------
  // derived stats, loadout, upgrades
  // ---------------------------------------------------------------------------
  function lv(save, id) {
    var v = save && save.up ? save.up[id] : 0;
    return v > 0 ? v : 0;
  }

  function computeStats(save) {
    var titan = lv(save, 'titan') >= 1;
    var coil = lv(save, 'coil') + lv(save, 'coil2') + lv(save, 'coil3'), amp = lv(save, 'amp'), pulse = lv(save, 'pulse') + lv(save, 'pulse2'), field = lv(save, 'field') + lv(save, 'field2');
    var fork = lv(save, 'fork'), surge = lv(save, 'surge'), chain = lv(save, 'chain'), overload = lv(save, 'overload');
    var cell = lv(save, 'cell') + lv(save, 'cell2') + lv(save, 'cell3'), thrust = lv(save, 'thrust'), recycler = lv(save, 'recycler'), capacitor = lv(save, 'capacitor');
    var coolant = lv(save, 'coolant'), plating = lv(save, 'plating'), spare = lv(save, 'spare');
    var magnet = lv(save, 'magnet'), sorter = lv(save, 'sorter') + lv(save, 'sorter2'), sweep = lv(save, 'sweep'), lucky = lv(save, 'lucky');
    var beacon = lv(save, 'beacon'), extract = lv(save, 'extract');
    var drone = lv(save, 'drone'), dronedmg = lv(save, 'dronedmg'), dronerate = lv(save, 'dronerate'), collector = lv(save, 'collector');
    // Act II
    var fusion = lv(save, 'fusion') + lv(save, 'fusion2') + lv(save, 'fusion3'), supercell = lv(save, 'supercell'), dividends = lv(save, 'dividends') + lv(save, 'dividends2');
    var lattice = lv(save, 'lattice'), storm = lv(save, 'storm'), sing = lv(save, 'singularity'), severance = lv(save, 'severance');
    var stockopt = lv(save, 'stockopt'), rehire = lv(save, 'rehire'), nanites = lv(save, 'nanites'), parachute = lv(save, 'parachute');
    var takeover = lv(save, 'takeover') >= 1, otpay = Math.min(lv(save, 'overtimepay'), 2000), hzpay = Math.min(lv(save, 'hazardpay'), 2000);   // cap keeps corrupt saves finite
    // Act III (SPEC 12.7)
    var megacoil = lv(save, 'megacoil') + lv(save, 'megacoil2'), diligence = lv(save, 'diligence'), legal = lv(save, 'legal'), compound = lv(save, 'compound');
    var fleet = lv(save, 'fleet'), insider = lv(save, 'insider'), orbital = lv(save, 'orbital'), expense = lv(save, 'expense');
    var restructure = lv(save, 'restructure'), outsource = lv(save, 'outsource'), stake = lv(save, 'stake') >= 1;
    var damage = (P.damage + L.coil * coil) * Math.pow(L.amp, amp) * (titan ? L.titan.damage : 1);
    damage *= Math.pow(L.fusion, fusion) * (takeover ? L.takeover.damage : 1) * Math.pow(L.overtimepay, otpay);
    damage *= Math.pow(L.megacoil, megacoil) * (stake ? L.stake.damage : 1);
    damage *= Math.pow(L.overdrive, lv(save, 'overdrive')) * Math.pow(L.arcfocus, lv(save, 'arcfocus')) * Math.pow(L.hardened, lv(save, 'hardened'));
    var boltMult = 1 + L.sorter * sorter;
    boltMult *= Math.pow(L.dividends, dividends) * Math.pow(L.hazardpay, hzpay);
    var droneDmg = damage * (L.droneBase + L.droneDmgPer * dronedmg);
    droneDmg *= Math.pow(L.fleet.dmg, fleet);
    return {
      damage: damage,
      pulseInterval: P.pulse * Math.pow(L.pulse, pulse),
      radius: (P.radius + L.field * field) * (titan ? L.titan.radius : 1) * (takeover ? L.takeover.radius : 1) * (stake ? L.stake.radius : 1),
      targets: P.targets + L.fork * fork,
      critChance: L.surge * surge + L.insider.crit * insider,
      critMult: P.critMult + L.insider.mult * insider,
      chainPct: chain ? L.chainBase + L.chainPer * chain : 0,
      overloadPct: L.overload * overload,
      maxBattery: (P.battery + L.cell * cell) * (titan ? L.titan.battery : 1) * (1 + L.supercell.battery * supercell) * (takeover ? L.takeover.battery : 1) * (stake ? L.stake.battery : 1),
      speed: P.speed + L.thrust * thrust,
      recycle: L.recycler * recycler,
      ocUnlocked: capacitor >= 1,
      ocDur: L.ocBase + capacitor,
      sag: P.sag * (1 - L.coolant * coolant) * (1 - L.supercell.sag * supercell),
      plating: L.plating * plating,
      sparePct: L.spare[spare] || 0,
      magnet: P.magnet + L.magnet * magnet,
      boltMult: boltMult,
      sweepPct: parachute ? (L.parachute[Math.min(parachute, 3)]) : (L.sweep[sweep] || 0),
      gildedChance: L.gildedBase + L.gildedPer * lucky,
      signalMult: 1 - L.beacon * beacon,
      bossCoreBonus: extract,
      eliteCoreChance: L.extractElite * extract,
      drones: drone + L.fleet.drones * fleet,
      droneDmg: droneDmg,
      droneInterval: L.droneInterval * Math.pow(L.droneRate, dronerate),
      collector: collector >= 1,
      titan: titan,
      // Act II (SPEC 11.8); 0 = off
      stormEvery: storm ? L.storm.base - storm : 0,
      latticeDps: lattice ? L.lattice * lattice * droneDmg : 0,
      wellEvery: sing ? L.singularity.base - sing : 0,
      wellMult: sing ? L.singularity.mult + L.singularity.per * sing : 0,
      severancePct: severance ? L.severance.mult : 0,
      severancePay: severance ? L.severance.pay[Math.min(severance, 3) - 1] : 0,
      stockStep: L.stockopt.step * stockopt,
      stockCap: L.stockopt.cap * stockopt,
      rehireChance: L.rehire * rehire,
      naniteDps: L.nanites * nanites * damage,
      colossus: takeover,
      // Act III (SPEC 12.7); 0 / 1 = off
      wardenMult: Math.pow(L.diligence, diligence),
      holdMult: Math.pow(L.legal.hold, legal),
      injunctionR: Math.pow(L.legal.injunction, legal),
      clawMult: Math.pow(L.legal.claw, legal),
      compoundStep: L.compound.step * compound,
      compoundCap: L.compound.cap * compound,
      orbitalEvery: orbital ? L.orbital.base - L.orbital.per * orbital : 0,
      orbitalMult: L.orbital.mult * orbital,
      expenseStep: L.expense.step * expense,
      expenseCap: L.expense.cap * expense,
      burstChance: L.restructure.chance * restructure,
      internLife: T.internLife + L.outsource.life * outsource,
      internMax: T.internMax + L.outsource.max * outsource,
      internMult: Math.pow(L.outsource.contact, outsource),
      magnate: stake,
      // extras (not in SPEC 4.3)
      r: P.r, leash: P.leash, drain: P.drain
    };
  }

  function branchTier(total, th) {
    var t = 0;
    for (var i = 0; i < th.length; i++) if (total >= th[i]) t = i + 1;
    return t;
  }
  function loadout(save) {
    var tot = { arc: 0, chassis: 0, salvage: 0, rnd: 0, exec: 0 }, i, u;
    for (i = 0; i < UP.length; i++) {
      u = UP[i];
      if (tot[u.branch] !== undefined) tot[u.branch] += lv(save, u.id);
    }
    return {
      arc: branchTier(tot.arc, D.TIERS.arc),
      chassis: branchTier(tot.chassis, D.TIERS.chassis),
      salvage: branchTier(tot.salvage, D.TIERS.salvage),
      drones: clamp(lv(save, 'drone'), 0, 4),
      titan: lv(save, 'titan') >= 1,
      rnd: branchTier(tot.rnd, D.TIERS.rnd),
      colossus: lv(save, 'takeover') >= 1,
      exec: branchTier(tot.exec, D.TIERS.exec),
      magnate: lv(save, 'stake') >= 1
    };
  }

  function costBolts(def, level) { return Math.round(def.base * Math.pow(def.growth, level)); }
  function costCores(def, level) { return def.cores ? (def.cores[level] || 0) : 0; }

  // Is the node's gate flag set? (ungated nodes are always open)
  function gateOpen(save, def) {
    if (!def.gate) return true;
    var f = save && save.flags;
    return !!(f && f[def.gate] === true);
  }

  // SPEC 12.15: a node is revealed when owned, when it has no requirements, or when any requirement is owned
  function revealed(save, def) {
    if (def.id === 'boot' || !def.requires.length || lv(save, def.id) > 0) return true;
    for (var i = 0; i < def.requires.length; i++) if (lv(save, def.requires[i][0]) > 0) return true;
    return false;
  }

  // SPEC 12.15: act-level condition (total capped levels owned in an act) for the capstone forms
  var ROMAN = ['', 'I', 'II', 'III'];
  function actOfDef(u) { return u.branch === 'rnd' ? 2 : u.branch === 'exec' ? 3 : 1; }
  function actLevels(save, act, selfId) {
    var n = 0;
    for (var i = 0; i < UP.length; i++) {
      var u = UP[i];
      if (u.id === 'boot' || u.id === selfId || u.max === Infinity || actOfDef(u) !== act) continue;
      n += Math.min(lv(save, u.id), u.max);
    }
    return n;
  }
  function actReqInfo(save, def) {
    return def.actReq ? { act: def.actReq.act, have: actLevels(save, def.actReq.act, def.id), need: def.actReq.levels } : null;
  }

  function upgradeInfo(save, id) {
    var def = UPID[id];
    if (!def) return null;
    var level = lv(save, id);
    if (id === 'boot') level = 1;
    var uncapped = def.max === Infinity;
    if (!gateOpen(save, def)) {
      return {
        id: id, name: 'CLASSIFIED', branch: def.branch, col: def.col, row: def.row, pos: def.pos, tier: def.tier || 0, icon: def.icon || id, revealed: revealed(save, def), actReq: actReqInfo(save, def), desc: '',
        level: level, max: uncapped ? null : def.max, maxed: false, classified: true,
        unlocked: false, lockReason: 'Classified',
        cost: null, affordable: false, now: null, next: null
      };
    }
    var maxed = !uncapped && level >= def.max;
    var unmet = [], i, r;
    for (i = 0; i < def.requires.length; i++) {
      r = def.requires[i];
      if (lv(save, r[0]) < r[1]) unmet.push(UPID[r[0]].name + (r[1] > 1 ? ' ' + r[1] : ''));
    }
    var ar = actReqInfo(save, def);
    if (ar && ar.have < ar.need) unmet.push(ar.need + ' Act ' + ROMAN[ar.act] + ' levels (' + ar.have + '/' + ar.need + ')');
    var unlocked = unmet.length === 0;
    var cost = maxed ? null : { bolts: costBolts(def, level), cores: costCores(def, level) };
    var affordable = !!(unlocked && !maxed && save.bolts >= cost.bolts && save.cores >= cost.cores);
    return {
      id: id, name: def.name, branch: def.branch, col: def.col, row: def.row, pos: def.pos, tier: def.tier || 0, icon: def.icon || id, revealed: revealed(save, def), actReq: ar, desc: def.desc,
      level: level, max: uncapped ? null : def.max, maxed: maxed, classified: false,
      unlocked: unlocked, lockReason: unlocked ? null : 'Needs ' + unmet.join(', '),
      cost: cost, affordable: affordable,
      now: def.fmt(level), next: maxed ? null : def.fmt(level + 1)
    };
  }

  function buy(save, id) {
    if (!save || !save.up || id === 'boot') return false;
    var info = upgradeInfo(save, id);
    if (!info || !info.affordable) return false;
    save.bolts -= info.cost.bolts;
    save.cores -= info.cost.cores;
    save.up[id] = info.level + 1;
    return true;
  }

  function affordableCount(save) {
    var n = 0;
    for (var i = 0; i < UP.length; i++) {
      if (UP[i].id === 'boot') continue;
      if (upgradeInfo(save, UP[i].id).affordable) n++;
    }
    return n;
  }

  function needFor(sec, signalMult) { return Math.max(1, Math.round(sec.need * signalMult)); }

  function sectorUnlocked(save, n) {
    if (n === 1) return true;
    if (n === NSEC) return !!(save.flags && save.flags.founder);
    return save.sectorsCleared >= n - 1;
  }

  function fatigueOf(save, n) {
    if (n < FIRSTFAT || n > LASTSEC || !save || !save.fatigue) return 0;
    var f = save.fatigue[n];
    return (typeof f === 'number' && f > 0) ? Math.min(f, T.fatigueMax) : 0;
  }
  function overtimeLevel(save) {
    var o = save && save.overtime;
    return (o && o.level > 0) ? Math.floor(o.level) : 0;
  }
  function overtimeWarden(Lv) { return OT.rotation[(Lv - 1) % OT.rotation.length]; }

  function sectorInfo(save, n) {
    n = clampInt(n, 1, NSEC, 1);
    var sec = SEC[n - 1], st = computeStats(save);
    var unlocked = sectorUnlocked(save, n);
    var OL = n === NSEC ? overtimeLevel(save) + 1 : 0;
    var b = BOSS[n === NSEC ? overtimeWarden(OL) : sec.warden];
    var cleared = n === NSEC ? overtimeLevel(save) > 0 : ((save.bossKills && save.bossKills[n] > 0) || save.sectorsCleared >= n);
    var lockReason = null;
    if (!unlocked) lockReason = 'Scrap ' + BOSS[SEC[n === NSEC ? LASTSEC - 1 : n - 2].warden].name;
    return {
      id: n, name: sec.name, unlocked: unlocked, cleared: !!cleared,
      lockReason: lockReason,
      bossId: b.id, bossName: b.name,
      need: needFor(sec, st.signalMult),
      lureBlocked: (n === 5 && !st.titan) || (n === 10 && !st.colossus) || (n === 15 && !st.magnate),
      overtime: OL,                     // Overtime level the next clock-in fights (sector 16), else 0
      fatigue: fatigueOf(save, n)       // Board fatigue: fraction off the Warden's hp (sectors 6-15), else 0
    };
  }

  // ---------------------------------------------------------------------------
  // shift setup
  // ---------------------------------------------------------------------------
  function startShift(save, sector, o) {
    o = o || {};
    sector = clampInt(sector, 1, NSEC, 1);
    var st = computeStats(save), sec = SEC[sector - 1], wardenId = sec.warden, OL = 0, fHp = 1, fBolts = 1;
    var fat = fatigueOf(save, sector);
    if (sector === NSEC) {            // Overtime: fight level (cleared + 1), scaled per SPEC 11.1 / 12.1
      OL = overtimeLevel(save) + 1;
      fHp = Math.min(Math.pow(OT.hp, OL), OT.maxScale);
      fBolts = Math.min(Math.pow(OT.bolts, OL), OT.maxScale);
      wardenId = overtimeWarden(OL);
      sec = { n: sec.n, name: sec.name, hp: sec.hp * fHp, bolts: sec.bolts * fBolts, dmg: sec.dmg * Math.pow(OT.dmg, OL),
              need: sec.need, cap: sec.cap, warden: wardenId, coresFirst: OT.coresBase + OL, coresRepeat: 0,
              mix: sec.mix, overtime: true };
    }
    var bdef = BOSS[wardenId];
    var hpBase = bdef.hp, boltBase = bdef.bolts;
    if (sector === NSEC) { hpBase = BOSS.founder.hp; boltBase = BOSS.founder.bolts; }   // SPEC 12.1: Overtime Wardens are normalised to the Founder
    var w = (o.w > 0) ? o.w : D.ARENA_W;
    var h = clamp(o.h > 0 ? o.h : 640, 480, 760);
    var seed = (o.seed === undefined || o.seed === null || !isFinite(o.seed)) ? 1 : (o.seed | 0);
    var px = w / 2, py = h * T.startY;
    var run = {
      sector: sector, w: w, h: h, seed: seed, t: 0, tick: 0, attract: !!o.attract,
      over: false, reason: null,
      overtime: OL, pulses: 0,
      stats: st,
      player: {
        x: px, y: py, r: st.r, vx: 0, vy: 0, tx: px, ty: py,
        battery: st.maxBattery, maxBattery: st.maxBattery,
        pulse: 0, hurt: 99,
        oc: { unlocked: st.ocUnlocked, charge: 0, active: false, time: 0, dur: st.ocDur },
        spareUsed: false, titan: st.titan, colossus: st.colossus, budget: false,
        held: 0, enjoined: false, magnate: st.magnate
      },
      enemies: [], pickups: [], shots: [], hazards: [], drones: [],
      interns: [], wells: [], links: [], stock: { n: 0, mult: 1 },
      heals: [], strikes: [], compound: 1, expense: 0, clawed: 0,
      boss: {
        state: 'none', signal: 0, need: needFor(sec, st.signalMult),
        blocked: (sector === 5 && !st.titan) || (sector === 10 && !st.colossus) || (sector === 15 && !st.magnate),
        id: bdef.id, name: bdef.name, enemyId: null, hp: hpBase * fHp * (1 - fat), maxHp: hpBase * fHp * (1 - fat), phase: 1, warn: 0, overtime: OL, fatigue: fat,
        clawed: 0, vol: 1, aura: 0
      },
      combo: { n: 0, t: 0 },
      earned: { bolts: 0, cores: 0 },
      counts: { kills: 0, bestCombo: 0, elites: 0, gilded: 0 },
      events: [],
      // internal
      rs: seed, sec: sec, _nid: 1, _cd: T.arcStartCd, _spawnT: 0.4, _lastKillT: -99, _low: false, _dAng: 0,
      _cAcc: 0, _cX: 0, _cY: 0, _cLast: -99, _cSrc: 'contact', _victoryT: 0, _safe: false, _heat0: 0,
      _first: sector === NSEC ? true : !(save.bossKills && save.bossKills[sector] > 0),
      _seen: {}, _report: null,
      _bossHp: fHp * (1 - fat), _hpBase: hpBase, _boltBase: boltBase, _fat: fat, _bossBolts: fBolts, _bud: 0,
      _orbT: st.orbitalEvery, _burstT: 0, _burstN: 0, _hr: false, _inj: false, _pend: [], _fn: false, _wellT: st.wellEvery, _infN: 0,
      _sevDone: false, _sev: false, _payMul: 1, stolen: 0
    };
    var i, n = st.drones;
    for (i = 0; i < n; i++) {
      run.drones.push({ x: px, y: py, angle: i * TWO_PI / n, cd: st.droneInterval * (i / n) });
    }
    // opening bots
    for (i = 0; i < T.initialBots; i++) {
      var type = pickType(run, true), x = 0, y = 0, tries = 0;
      do {
        x = T.spawnMargin / 2 + rnd(run) * (w - T.spawnMargin);
        y = T.spawnMargin / 2 + rnd(run) * (h - T.spawnMargin);
        tries++;
      } while (tries < 30 && Math.hypot(x - px, y - py) < T.initialClear);
      spawnEnemy(run, type, x, y, { entered: true, elite: false, roam: true });
    }
    return run;
  }

  // ---------------------------------------------------------------------------
  // enemies
  // ---------------------------------------------------------------------------
  function pickType(run, safeOnly) {
    var mix = run.sec.mix, tot = 0, i, m;
    for (i = 0; i < mix.length; i++) {
      m = mix[i];
      if (run.t < m.after) continue;
      if (safeOnly && EN[m.type].hostile) continue;
      tot += m.w;
    }
    var r = rnd(run) * tot;
    for (i = 0; i < mix.length; i++) {
      m = mix[i];
      if (run.t < m.after) continue;
      if (safeOnly && EN[m.type].hostile) continue;
      r -= m.w;
      if (r < 0) return m.type;
    }
    return mix[0].type;
  }

  // opt: { elite, entered, roam }
  function spawnEnemy(run, type, x, y, opt) {
    opt = opt || {};
    var def = EN[type], sec = run.sec, elite = !!opt.elite;
    var hp = def.hp * sec.hp * (elite ? T.eliteHp : 1);
    var e = {
      id: run._nid++, type: type, x: x, y: y, vx: 0, vy: 0, r: def.r * (elite ? T.eliteR : 1),
      hp: hp, maxHp: hp, armor: def.armor || 0, elite: elite, boss: false, hostile: !!def.hostile, invuln: false,
      flash: 0, age: 0, facing: 0, planted: false, windup: 0,
      sig: def.signal * (elite ? T.eliteSignal : 1), entered: !!opt.entered, wx: 0, wy: 0, wt: 0, st: 0,
      side: rnd(run) < 0.5 ? -1 : 1, dead: false, leaving: false,
      // Act II fields (SPEC 11.5); inert for Act I bots
      disguised: type === 'mimic', shieldedBy: null, stolen: 0, infected: 0,
      shielded: false, blinking: false, pyl: false, leaveAt: 0, dot: 0, dotT: 0, hz: 0, bt: 0,
      // Act III fields (SPEC 12.4)
      copy: false, healing: false
    };
    if (def.audit) e.bt = def.audit.every;
    e.wx = T.spawnMargin + rnd(run) * (run.w - 2 * T.spawnMargin);
    e.wy = T.spawnMargin + rnd(run) * (run.h - 2 * T.spawnMargin);
    e.wt = T.driftWaitMin + rnd(run) * (T.driftWaitMax - T.driftWaitMin);
    var ang;
    if (opt.roam || def.behaviour === 'roll' && opt.entered) ang = rnd(run) * TWO_PI;
    else ang = Math.atan2(e.wy - y, e.wx - x);
    e.facing = ang;
    if (def.behaviour === 'roll') { e.vx = Math.cos(ang) * def.speed; e.vy = Math.sin(ang) * def.speed; }
    run.enemies.push(e);
    run._seen[type] = true;
    if (type === 'firenode') run._fn = true;
    if (type === 'hr') run._hr = true;
    if (elite) run.counts.elites++;
    if (type === 'gilded') run.counts.gilded++;
    ev(run, { type: 'spawn', enemyId: e.id, enemyType: type, x: x, y: y, elite: elite });
    return e;
  }

  function countAlive(run) {
    var n = 0, en = run.enemies;
    for (var i = 0; i < en.length; i++) {
      var e = en[i];
      if (!e.dead && !e.boss && e.type !== 'pylon') n++;
    }
    return n;
  }
  function gildedAlive(run) {
    var en = run.enemies;
    for (var i = 0; i < en.length; i++) if (!en[i].dead && en[i].type === 'gilded') return true;
    return false;
  }

  function spawnRandom(run) {
    var type = pickType(run, false);
    var elite = false;
    if (rnd(run) < run.stats.gildedChance && !gildedAlive(run)) type = 'gilded';
    else if (run.sector >= T.eliteFromSector && rnd(run) < T.eliteChance) elite = true;
    if (type === 'mimic') {           // disguised bots appear on the floor, not at the edge
      var mx, my, mt = 0;
      do {
        mx = 30 + rnd(run) * (run.w - 60); my = 30 + rnd(run) * (run.h - 60); mt++;
      } while (mt < 12 && Math.hypot(mx - run.player.x, my - run.player.y) < 120);
      return spawnEnemy(run, type, mx, my, { elite: elite, entered: true });
    }
    if (type === 'spam') return spawnSpamEdge(run);       // Act III: one roll = one burst of 8
    if (type === 'courier') return spawnCourier(run);
    var side = (rnd(run) * 4) | 0, o = T.spawnOutside, x, y;
    if (side === 0) { x = rnd(run) * run.w; y = -o; }
    else if (side === 1) { x = run.w + o; y = rnd(run) * run.h; }
    else if (side === 2) { x = rnd(run) * run.w; y = run.h + o; }
    else { x = -o; y = rnd(run) * run.h; }
    return spawnEnemy(run, type, x, y, { elite: elite, entered: false });
  }

  // ---- Act III spawns (SPEC 12.4): only reached from Act III mixes / Wardens
  function edgePoint(run, side, along, depth) {
    if (side === 0) return { x: along, y: -depth };
    if (side === 1) return { x: run.w + depth, y: along };
    if (side === 2) return { x: along, y: run.h + depth };
    return { x: -depth, y: along };
  }
  function spawnSpamEdge(run) {
    var side = (rnd(run) * 4) | 0, len = (side & 1) ? run.h : run.w, c = 30 + rnd(run) * (len - 60), k, pt, e, n = EN.spam.burst;
    for (k = 0; k < n; k++) {
      pt = edgePoint(run, side, c + (k - (n - 1) / 2) * T.spamWedge + (rnd(run) - 0.5) * 8, T.spawnOutside + Math.abs(k - (n - 1) / 2) * 6 + rnd(run) * 10);
      e = spawnEnemy(run, 'spam', pt.x, pt.y, { entered: false });
    }
    return e;
  }
  function spawnSpamAt(run, cx, cy) {            // a Warden's burst: a loose cluster around the Warden
    var k, a, d, e, n = EN.spam.burst;
    for (k = 0; k < n; k++) {
      a = rnd(run) * TWO_PI; d = 18 + rnd(run) * 34;
      e = spawnEnemy(run, 'spam', clamp(cx + Math.cos(a) * d, 8, run.w - 8), clamp(cy + Math.sin(a) * d, 8, run.h - 8), { entered: true, roam: true });
    }
    return e;
  }
  function spawnCourier(run) {
    var side = (rnd(run) * 4) | 0, len = (side & 1) ? run.h : run.w, far = (side + 2) & 3, flen = (far & 1) ? run.h : run.w;
    var a = edgePoint(run, side, 20 + rnd(run) * (len - 40), T.spawnOutside), b = edgePoint(run, far, 20 + rnd(run) * (flen - 40), 60);
    var e = spawnEnemy(run, 'courier', a.x, a.y, { entered: false }), dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    e.vx = dx / d * EN.courier.speed; e.vy = dy / d * EN.courier.speed; e.facing = Math.atan2(dy, dx);
    e.leaving = true;                           // flies its line: never clamped, never steered
    return e;
  }

  function hostileDmg(run, base) { return base * run.sec.dmg * (1 - run.stats.plating); }

  // ---------------------------------------------------------------------------
  // pickups
  // ---------------------------------------------------------------------------
  function spawnPickup(run, kind, value, x, y) {
    var pk = run.pickups, i;
    if (kind === 'bolt' && pk.length >= T.pickupCap) {
      for (i = pk.length - 1; i >= 0; i--) {
        if (pk[i].kind === 'bolt') { pk[i].value += value; return; }
      }
    }
    var a = rnd(run) * TWO_PI, s = T.pickupBurstMin + rnd(run) * (T.pickupBurstMax - T.pickupBurstMin);
    pk.push({ id: run._nid++, kind: kind, value: value, x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0 });
  }

  function dropBolts(run, x, y, value) {
    var n = Math.min(value, 1 + Math.floor(rnd(run) * T.maxPieces));
    var per = Math.floor(value / n), rem = value - per * n;
    for (var i = 0; i < n; i++) spawnPickup(run, 'bolt', per + (i < rem ? 1 : 0), x, y);
  }

  function collectPickup(run, pk) {
    var p = run.player;
    var cv = pk.value;
    if (pk.kind === 'bolt') {
      var pm = run.stock.mult * run._payMul * run.compound;
      if (pm !== 1) cv = Math.max(1, Math.round(cv * pm));   // Stock Options / Severance payout
      run.earned.bolts += cv;
    }
    else if (pk.kind === 'core') run.earned.cores += pk.value;
    else if (pk.kind === 'cell') p.battery = Math.min(p.maxBattery, p.battery + T.cellHeal * p.maxBattery);
    ev(run, { type: 'pickup', kind: pk.kind, value: cv, x: pk.x, y: pk.y });
  }

  function updatePickups(run) {
    var arr = run.pickups, p = run.player, st = run.stats, w = 0, i, pk, dx, dy, d2, d, pull;
    var mag = st.magnet, mag2 = mag * mag, cr = p.r + T.pickupPad, cr2 = cr * cr;
    var drones = run.drones, nd = st.collector ? drones.length : 0, k, dd;
    var cr2d = T.collectorRange * T.collectorRange;
    for (i = 0; i < arr.length; i++) {
      pk = arr[i];
      pk.age += TICK;
      if (pk.age >= T.pickupLife) continue;
      pk.vx *= T.pickupFriction; pk.vy *= T.pickupFriction;
      pk.x += pk.vx * TICK; pk.y += pk.vy * TICK;
      if (pk.x < 4) { pk.x = 4; pk.vx = Math.abs(pk.vx); } else if (pk.x > run.w - 4) { pk.x = run.w - 4; pk.vx = -Math.abs(pk.vx); }
      if (pk.y < 4) { pk.y = 4; pk.vy = Math.abs(pk.vy); } else if (pk.y > run.h - 4) { pk.y = run.h - 4; pk.vy = -Math.abs(pk.vy); }
      if (pk.age >= T.pickupDelay) {
        dx = p.x - pk.x; dy = p.y - pk.y; d2 = dx * dx + dy * dy;
        if (d2 < mag2) {
          d = Math.sqrt(d2) || 0.001;
          pull = T.pullBase + (1 - d / mag) * T.pullGain;
          pk.x += dx / d * pull * TICK; pk.y += dy / d * pull * TICK;
          dx = p.x - pk.x; dy = p.y - pk.y; d2 = dx * dx + dy * dy;
        }
        if (d2 < cr2) { collectPickup(run, pk); continue; }
        if (nd) {
          var hit = false;
          for (k = 0; k < nd; k++) {
            dx = drones[k].x - pk.x; dy = drones[k].y - pk.y; dd = dx * dx + dy * dy;
            if (dd < cr2d) { hit = true; break; }
          }
          if (hit) { collectPickup(run, pk); continue; }
        }
      }
      arr[w++] = pk;
    }
    arr.length = w;
  }

  function collectAllPickups(run) {
    var arr = run.pickups;
    for (var i = 0; i < arr.length; i++) collectPickup(run, arr[i]);
    arr.length = 0;
  }

  // ---------------------------------------------------------------------------
  // damage, kills
  // ---------------------------------------------------------------------------
  function hurtPlayer(run, amount, x, y, src) {
    if (run.attract || run._safe || run.over || !(amount > 0)) return;
    var p = run.player;
    p.battery -= amount;
    p.hurt = 0;
    if (src === 'contact' || src === 'laser' || src === 'aura') { run._cAcc += amount; run._cX = x; run._cY = y; run._cSrc = src; }
    else ev(run, { type: 'hurt', amount: amount, x: x, y: y, src: src });
  }

  function damageEnemy(run, e, dmg, crit, ignoreArmor, depth) {
    if (e.dead || e.invuln || e.disguised) return;
    var armored = false;
    if (e.armor > 0 && !crit && !ignoreArmor) { dmg *= (1 - e.armor); armored = true; }
    if (e.boss) dmg *= run.stats.wardenMult * run.boss.vol;        // Due Diligence; Market volatility (both 1 otherwise)
    else if (e.pyl) dmg *= run.stats.wardenMult;
    e.hp -= dmg;
    e.flash = 0.12;
    ev(run, { type: 'hit', x: e.x, y: e.y, dmg: dmg, crit: !!crit, armored: armored, enemyId: e.id });
    if (e.boss) run.boss.hp = e.hp > 0 ? e.hp : 0;
    if (e.hp <= 0) killEnemy(run, e, depth);
  }

  function startWarning(run) {
    var b = run.boss;
    b.state = 'warning';
    b.warn = T.warn;
    ev(run, { type: 'bossWarn', name: b.name, dur: T.warn });
  }

  function killEnemy(run, e, depth) {
    e.dead = true;
    if (e.hp > 0) e.hp = 0;
    if (e.boss) { bossKilled(run, e); return; }
    var def = EN[e.type], st = run.stats, sec = run.sec, p = run.player, b = run.boss, c = run.counts;
    c.kills++;

    var bolts = 0;
    if (def.bolts > 0) {
      var bm = def.bolts * sec.bolts * st.boltMult * (e.elite ? T.eliteBolts : 1);
      if (e.copy) bm *= EN.copier.copy.bolts;      // Photocopier copies pay half
      bolts = Math.max(1, Math.round(bm));
      dropBolts(run, e.x, e.y, bolts);
    }
    if (def.cellChance && rnd(run) < def.cellChance) spawnPickup(run, 'cell', 0, e.x, e.y);
    if (e.elite && st.eliteCoreChance > 0 && rnd(run) < st.eliteCoreChance) spawnPickup(run, 'core', 1, e.x, e.y);

    ev(run, { type: 'kill', x: e.x, y: e.y, r: e.r, enemyType: e.type, elite: e.elite, boss: false, bolts: bolts });

    if (e.stolen > 0) {               // Repo Bot scrapped while carrying: the haul comes back with interest
      var refund = Math.max(1, Math.round(def.steal.refund * e.stolen));
      e.stolen = 0;
      dropBolts(run, e.x, e.y, refund);
      ev(run, { type: 'refund', x: e.x, y: e.y, bolts: refund });
    }

    // signal
    if (b.state === 'none' && !run.attract && !b.blocked && e.sig > 0) {
      b.signal += e.sig;
      if (b.signal >= b.need) { b.signal = b.need; startWarning(run); }
    }

    if (e.type !== 'pylon') {
      // combo
      var cb = run.combo;
      cb.n++; cb.t = 0;
      if (cb.n > c.bestCombo) c.bestCombo = cb.n;
      if (cb.n % T.comboEvery === 0) ev(run, { type: 'combo', n: cb.n });
      if (st.stockStep > 0 && cb.n % T.stockEvery === 0) stockStep(run);
      run._lastKillT = run.t;
      if (st.expenseStep > 0 && cb.n >= L.expense.combo && run.expense < st.expenseCap) {   // Expense Account
        var ex = Math.min(st.expenseStep, st.expenseCap - run.expense);
        run.expense += ex; p.battery = Math.min(p.maxBattery, p.battery + ex);
      }
      // recycle
      if (st.recycle > 0) p.battery = Math.min(p.maxBattery, p.battery + st.recycle);
      // overclock charge
      var oc = p.oc;
      if (oc.unlocked && !oc.active) {
        oc.charge += T.ocPerKill;
        if (oc.charge >= 1 - 1e-6) {   // epsilon: N kills of 1/N must trigger
          oc.charge = 1; oc.active = true; oc.time = oc.dur;
          ev(run, { type: 'ocStart', dur: oc.dur });
        }
      }
    }

    // Act II, owned features only
    if (st.rehireChance > 0 && e.type !== 'pylon' && rnd(run) < st.rehireChance) spawnIntern(run, e.x, e.y);
    if (e.infected > 0 && st.naniteDps > 0) {
      var ne = run.enemies, nj = T.naniteJump, nd2, no;
      for (var q = 0; q < ne.length; q++) {
        no = ne[q];
        if (no === e || no.dead || no.invuln || no.disguised) continue;
        nd2 = Math.hypot(no.x - e.x, no.y - e.y);
        if (nd2 <= nj + no.r) infect(run, no);
      }
    }

    // Restructuring (Act III): a chain of bursts, at most T.burstMax per second
    if (st.burstChance > 0 && e.type !== 'pylon' && !e.pyl && depth < T.chainDepth && rnd(run) < st.burstChance) burst(run, e, depth);

    // splitter
    if (def.split) {
      for (var s = 0; s < def.split.n; s++) {
        var a = rnd(run) * TWO_PI;
        var m = spawnEnemy(run, def.split.type, e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, { entered: true, roam: true });
        m.vx = Math.cos(a) * EN[m.type].speed; m.vy = Math.sin(a) * EN[m.type].speed;
      }
    }

    if (depth >= T.chainDepth) return;
    var i, o, dx, dy, d2, en = run.enemies, rr;

    // bomber blast when shot down
    if (def.behaviour === 'bomber') {
      ev(run, { type: 'explode', x: e.x, y: e.y, r: def.blastR, src: 'bomber' });
      var bd = def.blastMul * e.maxHp;
      for (i = 0; i < en.length; i++) {
        o = en[i];
        if (o.dead || o.invuln) continue;
        dx = o.x - e.x; dy = o.y - e.y; rr = def.blastR + o.r;
        if (dx * dx + dy * dy <= rr * rr) damageEnemy(run, o, bd, false, true, depth + 1);
      }
    }
    // chain
    if (st.chainPct > 0) {
      var best = null, bestD = T.chainRange * T.chainRange;
      for (i = 0; i < en.length; i++) {
        o = en[i];
        if (o.dead || o.invuln || o.disguised) continue;
        dx = o.x - e.x; dy = o.y - e.y; d2 = dx * dx + dy * dy;
        if (d2 <= bestD) { bestD = d2; best = o; }
      }
      if (best) {
        ev(run, { type: 'zap', x1: e.x, y1: e.y, x2: best.x, y2: best.y, crit: false, src: 'chain' });
        damageEnemy(run, best, st.chainPct * st.damage, false, true, depth + 1);
      }
    }
    // overload
    if (st.overloadPct > 0) {
      ev(run, { type: 'explode', x: e.x, y: e.y, r: T.overloadRange, src: 'overload' });
      var od = st.overloadPct * e.maxHp;
      for (i = 0; i < en.length; i++) {
        o = en[i];
        if (o.dead || o.invuln) continue;
        dx = o.x - e.x; dy = o.y - e.y; rr = T.overloadRange + o.r;
        if (dx * dx + dy * dy <= rr * rr) damageEnemy(run, o, od, false, true, depth + 1);
      }
    }
  }

  function burst(run, e, depth) {
    if (run.t - run._burstT >= 1) { run._burstT = run.t; run._burstN = 0; }
    if (run._burstN >= T.burstMax) return;
    run._burstN++;
    var R = L.restructure.r, en = run.enemies, n0 = en.length, i, o, dx, dy, rr, hit = [];
    for (i = 0; i < n0; i++) {
      o = en[i];
      if (o === e || o.dead || o.invuln || o.disguised) continue;
      dx = o.x - e.x; dy = o.y - e.y; rr = R + o.r;
      if (dx * dx + dy * dy <= rr * rr) hit.push(o);
    }
    ev(run, { type: 'burst', x: e.x, y: e.y, r: R, n: hit.length });
    for (i = 0; i < hit.length; i++) damageEnemy(run, hit[i], L.restructure.mult * run.stats.damage, false, true, depth + 1);
  }

  function bossKilled(run, e) {
    var def = BOSS[e.type], st = run.stats, sec = run.sec, b = run.boss, i, en = run.enemies;
    b.state = 'dead'; b.hp = 0;
    collectAllPickups(run);
    var bolts = Math.round((run.overtime > 0 ? run._boltBase : def.bolts) * st.boltMult * run._bossBolts);
    var cores = run._first ? sec.coresFirst : sec.coresRepeat;
    if (cores > 0) cores += Math.min(st.bossCoreBonus, cores);   // Core Extractor: up to double
    run.earned.bolts += bolts;
    run.earned.cores += cores;
    run.counts.kills++;
    if (b.clawed > 0) {                 // the Comptroller's / Founder's clawback comes back with interest
      var back = Math.max(1, Math.round(b.clawed * 1.5));
      b.clawed = 0; run.clawed = 0;
      dropBolts(run, e.x, e.y, back);
      ev(run, { type: 'refund', x: e.x, y: e.y, bolts: back });
    }
    run.shots.length = 0;
    run.hazards.length = 0;
    run.strikes.length = 0;
    run._pend.length = 0;
    setBudget(run, 0);
    for (i = 0; i < en.length; i++) {
      if (en[i].type === 'pylon' || en[i].pyl) en[i].dead = true;
      en[i].windup = 0;
    }
    ev(run, { type: 'kill', x: e.x, y: e.y, r: e.r, enemyType: e.type, elite: false, boss: true, bolts: bolts });
    ev(run, { type: 'bossDead', x: e.x, y: e.y, name: def.name, bolts: bolts, cores: cores });
    ev(run, { type: 'sectorClear', sector: run.sector, first: run.overtime > 0 ? false : run._first });
    if (run.overtime > 0) ev(run, { type: 'overtime', level: run.overtime });
    run._safe = true;
    run._victoryT = T.victoryDelay;
  }

  // ---------------------------------------------------------------------------
  // boss
  // ---------------------------------------------------------------------------
  function spawnBoss(run) {
    var b = run.boss, def = BOSS[b.id], p = run.player;
    var bhp = (run.overtime > 0 ? run._hpBase : def.hp) * run._bossHp;   // Overtime: the Founder's hp for every Warden
    var e = {
      id: run._nid++, type: def.id, x: run.w / 2, y: T.bossY + def.r, vx: 0, vy: 0, r: def.r,
      hp: bhp, maxHp: bhp, armor: 0, elite: false, boss: true, hostile: true, invuln: false,
      flash: 0, age: 0, facing: Math.PI / 2, planted: false, windup: 0,
      sig: 0, entered: true, wx: 0, wy: 0, wt: 0, st: 0, side: 1, dead: false, leaving: false,
      at: [], shDone: [], hz: 0, dashT: 0, dx: 0, dy: 0, dashSp: 0, dashDmg: 0, dashHit: false,
      disguised: false, shieldedBy: null, stolen: 0, infected: 0, shielded: false, blinking: false, pyl: false,
      leaveAt: 0, dot: 0, dotT: 0, bt: def.blink ? def.blink.every * T.bossFirstAttack : 0
    };
    var i, ph = def.phases ? def.phases[0].cadence : 1;
    for (i = 0; i < def.attacks.length; i++) e.at.push(NOTIMER[def.attacks[i].kind] ? 0 : def.attacks[i].every * ph * T.bossFirstAttack);
    if (def.shields) for (i = 0; i < def.shields.length; i++) e.shDone.push(false);
    run.enemies.push(e);
    run._seen[def.id] = true;
    run._heat0 = run.t;   // the heat sag restarts when the Warden arrives (T.bossHeatReset)
    b.state = 'active'; b.warn = 0; b.enemyId = e.id; b.hp = e.hp; b.maxHp = e.maxHp; b.phase = 1;
    e.phase = b.phase;   // the engine owns the boss phase on the enemy too; the renderer only reads it
    p.battery = Math.min(p.maxBattery, p.battery + T.reserve * p.maxBattery);
    ev(run, { type: 'bossSpawn', enemyId: e.id, name: def.name });
    if (def.id === 'founder') ev(run, { type: 'founder', phase: 1 });
    return e;
  }

  function findEnemy(run, id) {
    var en = run.enemies;
    for (var i = 0; i < en.length; i++) if (en[i].id === id) return en[i];
    return null;
  }

  function fireShot(run, x, y, ang, speed, dmg) {
    if (run.shots.length >= T.shotCap) return;
    run.shots.push({ id: run._nid++, x: x, y: y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
                     r: T.shotRadius, age: 0, dmg: dmg });
  }

  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var ex = px - (x1 + dx * t), ey = py - (y1 + dy * t);
    return Math.sqrt(ex * ex + ey * ey);
  }

  // attack kinds that are auras / modifiers, not timers
  var NOTIMER = { budget: 1, aura: 1, volatility: 1 };
  var HAS_BUDGET = {}, HAS_MOD = {};
  (function () {
    for (var k in BOSS) {
      HAS_BUDGET[k] = false; HAS_MOD[k] = false;
      for (var j = 0; j < BOSS[k].attacks.length; j++) {
        if (BOSS[k].attacks[j].kind === 'budget') HAS_BUDGET[k] = true;
        if (BOSS[k].attacks[j].kind === 'aura' || BOSS[k].attacks[j].kind === 'volatility') HAS_MOD[k] = true;
      }
    }
  })();

  function setBudget(run, perSec) {
    var on = perSec > 0;
    run._bud = perSec;
    if (on !== run.player.budget) {
      run.player.budget = on;
      ev(run, { type: 'budget', on: on });
    }
  }

  // a laser lane from (x,y) along ang, clipped to the arena edge. dmg is per second.
  function pushLaser(run, o, ang, windup, fire, w, dmg, ai) {
    if (run.hazards.length >= T.hazardCap) return;
    var c = Math.cos(ang), s = Math.sin(ang), t = 1e9, x = o.x, y = o.y;
    if (c > 1e-9) t = Math.min(t, (run.w - x) / c); else if (c < -1e-9) t = Math.min(t, -x / c);
    if (s > 1e-9) t = Math.min(t, (run.h - y) / s); else if (s < -1e-9) t = Math.min(t, -y / s);
    if (!(t > 0) || t > 5000) t = 0;
    run.hazards.push({ id: run._nid++, kind: 'laser', x: x, y: y, r: 0, x2: x + c * t, y2: y + s * t, w: w,
                       t: 0, dur: windup, fire: fire, firing: false, oid: o.id, ai: ai, dmg: dmg });
    ev(run, { type: 'telegraph', kind: 'laser', x: x, y: y, r: w, dur: windup });
  }

  function launchSlam(run, a, oid, ai, x, y) {
    if (run.hazards.length >= T.hazardCap) return;
    x = clamp(x, 0, run.w); y = clamp(y, 0, run.h);
    run.hazards.push({ id: run._nid++, kind: 'slam', x: x, y: y, r: a.r, x2: 0, y2: 0, w: 0, t: 0, dur: a.windup,
                       oid: oid, ai: ai, dmg: hostileDmg(run, a.dmg), bar: true });
    ev(run, { type: 'telegraph', kind: 'slam', x: x, y: y, r: a.r, dur: a.windup });
  }

  // one slam of a barrage; q = { at, oid, ai, a, i, cx, cy }
  function launchBarrage(run, q) {
    var a = q.a, p = run.player, x, y;
    if (a.pattern === 'grid') {
      var rows = Math.ceil(a.n / 3);
      x = q.cx + ((q.i % 3) - 1) * a.spread;
      y = q.cy + (Math.floor(q.i / 3) - (rows - 1) / 2) * a.spread;
    } else {
      var ang = rnd(run) * TWO_PI, rad = rnd(run) * a.spread;
      x = p.x + Math.cos(ang) * rad; y = p.y + Math.sin(ang) * rad;
    }
    launchSlam(run, a, q.oid, q.ai, x, y);
  }

  function startBlink(run, e, bl) {
    var p = run.player, tries = 0, x, y, ang, d, m = e.r + 4;
    do {
      ang = rnd(run) * TWO_PI; d = T.blinkMin + rnd(run) * (T.blinkMax - T.blinkMin);
      x = clamp(p.x + Math.cos(ang) * d, m, run.w - m); y = clamp(p.y + Math.sin(ang) * d, m, run.h - m);
      tries++;
    } while (tries < 8 && Math.hypot(x - p.x, y - p.y) < T.blinkMin * 0.9);
    pushBlink(run, e, x, y, bl.windup);
  }
  function pushBlink(run, e, x, y, windup) {
    if (run.hazards.length >= T.hazardCap) return;
    run.hazards.push({ id: run._nid++, kind: 'blink', x: x, y: y, r: e.r, x2: 0, y2: 0, w: 0, t: 0, dur: windup,
                       oid: e.id, ai: -1, dmg: 0 });
    e.blinking = true; e.invuln = true;
    ev(run, { type: 'telegraph', kind: 'blink', x: x, y: y, r: e.r, dur: windup });
  }

  // ---- Act III hazards (SPEC 12.5)
  function pushHold(run, e, a, idx, x, y) {
    if (run.hazards.length >= T.hazardCap) return;
    x = clamp(x, 0, run.w); y = clamp(y, 0, run.h);
    run.hazards.push({ id: run._nid++, kind: 'hold', x: x, y: y, r: a.r, x2: 0, y2: 0, w: 0, t: 0, dur: a.windup,
                       oid: e.id, ai: idx, dmg: hostileDmg(run, a.dmg), stun: a.stun, bar: true });
    ev(run, { type: 'telegraph', kind: 'hold', x: x, y: y, r: a.r, dur: a.windup });
  }
  function injunctionCount(run) {
    var n = 0, hz = run.hazards;
    for (var i = 0; i < hz.length; i++) if (hz[i].kind === 'injunction') n++;
    return n;
  }
  function pushInjunction(run, e, a, idx, x, y) {
    if (run.hazards.length >= T.hazardCap || injunctionCount(run) >= T.injunctionMax) return false;
    x = clamp(x, 0, run.w); y = clamp(y, 0, run.h);
    var r = a.r * run.stats.injunctionR;
    run.hazards.push({ id: run._nid++, kind: 'injunction', x: x, y: y, r: r, x2: 0, y2: 0, w: 0, t: 0, dur: a.windup, life: a.life,
                       active: false, oid: e.id, ai: idx, dmg: 0, bar: !!e.boss });
    ev(run, { type: 'telegraph', kind: 'injunction', x: x, y: y, r: r, dur: a.windup });
    return true;
  }

  function updateBoss(run, e) {
    var def = BOSS[e.type], p = run.player, b = run.boss, dt = TICK, i, a;
    var dx = p.x - e.x, dy = p.y - e.y, dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    e.facing = Math.atan2(dy, dx);

    // shields
    if (def.shields) {
      var ptype = def.pylonType || 'pylon';
      if (e.shielded) {
        var alive = 0, en = run.enemies;
        for (i = 0; i < en.length; i++) {
          if (en[i].dead) continue;
          if (ptype === 'pylon' ? en[i].type === 'pylon' : (en[i].pyl && en[i].type === ptype)) alive++;
        }
        if (alive === 0) { e.shielded = false; e.invuln = e.blinking; ev(run, { type: 'shield', on: false }); }
      } else {
        for (i = 0; i < def.shields.length; i++) {
          if (!e.shDone[i] && e.hp <= def.shields[i] * e.maxHp) {
            e.shDone[i] = true;
            e.invuln = true; e.shielded = true;
            var base = rnd(run) * TWO_PI, np = def.pylons || T.shieldPylons;
            for (var k = 0; k < np; k++) {
              var ang = base + k * TWO_PI / np;
              var px = clamp(e.x + Math.cos(ang) * T.shieldRing, 24, run.w - 24);
              var py = clamp(e.y + Math.sin(ang) * T.shieldRing, 24, run.h - 24);
              var pyl = spawnEnemy(run, ptype, px, py, { entered: true });
              pyl.pyl = true; pyl.wx = px; pyl.wy = py;
              if (def.pylonFrac) { pyl.hp = pyl.maxHp = def.pylonFrac * e.maxHp; }
              else if (run._fat > 0) { pyl.hp *= 1 - run._fat; pyl.maxHp *= 1 - run._fat; }   // pylon strength follows the Warden, not the sector
            }
            ev(run, { type: 'shield', on: true });
            break;
          }
        }
      }
    }

    // phases
    var cadence = 1;
    if (def.phases) {
      var frac = e.hp / e.maxHp, ph = 1;
      for (i = 1; i < def.phases.length; i++) if (frac <= def.phases[i].hp) ph = i + 1;
      if (ph !== b.phase) {
        b.phase = ph; e.phase = ph;
        ev(run, { type: 'bossPhase', phase: ph });
        if (e.type === 'founder') ev(run, { type: 'founder', phase: ph });
        var cad = def.phases[ph - 1].cadence;
        for (i = 0; i < def.attacks.length; i++) {
          a = def.attacks[i];
          if (NOTIMER[a.kind]) continue;
          if (a.phases && a.phases.indexOf(ph) < 0) continue;
          var cap = a.every * cad;
          if (e.at[i] > cap) e.at[i] = cap;
          if (a.phases && a.phases.indexOf(ph - 1) < 0) e.at[i] = cap * T.bossFirstAttack;
        }
      }
      cadence = def.phases[ph - 1].cadence;
    }

    // budget aura (VP, Chairman): extra battery drain while in a listed phase
    if (HAS_BUDGET[e.type]) {
      var bud = 0;
      for (i = 0; i < def.attacks.length; i++) {
        a = def.attacks[i];
        if (a.kind === 'budget' && (!a.phases || a.phases.indexOf(b.phase) >= 0)) bud += a.perSec;
      }
      setBudget(run, bud * run.sec.dmg);
    }

    // Act III modifiers: Market volatility (damage taken x m(t)) and the Founder's aura
    var auraR = 0, auraDps = 0;
    if (HAS_MOD[e.type]) {
      var vol = 1;
      for (i = 0; i < def.attacks.length; i++) {
        a = def.attacks[i];
        if (a.phases && a.phases.indexOf(b.phase) < 0) continue;
        if (a.kind === 'volatility') vol = (a.lo + a.hi) / 2 + (a.hi - a.lo) / 2 * Math.sin(TWO_PI * e.age / a.period);
        else if (a.kind === 'aura' && a.r > auraR) { auraR = a.r; auraDps = a.dps; }
      }
      b.vol = vol; b.aura = auraR;
    }

    // blinking: invulnerable, untouchable and idle until it lands
    if (e.blinking) { e.vx = 0; e.vy = 0; return; }
    if (auraR > 0 && dist < auraR) hurtPlayer(run, hostileDmg(run, auraDps) * dt, p.x, p.y, 'aura');

    // movement
    var mv = (def.moveByPhase && def.moveByPhase[b.phase]) || def.move;
    if (e.dashT > 0) {
      e.dashT -= dt;
      e.x = clamp(e.x + e.dx * e.dashSp * dt, e.r, run.w - e.r);
      e.y = clamp(e.y + e.dy * e.dashSp * dt, e.r, run.h - e.r);
      e.vx = e.dx * e.dashSp; e.vy = e.dy * e.dashSp;
      if (!e.dashHit && dist < e.r + p.r) {
        e.dashHit = true;
        hurtPlayer(run, e.dashDmg, p.x, p.y, 'charge');
      }
    } else {
      if ((def.move === 'chase' || (mv === 'blink' && def.speed > 0)) && e.hz === 0) {
        e.vx = dx / dist * def.speed; e.vy = dy / dist * def.speed;
        e.x = clamp(e.x + e.vx * dt, e.r, run.w - e.r);
        e.y = clamp(e.y + e.vy * dt, e.r, run.h - e.r);
      } else if (def.move === 'drift') {        // Receptionist: wanders the top of the floor
        e.wt -= dt;
        if (e.wt <= 0 || (e.wx === 0 && e.wy === 0)) {
          e.wx = e.r + rnd(run) * (run.w - 2 * e.r); e.wy = e.r + T.bossY + rnd(run) * (run.h * 0.45 - e.r); e.wt = T.driftWaitMin + rnd(run) * (T.driftWaitMax - T.driftWaitMin);
        }
        var ddx = e.wx - e.x, ddy = e.wy - e.y, ddd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (ddd > 4) {
          e.vx = ddx / ddd * def.speed; e.vy = ddy / ddd * def.speed;
          e.x = clamp(e.x + e.vx * dt, e.r, run.w - e.r); e.y = clamp(e.y + e.vy * dt, e.r, run.h - e.r);
        } else { e.vx = 0; e.vy = 0; }
      } else { e.vx = 0; e.vy = 0; }
      if (def.contact > 0 && dist < e.r + p.r) hurtPlayer(run, hostileDmg(run, def.contact) * dt, p.x, p.y, 'contact');
    }

    // teleport (Inspector; Chairman in its last phase)
    if (mv === 'blink' && def.blink && e.dashT <= 0 && e.hz === 0) {
      e.bt -= dt;
      if (e.bt <= 0) { e.bt = def.blink.every; startBlink(run, e, def.blink); return; }
    }

    // attacks
    for (i = 0; i < def.attacks.length; i++) {
      a = def.attacks[i];
      if (NOTIMER[a.kind]) continue;
      if (a.phases && a.phases.indexOf(b.phase) < 0) continue;
      e.at[i] -= dt;
      if (e.at[i] > 0) continue;
      var busy = e.hz !== 0 || e.dashT > 0;
      if ((a.kind === 'slam' || a.kind === 'charge') && busy) continue;
      e.at[i] = a.every * cadence;
      fireAttack(run, e, a, i, dist, dx, dy);
    }
  }

  function fireAttack(run, e, a, idx, dist, dx, dy) {
    var p = run.player, h, k, n, ang;
    if (a.kind === 'slam') {
      h = { id: run._nid++, kind: 'slam', x: p.x, y: p.y, r: a.r, x2: 0, y2: 0, w: 0, t: 0, dur: a.windup,
            oid: e.id, ai: idx, dmg: hostileDmg(run, a.dmg) };
      run.hazards.push(h);
      e.hz = h.id;
      ev(run, { type: 'telegraph', kind: 'slam', x: h.x, y: h.y, r: h.r, dur: h.dur });
    } else if (a.kind === 'charge') {
      var ux = dx / dist, uy = dy / dist, len = Math.min(dist + T.dashOver, T.dashMax);
      h = { id: run._nid++, kind: 'charge', x: e.x, y: e.y, r: e.r, x2: e.x + ux * len, y2: e.y + uy * len, w: e.r * 2,
            t: 0, dur: a.windup, oid: e.id, ai: idx, dmg: hostileDmg(run, a.dmg), sp: a.speed };
      run.hazards.push(h);
      e.hz = h.id;
      ev(run, { type: 'telegraph', kind: 'charge', x: e.x, y: e.y, r: e.r, dur: h.dur });
    } else if (a.kind === 'ring') {
      n = a.n;
      ang = rnd(run) * TWO_PI;
      var dm = hostileDmg(run, a.dmg);
      for (k = 0; k < n; k++) fireShot(run, e.x, e.y, ang + k * TWO_PI / n, a.speed, dm);
      ev(run, { type: 'shot', x: e.x, y: e.y });
    } else if (a.kind === 'summon') {
      if (countAlive(run) >= T.bossSummonCap) return;
      for (k = 0; k < a.n; k++) {
        if (a.type === 'spam') { spawnSpamAt(run, e.x, e.y); continue; }       // one burst per count
        if (a.type === 'courier') { spawnCourier(run); continue; }
        ang = rnd(run) * TWO_PI;
        var dd = e.r + 14 + rnd(run) * 20;
        var m = spawnEnemy(run, a.type, clamp(e.x + Math.cos(ang) * dd, 12, run.w - 12),
                           clamp(e.y + Math.sin(ang) * dd, 12, run.h - 12), { entered: true, roam: true });
        if (a.type === 'roller') { m.vx = Math.cos(ang) * EN.roller.speed; m.vy = Math.sin(ang) * EN.roller.speed; }
      }
    } else if (a.kind === 'barrage') {
      var q = { at: 0, oid: e.id, ai: idx, a: a, i: 0, cx: p.x, cy: p.y };
      launchBarrage(run, q);
      for (k = 1; k < a.n; k++) run._pend.push({ at: run.t + a.gap * k, oid: e.id, ai: idx, a: a, i: k, cx: q.cx, cy: q.cy });
    } else if (a.kind === 'laser') {
      var base = Math.atan2(p.y - e.y, p.x - e.x), dl = hostileDmg(run, a.dmg);
      for (k = 0; k < a.n; k++) pushLaser(run, e, base + (k - (a.n - 1) / 2) * (a.fan || 0), a.windup, a.fire, a.w, dl, idx);
    } else if (a.kind === 'hold') {
      for (k = 0; k < a.n; k++) {
        var hx = p.x, hy = p.y;
        if (k > 0) { ang = rnd(run) * TWO_PI; var hr = rnd(run) * a.spread; hx += Math.cos(ang) * hr; hy += Math.sin(ang) * hr; }
        pushHold(run, e, a, idx, hx, hy);
      }
    } else if (a.kind === 'injunction') {
      for (k = 0; k < a.n; k++) {
        var ix = p.x, iy = p.y;
        if (k > 0) { ang = rnd(run) * TWO_PI; var ir = rnd(run) * 120; ix += Math.cos(ang) * ir; iy += Math.sin(ang) * ir; }
        if (!pushInjunction(run, e, a, idx, ix, iy)) break;
      }
    } else if (a.kind === 'clawback') {
      var amt = Math.floor(run.earned.bolts * a.pct * run.stats.clawMult);
      if (amt > 0) {
        run.earned.bolts -= amt; run.boss.clawed += amt; run.clawed = run.boss.clawed;
        ev(run, { type: 'clawback', bolts: amt });
      }
    }
  }

  function updateHazards(run) {
    var hz = run.hazards, w = 0, p = run.player, i, h, o, pd = run._pend;
    p.enjoined = false;
    if (pd.length) {                    // queued barrage slams
      var pw = 0, q;
      for (i = 0; i < pd.length; i++) {
        q = pd[i];
        if (run.t + 1e-9 >= q.at) { o = findEnemy(run, q.oid); if (o && !o.dead) launchBarrage(run, q); }
        else pd[pw++] = q;
      }
      pd.length = pw;
    }
    for (i = 0; i < hz.length; i++) {
      h = hz[i];
      h.t += TICK;
      o = findEnemy(run, h.oid);
      if (!o || o.dead) continue;
      if (h.kind === 'laser') {
        if (!h.firing && h.t >= h.dur) {
          h.firing = true; o.windup = 0;
          ev(run, { type: 'laser', x: h.x, y: h.y, x2: h.x2, y2: h.y2, w: h.w });
        }
        if (h.firing) {
          if (h.t >= h.dur + h.fire) continue;
          if (segDist(p.x, p.y, h.x, h.y, h.x2, h.y2) < h.w / 2 + p.r) hurtPlayer(run, h.dmg * TICK, p.x, p.y, 'laser');
        } else if (!o.boss) o.windup = h.t / h.dur;
        hz[w++] = h;
        continue;
      }
      if (h.kind === 'hold') {
        if (h.t >= h.dur) {
          var hdx = p.x - h.x, hdy = p.y - h.y;
          if (hdx * hdx + hdy * hdy <= h.r * h.r) {
            p.held = Math.max(p.held, h.stun * run.stats.holdMult);
            ev(run, { type: 'hold', x: h.x, y: h.y, r: h.r });
            hurtPlayer(run, h.dmg, p.x, p.y, 'hold');
          }
          continue;
        }
        hz[w++] = h;
        continue;
      }
      if (h.kind === 'injunction') {
        if (!h.active && h.t >= h.dur) {
          h.active = true; if (!h.bar) o.windup = 0;
          ev(run, { type: 'injunction', x: h.x, y: h.y, r: h.r });
        }
        if (h.active) {
          if (h.t >= h.dur + h.life) continue;
          var jdx = p.x - h.x, jdy = p.y - h.y;
          if (jdx * jdx + jdy * jdy <= h.r * h.r) p.enjoined = true;
        } else if (!h.bar) o.windup = h.t / h.dur;
        hz[w++] = h;
        continue;
      }
      if (h.kind === 'blink') {
        if (h.t >= h.dur) {
          o.x = h.x; o.y = h.y; o.vx = 0; o.vy = 0; o.blinking = false; o.windup = 0;
          o.invuln = o.shielded || o.shieldedBy !== null;
          ev(run, { type: 'blink', enemyId: o.id, x: o.x, y: o.y });
          var od = EN[o.type];
          if (!o.boss && od && od.audit) {   // Auditor: land, then slam Sprocket's spot
            var sl = od.audit.slam;
            if (run.hazards.length < T.hazardCap && hz.length < T.hazardCap + 4) {
              hz.push({ id: run._nid++, kind: 'slam', x: p.x, y: p.y, r: sl.r, x2: 0, y2: 0, w: 0, t: 0, dur: sl.windup,
                        oid: o.id, ai: -1, dmg: hostileDmg(run, sl.dmg) });
              ev(run, { type: 'telegraph', kind: 'slam', x: p.x, y: p.y, r: sl.r, dur: sl.windup });
            }
          }
          continue;
        }
        o.windup = h.t / h.dur;
        hz[w++] = h;
        continue;
      }
      if (h.t >= h.dur) {
        if (o.hz === h.id) o.hz = 0;
        if (!h.bar) o.windup = 0;
        if (h.kind === 'slam') {
          ev(run, { type: 'slam', x: h.x, y: h.y, r: h.r });
          var dx = p.x - h.x, dy = p.y - h.y;
          if (dx * dx + dy * dy <= h.r * h.r) hurtPlayer(run, h.dmg, p.x, p.y, 'slam');
        } else {
          var len = Math.hypot(h.x2 - h.x, h.y2 - h.y) || 1;
          o.dx = (h.x2 - h.x) / len; o.dy = (h.y2 - h.y) / len;
          o.dashSp = h.sp; o.dashT = len / h.sp; o.dashHit = false; o.dashDmg = h.dmg;
        }
        continue;
      }
      if (!h.bar) o.windup = h.t / h.dur;
      hz[w++] = h;
    }
    hz.length = w;
  }

  function updateShots(run) {
    var sh = run.shots, w = 0, p = run.player, i, s, dx, dy, rr;
    for (i = 0; i < sh.length; i++) {
      s = sh[i];
      s.x += s.vx * TICK; s.y += s.vy * TICK; s.age += TICK;
      if (s.x < -20 || s.x > run.w + 20 || s.y < -20 || s.y > run.h + 20) continue;
      dx = p.x - s.x; dy = p.y - s.y; rr = p.r + s.r;
      if (dx * dx + dy * dy < rr * rr) { hurtPlayer(run, s.dmg, s.x, s.y, 'shot'); continue; }
      sh[w++] = s;
    }
    sh.length = w;
  }

  // ---------------------------------------------------------------------------
  // regular enemy behaviour
  // ---------------------------------------------------------------------------
  function steerTo(e, tx, ty, sp) {
    var dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < T.driftArrive) { e.vx = 0; e.vy = 0; return true; }
    e.vx = dx / d * sp; e.vy = dy / d * sp;
    e.x += e.vx * TICK; e.y += e.vy * TICK;
    e.facing = Math.atan2(e.vy, e.vx);
    return false;
  }

  function settle(run, e) {
    if (e.leaving) return;
    if (e.entered) {
      if (e.x < e.r) e.x = e.r; else if (e.x > run.w - e.r) e.x = run.w - e.r;
      if (e.y < e.r) e.y = e.r; else if (e.y > run.h - e.r) e.y = run.h - e.r;
    } else if (e.x >= e.r && e.x <= run.w - e.r && e.y >= e.r && e.y <= run.h - e.r) {
      e.entered = true;
    }
  }

  function newWaypoint(run, e) {
    var m = T.driftMargin;
    e.wx = m + rnd(run) * (run.w - 2 * m);
    e.wy = m + rnd(run) * (run.h - 2 * m);
    e.wt = T.driftWaitMin + rnd(run) * (T.driftWaitMax - T.driftWaitMin);
  }

  function explodeBomber(run, e, def) {
    var p = run.player;
    e.dead = true;
    ev(run, { type: 'explode', x: e.x, y: e.y, r: def.blastR, src: 'bomber' });
    hurtPlayer(run, hostileDmg(run, def.contactDmg), p.x, p.y, 'bomb');
  }

  function updateEnemies(run) {
    var en = run.enemies, p = run.player, i, e, def, dx, dy, dist, sp, d;
    if (run._hr) run.heals.length = 0;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead) continue;
      e.age += TICK;
      if (e.flash > 0) { e.flash -= TICK; if (e.flash < 0) e.flash = 0; }
      if (e.boss) { updateBoss(run, e); continue; }
      def = EN[e.type];
      sp = def.speed;
      dx = p.x - e.x; dy = p.y - e.y;
      dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      switch (def.behaviour) {
        case 'drift':
          if (!e.entered) steerTo(e, e.wx, e.wy, sp);
          else {
            e.wt -= TICK;
            if (e.wt <= 0) newWaypoint(run, e);
            steerTo(e, e.wx, e.wy, sp);
          }
          break;
        case 'roll':
          e.x += e.vx * TICK; e.y += e.vy * TICK;
          e.facing = Math.atan2(e.vy, e.vx);
          if (e.entered) {
            if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
            else if (e.x > run.w - e.r) { e.x = run.w - e.r; e.vx = -Math.abs(e.vx); }
            if (e.y < e.r) { e.y = e.r; e.vy = Math.abs(e.vy); }
            else if (e.y > run.h - e.r) { e.y = run.h - e.r; e.vy = -Math.abs(e.vy); }
          }
          break;
        case 'chase':
        case 'bomber':
          e.vx = dx / dist * sp; e.vy = dy / dist * sp;
          e.x += e.vx * TICK; e.y += e.vy * TICK;
          e.facing = Math.atan2(e.vy, e.vx);
          break;
        case 'flee':
          updateFlee(run, e, def, dx, dy, dist);
          break;
        case 'plant':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, sp) && e.entered) {
              e.planted = true;
              e.st = T.sentryFirstMin + rnd(run) * (T.sentryFirstMax - T.sentryFirstMin);
            }
          } else {
            e.facing = Math.atan2(dy, dx);
            e.st -= TICK;
            if (e.st <= 0) {
              e.st = def.shoot.every;
              fireShot(run, e.x, e.y, e.facing, def.shoot.speed, hostileDmg(run, def.shoot.dmg));
              ev(run, { type: 'shot', x: e.x, y: e.y });
            }
          }
          break;
        case 'repo':
          if (e.st === 0) {
            e.vx = dx / dist * sp; e.vy = dy / dist * sp;
            e.x += e.vx * TICK; e.y += e.vy * TICK;
            e.facing = Math.atan2(e.vy, e.vx);
            if (!run.attract && !run._safe && dist < e.r + p.r) repoSteal(run, e, def);
          } else updateFlee(run, e, def, dx, dy, dist);
          break;
        case 'printer':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, def.walk || sp) && e.entered) { e.planted = true; e.st = def.print.every; }
          } else {
            e.st -= TICK;
            if (e.st <= 0) {
              e.st = def.print.every;
              if (countAlive(run) < T.bossSummonCap && run.enemies.length < T.enemyCap) {
                for (var pk2 = 0; pk2 < def.print.n; pk2++) {
                  var pa = rnd(run) * TWO_PI;
                  var pm = spawnEnemy(run, def.print.type, clamp(e.x + Math.cos(pa) * (e.r + 8), 8, run.w - 8),
                                      clamp(e.y + Math.sin(pa) * (e.r + 8), 8, run.h - 8), { entered: true, roam: true });
                  pm.vx = Math.cos(pa) * EN[pm.type].speed; pm.vy = Math.sin(pa) * EN[pm.type].speed;
                }
                ev(run, { type: 'print', enemyId: e.id });
              }
            }
          }
          break;
        case 'laser':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, sp) && e.entered) {
              e.planted = true;
              e.st = T.sentryFirstMin + rnd(run) * (T.sentryFirstMax - T.sentryFirstMin);
            }
          } else {
            e.facing = Math.atan2(dy, dx);
            e.st -= TICK;
            if (e.st <= 0) {
              e.st = def.laser.every;
              pushLaser(run, e, e.facing, def.laser.windup, def.laser.fire, def.laser.w, hostileDmg(run, def.laser.dmg), -1);
            }
          }
          break;
        case 'courier':
          e.x += e.vx * TICK; e.y += e.vy * TICK;
          if (!e.entered) { if (e.x >= 0 && e.x <= run.w && e.y >= 0 && e.y <= run.h) e.entered = true; }
          else if (e.x < -40 || e.x > run.w + 40 || e.y < -40 || e.y > run.h + 40) e.dead = true;   // delivered: no reward, no penalty
          break;
        case 'paralegal':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, sp) && e.entered) {
              e.planted = true;
              e.st = T.sentryFirstMin + rnd(run) * (T.sentryFirstMax - T.sentryFirstMin);
            }
          } else {
            e.facing = Math.atan2(dy, dx);
            e.st -= TICK;
            if (e.st <= 0) { e.st = def.injunction.every; pushInjunction(run, e, def.injunction, -1, p.x, p.y); }
          }
          break;
        case 'copier':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, def.walk || sp) && e.entered) { e.planted = true; e.st = def.copy.every; }
          } else {
            e.vx = 0; e.vy = 0;
            e.st -= TICK;
            if (e.st <= 0) { e.st = def.copy.every; doCopy(run, e, def); }
          }
          break;
        case 'hr':
          if (!e.entered) steerTo(e, e.wx, e.wy, sp);
          else {
            var hrd = def.heal;
            if (dist < hrd.min) { e.vx = -dx / dist * sp; e.vy = -dy / dist * sp; e.x += e.vx * TICK; e.y += e.vy * TICK; e.facing = Math.atan2(e.vy, e.vx); }
            else if (dist > hrd.max) { e.vx = dx / dist * sp; e.vy = dy / dist * sp; e.x += e.vx * TICK; e.y += e.vy * TICK; e.facing = Math.atan2(e.vy, e.vx); }
            else { e.vx = 0; e.vy = 0; }
            healAround(run, e, hrd);
          }
          break;
        case 'firenode':
          if (!e.planted) {
            if (steerTo(e, e.wx, e.wy, def.walk || sp) && e.entered) e.planted = true;
          } else { e.vx = 0; e.vy = 0; }
          break;
        case 'auditor':
          e.vx = 0; e.vy = 0;
          if (!e.entered) { steerTo(e, e.wx, e.wy, def.walk || 50); break; }
          if (!e.blinking) {
            e.bt -= TICK;
            if (e.bt <= 0 && run.hazards.length < T.hazardCap) {
              e.bt = def.audit.every;
              var bang = rnd(run) * TWO_PI, bd = def.audit.min + rnd(run) * (def.audit.max - def.audit.min);
              var bm = e.r + 4;
              pushBlink(run, e, clamp(p.x + Math.cos(bang) * bd, bm, run.w - bm), clamp(p.y + Math.sin(bang) * bd, bm, run.h - bm), def.audit.windup);
            }
          }
          break;
        case 'mimic':
          if (e.disguised) {
            e.vx = 0; e.vy = 0;
            if (dist < def.wake) { e.disguised = false; ev(run, { type: 'mimicWake', enemyId: e.id }); }
          } else {
            e.vx = dx / dist * sp; e.vy = dy / dist * sp;
            e.x += e.vx * TICK; e.y += e.vy * TICK;
            e.facing = Math.atan2(e.vy, e.vx);
          }
          break;
        default: // static
          e.vx = 0; e.vy = 0;
      }
      if (!e.dead) {
        settle(run, e);
        if (def.contact && !e.disguised && dist < e.r + p.r) hurtPlayer(run, hostileDmg(run, def.contact) * TICK, p.x, p.y, 'contact');
        else if (def.behaviour === 'bomber' && dist < e.r + p.r) explodeBomber(run, e, def);
      }
    }
  }

  // Photocopier: duplicate the nearest ordinary bot within range at 60% hp
  function doCopy(run, e, def) {
    var en = run.enemies, n = en.length, i, o, d, best = null, bd = def.copy.range * def.copy.range, copies = 0, dx, dy;
    for (i = 0; i < n; i++) if (!en[i].dead && en[i].copy) copies++;
    if (copies >= T.copyMax || n >= T.enemyCap) return;
    for (i = 0; i < n; i++) {
      o = en[i];
      if (o.dead || o.boss || o.pyl || o.copy || o === e || o.type === 'copier' || o.type === 'pylon' || o.type === 'courier' || o.type === 'gilded' || !o.entered) continue;
      dx = o.x - e.x; dy = o.y - e.y; d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = o; }
    }
    if (!best) return;
    var a = rnd(run) * TWO_PI, rr = best.r * 2.2 + 6;
    var c = spawnEnemy(run, best.type, clamp(best.x + Math.cos(a) * rr, 8, run.w - 8), clamp(best.y + Math.sin(a) * rr, 8, run.h - 8), { entered: true, roam: true });
    c.hp = c.maxHp = c.hp * def.copy.hp; c.copy = true; c.sig = 0;
    if (EN[c.type].behaviour === 'roll') { c.vx = Math.cos(a) * EN[c.type].speed; c.vy = Math.sin(a) * EN[c.type].speed; }
    ev(run, { type: 'copy', enemyId: c.id, srcId: best.id });
  }

  // HR Rep: heals every other bot in range (Wardens far less); the links are drawn from run.heals
  function healAround(run, e, def) {
    var en = run.enemies, n = en.length, i, o, dx, dy, rr, any = false, amt;
    for (i = 0; i < n; i++) {
      o = en[i];
      if (o === e || o.dead || o.hp >= o.maxHp) continue;
      dx = o.x - e.x; dy = o.y - e.y; rr = def.range + o.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      amt = (o.boss ? T.bossHeal : def.pct) * o.maxHp * TICK;
      o.hp = Math.min(o.maxHp, o.hp + amt);
      if (o.boss) run.boss.hp = o.hp;
      run.heals.push({ x1: e.x, y1: e.y, x2: o.x, y2: o.y });
      any = true;
    }
    e.healing = any;
  }

  function repoSteal(run, e, def) {
    var earned = run.earned.bolts, amt = 0;
    if (earned >= 1) amt = Math.min(earned, Math.max(1, Math.floor(earned * def.steal.pct)));
    run.earned.bolts -= amt;
    e.stolen = amt; e.st = 1; e.leaveAt = e.age + def.steal.flee;
    ev(run, { type: 'steal', enemyId: e.id, x: e.x, y: e.y, bolts: amt });
  }

  function updateFlee(run, e, def, dx, dy, dist) {
    var sp = def.speed, w = run.w, h = run.h, lt = e.leaveAt > 0 ? e.leaveAt : def.leave;
    if (lt && !e.leaving && e.age >= lt) {
      e.leaving = true;
      // run for the nearest edge
      var l = e.x, r = w - e.x, t = e.y, b = h - e.y, m = Math.min(l, r, t, b);
      if (m === l) { e.wx = -60; e.wy = e.y; }
      else if (m === r) { e.wx = w + 60; e.wy = e.y; }
      else if (m === t) { e.wx = e.x; e.wy = -60; }
      else { e.wx = e.x; e.wy = h + 60; }
    }
    if (e.leaving) {
      steerTo(e, e.wx, e.wy, sp * 1.1);
      if (e.x < -30 || e.x > w + 30 || e.y < -30 || e.y > h + 30) {
        e.dead = true;
        if (e.stolen > 0) { run.stolen += e.stolen; e.stolen = 0; }   // the Repo Bot got away with it
      }
      return;
    }
    if (!e.entered) { steerTo(e, e.wx, e.wy, sp); return; }
    if (dist < T.fleeRange) {
      var ax = -dx / dist, ay = -dy / dist;
      var vx = ax - ay * e.side * T.fleeSide, vy = ay + ax * e.side * T.fleeSide;
      var wm = T.fleeWall;
      if (e.x < wm) vx += (wm - e.x) / wm * 1.5; else if (e.x > w - wm) vx -= (e.x - (w - wm)) / wm * 1.5;
      if (e.y < wm) vy += (wm - e.y) / wm * 1.5; else if (e.y > h - wm) vy -= (e.y - (h - wm)) / wm * 1.5;
      var vl = Math.sqrt(vx * vx + vy * vy) || 1;
      e.vx = vx / vl * sp; e.vy = vy / vl * sp;
      e.x += e.vx * TICK; e.y += e.vy * TICK;
      e.facing = Math.atan2(e.vy, e.vx);
    } else {
      e.vx = 0; e.vy = 0;
    }
  }

  function separate(run) {
    var en = run.enemies, n = en.length, i, j, a, b, dx, dy, sr, d2, d, ov, nx, ny, k, fa, fb;
    for (i = 0; i < n; i++) {
      a = en[i];
      if (a.dead) continue;
      for (j = i + 1; j < n; j++) {
        b = en[j];
        if (b.dead) continue;
        sr = a.r + b.r;
        dx = b.x - a.x;
        if (dx > sr || dx < -sr) continue;
        dy = b.y - a.y;
        if (dy > sr || dy < -sr) continue;
        d2 = dx * dx + dy * dy;
        if (d2 >= sr * sr) continue;
        d = Math.sqrt(d2);
        if (d < 0.001) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
        ov = sr - d;
        k = ov * T.separation;
        fa = a.boss || a.type === 'pylon' || a.planted || a.disguised;
        fb = b.boss || b.type === 'pylon' || b.planted || b.disguised;
        if (fa && fb) continue;
        if (fa) { b.x += nx * k * 2; b.y += ny * k * 2; }
        else if (fb) { a.x -= nx * k * 2; a.y -= ny * k * 2; }
        else { a.x -= nx * k; a.y -= ny * k; b.x += nx * k; b.y += ny * k; }
        if (a.entered && !a.leaving) { a.x = clamp(a.x, a.r, run.w - a.r); a.y = clamp(a.y, a.r, run.h - a.r); }
        if (b.entered && !b.leaving) { b.x = clamp(b.x, b.r, run.w - b.r); b.y = clamp(b.y, b.r, run.h - b.r); }
      }
    }
  }

  function compactEnemies(run) {
    var en = run.enemies, w = 0;
    for (var i = 0; i < en.length; i++) if (!en[i].dead) en[w++] = en[i];
    en.length = w;
  }

  // ---------------------------------------------------------------------------
  // player, arc, drones
  // ---------------------------------------------------------------------------
  var _cE = [], _cD = [];

  function updatePlayer(run, input) {
    var p = run.player, st = run.stats;
    if (input && isFinite(input.x) && isFinite(input.y)) {
      var tx = clamp(input.x, 0, run.w), ty = clamp(input.y, 0, run.h);
      var dx = tx - p.x, dy = ty - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > st.leash) { tx = p.x + dx / d * st.leash; ty = p.y + dy / d * st.leash; }
      p.tx = tx; p.ty = ty;
    }
    if (p.held > 0) {                  // "Please hold": no movement while held (the arc still fires)
      p.held -= TICK; if (p.held < 0) p.held = 0;
      p.vx = 0; p.vy = 0;
      return;
    }
    var ddx = p.tx - p.x, ddy = p.ty - p.y, dist = Math.sqrt(ddx * ddx + ddy * ddy);
    var sp = st.speed * (p.oc.active ? T.ocSpeedMul : 1);
    var f = dist > 1e-6 ? sp * Math.min(1, dist / T.steerRamp) / dist : 0;
    p.vx += (ddx * f - p.vx) * T.steer;
    p.vy += (ddy * f - p.vy) * T.steer;
    p.x += p.vx * TICK; p.y += p.vy * TICK;
    if (p.x < p.r) { p.x = p.r; if (p.vx < 0) p.vx = 0; } else if (p.x > run.w - p.r) { p.x = run.w - p.r; if (p.vx > 0) p.vx = 0; }
    if (p.y < p.r) { p.y = p.r; if (p.vy < 0) p.vy = 0; } else if (p.y > run.h - p.r) { p.y = run.h - p.r; if (p.vy > 0) p.vy = 0; }
  }

  function updateOverclock(run) {
    var oc = run.player.oc;
    if (!oc.unlocked) return;
    if (oc.active) {
      oc.time -= TICK;
      if (oc.time <= 0) {
        oc.active = false; oc.time = 0; oc.charge = 0;
        ev(run, { type: 'ocEnd' });
      }
    } else if (oc.charge > 0 && run.t - run._lastKillT > T.ocDecayDelay) {
      oc.charge -= T.ocDecayPerSec * TICK;
      if (oc.charge < 0) oc.charge = 0;
    }
  }

  function drainBattery(run) {
    var p = run.player;
    if (run.attract || run._safe) return;
    var drain = run.stats.drain * T.drainRate * (1 + run.stats.sag * (T.bossHeatReset ? run.t - run._heat0 : run.t));
    var otS = run.sector >= 11 && T.overtimeStart3 ? T.overtimeStart3 : T.overtimeStart, otD = run.sector >= 11 && T.overtimeDrain3 ? T.overtimeDrain3 : T.overtimeDrain;   // Act III has its own late-shift drain (SPEC 12.16)
    if (run.t > otS) drain += otD * (run.t - otS);
    if (p.oc.active) drain *= T.ocDrainMul;   // Overclock slows the drain (0 = stops it)
    if (run.boss.state === 'active') drain *= T.bossDrainMul;   // a Warden fight is not a race against the clock alone
    p.battery -= (drain + run._bud) * TICK;   // _bud: Budget aura (0 outside the VP / Chairman)
  }

  function doArc(run) {
    var p = run.player, st = run.stats, interval = st.pulseInterval * (p.oc.active ? T.ocPulseMul : 1);
    if (run._cd > 0) run._cd -= TICK;
    if (run._cd > 0) { p.pulse = clamp(1 - run._cd / interval, 0, 1); return; }
    if (p.enjoined) {                  // injunction: the arc stays dark (Storm Coil keeps its own cadence)
      p.pulse = 0;
      if (st.stormEvery > 0) {
        run.pulses++;
        if (run.pulses % st.stormEvery === 0) doStorm(run);
        run._cd = interval;
      }
      return;
    }
    p.pulse = 1;
    var en = run.enemies, tg = st.targets, n = 0, i, e, dx, dy, d2, reach, j;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || e.invuln || e.disguised) continue;
      dx = e.x - p.x; dy = e.y - p.y; reach = st.radius + e.r; d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      if (n < tg || d2 < _cD[n - 1]) {
        j = n < tg ? n : n - 1;
        while (j > 0 && _cD[j - 1] > d2) { _cD[j] = _cD[j - 1]; _cE[j] = _cE[j - 1]; j--; }
        _cD[j] = d2; _cE[j] = e;
        if (n < tg) n++;
      }
    }
    if (n === 0) return;
    ev(run, { type: 'pulse', x: p.x, y: p.y, r: st.radius });
    for (i = 0; i < n; i++) {
      e = _cE[i]; _cE[i] = null;
      if (e.dead || e.invuln) continue;
      var crit = st.critChance > 0 && rnd(run) < st.critChance;
      var dmg = st.damage * (crit ? st.critMult : 1);
      ev(run, { type: 'zap', x1: p.x, y1: p.y, x2: e.x, y2: e.y, crit: crit, src: 'arc' });
      damageEnemy(run, e, dmg, crit, false, 0);
      if (st.naniteDps > 0 && !e.dead) infect(run, e);
    }
    run.pulses++;
    if (st.stormEvery > 0 && run.pulses % st.stormEvery === 0) doStorm(run);
    run._cd = interval;
  }

  function updateDrones(run) {
    var drones = run.drones, n = drones.length;
    if (!n) return;
    var p = run.player, st = run.stats, en = run.enemies, i, k, d, e, dx, dy, d2, reach, best, bestD;
    run._dAng += T.droneSpin * TICK;
    for (i = 0; i < n; i++) {
      d = drones[i];
      d.angle = run._dAng + i * TWO_PI / n;
      d.x = p.x + Math.cos(d.angle) * T.droneRadius;
      d.y = p.y + Math.sin(d.angle) * T.droneRadius;
      if (d.cd > 0) d.cd -= TICK;
      if (d.cd > 0) continue;
      best = null; bestD = 1e18;
      for (k = 0; k < en.length; k++) {
        e = en[k];
        if (e.dead || e.invuln || e.disguised) continue;
        dx = e.x - d.x; dy = e.y - d.y; d2 = dx * dx + dy * dy;
        reach = T.droneRange + e.r;
        if (d2 <= reach * reach && d2 < bestD) { bestD = d2; best = e; }
      }
      if (best) {
        ev(run, { type: 'zap', x1: d.x, y1: d.y, x2: best.x, y2: best.y, crit: false, src: 'drone' });
        damageEnemy(run, best, st.droneDmg, false, false, 0);
        d.cd = st.droneInterval;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Act II R&D features (SPEC 11.8). Every function here only runs when the player owns the feature.
  // ---------------------------------------------------------------------------
  function stockStep(run) {
    var st = run.stats, sk = run.stock, cap = 1 + st.stockCap;
    if (sk.mult >= cap - 1e-9) return;
    sk.mult = Math.min(cap, sk.mult + st.stockStep);
    sk.n++;
    ev(run, { type: 'stock', n: sk.n, mult: sk.mult });
  }

  function spawnIntern(run, x, y) {
    if (run.interns.length >= run.stats.internMax) return;
    var it = { id: run._nid++, x: x, y: y, vx: 0, vy: 0, age: 0, life: run.stats.internLife };
    run.interns.push(it);
    ev(run, { type: 'intern', id: it.id, x: x, y: y });
  }

  function updateInterns(run) {
    var arr = run.interns, st = run.stats, en = run.enemies, p = run.player, w = 0, i, k, it, e, best, bd, d, dx, dy, tx, ty, dd;
    for (i = 0; i < arr.length; i++) {
      it = arr[i];
      it.age += TICK;
      if (it.age >= it.life) { ev(run, { type: 'internEnd', id: it.id, x: it.x, y: it.y }); continue; }
      best = null; bd = 1e18;
      for (k = 0; k < en.length; k++) {
        e = en[k];
        if (e.dead || e.invuln || e.disguised || !e.entered) continue;
        dx = e.x - it.x; dy = e.y - it.y; d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { tx = best.x; ty = best.y; } else { tx = p.x; ty = p.y; }
      dx = tx - it.x; dy = ty - it.y; dd = Math.sqrt(dx * dx + dy * dy) || 0.001;
      if (best || dd > 40) {
        it.vx = dx / dd * T.internSpeed; it.vy = dy / dd * T.internSpeed;
        it.x = clamp(it.x + it.vx * TICK, 0, run.w); it.y = clamp(it.y + it.vy * TICK, 0, run.h);
      } else { it.vx = 0; it.vy = 0; }
      if (best && dd < best.r + T.internR) best.dot += T.internDps * st.damage * st.internMult * TICK;
      arr[w++] = it;
    }
    arr.length = w;
  }

  function infect(run, e) {
    if (e.dead || e.invuln || e.disguised) return;
    if (e.infected <= 0) {
      if (run._infN >= T.naniteMax) return;
      run._infN++;
      ev(run, { type: 'infect', enemyId: e.id });
    }
    e.infected = T.naniteDur;
  }

  function updateNanites(run) {
    var en = run.enemies, st = run.stats, n = 0, i, e;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || e.infected <= 0) continue;
      e.infected -= TICK;
      if (e.infected <= 0) { e.infected = 0; continue; }
      n++;
      e.dot += st.naniteDps * TICK;
    }
    run._infN = n;
  }

  function updateLattice(run) {
    var drones = run.drones, nd = drones.length, links = run.links, p = run.player, st = run.stats, en = run.enemies;
    var nl = 0, i, k, l, e, a, b, hit;
    if (nd < 1) { links.length = 0; return; }
    var need = nd + (nd >= 3 ? nd : nd - 1);
    while (links.length < need) links.push({ x1: 0, y1: 0, x2: 0, y2: 0 });
    for (i = 0; i < nd; i++) { l = links[nl++]; l.x1 = p.x; l.y1 = p.y; l.x2 = drones[i].x; l.y2 = drones[i].y; }
    for (i = 0; i < nd - 1; i++) { l = links[nl++]; l.x1 = drones[i].x; l.y1 = drones[i].y; l.x2 = drones[i + 1].x; l.y2 = drones[i + 1].y; }
    if (nd >= 3) { l = links[nl++]; l.x1 = drones[nd - 1].x; l.y1 = drones[nd - 1].y; l.x2 = drones[0].x; l.y2 = drones[0].y; }
    links.length = nl;
    var dmg = st.latticeDps * TICK;
    for (k = 0; k < en.length; k++) {
      e = en[k];
      if (e.dead || e.invuln || e.disguised || !e.entered) continue;
      hit = false;
      for (i = 0; i < nl && !hit; i++) {
        l = links[i];
        if (segDist(e.x, e.y, l.x1, l.y1, l.x2, l.y2) <= e.r + T.latticeReach) hit = true;
      }
      if (hit) e.dot += dmg;
    }
  }

  function flushDots(run) {
    var en = run.enemies, n = en.length, i, e;
    for (i = 0; i < n; i++) {
      e = en[i];
      if (e.dot <= 0 || e.dead) continue;
      e.dotT += TICK;
      if (e.dotT >= T.dotFlush) {
        var d = e.dot; e.dot = 0; e.dotT = 0;
        damageEnemy(run, e, d, false, true, 0);
      }
    }
  }

  function doStorm(run) {
    var st = run.stats, en = run.enemies, n0 = en.length, i, e, n = 0, crit, mult = L.storm.mult;
    for (i = 0; i < n0; i++) { e = en[i]; if (!e.dead && !e.invuln && !e.disguised && e.entered) n++; }
    ev(run, { type: 'storm', n: n });
    for (i = 0; i < n0; i++) {
      e = en[i];
      if (e.dead || e.invuln || e.disguised || !e.entered) continue;
      crit = st.critChance > 0 && rnd(run) < st.critChance;
      damageEnemy(run, e, st.damage * mult * (crit ? st.critMult : 1), crit, true, 0);
    }
  }

  function openWell(run) {
    var en = run.enemies, n = en.length, i, j, e, o, best = null, bc = -1, c, dx, dy, rr = T.wellR;
    for (i = 0; i < n; i++) {
      e = en[i];
      if (e.dead || e.disguised || !e.entered || e.type === 'pylon') continue;
      c = 0;
      for (j = 0; j < n; j++) {
        o = en[j];
        if (o === e || o.dead || o.disguised || !o.entered || o.type === 'pylon') continue;
        dx = o.x - e.x; dy = o.y - e.y;
        if (dx * dx + dy * dy <= rr * rr) c++;
      }
      if (c > bc || (c === bc && e.boss)) { bc = c; best = e; }
    }
    if (!best) return false;
    var well = { id: run._nid++, x: best.x, y: best.y, r: rr, t: 0, pull: T.wellPull, phase: 'pull' };
    run.wells.push(well);
    ev(run, { type: 'wellOpen', id: well.id, x: well.x, y: well.y, r: well.r });
    return true;
  }

  function updateWells(run) {
    var st = run.stats, ws = run.wells, en = run.enemies, pk = run.pickups, i, k, w, e, dx, dy, d, mv, n, keep = 0;
    run._wellT -= TICK;
    if (run._wellT <= 0 && ws.length === 0 && !run._safe) run._wellT = openWell(run) ? st.wellEvery : 1;
    for (i = 0; i < ws.length; i++) {
      w = ws[i];
      w.t += TICK;
      if (w.phase === 'pull') {
        mv = w.pull * TICK;
        for (k = 0; k < en.length; k++) {
          e = en[k];
          if (e.dead || e.boss || e.disguised || !e.entered || e.type === 'pylon') continue;
          dx = w.x - e.x; dy = w.y - e.y; d = Math.sqrt(dx * dx + dy * dy);
          if (d > w.r + e.r || d < 0.001) continue;
          if (d <= mv) { e.x = w.x; e.y = w.y; } else { e.x += dx / d * mv; e.y += dy / d * mv; }
        }
        for (k = 0; k < pk.length; k++) {
          dx = w.x - pk[k].x; dy = w.y - pk[k].y; d = Math.sqrt(dx * dx + dy * dy);
          if (d > w.r * 1.5 || d < 0.001) continue;
          if (d <= mv) { pk[k].x = w.x; pk[k].y = w.y; } else { pk[k].x += dx / d * mv; pk[k].y += dy / d * mv; }
        }
        if (w.t >= T.wellDur) {
          w.phase = 'boom'; w.t = 0; n = 0;
          var wd = st.wellMult * st.damage, n0 = en.length, hitList = [];
          for (k = 0; k < n0; k++) {
            e = en[k];
            if (e.dead || e.invuln || e.disguised || !e.entered) continue;
            dx = e.x - w.x; dy = e.y - w.y;
            if (Math.sqrt(dx * dx + dy * dy) <= w.r + e.r) hitList.push(e);
          }
          for (k = 0; k < hitList.length; k++) { n++; damageEnemy(run, hitList[k], wd, false, true, 0); }
          ev(run, { type: 'wellBoom', id: w.id, x: w.x, y: w.y, r: w.r, n: n });
        }
      } else if (w.t >= T.wellHold) continue;
      ws[keep++] = w;
    }
    ws.length = keep;
  }

  function triggerSeverance(run) {
    var st = run.stats, p = run.player, en = run.enemies, n0 = en.length, i, e, dx, dy, rr;
    run._sevDone = true; run._sev = true;
    for (i = 0; i < n0; i++) {
      e = en[i];
      if (e.dead || e.invuln || e.disguised) continue;
      dx = e.x - p.x; dy = e.y - p.y; rr = T.severanceR + e.r;
      if (dx * dx + dy * dy <= rr * rr) damageEnemy(run, e, st.severancePct * st.damage, false, true, 0);
    }
    var before = run.earned.bolts;
    run._payMul = st.severancePay;
    collectAllPickups(run);
    run._payMul = 1;
    ev(run, { type: 'severance', x: p.x, y: p.y, r: T.severanceR, bolts: run.earned.bolts - before });
  }

  // Orbital Office (Act III): every few seconds a strike marks the biggest bot, then lands on it
  function markStrike(run) {
    var en = run.enemies, i, e, best = null, bh = -1;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || e.invuln || e.disguised || e.type === 'pylon' || e.pyl || !e.entered) continue;
      if (e.hp > bh) { bh = e.hp; best = e; }
    }
    if (!best) return false;
    var R = L.orbital.r;
    run.strikes.push({ id: run._nid++, x: best.x, y: best.y, r: R, t: 0, dur: L.orbital.windup, targetId: best.id });
    ev(run, { type: 'telegraph', kind: 'orbital', x: best.x, y: best.y, r: R, dur: L.orbital.windup });
    return true;
  }
  function landStrike(run, sk) {
    var st = run.stats, en = run.enemies, n0 = en.length, i, o, dx, dy, rr, hit = [], base = st.orbitalMult * st.damage, R = sk.r;
    for (i = 0; i < n0; i++) {
      o = en[i];
      if (o.dead || o.invuln || o.disguised) continue;
      if (o.id === sk.targetId) { hit.push([o, base]); continue; }
      dx = o.x - sk.x; dy = o.y - sk.y; rr = R + o.r;
      if (dx * dx + dy * dy <= rr * rr) hit.push([o, base * L.orbital.splash]);
    }
    ev(run, { type: 'orbital', x: sk.x, y: sk.y, r: R, n: hit.length });
    for (i = 0; i < hit.length; i++) damageEnemy(run, hit[i][0], hit[i][1], false, true, 0);
  }
  function updateOrbital(run) {
    var ss = run.strikes, i, sk, e;
    for (i = ss.length - 1; i >= 0; i--) {
      sk = ss[i]; sk.t += TICK;
      e = findEnemy(run, sk.targetId);
      if (e && !e.dead) { sk.x = e.x; sk.y = e.y; }
      if (sk.t >= sk.dur) { ss.splice(i, 1); landStrike(run, sk); }
    }
    if (ss.length === 0 && !run._safe) {
      run._orbT -= TICK;
      if (run._orbT <= 0) run._orbT = markStrike(run) ? run.stats.orbitalEvery : 1;
    }
  }

  // Firewall Nodes make every other nearby bot invulnerable while they live
  var _nodes = [];
  function inRange(n, e, range) {
    var dx = n.x - e.x, dy = n.y - e.y;
    return dx * dx + dy * dy <= range * range;
  }
  function updateFireShields(run) {
    var en = run.enemies, n = en.length, nn = 0, i, j, e, f, range = EN.firenode.shield.range;
    for (i = 0; i < n; i++) { e = en[i]; if (!e.dead && e.type === 'firenode' && e.entered) _nodes[nn++] = e; }
    for (i = 0; i < n; i++) {
      e = en[i];
      if (e.dead || e.boss || e.type === 'firenode' || e.type === 'pylon') continue;
      f = null;
      if (e.shieldedBy !== null) {          // keep the current shield while its node lives and is in reach
        for (j = 0; j < nn; j++) if (_nodes[j].id === e.shieldedBy && inRange(_nodes[j], e, range)) { f = _nodes[j]; break; }
      }
      if (!f) for (j = 0; j < nn; j++) if (inRange(_nodes[j], e, range)) { f = _nodes[j]; break; }
      if (f) { e.shieldedBy = f.id; e.invuln = true; }
      else if (e.shieldedBy !== null) { e.shieldedBy = null; e.invuln = e.blinking || e.shielded; }
    }
    for (j = 0; j < nn; j++) _nodes[j] = null;
  }

  function updateSpawning(run) {
    if (run._safe) return;
    var b = run.boss;
    run._spawnT -= TICK;
    if (run._spawnT > 0) return;
    run._spawnT += Math.max(T.spawnIntervalMin, T.spawnIntervalBase - T.spawnIntervalDrop * run.t);
    var cap = Math.min(run.sec.cap, T.maxAliveBase + T.maxAlivePerSec * run.t);
    if (b.state === 'active') cap *= T.bossAliveMul;
    if (countAlive(run) < cap) spawnRandom(run);
  }

  function finish(run, reason) {
    if (run.over) return;
    run.over = true;
    run.reason = reason;
    ev(run, { type: 'end', reason: reason });
  }

  // ---------------------------------------------------------------------------
  // step
  // ---------------------------------------------------------------------------
  function step(run, save, input) {
    if (run.over) return;
    var p = run.player, st = run.stats, b = run.boss;
    run.t += TICK; run.tick++;
    p.hurt = p.hurt < 99 ? p.hurt + TICK : 99;

    updatePlayer(run, input);
    updateOverclock(run);
    drainBattery(run);
    doArc(run);
    updateDrones(run);
    if (st.latticeDps > 0) updateLattice(run);
    if (st.wellEvery > 0) updateWells(run);
    if (st.naniteDps > 0) updateNanites(run);
    if (run.interns.length) updateInterns(run);
    if (st.orbitalEvery > 0) updateOrbital(run);
    if (st.compoundStep > 0) run.compound = 1 + Math.min(st.compoundCap, st.compoundStep * Math.floor(run.t / T.compoundEvery));
    updateSpawning(run);

    if (b.state === 'warning') {
      b.warn -= TICK;
      if (b.warn <= 0) { b.warn = 0; spawnBoss(run); }
    }

    updateHazards(run);
    updateEnemies(run);
    if (run._fn) updateFireShields(run);
    if (st.latticeDps > 0 || st.naniteDps > 0 || st.rehireChance > 0) flushDots(run);
    separate(run);
    updateShots(run);
    updatePickups(run);
    compactEnemies(run);

    var cb = run.combo;
    cb.t += TICK;
    if (cb.n > 0 && cb.t >= T.comboWindow) cb.n = 0;

    if (run._cAcc > 0 && run.t - run._cLast >= 0.2) {
      ev(run, { type: 'hurt', amount: run._cAcc, x: run._cX, y: run._cY, src: run._cSrc });
      run._cAcc = 0; run._cLast = run.t; run._cSrc = 'contact';
    }

    if (p.battery > p.maxBattery) p.battery = p.maxBattery;
    if (!run.attract && !run._safe) {
      if (run.t >= T.hardCap) { p.battery = 0; finish(run, 'battery'); return; }
      if (p.battery <= 0) {
        if (st.sparePct > 0 && !p.spareUsed) {
          p.spareUsed = true;
          p.battery = st.sparePct * p.maxBattery;
          ev(run, { type: 'spare' });
        } else if (st.severancePct > 0 && !run._sevDone) {
          triggerSeverance(run);
          compactEnemies(run);
          if (run._safe) p.battery = Math.max(p.battery, 1);   // the blast scrapped the Warden: victory window instead
          else { p.battery = 0; finish(run, 'battery'); return; }
        } else { p.battery = 0; finish(run, 'battery'); return; }
      }
      if (p.battery < T.lowBattery * p.maxBattery) {
        if (!run._low) { run._low = true; ev(run, { type: 'lowBattery' }); }
      } else run._low = false;
    }
    if (run._safe && run._victoryT > 0) {
      run._victoryT -= TICK;
      if (run._victoryT <= 0) finish(run, 'victory');
    }
  }

  function clockOut(run) {
    if (run.over) return;
    finish(run, run.boss.state === 'dead' ? 'victory' : 'clockout');
  }

  // ---------------------------------------------------------------------------
  // end of shift
  // ---------------------------------------------------------------------------
  function endShift(run, save) {
    if (run._report) return run._report;
    clockOut(run);
    var earned = run.earned, st = run.stats, b = run.boss, c = run.counts, i, pk;
    var swept = 0;
    var bossSeen = b.state !== 'none';
    var bossDefeated = b.state === 'dead';
    var report = {
      reason: run.reason, sector: run.sector, time: run.t, bolts: 0, cores: 0, kills: c.kills, bestCombo: c.bestCombo,
      swept: 0, signalPct: 0, bossSeen: bossSeen, bossDefeated: bossDefeated, firstClear: false,
      unlockedSector: null, gameWon: false, newSeen: [],
      fatigue: fatigueOf(save, run.sector), fatigueUp: false, act2Won: false, overtimeLevel: null, severance: !!run._sev, stolen: run.stolen, stockMult: run.stock.mult,
      act3Won: false, clawed: run.clawed, compound: run.compound, expense: run.expense
    };
    if (run.attract) {
      report.kills = 0; report.bestCombo = 0; report.bossSeen = false; report.bossDefeated = false;
      run._report = report;
      return report;
    }
    var floorBolts = 0;
    for (i = 0; i < run.pickups.length; i++) {
      pk = run.pickups[i];
      if (pk.kind === 'bolt') floorBolts += pk.value;
      else if (pk.kind === 'core') earned.cores += pk.value;
    }
    if (st.sweepPct > 0) {
      var salvage = 0;
      if (T.sweepBots > 0) {   // Yard Sweep also scraps the bots still walking around
        for (i = 0; i < run.enemies.length; i++) {
          var se = run.enemies[i], sd = EN[se.type];
          if (se.dead || se.boss || !sd || !(sd.bolts > 0)) continue;
          salvage += sd.bolts * run.sec.bolts * st.boltMult * (se.elite ? T.eliteBolts : 1);
        }
      }
      swept = Math.round(floorBolts * st.sweepPct + salvage * T.sweepBots * st.sweepPct);
    }
    earned.bolts += swept;

    report.bolts = earned.bolts; report.cores = earned.cores; report.swept = swept;
    report.signalPct = bossSeen ? 1 : (b.blocked ? 0 : clamp(b.signal / b.need, 0, 1));

    var s = save.stats;
    save.bolts += earned.bolts; save.cores += earned.cores;
    s.stolen += run.stolen;
    s.clawed += run.clawed;
    s.shifts++; s.kills += c.kills; s.boltsTotal += earned.bolts; s.coresTotal += earned.cores; s.playTime += run.t;
    if (c.bestCombo > s.bestCombo) s.bestCombo = c.bestCombo;
    if (earned.bolts > s.bestShiftBolts) s.bestShiftBolts = earned.bolts;
    save.sector = run.sector;

    for (var id in run._seen) {
      if (!save.seen[id]) { save.seen[id] = true; report.newSeen.push(id); }
    }

    if (run.sector >= FIRSTFAT && run.sector <= LASTSEC) {
      if (!save.fatigue || typeof save.fatigue !== 'object') { save.fatigue = {}; for (i = FIRSTFAT; i <= LASTSEC; i++) save.fatigue[i] = 0; }   // saves that skipped loadSave   // Board fatigue (Act II and III Wardens; not Overtime)
      if (bossDefeated) save.fatigue[run.sector] = 0;
      else if (bossSeen) { save.fatigue[run.sector] = Math.min(T.fatigueMax, (save.fatigue[run.sector] || 0) + T.fatiguePer); report.fatigueUp = true; }
      report.fatigue = save.fatigue[run.sector];
    }

    if (bossDefeated) {
      if (run.sector === NSEC) {                 // Overtime: winning advances the level
        save.overtime.level = run.overtime;
        if (run.overtime > save.overtime.best) save.overtime.best = run.overtime;
        report.overtimeLevel = run.overtime;
      } else {
        var prior = save.bossKills[run.sector] || 0;
        save.bossKills[run.sector] = prior + 1;
        if (prior === 0) {
          report.firstClear = true;
          if (run.sector > save.sectorsCleared) {
            save.sectorsCleared = run.sector;
            report.unlockedSector = run.sector + 1;   // 5 -> 6 (Act II), 10 -> 11 (Act III), 15 -> 16 (Overtime)
          }
        }
        if (run.sector === 5 && !save.flags.act2) save.flags.act2 = true;
        if (run.sector === 5 && !save.flags.won) {
          save.flags.won = true;
          s.wonShifts = s.shifts;
          s.wonPlayTime = s.playTime;
          report.gameWon = true;
        }
        if (run.sector === 10 && !save.flags.chairman) {
          save.flags.chairman = true;
          s.act2Shifts = s.shifts - (s.wonShifts || 0);
          s.act2PlayTime = s.playTime - (s.wonPlayTime || 0);
          report.act2Won = true;
        }
        if (run.sector === 10 && !save.flags.act3) save.flags.act3 = true;
        if (run.sector === 15 && !save.flags.founder) {
          save.flags.founder = true;
          s.act3Shifts = s.shifts - (s.wonShifts || 0) - (s.act2Shifts || 0);
          s.act3PlayTime = s.playTime - (s.wonPlayTime || 0) - (s.act2PlayTime || 0);
          report.act3Won = true;
        }
      }
    }
    run._report = report;
    return report;
  }

  BY.Engine = {
    newSave: newSave, loadSave: loadSave, stats: computeStats, loadout: loadout,
    upgradeInfo: upgradeInfo, buy: buy, affordableCount: affordableCount, sectorInfo: sectorInfo,
    startShift: startShift, step: step, clockOut: clockOut, endShift: endShift,
    // helpers for tools/tests (not part of the UI contract)
    cost: function (id, level) { var d = UPID[id]; return { bolts: costBolts(d, level), cores: costCores(d, level) }; },
    // test hook: force-spawn a bot, or a Warden (any Warden id; the shift's boss state becomes 'active')
    spawn: function (run, type, x, y, opt) {
      if (!BOSS[type]) return spawnEnemy(run, type, x, y, opt);
      var b = run.boss;
      if (b.state === 'active') return findEnemy(run, b.enemyId);
      var def = BOSS[type];
      b.id = def.id; b.name = def.name; b.hp = b.maxHp = def.hp; b.state = 'warning';
      var e = spawnBoss(run);
      if (isFinite(x)) e.x = clamp(x, e.r, run.w - e.r);
      if (isFinite(y)) e.y = clamp(y, e.r, run.h - e.r);
      return e;
    },
    needFor: needFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
