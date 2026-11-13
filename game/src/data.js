(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};

  // ---------------------------------------------------------------------------
  // BY.Data: every tunable number in the game lives here. engine.js hard-codes none.
  // ---------------------------------------------------------------------------

  var TICK = 1 / 60;

  // Sprocket base stats (SPEC 4.1)
  var PLAYER = {
    r: 12, battery: 18, drain: 1, sag: 0.058, damage: 1, pulse: 0.5, radius: 46, targets: 1,
    speed: 260, magnet: 60, critMult: 3, leash: 130
  };

  // Per-level effect sizes (SPEC 4.3)
  var LEVEL = {
    coil: 1,                 // +damage per level
    pulse: 0.94,             // interval multiplier per level
    field: 5,                // +radius per level
    fork: 1,                 // +targets per level
    amp: 1.25,               // damage multiplier per level
    surge: 0.05,             // crit chance per level
    chainBase: 0.3, chainPer: 0.4,
    overload: 0.2,
    cell: 3,                 // +max battery
    thrust: 42,              // +speed
    recycler: 0.07,           // battery per bot scrapped
    ocBase: 3,               // ocDur = ocBase + capacitor level
    coolant: 0.1,            // fraction of sag removed per level
    plating: 0.09,           // fraction of hostile damage removed per level
    spare: [0, 0.35, 0.55, 0.75],
    magnet: 14,
    sorter: 0.15,
    sweep: [0, 0.5, 1],
    gildedBase: 0.005, gildedPer: 0.015,
    beacon: 0.11,
    extractElite: 0.1,
    droneBase: 0.5, droneDmgPer: 0.2, droneInterval: 0.9, droneRate: 0.9,
    titan: { damage: 3, battery: 1.3, radius: 1.25 },
    // Act II (SPEC 11.8)
    fusion: 1.36,                                // arc damage multiplier per level (SPEC 12.15)
    overdrive: 1.19, arcfocus: 1.16, hardened: 1.1,   // modest damage nodes spread round the tree (SPEC 12.15)
    supercell: { battery: 0.07, sag: 0.05 },    // +battery fraction, -sag fraction (multiplicative with coolant) per level
    dividends: 1.44,                             // bolt value multiplier per level
    lattice: 2,                                 // x droneDmg per second per level
    storm: { base: 9, mult: 3 },                // every (base - level)th pulse; x damage to everything
    singularity: { base: 11, mult: 10, per: 10 },   // every (base - level) s; (mult + per*level) x damage
    severance: { mult: 50, pay: [1.5, 2, 2.5] },
    stockopt: { step: 0.02, cap: 1 },           // per level: +step per 10-streak, cap +cap
    rehire: 0.03,                               // Intern chance per scrapped bot per level
    nanites: 0.1,                               // x damage per second per level
    parachute: [0, 1.5, 2, 3],                  // sweep payout by level
    takeover: { damage: 4, battery: 1.3, radius: 1.3 },
    overtimepay: 1.23, hazardpay: 1.27,
    // Act III (SPEC 12.7 / 12.8)
    megacoil: 1.22,                              // arc damage multiplier per level
    diligence: 1.25,                            // damage to Wardens (and their pylons) per level
    legal: { hold: 0.7, injunction: 0.8, claw: 0.75 },   // multiplicative per level
    compound: { step: 0.04, cap: 0.6 },         // bolt value per 10 s survived, per level; cap per level
    fleet: { drones: 1, dmg: 1.4 },
    insider: { crit: 0.03, mult: 0.5 },
    orbital: { base: 13, per: 2, mult: 25, splash: 0.3, r: 50, windup: 0.6 },
    expense: { step: 0.04, cap: 12, combo: 20 },
    restructure: { chance: 0.04, r: 60, mult: 8, perSec: 8 },
    outsource: { life: 3, max: 2, contact: 2 },
    stake: { damage: 3, battery: 1.25, radius: 1.15 }
  };

  // Everything else the rules need (SPEC 3)
  var TUNE = {
    steer: 0.25, steerRamp: 24, ocSpeedMul: 1.25, ocPulseMul: 0.5, ocDrainMul: 0.5,
    drainRate: 1,
    overtimeStart: 120, overtimeDrain: 0.5,
    overtimeStart3: 64, overtimeDrain3: 1.5,   // sectors 11+ (SPEC 12.16)  // extra drain/s per second past overtimeStart (guarantees shifts end)
    hardCap: 200,                            // absolute failsafe: battery forced flat at this shift time
    lowBattery: 0.25,
    startY: 0.72,                            // Sprocket starts at this fraction of arena height
    arcStartCd: 0.25,
    // pickups
    pickupDelay: 0.25, pickupBlink: 12, pickupLife: 15, pickupFriction: 0.94,
    pickupBurstMin: 60, pickupBurstMax: 150, pickupPad: 6, pickupCap: 160,
    pullBase: 240, pullGain: 480, cellHeal: 0.06, maxPieces: 5,
    // combo / overclock
    comboWindow: 2.5, comboEvery: 5,
    ocPerKill: 1 / 14, ocDecayPerSec: (1 / 14) / 1.5, ocDecayDelay: 2,
    chainRange: 100, chainDepth: 6, overloadRange: 55,
    // spawning
    initialBots: 4, initialClear: 90, spawnOutside: 20, spawnMargin: 40,
    maxAliveBase: 5, maxAlivePerSec: 0.25,
    spawnIntervalBase: 0.8, spawnIntervalDrop: 0.008, spawnIntervalMin: 0.3,
    bossAliveMul: 0.4, bossSummonCap: 40,
    eliteChance: 0.04, eliteFromSector: 2, eliteHp: 4, eliteBolts: 4, eliteR: 1.25, eliteSignal: 2,
    separation: 0.15,
    // behaviours
    driftMargin: 30, driftWaitMin: 3, driftWaitMax: 6, driftArrive: 4,
    fleeRange: 170, fleeSide: 0.7, fleeWall: 60,
    shotRadius: 5, sentryFirstMin: 0.6, sentryFirstMax: 1.6,
    // drones
    droneRadius: 34, droneSpin: 2.2, droneRange: 70, collectorRange: 26,
    // bosses
    warn: 2.5, reserve: 0.6, bossHeatReset: 1, sweepBots: 1, bossDrainMul: 0.8, victoryDelay: 1.5, bossY: 40,
    bossFirstAttack: 0.75,        // first attack comes after this fraction of its interval
    shieldPylons: 3, shieldRing: 110,
    dashOver: 120, dashMax: 900,      // a charge runs through Sprocket's position and this much further (capped)
    // Act II (SPEC 11). Only read when the player owns the feature or the bot/attack is Act II.
    stormLimit: 0,
    wellR: 90, wellPull: 160, wellDur: 1.5, wellHold: 0.35,
    severanceR: 140,
    internLife: 6, internR: 9, internSpeed: 150, internMax: 4, internDps: 2,
    naniteDur: 4, naniteMax: 40, naniteJump: 60,
    latticeReach: 8, dotFlush: 0.25,
    stockEvery: 10,
    laserGuard: 0,
    hazardCap: 80, shotCap: 500, enemyCap: 160,
    fatiguePer: 0.10, fatigueMax: 0.5,            // Board fatigue: each failed Act II Warden attempt shaves this off his hp next time
    blinkMin: 80, blinkMax: 160,
    mimicWake: 40,
    // Act III (SPEC 12). Only read when the player owns the feature or the bot/attack is Act III.
    injunctionMax: 4, copyMax: 12, spamWedge: 14, healRange: 110, bossHeal: 0.005,
    compoundEvery: 10, burstMax: 8
  };

  // Overtime (sector 11): per-level scaling on top of sector 11's base multipliers (SPEC 11.1)
  // SPEC 12.1: sector 16 now; every Overtime Warden uses the Founder's base hp/bolts x the level factors.
  var OVERTIME = { hp: 6, bolts: 4, dmg: 1.12, coresBase: 2, maxScale: 1e280,
                   rotation: ['forklift', 'receptionist', 'firewall', 'counsel', 'inspector', 'comptroller', 'vp', 'market', 'chairman', 'founder'] };

  // ---------------------------------------------------------------------------
  // Upgrades (the Blueprint) SPEC 4.2. requires: [[id, level], ...]
  // ---------------------------------------------------------------------------
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  var MINUS = '−', TIMES = '×';

  // ---------------------------------------------------------------------------
  // BY.Fmt: shared big-number formatter (SPEC 11.3). UI, render and sprites use it for every number they show.
  // ---------------------------------------------------------------------------
  var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  var MINUS_SIGN = '−', THIN = '\u2009';
  function stripZeros(str) {
    if (str.indexOf('.') < 0) return str;
    return str.replace(/0+$/, '').replace(/\.$/, '');
  }
  function fmtNum(n) {
    n = Number(n);
    if (n !== n || n === Infinity || n === -Infinity) return '—';
    if (n < 0) return MINUS_SIGN + fmtNum(-n);
    if (n === 0) return '0';
    if (n < 1) {
      var sm = n.toPrecision(3);
      return sm.indexOf('e') >= 0 ? '0' : stripZeros(sm);
    }
    var tier = 0, x = n, r;
    while (x >= 1000) { x /= 1000; tier++; }
    r = x >= 100 ? Math.round(x) : (x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100);
    if (r >= 1000) { r = Math.round(r / 10) / 100; tier++; }   // 999.6 -> 1K
    if (tier >= SUFFIX.length) {
      var ex = n.toExponential(2).split('e');
      return stripZeros(ex[0]) + 'e' + parseInt(ex[1], 10);
    }
    var str = r >= 100 ? String(r) : (r >= 10 ? r.toFixed(1) : r.toFixed(2));
    return stripZeros(str) + SUFFIX[tier];
  }
  function fmtInt(n) {
    n = Number(n);
    if (n !== n || n === Infinity || n === -Infinity) return '—';
    var neg = n < 0, a = Math.round(Math.abs(n));
    if (a >= 1e6) return fmtNum(n);
    var s = String(a), out = '';
    while (s.length > 3) { out = THIN + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg && a > 0 ? MINUS_SIGN : '') + s + out;
  }
  BY.Fmt = { num: fmtNum, int: fmtInt };
  var FN = fmtNum;

  var UPGRADES = [
    { id: 'boot', name: 'Sprocket', branch: 'core', col: 2, row: 0, max: 1, base: 0, growth: 1, cores: null, requires: [],
      desc: 'A small salvage bot with an arc coil and a pass card.',
      fmt: function (l) { return 'Standard issue'; } },

    { id: 'coil', name: 'Coil Voltage', branch: 'arc', tier: 1, icon: 'coil', max: 8, base: 4, growth: 1.731, cores: null, requires: [],
      desc: 'More volts per zap.',
      fmt: function (l) { return '+' + FN(l) + ' damage'; } },
    { id: 'coil2', name: 'Coil Voltage', branch: 'arc', tier: 2, icon: 'coil', max: 8, base: 4 * Math.pow(1.731, 8), growth: 1.731, cores: null, requires: [['coil', 8]],
      desc: 'More volts per zap.',
      fmt: function (l) { return '+' + FN(l) + ' damage'; } },
    { id: 'coil3', name: 'Coil Voltage', branch: 'arc', tier: 3, icon: 'coil', max: 9, base: 4 * Math.pow(1.731, 16), growth: 1.731, cores: null, requires: [['coil2', 8]],
      desc: 'More volts per zap.',
      fmt: function (l) { return '+' + FN(l) + ' damage'; } },
    { id: 'pulse', name: 'Pulse Rate', branch: 'arc', tier: 1, icon: 'pulse', max: 6, base: 18, growth: 2.46, cores: null, requires: [['coil', 1]],
      desc: 'Zap more often.',
      fmt: function (l) { return TIMES + f2(Math.pow(LEVEL.pulse, l)) + ' interval'; } },
    { id: 'pulse2', name: 'Pulse Rate', branch: 'arc', tier: 2, icon: 'pulse', max: 6, base: 18 * Math.pow(2.46, 6), growth: 2.46, cores: null, requires: [['pulse', 6]],
      desc: 'Zap more often.',
      fmt: function (l) { return TIMES + f2(Math.pow(LEVEL.pulse, l)) + ' interval'; } },
    { id: 'field', name: 'Field Radius', branch: 'arc', tier: 1, icon: 'field', max: 5, base: 14, growth: 2.495, cores: null, requires: [['coil', 1]],
      desc: 'Reach farther before bots get close.',
      fmt: function (l) { return '+' + FN(LEVEL.field * l) + ' radius'; } },
    { id: 'field2', name: 'Field Radius', branch: 'arc', tier: 2, icon: 'field', max: 5, base: 14 * Math.pow(2.495, 5), growth: 2.495, cores: null, requires: [['field', 5]],
      desc: 'Reach farther before bots get close.',
      fmt: function (l) { return '+' + FN(LEVEL.field * l) + ' radius'; } },
    { id: 'fork', name: 'Fork', branch: 'arc', col: 0, row: 3, max: 4, base: 79, growth: 14.938, cores: null, requires: [['pulse', 1]],
      desc: 'Each pulse hits one more bot.',
      fmt: function (l) { return '+' + l + (l === 1 ? ' target' : ' targets'); } },
    { id: 'amp', name: 'Amplifier', branch: 'arc', col: 1, row: 3, max: 8, base: 210, growth: 3.884, cores: [1, 1, 2, 2, 3, 3, 4, 5], requires: [['field', 1]],
      desc: 'Multiplies arc, drone and chain damage. Needs cores.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.amp, l)) + ' damage'; } },
    { id: 'surge', name: 'Surge', branch: 'arc', col: 0, row: 4, max: 8, base: 123, growth: 3.218, cores: null, requires: [['fork', 1]],
      desc: 'Chance for a triple-damage arc hit that ignores armor.',
      fmt: function (l) { return Math.round(LEVEL.surge * l * 100) + '% crit'; } },
    { id: 'chain', name: 'Chain Lightning', branch: 'arc', col: 1, row: 4, max: 5, base: 280, growth: 7.825, cores: [1, 1, 1, 2, 2], requires: [['fork', 1]],
      desc: 'A scrapped bot arcs to the nearest bot in reach for a share of your damage. Ignores armor.',
      fmt: function (l) { return l ? Math.round((LEVEL.chainBase + LEVEL.chainPer * l) * 100) + '% dmg jump' : 'none'; } },
    { id: 'overload', name: 'Overload', branch: 'arc', col: 1, row: 5, max: 5, base: 560, growth: 8.274, cores: [1, 1, 2, 2, 3], requires: [['chain', 1]],
      desc: 'A scrapped bot explodes, hurting its neighbours for a share of its own max HP. Ignores armor.',
      fmt: function (l) { return Math.round(LEVEL.overload * l * 100) + '% HP blast'; } },

    { id: 'cell', name: 'Power Cell', branch: 'chassis', tier: 1, icon: 'cell', max: 7, base: 5, growth: 1.866, cores: null, requires: [],
      desc: 'A bigger battery. Longer shifts.',
      fmt: function (l) { return '+' + FN(LEVEL.cell * l) + ' battery'; } },
    { id: 'cell2', name: 'Power Cell', branch: 'chassis', tier: 2, icon: 'cell', max: 7, base: 5 * Math.pow(1.866, 7), growth: 1.866, cores: null, requires: [['cell', 7]],
      desc: 'A bigger battery. Longer shifts.',
      fmt: function (l) { return '+' + FN(LEVEL.cell * l) + ' battery'; } },
    { id: 'cell3', name: 'Power Cell', branch: 'chassis', tier: 3, icon: 'cell', max: 6, base: 5 * Math.pow(1.866, 14), growth: 1.866, cores: null, requires: [['cell2', 7]],
      desc: 'A bigger battery. Longer shifts.',
      fmt: function (l) { return '+' + FN(LEVEL.cell * l) + ' battery'; } },
    { id: 'thrust', name: 'Thrusters', branch: 'chassis', col: 2, row: 2, max: 8, base: 14, growth: 3.486, cores: null, requires: [['cell', 1]],
      desc: 'Move faster. Dodge better.',
      fmt: function (l) { return '+' + FN(LEVEL.thrust * l) + ' speed'; } },
    { id: 'recycler', name: 'Recycler', branch: 'chassis', col: 2, row: 3, max: 5, base: 53, growth: 7.598, cores: null, requires: [['thrust', 1]],
      desc: 'Every scrapped bot gives a little charge back.',
      fmt: function (l) { return '+' + f2(LEVEL.recycler * l) + ' battery per bot'; } },
    { id: 'capacitor', name: 'Overclock', branch: 'chassis', col: 2, row: 4, max: 5, base: 158, growth: 9.036, cores: [1, 0, 1, 1, 2], requires: [['recycler', 1]],
      desc: 'Quick kills charge it (' + Math.round(1 / TUNE.ocPerKill) + ' in a row). Then: double pulse rate, ' + Math.round((1 - TUNE.ocDrainMul) * 100) + '% less drain, +' + Math.round((TUNE.ocSpeedMul - 1) * 100) + '% speed.',
      fmt: function (l) { return l ? (LEVEL.ocBase + l) + ' s overclock' : 'locked'; } },
    { id: 'coolant', name: 'Coolant Loop', branch: 'chassis', col: 2, row: 5, max: 5, base: 105, growth: 8.409, cores: null, requires: [['capacitor', 1]],
      desc: 'The battery drains more slowly as the shift heats up.',
      fmt: function (l) { return MINUS + Math.round(LEVEL.coolant * l * 100) + '% heat sag'; } },
    { id: 'plating', name: 'Plating', branch: 'chassis', col: 2, row: 6, max: 6, base: 140, growth: 5.957, cores: null, requires: [['coolant', 1]],
      desc: 'Hostile bots hit softer.',
      fmt: function (l) { return MINUS + Math.round(LEVEL.plating * l * 100) + '% damage taken'; } },
    { id: 'spare', name: 'Spare Cell', branch: 'chassis', col: 2, row: 7, max: 3, base: 875, growth: 48.99, cores: [1, 2, 3], requires: [['plating', 1]],
      desc: 'Once per shift, a flat battery restarts.',
      fmt: function (l) { return l ? 'restart at ' + Math.round(LEVEL.spare[l] * 100) + '%' : 'none'; } },

    { id: 'magnet', name: 'Magnet', branch: 'salvage', col: 3, row: 1, max: 8, base: 3, growth: 2.25, cores: null, requires: [],
      desc: 'Bolts fly to you from farther away.',
      fmt: function (l) { return '+' + FN(LEVEL.magnet * l) + ' pickup radius'; } },
    { id: 'sorter', name: 'Bolt Sorter', branch: 'salvage', tier: 1, icon: 'sorter', max: 8, base: 21, growth: 2.211, cores: null, requires: [['magnet', 1]],
      desc: 'Every bolt is worth more.',
      fmt: function (l) { return '+' + Math.round(LEVEL.sorter * l * 100) + '% bolts'; } },
    { id: 'sorter2', name: 'Bolt Sorter', branch: 'salvage', tier: 2, icon: 'sorter', max: 7, base: 21 * Math.pow(2.211, 8), growth: 2.211, cores: null, requires: [['sorter', 8]],
      desc: 'Every bolt is worth more.',
      fmt: function (l) { return '+' + Math.round(LEVEL.sorter * l * 100) + '% bolts'; } },
    { id: 'sweep', name: 'Yard Sweep', branch: 'salvage', col: 3, row: 3, max: 2, base: 105, growth: 100.0, cores: null, requires: [['sorter', 1]],
      desc: 'At shift end, pays out the bolts left on the floor and the value of bots still walking around.',
      fmt: function (l) { return l ? Math.round(LEVEL.sweep[l] * 100) + '% of leftovers' : 'none'; } },
    { id: 'lucky', name: 'Gold Sniffer', branch: 'salvage', col: 3, row: 4, max: 5, base: 175, growth: 7.953, cores: null, requires: [['sweep', 1]],
      desc: 'Gilded Bots turn up more often. They run.',
      fmt: function (l) { return '+' + f1(LEVEL.gildedPer * l * 100) + '% gilded chance'; } },
    { id: 'beacon', name: 'Lure Beacon', branch: 'salvage', col: 3, row: 5, max: 4, base: 263, growth: 14.938, cores: null, requires: [['lucky', 1]],
      desc: 'The Warden notices you sooner.',
      fmt: function (l) { return MINUS + Math.round(LEVEL.beacon * l * 100) + '% signal needed'; } },
    { id: 'extract', name: 'Core Extractor', branch: 'salvage', col: 3, row: 6, max: 3, base: 700, growth: 50.0, cores: [1, 2, 3], requires: [['beacon', 1]],
      desc: 'Wardens drop extra cores (never more than double). Elite bots sometimes drop one too.',
      fmt: function (l) { return l ? 'up to +' + l + (l === 1 ? ' core' : ' cores') + ' \u00b7 ' + Math.round(LEVEL.extractElite * l * 100) + '% elite' : 'none'; } },

    { id: 'drone', name: 'Drone Bay', branch: 'drones', col: 4, row: 1, max: 4, base: 88, growth: 27.144, cores: [1, 2, 2, 3], requires: [],
      desc: 'Adds an orbiting drone that zaps on its own for half your arc damage.',
      fmt: function (l) { return l + (l === 1 ? ' drone' : ' drones'); } },
    { id: 'dronedmg', name: 'Drone Coils', branch: 'drones', col: 4, row: 2, max: 5, base: 140, growth: 8.409, cores: null, requires: [['drone', 1]],
      desc: 'Drones hit harder.',
      fmt: function (l) { return Math.round((LEVEL.droneBase + LEVEL.droneDmgPer * l) * 100) + '% of arc'; } },
    { id: 'dronerate', name: 'Servo Sync', branch: 'drones', col: 4, row: 3, max: 6, base: 175, growth: 5.697, cores: null, requires: [['dronedmg', 1]],
      desc: 'Drones zap more often.',
      fmt: function (l) { return TIMES + f2(Math.pow(LEVEL.droneRate, l)) + ' interval'; } },
    { id: 'collector', name: 'Collector Arms', branch: 'drones', col: 4, row: 4, max: 1, base: 10500, growth: 1, cores: [1], requires: [['dronerate', 1]],
      desc: 'Drones pick up bolts they pass over.',
      fmt: function (l) { return l ? 'drones collect' : 'off'; } },

    { id: 'titan', name: 'Titan Frame', branch: 'core', col: 2, row: 8, max: 1, base: 200000, growth: 1, cores: [16],
      requires: [['overload', 1]], legacyReq: [['spare', 1], ['overload', 1], ['extract', 1], ['collector', 1]], actReq: { act: 1, levels: 90 },
      desc: 'Damage ' + TIMES + LEVEL.titan.damage + ', battery ' + TIMES + LEVEL.titan.battery + ', field ' + TIMES + LEVEL.titan.radius + '. The Overseer in Sector 5 will not come until you build this.',
      fmt: function (l) { return l ? TIMES + LEVEL.titan.damage + ' dmg, ' + TIMES + LEVEL.titan.battery + ' battery' : 'standard frame'; } },

    // ---- Act II: R&D (SPEC 11.8). gate: save flag that must be true or the node is CLASSIFIED. max Infinity = uncapped.
    { id: 'fusion', name: 'Fusion Coil', branch: 'rnd', tier: 1, icon: 'fusion', max: 4, base: 61000, growth: 4.07, cores: [2, 2, 3, 3], requires: [['titan', 1]], gate: 'act2',
      desc: 'Arc damage ' + TIMES + LEVEL.fusion + ' per level. Compounds. Needs cores.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.fusion, l)) + ' damage'; } },
    { id: 'fusion2', name: 'Fusion Coil', branch: 'rnd', tier: 2, icon: 'fusion', max: 3, base: 1.67e7, growth: 4.07, cores: [3, 3, 4], requires: [['fusion', 4]], gate: 'act2',
      desc: 'Arc damage ' + TIMES + LEVEL.fusion + ' per level. Compounds. Needs cores.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.fusion, l)) + ' damage'; } },
    { id: 'fusion3', name: 'Fusion Coil', branch: 'rnd', tier: 3, icon: 'fusion', max: 3, base: 1.13e9, growth: 4.07, cores: [4, 4, 5], requires: [['fusion2', 3]], gate: 'act2',
      desc: 'Arc damage ' + TIMES + LEVEL.fusion + ' per level. Compounds. Needs cores.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.fusion, l)) + ' damage'; } },
    { id: 'overdrive', name: 'Overdrive', branch: 'rnd', icon: 'fusion', max: 5, base: 896000, growth: 4.86, cores: [1, 1, 2, 2, 3], requires: [['overload', 1]], gate: 'act2',
      desc: 'Arc damage ' + TIMES + LEVEL.overdrive + ' per level. Runs the coil past the number on the label.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.overdrive, l)) + ' damage'; } },
    { id: 'arcfocus', name: 'Arc Focus', branch: 'rnd', icon: 'surge', max: 5, base: 1.22e6, growth: 5.37, cores: [1, 1, 1, 2, 2], requires: [['overdrive', 1]], gate: 'act2',
      desc: 'Arc damage ' + TIMES + LEVEL.arcfocus + ' per level. Same zap, fewer places to go.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.arcfocus, l)) + ' damage'; } },
    { id: 'supercell', name: 'Supercapacitor', branch: 'rnd', col: 2, row: 9, max: 8, base: 1.2e5, growth: 3.21, cores: null, requires: [['spare', 1]], gate: 'act2',
      desc: 'Battery +' + Math.round(LEVEL.supercell.battery * 100) + '% and heat sag ' + MINUS + Math.round(LEVEL.supercell.sag * 100) + '% per level.',
      fmt: function (l) { return '+' + FN(Math.round(LEVEL.supercell.battery * 100 * l)) + '% battery, ' + MINUS + FN(Math.round(LEVEL.supercell.sag * 100 * l)) + '% sag'; } },
    { id: 'dividends', name: 'Dividends', branch: 'rnd', tier: 1, icon: 'dividends', max: 5, base: 82400, growth: 3.79, cores: null, requires: [['extract', 1]], gate: 'act2',
      desc: 'Every bolt is worth ' + TIMES + LEVEL.dividends + ' more per level.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.dividends, l)) + ' bolts'; } },
    { id: 'dividends2', name: 'Dividends', branch: 'rnd', tier: 2, icon: 'dividends', max: 5, base: 6.44e7, growth: 3.79, cores: null, requires: [['dividends', 5]], gate: 'act2',
      desc: 'Every bolt is worth ' + TIMES + LEVEL.dividends + ' more per level.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.dividends, l)) + ' bolts'; } },
    { id: 'lattice', name: 'Tesla Lattice', branch: 'rnd', col: 4, row: 9, max: 5, base: 896000, growth: 5.86, cores: [2, 0, 2, 0, 3], requires: [['collector', 1]], gate: 'act2',
      desc: 'Beams link Sprocket and the drones. Bots touching a beam take drone damage every second.',
      fmt: function (l) { return l ? TIMES + FN(LEVEL.lattice * l) + ' drone dmg/s' : 'off'; } },
    { id: 'storm', name: 'Storm Coil', branch: 'rnd', col: 0, row: 10, max: 5, base: 1.06e6, growth: 5.86, cores: [2, 0, 2, 0, 3], requires: [['fusion', 1]], gate: 'act2',
      desc: 'Every few pulses, a storm hits every bot on the floor for triple damage. Ignores armor.',
      fmt: function (l) { return l ? 'every ' + (LEVEL.storm.base - l) + 'th pulse, ' + TIMES + LEVEL.storm.mult : 'off'; } },
    { id: 'singularity', name: 'Singularity', branch: 'rnd', col: 1, row: 10, max: 5, base: 1.5e6, growth: 6.34, cores: [2, 1, 2, 2, 3], requires: [['fusion', 1]], gate: 'act2',
      desc: 'Opens a well on the thickest crowd. It pulls bots and bolts in, then implodes.',
      fmt: function (l) { return l ? 'every ' + (LEVEL.singularity.base - l) + ' s, ' + TIMES + FN(LEVEL.singularity.mult + LEVEL.singularity.per * l) + ' implosion' : 'off'; } },
    { id: 'severance', name: 'Severance Package', branch: 'rnd', col: 2, row: 10, max: 3, base: 2.04e6, growth: 8.56, cores: [2, 3, 4], requires: [['supercell', 1]], gate: 'act2',
      desc: 'Once per shift, a flat battery goes out with a blast, then pays out the bolts on the floor at a bonus.',
      fmt: function (l) { return l ? 'blast ' + TIMES + LEVEL.severance.mult + ', payout ' + TIMES + LEVEL.severance.pay[l - 1] : 'off'; } },
    { id: 'stockopt', name: 'Stock Options', branch: 'rnd', col: 3, row: 10, max: 5, base: 730000, growth: 5.37, cores: null, requires: [['dividends', 1]], gate: 'act2',
      desc: 'Every ' + 10 + ' kills in a streak, bolts picked up for the rest of the shift are worth a little more.',
      fmt: function (l) { return l ? '+' + FN(Math.round(LEVEL.stockopt.step * 100 * l)) + '% per streak of ' + 10 + ', cap +' + FN(Math.round(LEVEL.stockopt.cap * 100 * l)) + '%' : 'off'; } },
    { id: 'rehire', name: 'Hostile Rehire', branch: 'rnd', col: 4, row: 10, max: 5, base: 1.22e6, growth: 5.86, cores: [1, 1, 1, 2, 2], requires: [['lattice', 1]], gate: 'act2',
      desc: 'Scrapped bots sometimes reboot as Interns on your side for a few seconds.',
      fmt: function (l) { return l ? FN(Math.round(LEVEL.rehire * 100 * l)) + '% Intern chance' : 'off'; } },
    { id: 'nanites', name: 'Nanite Swarm', branch: 'rnd', col: 0, row: 11, max: 5, base: 2.96e6, growth: 5.86, cores: [2, 1, 2, 2, 3], requires: [['storm', 1]], gate: 'act2',
      desc: 'Arc hits infect bots. Infected bots take damage over time and pass it on when scrapped.',
      fmt: function (l) { return l ? FN(Math.round(LEVEL.nanites * 100 * l)) + '% arc dmg/s' : 'off'; } },
    { id: 'parachute', name: 'Golden Parachute', branch: 'rnd', col: 3, row: 11, max: 3, base: 1.78e6, growth: 10.59, cores: null, requires: [['stockopt', 1]], gate: 'act2',
      desc: 'Yard Sweep pays out more than the full value of what is left.',
      fmt: function (l) { return l ? TIMES + LEVEL.parachute[l] + ' of leftovers' : 'off'; } },
    { id: 'takeover', name: 'Hostile Takeover', branch: 'rnd', col: 2, row: 12, max: 1, base: 1.2e9, growth: 1, cores: [30],
      requires: [['severance', 1]], legacyReq: [['fusion2', 1], ['severance', 1], ['parachute', 1], ['rehire', 1], ['nanites', 1]], actReq: { act: 2, levels: 38 }, gate: 'act2',
      desc: 'Sprocket becomes the Colossus: damage ' + TIMES + LEVEL.takeover.damage + ', battery ' + TIMES + LEVEL.takeover.battery + ', field ' + TIMES + LEVEL.takeover.radius + '. The Chairman will not come until you build this.',
      fmt: function (l) { return l ? TIMES + LEVEL.takeover.damage + ' dmg, ' + TIMES + LEVEL.takeover.battery + ' battery' : 'standard frame'; } },
    { id: 'overtimepay', name: 'Overtime Pay', branch: 'rnd', col: 1, row: 13, max: Infinity, base: 7.39e9, growth: 1.6, cores: null, requires: [['nanites', 1]], gate: 'chairman',
      desc: 'Damage ' + TIMES + LEVEL.overtimepay + ' per level. No limit. HR has stopped reading the forms.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.overtimepay, l)) + ' damage'; } },
    { id: 'hazardpay', name: 'Hazard Pay', branch: 'rnd', col: 3, row: 13, max: Infinity, base: 7.39e9, growth: 1.6, cores: null, requires: [['dividends2', 1]], gate: 'chairman',
      desc: 'Bolt value ' + TIMES + LEVEL.hazardpay + ' per level. No limit. The hazards are also uncapped.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.hazardpay, l)) + ' bolts'; } },

    // ---- Act III: Executive Suite (SPEC 12.8). All gate 'chairman'.
    { id: 'megacoil', name: 'Megacoil', branch: 'exec', tier: 1, icon: 'megacoil', max: 4, base: 2.24e11, growth: 2.06, cores: [2, 2, 3, 3], requires: [['takeover', 1]], gate: 'chairman',
      desc: 'Arc damage ' + TIMES + LEVEL.megacoil + ' per level. Facilities approved the wiring. Facilities has since resigned.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.megacoil, l)) + ' damage'; } },
    { id: 'megacoil2', name: 'Megacoil', branch: 'exec', tier: 2, icon: 'megacoil', max: 4, base: 4.02e12, growth: 2.06, cores: [4, 5, 6, 7], requires: [['megacoil', 4]], gate: 'chairman',
      desc: 'Arc damage ' + TIMES + LEVEL.megacoil + ' per level. Facilities approved the wiring. Facilities has since resigned.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.megacoil, l)) + ' damage'; } },
    { id: 'hardened', name: 'Hardened Coils', branch: 'exec', icon: 'plating', max: 5, base: 2.94e11, growth: 2.42, cores: [2, 3, 3, 4, 5], requires: [['arcfocus', 1]], gate: 'chairman',
      desc: 'Arc damage ' + TIMES + LEVEL.hardened + ' per level. Rated for continuous use. Nobody read the rating.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.hardened, l)) + ' damage'; } },
    { id: 'diligence', name: 'Due Diligence', branch: 'exec', col: 1, row: 14, max: 5, base: 7.3e10, growth: 2.6, cores: [2, 3, 5, 6, 7], requires: [['fusion3', 1]], gate: 'chairman',
      desc: 'Damage to Wardens ' + TIMES + LEVEL.diligence + ' per level. You read the small print. Out loud. At them.',
      fmt: function (l) { return TIMES + FN(Math.pow(LEVEL.diligence, l)) + ' vs Wardens'; } },
    { id: 'legal', name: 'Legal Team', branch: 'exec', col: 2, row: 14, max: 3, base: 1.39e11, growth: 3.05, cores: null, requires: [['severance', 1]], gate: 'chairman',
      desc: 'Holds are shorter, injunctions smaller, clawbacks lighter. Billed in hours you do not have.',
      fmt: function (l) { return l ? 'hold ' + MINUS + Math.round((1 - Math.pow(LEVEL.legal.hold, l)) * 100) + '%, injunction ' + MINUS + Math.round((1 - Math.pow(LEVEL.legal.injunction, l)) * 100) + '%, clawback ' + MINUS + Math.round((1 - Math.pow(LEVEL.legal.claw, l)) * 100) + '%' : 'off'; } },
    { id: 'compound', name: 'Compound Interest', branch: 'exec', col: 3, row: 14, max: 5, base: 2.74e11, growth: 2.42, cores: [0, 0, 0, 0, 4], requires: [['parachute', 1]], gate: 'chairman',
      desc: 'Bolts are worth more the longer the shift runs. Patience, finally monetised.',
      fmt: function (l) { return l ? '+' + Math.round(LEVEL.compound.step * 100 * l) + '% bolts per 10 s, cap +' + Math.round(LEVEL.compound.cap * 100 * l) + '%' : 'off'; } },
    { id: 'fleet', name: 'Drone Fleet', branch: 'exec', col: 4, row: 14, max: 3, base: 4.8e11, growth: 2.98, cores: [2, 4, 5], requires: [['rehire', 1]], gate: 'chairman',
      desc: 'One more drone per level, and every drone hits ' + TIMES + LEVEL.fleet.dmg + ' harder. Procurement did not ask.',
      fmt: function (l) { return l ? '+' + l + (l === 1 ? ' drone' : ' drones') + ', drones ' + TIMES + FN(Math.pow(LEVEL.fleet.dmg, l)) : 'off'; } },
    { id: 'insider', name: 'Insider Trading', branch: 'exec', col: 0, row: 15, max: 5, base: 1.39e11, growth: 2.6, cores: [0, 0, 0, 0, 4], requires: [['megacoil', 1]], gate: 'chairman',
      desc: 'Crits land more often and hit harder. Strictly a coincidence.',
      fmt: function (l) { return l ? '+' + Math.round(LEVEL.insider.crit * 100 * l) + '% crit, +' + f1(LEVEL.insider.mult * l) + ' crit mult' : 'off'; } },
    { id: 'orbital', name: 'Orbital Office', branch: 'exec', col: 1, row: 15, max: 5, base: 1.64e11, growth: 2.85, cores: [2, 0, 2, 0, 3], requires: [['diligence', 1]], gate: 'chairman',
      desc: 'A satellite marks the biggest bot on the floor and files a strike. Corner office, strictly speaking.',
      fmt: function (l) { return l ? 'every ' + (LEVEL.orbital.base - LEVEL.orbital.per * l) + ' s, ' + TIMES + FN(LEVEL.orbital.mult * l) + ' strike' : 'off'; } },
    { id: 'expense', name: 'Expense Account', branch: 'exec', col: 2, row: 15, max: 3, base: 2.44e11, growth: 3.25, cores: null, requires: [['legal', 1]], gate: 'chairman',
      desc: 'Scrapping while on a streak is reimbursed in battery. Receipts not required.',
      fmt: function (l) { return l ? '+' + f2(LEVEL.expense.step * l) + ' battery per scrap at x' + LEVEL.expense.combo + ', max +' + FN(LEVEL.expense.cap * l) + ' per shift' : 'off'; } },
    { id: 'restructure', name: 'Restructuring', branch: 'exec', col: 3, row: 15, max: 5, base: 5.64e11, growth: 2.53, cores: [2, 0, 2, 0, 3], requires: [['compound', 1]], gate: 'chairman',
      desc: 'Scrapped bots sometimes go out with a burst that takes the department with them. Effective immediately.',
      fmt: function (l) { return l ? Math.round(LEVEL.restructure.chance * 100 * l) + '% burst, ' + TIMES + LEVEL.restructure.mult + ' damage' : 'off'; } },
    { id: 'outsource', name: 'Outsourcing', branch: 'exec', col: 4, row: 15, max: 3, base: 6.93e11, growth: 3.06, cores: null, requires: [['fleet', 1], ['rehire', 1]], gate: 'chairman',
      desc: 'Interns last longer, come in greater numbers and bite harder. Contractors, technically.',
      fmt: function (l) { return l ? 'Interns +' + (LEVEL.outsource.life * l) + ' s, +' + (LEVEL.outsource.max * l) + ' max, ' + TIMES + FN(Math.pow(LEVEL.outsource.contact, l)) + ' bite' : 'off'; } },
    { id: 'stake', name: 'Majority Stake', branch: 'exec', col: 2, row: 16, max: 1, base: 8.42e12, growth: 1, cores: [30],
      requires: [['restructure', 1]], legacyReq: [['megacoil2', 1], ['orbital', 1], ['restructure', 1], ['insider', 1], ['expense', 1], ['outsource', 1]], actReq: { act: 3, levels: 39 }, gate: 'chairman',
      desc: 'Sprocket becomes the Magnate: damage ' + TIMES + LEVEL.stake.damage + ', battery ' + TIMES + LEVEL.stake.battery + ', field ' + TIMES + LEVEL.stake.radius + '. The Founder will not come until you own the company.',
      fmt: function (l) { return l ? TIMES + LEVEL.stake.damage + ' dmg, ' + TIMES + LEVEL.stake.battery + ' battery' : 'standard frame'; } }
  ];


  // ---------------------------------------------------------------------------
  // Rogue bots (SPEC 4.4). contact = battery per second; hostile bots set hostile:true.
  // ---------------------------------------------------------------------------
  var ENEMIES = [
    { id: 'scrapling', name: 'Scrapling', serial: 'SCR-3', blurb: 'Wanders in circles. Has never filed a complaint.',
      hp: 3, r: 11, speed: 24, bolts: 1, signal: 1, behaviour: 'drift' },
    { id: 'roller', name: 'Roller', serial: 'RLR-7', blurb: 'One wheel, one direction, no brakes.',
      hp: 5, r: 12, speed: 70, bolts: 2, signal: 1, behaviour: 'roll' },
    { id: 'sparker', name: 'Sparker', serial: 'SPK-12', blurb: 'Short fuse. Follows you home and zaps your ankles.',
      hp: 8, r: 12, speed: 46, bolts: 3, signal: 2, behaviour: 'chase', hostile: true, contact: 2.5 },
    { id: 'shieldbot', name: 'Bulwark', serial: 'BLW-5', blurb: 'Plated. Plain zaps do half damage. Crits, chains and blasts ignore the plating.',
      hp: 16, r: 15, speed: 18, bolts: 6, signal: 2, behaviour: 'drift', armor: 0.5 },
    { id: 'hauler', name: 'Hauler', serial: 'HLR-40', blurb: 'Slow, heavy and full of other robots\' lunch money. Sometimes a spare cell.',
      hp: 45, r: 22, speed: 12, bolts: 16, signal: 4, behaviour: 'drift', cellChance: 0.25 },
    { id: 'splitter', name: 'Splitter', serial: 'SPL-9', blurb: 'Scrap it and it becomes three smaller problems.',
      hp: 10, r: 15, speed: 28, bolts: 3, signal: 2, behaviour: 'drift', split: { type: 'mite', n: 3 } },
    { id: 'mite', name: 'Mite', serial: 'MIT-1', blurb: 'Fast, tiny, terrified.',
      hp: 2, r: 7, speed: 80, bolts: 1, signal: 0, behaviour: 'flee' },
    { id: 'turret', name: 'Sentry', serial: 'SNT-6', blurb: 'Picks a spot, plants itself and shoots at your general direction.',
      hp: 18, r: 14, speed: 30, bolts: 7, signal: 3, behaviour: 'plant', hostile: true,
      shoot: { every: 2.6, speed: 110, dmg: 3 } },
    { id: 'bomber', name: 'Fuse', serial: 'FUS-8', blurb: 'Runs at you. Goes off on arrival. Do not hug.',
      hp: 6, r: 12, speed: 85, bolts: 3, signal: 2, behaviour: 'bomber', hostile: true,
      contactDmg: 5, blastMul: 3, blastR: 60 },
    { id: 'gilded', name: 'Gilded Bot', serial: 'AU-79', blurb: 'Rumoured to exist. Pays well. Runs off after nine seconds.',
      hp: 12, r: 12, speed: 95, bolts: 40, signal: 0, behaviour: 'flee', leave: 9 },
    { id: 'pylon', name: 'Shield Pylon', serial: 'PYL-2', blurb: 'Holds a Warden\'s shield up. Does nothing else, which is the point.',
      hp: 30, r: 13, speed: 0, bolts: 0, signal: 0, behaviour: 'static' },

    // ---- Act II bots (SPEC 11.5)
    { id: 'repo', name: 'Repo Bot', serial: 'REPO-11', blurb: 'Here to repossess your bolts. Grabs a handful, then runs. Chase it.',
      hp: 10, r: 12, speed: 70, bolts: 4, signal: 2, behaviour: 'repo', hostile: true,
      steal: { pct: 0.05, flee: 6, refund: 1.5 } },
    { id: 'printer', name: 'Pallet Printer', serial: 'PRT-4', blurb: 'Prints more Mites on demand. Nobody approved the budget.',
      hp: 40, r: 16, speed: 0, walk: 40, bolts: 8, signal: 3, behaviour: 'printer', armor: 0.5,
      print: { every: 4, n: 2, type: 'mite' } },
    { id: 'laser', name: 'Laser Drone', serial: 'LZR-3', blurb: 'Draws a straight line through you. Please stand somewhere else.',
      hp: 14, r: 12, speed: 40, bolts: 6, signal: 3, behaviour: 'laser', hostile: true,
      laser: { every: 3.5, windup: 0.9, fire: 0.5, w: 14, dmg: 4 } },
    { id: 'firenode', name: 'Firewall Node', serial: 'FWN-0', blurb: 'Keeps the neighbours safe from your arc. Terms and conditions apply.',
      hp: 60, r: 14, speed: 0, walk: 40, bolts: 10, signal: 3, behaviour: 'firenode',
      shield: { range: 90 } },
    { id: 'auditor', name: 'Auditor', serial: 'AUD-8', blurb: 'Appears without notice. Lands on your expenses.',
      hp: 22, r: 12, speed: 0, bolts: 8, signal: 3, behaviour: 'auditor', hostile: true,
      audit: { every: 3, windup: 0.5, min: 60, max: 120, slam: { r: 34, windup: 0.8, dmg: 4 } } },
    { id: 'mimic', name: 'Mimic', serial: 'MMC-6', blurb: 'Looks like a bolt. Is not a bolt. Please stop picking it up.',
      hp: 30, r: 10, speed: 75, bolts: 24, signal: 2, behaviour: 'mimic', hostile: true, contact: 4,
      wake: 40 },

    // ---- Act III bots (SPEC 12.4)
    { id: 'spam', name: 'Spam', serial: 'SPM-0', blurb: 'Unsolicited. Arrives in bulk. Cannot be unsubscribed from.',
      hp: 2, r: 6, speed: 95, bolts: 1, signal: 0.25, behaviour: 'chase', hostile: true, contact: 1, burst: 8 },
    { id: 'courier', name: 'Courier Drone', serial: 'CRR-2', blurb: 'Carrying something important across the floor. Will not stop to discuss it.',
      hp: 12, r: 10, speed: 150, bolts: 30, signal: 2, behaviour: 'courier' },
    { id: 'paralegal', name: 'Paralegal', serial: 'PLG-5', blurb: 'Files injunctions at billable speed. Has never read one.',
      hp: 20, r: 12, speed: 50, bolts: 8, signal: 3, behaviour: 'paralegal', hostile: true,
      injunction: { every: 5, r: 40, windup: 0.9, life: 5 } },
    { id: 'copier', name: 'Photocopier', serial: 'CPY-9', blurb: 'Makes copies of colleagues. Jammed on ethics.',
      hp: 36, r: 15, speed: 0, walk: 40, bolts: 10, signal: 3, behaviour: 'copier', armor: 0.3,
      copy: { every: 5, range: 140, hp: 0.6, bolts: 0.5 } },
    { id: 'hr', name: 'HR Rep', serial: 'HRR-1', blurb: 'Here to support everyone, except you. Keeps a respectful distance.',
      hp: 26, r: 12, speed: 55, bolts: 9, signal: 3, behaviour: 'hr',
      heal: { min: 100, max: 160, range: 110, pct: 0.04 } }
  ];


  // ---------------------------------------------------------------------------
  // Wardens (SPEC 4.6). Attacks are data-driven; `phases` on an attack limits it to those phase numbers.
  // Phase definitions: hp = fraction at/below which the phase starts; cadence multiplies attack intervals.
  // shields: hp fractions at which the boss goes invulnerable and calls pylons.
  // ---------------------------------------------------------------------------
  var BOSSES = [
    { id: 'compactor', name: 'The Compactor', serial: 'WRD-1', blurb: 'Presses things flat. Currently pressing you.',
      hp: 137, r: 32, move: 'chase', speed: 26, contact: 4, bolts: 60,
      attacks: [{ kind: 'slam', every: 4, r: 60, windup: 1.4, dmg: 4 }] },
    { id: 'shredder', name: 'The Shredder', serial: 'WRD-2', blurb: 'Teeth first, questions never.',
      hp: 1257, r: 30, move: 'chase', speed: 20, contact: 4, bolts: 400,
      attacks: [{ kind: 'charge', every: 3.8, windup: 1.1, speed: 420, dmg: 6 },
                { kind: 'summon', every: 9, type: 'roller', n: 3 }] },
    { id: 'furnace', name: 'Furnace Mother', serial: 'WRD-3', blurb: 'Keeps the Smelter warm. Hates guests.',
      hp: 4150, r: 38, move: 'static', speed: 0, contact: 0, bolts: 2200,
      attacks: [{ kind: 'ring', every: 3.2, n: 10, speed: 85, dmg: 4 },
                { kind: 'summon', every: 7, type: 'bomber', n: 2 },
                { kind: 'slam', every: 6, r: 64, windup: 1.3, dmg: 5 }] },
    { id: 'foreman', name: 'Foreman Unit', serial: 'WRD-4', blurb: 'Sets the pace. Yours is too slow.',
      hp: 6400, r: 32, move: 'chase', speed: 30, contact: 5, bolts: 9000,
      shields: [0.75, 0.4], pylonFrac: 0.03,
      attacks: [{ kind: 'charge', every: 4.5, windup: 1.1, speed: 440, dmg: 7 },
                { kind: 'ring', every: 5, n: 8, speed: 85, dmg: 4 }] },
    { id: 'overseer', name: 'The Overseer', serial: 'WRD-5', blurb: 'Yard 9 management. Your shift was supposed to be over.',
      hp: 68000, r: 42, move: 'chase', speed: 18, contact: 6, bolts: 0,
      shields: [0.33], pylonFrac: 0.02,
      phases: [{ hp: 1, cadence: 1 }, { hp: 0.66, cadence: 1 }, { hp: 0.33, cadence: 0.75 }],
      attacks: [{ kind: 'slam', every: 3.2, r: 60, windup: 1.4, dmg: 5, phases: [1, 3] },
                { kind: 'summon', every: 8, type: 'sparker', n: 2, phases: [1, 3] },
                { kind: 'charge', every: 4, windup: 1.0, speed: 460, dmg: 7, phases: [2, 3] },
                { kind: 'ring', every: 4, n: 10, speed: 90, dmg: 4, phases: [2, 3] }] },

    // ---- Act II Wardens (SPEC 11.7)
    { id: 'forklift', name: 'The Forklift', serial: 'WRD-6', blurb: 'Lifts heavy things. Currently: you.',
      hp: 1.5e5, r: 34, move: 'chase', speed: 34, contact: 6, bolts: 6e4,
      attacks: [{ kind: 'charge', every: 3.2, windup: 0.9, speed: 480, dmg: 8 },
                { kind: 'barrage', every: 6, n: 3, r: 46, windup: 0.9, gap: 0.3, spread: 70, dmg: 7 },
                { kind: 'summon', every: 12, type: 'printer', n: 2 }] },
    { id: 'firewall', name: 'The Firewall', serial: 'WRD-7', blurb: 'Blocks all inbound traffic. You are inbound.',
      hp: 2.5e5, r: 40, move: 'static', speed: 0, contact: 0, bolts: 2e5,
      shields: [0.7, 0.35], pylonType: 'firenode', pylons: 4, pylonFrac: 0.12,
      attacks: [{ kind: 'ring', every: 2.6, n: 16, speed: 95, dmg: 6 },
                { kind: 'laser', every: 5, n: 2, windup: 1.0, fire: 0.6, w: 18, dmg: 10, fan: 0.6 }] },
    { id: 'inspector', name: 'The Inspector', serial: 'WRD-8', blurb: 'Appears without warning. Finds fault anyway.',
      hp: 5e6, r: 30, move: 'blink', speed: 0, contact: 6, bolts: 6e5,
      blink: { every: 5, windup: 0.7 },
      attacks: [{ kind: 'barrage', every: 5.5, pattern: 'grid', n: 6, r: 40, windup: 1.0, gap: 0.12, spread: 72, dmg: 8 },
                { kind: 'summon', every: 9, type: 'auditor', n: 2 }] },
    { id: 'vp', name: 'The Vice President', serial: 'WRD-9', blurb: 'Reports to the Chairman. Reports on you.',
      hp: 3e7, r: 36, move: 'chase', speed: 26, contact: 7, bolts: 2e6,
      phases: [{ hp: 1, cadence: 1 }, { hp: 0.5, cadence: 0.85 }],
      attacks: [{ kind: 'laser', every: 4.5, n: 1, windup: 0.8, fire: 0.6, w: 16, dmg: 12, phases: [1, 2] },
                { kind: 'summon', every: 8, type: 'repo', n: 3, phases: [1, 2] },
                { kind: 'ring', every: 4, n: 12, speed: 105, dmg: 7, phases: [2] },
                { kind: 'budget', perSec: 0.6, phases: [2] }] },
    { id: 'chairman', name: 'The Chairman', serial: 'WRD-10', blurb: 'Owns the building, the yard and, per the small print, you.',
      hp: 1.5e8, r: 44, move: 'chase', speed: 20, contact: 8, bolts: 0,
      moveByPhase: { 4: 'blink' }, blink: { every: 4, windup: 0.6 },
      shields: [0.5], pylons: 3,
      phases: [{ hp: 1, cadence: 1 }, { hp: 0.75, cadence: 1 }, { hp: 0.5, cadence: 1 }, { hp: 0.25, cadence: 0.6 }],
      attacks: [{ kind: 'slam', every: 3, r: 66, windup: 1.0, dmg: 9, phases: [1, 4] },
                { kind: 'summon', every: 8, type: 'sparker', n: 3, phases: [1, 4] },
                { kind: 'charge', every: 3.6, windup: 0.8, speed: 480, dmg: 10, phases: [2, 4] },
                { kind: 'laser', every: 5, n: 3, fan: 0.5, windup: 0.9, fire: 0.5, w: 16, dmg: 12, phases: [2, 4] },
                { kind: 'ring', every: 3.4, n: 14, speed: 110, dmg: 8, phases: [3, 4] },
                { kind: 'barrage', every: 6, n: 5, r: 44, windup: 0.9, gap: 0.2, spread: 90, dmg: 9, phases: [3, 4] },
                { kind: 'budget', perSec: 1.0, phases: [4] }] },

    // ---- Act III Wardens (SPEC 12.6). hp/bolts start at the Act II ratio to the sector's own numbers; Balance tunes them.
    { id: 'receptionist', name: 'The Receptionist', serial: 'WRD-11', blurb: 'Your call is important to us. Please continue to hold.',
      hp: 2.5e8, r: 32, move: 'drift', speed: 30, contact: 6, bolts: 2e7,
      attacks: [{ kind: 'hold', every: 4, n: 3, r: 40, windup: 1.0, spread: 80, stun: 0.8, dmg: 6 },
                { kind: 'ring', every: 3, n: 12, speed: 100, dmg: 6 },
                { kind: 'summon', every: 10, type: 'spam', n: 2 }] },
    { id: 'counsel', name: 'The General Counsel', serial: 'WRD-12', blurb: 'Objects to everything. Sustained.',
      hp: 2.0e9, r: 34, move: 'chase', speed: 24, contact: 7, bolts: 6e7,
      attacks: [{ kind: 'injunction', every: 6, n: 3, r: 50, windup: 0.8, life: 6 },
                { kind: 'laser', every: 5, n: 2, fan: 0.4, windup: 0.9, fire: 0.5, w: 16, dmg: 12 },
                { kind: 'summon', every: 12, type: 'paralegal', n: 2 }] },
    { id: 'comptroller', name: 'The Comptroller', serial: 'WRD-13', blurb: 'Has found an error in your favour. Correcting it.',
      hp: 4.6e9, r: 40, move: 'static', speed: 0, contact: 0, bolts: 2e8,
      shields: [0.6], pylons: 3,
      attacks: [{ kind: 'clawback', every: 6, pct: 0.04 },
                { kind: 'barrage', every: 5, pattern: 'grid', n: 6, r: 40, windup: 1.0, gap: 0.12, spread: 72, dmg: 9 },
                { kind: 'summon', every: 14, type: 'copier', n: 1 }] },
    { id: 'market', name: 'The Market', serial: 'WRD-14', blurb: 'Up 4%. Down 6%. Nobody knows why.',
      hp: 2.5e10, r: 40, move: 'chase', speed: 30, contact: 8, bolts: 6e8,
      phases: [{ hp: 1, cadence: 1, name: 'bull' }, { hp: 0.5, cadence: 1, name: 'bear' }],
      attacks: [{ kind: 'volatility', period: 6, lo: 0.25, hi: 2.5 },
                { kind: 'charge', every: 2.6, windup: 0.7, speed: 560, dmg: 10, phases: [1] },
                { kind: 'slam', every: 2.8, r: 70, windup: 0.9, dmg: 11, phases: [2] },
                { kind: 'ring', every: 3.5, n: 14, speed: 110, dmg: 8, phases: [2] },
                { kind: 'summon', every: 9, type: 'courier', n: 3 }] },
    { id: 'founder', name: 'The Founder', serial: 'WRD-15', blurb: 'Built Yard 9 out of scrap. Then built a company. Then built you.',
      hp: 2.4e12, r: 46, move: 'chase', speed: 22, contact: 9, bolts: 1.8e9,
      moveByPhase: { 2: 'blink', 5: 'blink' }, blink: { every: 4.5, windup: 0.7 },
      phases: [{ hp: 1, cadence: 1 }, { hp: 0.8, cadence: 1 }, { hp: 0.6, cadence: 0.85 }, { hp: 0.4, cadence: 0.7 }, { hp: 0.2, cadence: 0.5 }],
      attacks: [{ kind: 'slam', every: 3.2, r: 62, windup: 1.1, dmg: 22, phases: [1, 5] },
                { kind: 'charge', every: 4, windup: 0.9, speed: 480, dmg: 27, phases: [1, 5] },
                { kind: 'ring', every: 3.6, n: 12, speed: 100, dmg: 20, phases: [1, 5] },
                { kind: 'laser', every: 5, n: 3, fan: 0.45, windup: 0.9, fire: 0.5, w: 16, dmg: 29, phases: [2, 5] },
                { kind: 'barrage', every: 5.5, pattern: 'grid', n: 6, r: 40, windup: 1.0, gap: 0.12, spread: 72, dmg: 22, phases: [2, 5] },
                { kind: 'hold', every: 5, n: 3, r: 40, windup: 1.0, spread: 90, stun: 0.8, dmg: 18, phases: [3, 5] },
                { kind: 'injunction', every: 7, n: 3, r: 50, windup: 0.8, life: 6, phases: [3, 5] },
                { kind: 'clawback', every: 7, pct: 0.04, phases: [3, 5] },
                { kind: 'aura', r: 90, dps: 16, phases: [4, 5] },
                { kind: 'summon', every: 11, type: 'hr', n: 2, phases: [4, 5] },
                { kind: 'summon', every: 9, type: 'spam', n: 1, phases: [4, 5] }] }
  ];


  // ---------------------------------------------------------------------------
  // Sectors (SPEC 4.5). mix entries: { type, w, after }
  // ---------------------------------------------------------------------------
  function mix(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push({ type: arr[i][0], w: arr[i][1], after: arr[i][2] || 0 });
    return out;
  }
  // Act III sector mixes: the sector-10 mix scaled by k (SPEC 12.3), then the new bots on top
  function ACT3_BASE(k) {
    var b = [['sparker', 12], ['shieldbot', 12], ['hauler', 8], ['splitter', 6], ['bomber', 12], ['turret', 8], ['repo', 10], ['printer', 6], ['laser', 10], ['firenode', 5], ['auditor', 10], ['mimic', 5]], i, out = [];
    for (i = 0; i < b.length; i++) out.push([b[i][0], Math.round(b[i][1] * k * 10) / 10]);
    return out;
  }
  var SECTORS = [
    { n: 1, name: 'Conveyor Yard', hp: 1, bolts: 1, dmg: 1, need: 24, cap: 16, warden: 'compactor', coresFirst: 2, coresRepeat: 1,
      mix: mix([['scrapling', 70], ['roller', 30], ['sparker', 12, 15]]) },
    { n: 2, name: 'Crusher Row', hp: 4, bolts: 2.9, dmg: 1.3, need: 54, cap: 18, warden: 'shredder', coresFirst: 3, coresRepeat: 1,
      mix: mix([['scrapling', 35], ['roller', 25], ['sparker', 15], ['shieldbot', 15], ['hauler', 6], ['splitter', 8]]) },
    { n: 3, name: 'The Smelter', hp: 12, bolts: 6.2, dmg: 1.7, need: 125, cap: 20, warden: 'furnace', coresFirst: 4, coresRepeat: 1,
      mix: mix([['scrapling', 20], ['roller', 15], ['sparker', 14], ['shieldbot', 14], ['hauler', 8], ['splitter', 12], ['bomber', 12], ['turret', 8]]) },
    { n: 4, name: 'Assembly Line', hp: 36, bolts: 13.2, dmg: 2.2, need: 140, cap: 22, warden: 'foreman', coresFirst: 5, coresRepeat: 1,
      mix: mix([['scrapling', 10], ['roller', 15], ['sparker', 15], ['shieldbot', 16], ['hauler', 10], ['splitter', 12], ['bomber', 14], ['turret', 12]]) },
    { n: 5, name: 'Core Vault', hp: 110, bolts: 29, dmg: 1.8, need: 52, cap: 24, warden: 'overseer', coresFirst: 0, coresRepeat: 0,
      mix: mix([['roller', 14], ['sparker', 16], ['shieldbot', 18], ['hauler', 12], ['splitter', 12], ['bomber', 16], ['turret', 14]]) },

    // ---- Act II (SPEC 11.4). Sector 11 (Overtime) is scaled per level by the engine; its warden/cores are set there.
    { n: 6, name: 'Loading Dock B', hp: 500, bolts: 92, dmg: 2.3, need: 75, cap: 24, warden: 'forklift', coresFirst: 5, coresRepeat: 2,
      mix: mix([['scrapling', 6], ['roller', 10], ['sparker', 14], ['shieldbot', 14], ['hauler', 10], ['splitter', 10], ['bomber', 12], ['turret', 10], ['repo', 10], ['printer', 6]]) },
    { n: 7, name: 'Server Farm', hp: 1800, bolts: 290, dmg: 3, need: 110, cap: 25, warden: 'firewall', coresFirst: 6, coresRepeat: 1,
      mix: mix([['roller', 8], ['sparker', 12], ['shieldbot', 14], ['hauler', 10], ['splitter', 10], ['bomber', 12], ['turret', 8], ['repo', 8], ['printer', 6], ['laser', 8], ['firenode', 4]]) },
    { n: 8, name: 'Quality Control', hp: 10000, bolts: 930, dmg: 3.9, need: 200, cap: 26, warden: 'inspector', coresFirst: 7, coresRepeat: 1,
      mix: mix([['sparker', 12], ['shieldbot', 12], ['hauler', 8], ['splitter', 8], ['bomber', 12], ['turret', 8], ['repo', 8], ['printer', 6], ['laser', 8], ['firenode', 5], ['auditor', 8], ['mimic', 4]]) },
    { n: 9, name: 'Executive Elevator', hp: 46000, bolts: 2900, dmg: 5.1, need: 90, cap: 26, warden: 'vp', coresFirst: 8, coresRepeat: 3,
      mix: mix([['sparker', 12], ['shieldbot', 12], ['hauler', 8], ['splitter', 6], ['bomber', 12], ['turret', 8], ['repo', 10], ['printer', 6], ['laser', 10], ['firenode', 5], ['auditor', 10], ['mimic', 5]]) },
    { n: 10, name: 'The Boardroom', hp: 2.1e5, bolts: 9300, dmg: 6.6, need: 300, cap: 26, warden: 'chairman', coresFirst: 0, coresRepeat: 3,
      mix: mix([['sparker', 12], ['shieldbot', 12], ['hauler', 8], ['splitter', 6], ['bomber', 12], ['turret', 8], ['repo', 10], ['printer', 6], ['laser', 10], ['firenode', 5], ['auditor', 10], ['mimic', 5]]) },

    // ---- Act III (SPEC 12.3). Sector 16 (Overtime) is scaled per level by the engine; its warden/cores are set there.
    { n: 11, name: 'The Lobby', hp: 9.5e5, bolts: 30000, dmg: 8.5, need: 240, cap: 26, warden: 'receptionist', coresFirst: 8, coresRepeat: 3,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 6]])) },
    { n: 12, name: 'Legal', hp: 4.3e6, bolts: 94000, dmg: 11, need: 256, cap: 26, warden: 'counsel', coresFirst: 6, coresRepeat: 3,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 6], ['paralegal', 10]])) },
    { n: 13, name: 'Accounting', hp: 2e7, bolts: 3e5, dmg: 14.3, need: 272, cap: 26, warden: 'comptroller', coresFirst: 8, coresRepeat: 5,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 6], ['paralegal', 10], ['copier', 8]])) },
    { n: 14, name: 'The Trading Floor', hp: 8.8e7, bolts: 9.5e5, dmg: 18.5, need: 288, cap: 26, warden: 'market', coresFirst: 10, coresRepeat: 5,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 10], ['paralegal', 10], ['copier', 8], ['hr', 8]])) },
    { n: 15, name: 'Head Office', hp: 4e8, bolts: 3e6, dmg: 34, need: 304, cap: 26, warden: 'founder', coresFirst: 0, coresRepeat: 3,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 10], ['paralegal', 10], ['copier', 8], ['hr', 8]])) },
    { n: 16, name: 'Overtime', hp: 4e8, bolts: 3e6, dmg: 34, need: 1000, cap: 26, warden: 'forklift', coresFirst: 0, coresRepeat: 0, overtime: true,
      mix: mix(ACT3_BASE(0.7).concat([['spam', 14], ['courier', 10], ['paralegal', 10], ['copier', 8], ['hr', 8]])) }
  ];


  // ---------------------------------------------------------------------------
  // Blueprint layout (SPEC 12.15): pos = [x, y] in grid units, Sprocket at [0, 0], y down. Layout is data only.
  // Act I fills radius ~1-5, Act II ~5-9, Act III ~9-12.
  // ---------------------------------------------------------------------------
  var POS = {
    boot: [0, 0],
    // Act I: arc (north), chassis (west, curling south), salvage (east, curling south), drones (south)
    coil: [0, -1], coil2: [-1, -1], coil3: [-2, -1], pulse: [-1, -2], pulse2: [-2, -2], field: [1, -2], field2: [2, -2],
    fork: [-1, -3], surge: [-2, -3], chain: [0, -3], amp: [1, -3], overload: [0, -4],
    cell: [-1, 0], thrust: [-2, 0], recycler: [-3, 0], cell2: [-1, 1], cell3: [-2, 1],
    capacitor: [-3.8, 0.7], coolant: [-3.8, 1.8], plating: [-3, 2.6], spare: [-2, 3.4],
    drone: [0, 1], dronedmg: [0, 2], dronerate: [0, 3], collector: [0, 4],
    magnet: [1, 0], sorter: [2, 0], sorter2: [2, 1], sweep: [3, 0], lucky: [4, 0], beacon: [4, -1], extract: [4, -2],
    // Act II / III: polar-placed arms, spread round the circle; capstones hang off one neighbour
    titan: [-3.2, -4.4], overdrive: [0, -5.3], arcfocus: [-1.4, -6.4], hardened: [-0.3, -7.7], fusion: [-4.7, -4.7], fusion2: [-6.2, -3.7], fusion3: [-7.4, -2.3], storm: [-3.8, -6.6], singularity: [-5.5, -5.9], nanites: [-2.7, -8.4], diligence: [-8.8, -0.8], orbital: [-9.1, -3.1], overtimepay: [-4.5, -8.9], supercell: [-2.8, 4.5], severance: [-4.4, 4.6], takeover: [-6.4, 4], megacoil: [-8.3, 3], megacoil2: [-9.7, 1.5], insider: [-8.1, 5.5], legal: [-3.8, 6.6], expense: [-2.7, 8.4], lattice: [0.7, 5.2], rehire: [2.5, 5.9], fleet: [0.8, 7.6], outsource: [4.9, 6.2], dividends: [4.8, -3.3], dividends2: [4.6, -5.1], stockopt: [6.2, -2.5], parachute: [7.3, -1], hazardpay: [4.9, -7], compound: [8.7, 0.6], restructure: [9.2, 3.2], stake: [9.1, 6.6]
  };
  (function () {
    for (var j = 0; j < UPGRADES.length; j++) {
      var u = UPGRADES[j], p = POS[u.id];
      if (!p) throw new Error('no layout position for ' + u.id);
      u.pos = [p[0], p[1]];
      if (u.col === undefined) { u.col = Math.round(p[0]); u.row = Math.round(p[1]); }   // legacy grid coordinates (compat only)
    }
  })();

  // Loadout tier thresholds (total levels bought in the branch) SPEC 4.3
  var TIERS = { arc: [1, 12, 30], chassis: [1, 10, 25], salvage: [1, 8, 20], rnd: [1, 15, 35], exec: [1, 12, 28] };

  // Indexes
  var UPGRADE_BY_ID = {}, ENEMY_BY_ID = {}, BOSS_BY_ID = {}, i;
  for (i = 0; i < UPGRADES.length; i++) UPGRADE_BY_ID[UPGRADES[i].id] = UPGRADES[i];
  for (i = 0; i < ENEMIES.length; i++) ENEMY_BY_ID[ENEMIES[i].id] = ENEMIES[i];
  for (i = 0; i < BOSSES.length; i++) BOSS_BY_ID[BOSSES[i].id] = BOSSES[i];

  BY.Data = {
    TICK: TICK, PLAYER: PLAYER, LEVEL: LEVEL, TUNE: TUNE, TIERS: TIERS,
    UPGRADES: UPGRADES, ENEMIES: ENEMIES, BOSSES: BOSSES, SECTORS: SECTORS, OVERTIME: OVERTIME,
    UPGRADE_BY_ID: UPGRADE_BY_ID, ENEMY_BY_ID: ENEMY_BY_ID, BOSS_BY_ID: BOSS_BY_ID,
    ARENA_W: 360
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
