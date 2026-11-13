(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};
  var D = BY.Data, E = BY.Engine;
  var EN = D.ENEMY_BY_ID, BOSS = D.BOSS_BY_ID, UPID = D.UPGRADE_BY_ID, UP = D.UPGRADES;
  var states = new WeakMap();

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rng(s) {
    var a = (s.rs = (s.rs + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function stateOf(run) {
    var s = states.get(run);
    if (!s) {
      s = { rs: (run.seed * 2654435761) | 0 || 7, next: 0, ignore: false, off: { x: 0, y: 0 }, tgt: { x: run.player.x, y: run.player.y },
            out: { x: run.player.x, y: run.player.y }, lastId: 0 };
      states.set(run, s);
    }
    return s;
  }

  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  // Where to be to dodge hazards. Returns true and writes into out when a dodge is needed.
  function hazardEscape(run, out) {
    var p = run.player, hz = run.hazards, i, h, k;
    for (i = 0; i < hz.length; i++) {
      h = hz[i];
      if (h.kind === 'slam') {
        var d = Math.hypot(p.x - h.x, p.y - h.y);
        if (d < h.r + p.r + 14) {
          var bestD = 1e9, bx = p.x, by = p.y, far = -1, fx = p.x, fy = p.y, found = false;
          for (k = 0; k < 8; k++) {
            var a = k * Math.PI / 4;
            var cx = clamp(h.x + Math.cos(a) * (h.r + p.r + 24), p.r, run.w - p.r);
            var cy = clamp(h.y + Math.sin(a) * (h.r + p.r + 24), p.r, run.h - p.r);
            var dc = Math.hypot(cx - h.x, cy - h.y);
            var travel = Math.hypot(cx - p.x, cy - p.y);
            if (dc > far) { far = dc; fx = cx; fy = cy; }
            if (dc > h.r + p.r + 6 && travel < bestD) { bestD = travel; bx = cx; by = cy; found = true; }
          }
          out.x = found ? bx : fx; out.y = found ? by : fy;
          return true;
        }
      } else if (h.kind === 'charge') {
        var hw = h.w / 2 + p.r + 14;
        var sd = segDist(p.x, p.y, h.x, h.y, h.x2, h.y2);
        if (sd < hw) {
          var len = Math.hypot(h.x2 - h.x, h.y2 - h.y) || 1;
          var ux = (h.x2 - h.x) / len, uy = (h.y2 - h.y) / len, nx = -uy, ny = ux;
          var side = ((p.x - h.x) * nx + (p.y - h.y) * ny) >= 0 ? 1 : -1;
          var m = hw - sd + 22;
          var ax = clamp(p.x + nx * side * m, p.r, run.w - p.r), ay = clamp(p.y + ny * side * m, p.r, run.h - p.r);
          var m2 = hw + sd + 22;
          var bx2 = clamp(p.x - nx * side * m2, p.r, run.w - p.r), by2 = clamp(p.y - ny * side * m2, p.r, run.h - p.r);
          var da = segDist(ax, ay, h.x, h.y, h.x2, h.y2), db = segDist(bx2, by2, h.x, h.y, h.x2, h.y2);
          if (da >= hw || da >= db) { out.x = ax; out.y = ay; } else { out.x = bx2; out.y = by2; }
          return true;
        }
      }
    }
    return false;
  }

  // Act II dodge (sector 6+): slams (incl. barrages), charge lanes and laser lanes. Samples nearby spots and picks the
  // closest one that no telegraph covers. Act I keeps hazardEscape() above so its numbers do not move.
  function covers(h, x, y, pr, m) {
    if (h.kind === 'slam') return Math.hypot(x - h.x, y - h.y) < h.r + pr + m;
    if (h.kind === 'hold' || h.kind === 'injunction') return Math.hypot(x - h.x, y - h.y) < h.r + pr + m;   // Act III: stay out of holds and injunctions
    if (h.kind === 'charge' || h.kind === 'laser') return segDist(x, y, h.x, h.y, h.x2, h.y2) < h.w / 2 + pr + m;
    return false;
  }
  var RINGS = [30, 60, 100, 150];
  function hazardEscape2(run, out) {
    var p = run.player, hz = run.hazards, n = hz.length, i, k, ri, h, hit = false;
    if (!n) return false;
    for (i = 0; i < n && !hit; i++) if (covers(hz[i], p.x, p.y, p.r, 10)) hit = true;
    if (!hit) return false;
    var bestC = 1e18, bx = p.x, by = p.y;
    for (ri = -1; ri < RINGS.length; ri++) {
      for (k = 0; k < (ri < 0 ? 1 : 16); k++) {
        var cx = p.x, cy = p.y, d = 0;
        if (ri >= 0) { var a = k * Math.PI / 8; d = RINGS[ri]; cx = clamp(p.x + Math.cos(a) * d, p.r, run.w - p.r); cy = clamp(p.y + Math.sin(a) * d, p.r, run.h - p.r); d = Math.hypot(cx - p.x, cy - p.y); }
        var cost = d, cov = 0;
        for (i = 0; i < n; i++) if (covers(hz[i], cx, cy, p.r, 12)) cov++;
        cost += cov * 1000;
        // crossing a lane on the way costs a little: prefer leaving along it
        if (cost < bestC) { bestC = cost; bx = cx; by = cy; }
      }
    }
    out.x = bx; out.y = by;
    return true;
  }

  function decide(run, s, ignoreTele, smart) {
    var p = run.player, st = run.stats, sec = run.sec, en = run.enemies, out = s.out;
    var px = p.x, py = p.y, i, e, def, d;

    if (!ignoreTele && (run.sector >= 6 ? hazardEscape2(run, out) : hazardEscape(run, out))) return out;

    var battLow = !p.oc.active && p.battery < 0.3 * p.maxBattery;
    var boss = run.boss, bossOn = boss.state === 'active';
    var sigOn = boss.state === 'none' && !boss.blocked && !run.attract;
    var sigVal = 1.5 * sec.bolts;
    var hit = st.damage * (1 + st.critChance * (st.critMult - 1));
    var dps = Math.max(0.01, hit / st.pulseInterval * (p.oc.active ? 2 : 1) + st.drones * st.droneDmg / st.droneInterval * 0.5);

    var best = null, bestScore = -1, bestId = 0, bx = px, by = py;
    var gx = px, gy = py;

    // bots
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || e.invuln || e.disguised) continue;
      if (!e.entered && (e.x < 0 || e.x > run.w || e.y < 0 || e.y > run.h)) continue; // not on the floor yet
      var dx = e.x - px, dy = e.y - py;
      d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      var hostile = e.hostile;
      var contactBot = hostile && (e.boss || e.type === 'sparker' || e.type === 'bomber' || e.type === 'mimic');
      var value;
      if (e.boss) value = 1e4 * sec.bolts;     // once the Warden is out, going for it is the whole point
      else if (e.type === 'pylon' || e.pyl) value = 3e3 * sec.bolts;
      else {
        def = EN[e.type];
        value = def.bolts * sec.bolts * st.boltMult * (e.elite ? 4 : 1) + (sigOn ? def.signal * (e.elite ? 2 : 1) * sigVal : 0);
        if (e.type === 'mite') value = 0.3 * sec.bolts;
        if (e.type === 'hr') value *= 5;                                   // Act III: heals everything else: scrap first
        else if (e.type === 'copier') value *= 4;                          // ... and the Photocopier fills the floor
        else if (e.type === 'paralegal') value *= 2;                       // ... injunctions switch the arc off
        if (e.type === 'gilded') value *= 1.2;
        if (e.stolen > 0) value += 1.5 * e.stolen + 2 * sec.bolts;          // a Repo Bot running off with bolts
        if (e.type === 'firenode') {                                       // worth more the more bots it is shielding
          var sh = 0;
          for (var q = 0; q < en.length; q++) if (en[q].shieldedBy === e.id) sh++;
          value *= 1 + 0.6 * sh;
        }
      }
      if (value <= 0) continue;
      var edps = dps * (e.armor > 0 ? (1 - e.armor * (1 - st.critChance)) : 1);
      var ttk = Math.max(0.3, e.hp / edps);
      if (e.type === 'pylon') ttk = Math.max(0.3, e.hp / edps);
      var standoff;
      if (contactBot) standoff = Math.max(e.r + p.r + 9, e.r + st.radius - 6);
      else standoff = e.r + st.radius * 0.45;
      if (standoff > e.r + st.radius - 2) standoff = e.r + st.radius - 2;
      var travel = Math.max(0, d - standoff) / st.speed;
      var danger = 0;
      if (contactBot) {
        if (battLow) continue;
        danger = e.boss ? 0.0 : 0.3;
      }
      var cost = ttk + travel + 0.2 + danger;
      if (e.boss) cost += 0.0;
      var score = value / cost;
      if (st.targets > 1 && !e.boss) {
        var nb = 0;
        for (var j = 0; j < en.length && nb < st.targets - 1; j++) {
          var o = en[j];
          if (o === e || o.dead || o.invuln) continue;
          if (Math.abs(o.x - e.x) < st.radius * 0.8 && Math.abs(o.y - e.y) < st.radius * 0.8) nb++;
        }
        score *= 1 + 0.3 * nb;
      }
      if (e.id === s.lastId) score *= 1.2;
      if (score > bestScore) {
        bestScore = score; best = e; bestId = e.id;
        // goal: stand `standoff` from the bot on our side of it
        bx = e.x + dx / d * -standoff; by = e.y + dy / d * -standoff;
        if (!contactBot && d < standoff) { bx = px; by = py; }
      }
    }

    // pickups
    var pk = run.pickups;
    for (i = 0; i < pk.length; i++) {
      var q = pk[i];
      var qd = Math.hypot(q.x - px, q.y - py);
      var qv;
      if (q.kind === 'bolt') qv = q.value;
      else if (q.kind === 'core') qv = 35 * sec.bolts;
      else qv = (battLow ? 60 : 6) * sec.bolts;
      var qt = Math.max(0, qd - st.magnet * 0.85) / st.speed + 0.15;
      var qs = qv / qt;
      if (q.age > 11) qs *= 1.5;
      if (qs > bestScore) {
        bestScore = qs; best = q; bestId = q.id; bx = q.x; by = q.y;
      }
    }
    s.lastId = bestId;

    if (best) { gx = bx; gy = by; }
    else { gx = run.w / 2; gy = run.h * 0.55; }

    // keep clear of hostile bodies we are not deliberately fighting
    var rx = 0, ry = 0;
    for (i = 0; i < en.length; i++) {
      e = en[i];
      if (e.dead || !e.hostile) continue;
      if (!(e.boss || e.type === 'sparker' || e.type === 'bomber' || e.type === 'mimic')) continue;
      if (e === best) continue;
      var ex = px - e.x, ey = py - e.y, ed = Math.sqrt(ex * ex + ey * ey) || 0.001;
      var rng2 = e.r + p.r + 34;
      if (ed < rng2) { var f = (1 - ed / rng2) * 110; rx += ex / ed * f; ry += ey / ed * f; }
    }
    // dodge shots
    var sh = run.shots;
    if (smart) {
      // attentive: pick the nearby spot (incl. staying near the goal) that keeps clear of every incoming shot
      var gtx = clamp(gx + rx, p.r, run.w - p.r), gty = clamp(gy + ry, p.r, run.h - p.r);
      var threat = false;
      for (i = 0; i < sh.length && !threat; i++) {
        var b0 = sh[i], ddx = b0.x - px, ddy = b0.y - py;
        if (ddx * ddx + ddy * ddy < 200 * 200) threat = true;
      }
      if (threat) {
        var bestC = null, bestCost = 1e18, spd = st.speed * (p.oc.active ? 1.25 : 1);
        for (var k2 = -1; k2 < 16; k2++) {
          var cx2, cy2;
          if (k2 < 0) { cx2 = gtx; cy2 = gty; }
          else {
            var aa = k2 * Math.PI / 8, rr2 = k2 % 2 ? 50 : 90;
            cx2 = clamp(px + Math.cos(aa) * rr2, p.r, run.w - p.r); cy2 = clamp(py + Math.sin(aa) * rr2, p.r, run.h - p.r);
          }
          var mvx = cx2 - px, mvy = cy2 - py, ml = Math.sqrt(mvx * mvx + mvy * mvy) || 1;
          var travelT = Math.min(0.9, ml / spd), pen = 0;
          for (var ts = 1; ts <= 9; ts++) {
            var tt2 = ts * 0.1, f2 = Math.min(tt2, travelT) / (travelT || 1);
            var qx = px + mvx * (ml > 1 ? f2 * Math.min(1, travelT * spd / ml) : 0), qy = py + mvy * (ml > 1 ? f2 * Math.min(1, travelT * spd / ml) : 0);
            for (var m2 = 0; m2 < sh.length; m2++) {
              var s2 = sh[m2], sx2 = s2.x + s2.vx * tt2 - qx, sy2 = s2.y + s2.vy * tt2 - qy;
              var gap = Math.sqrt(sx2 * sx2 + sy2 * sy2) - (p.r + s2.r);
              if (gap < 10) pen += (10 - gap) * 40;
            }
          }
          var dg = Math.hypot(cx2 - gtx, cy2 - gty);
          var cost2 = pen + dg * 0.5 + (k2 < 0 ? 0 : 6);
          if (cost2 < bestCost) { bestCost = cost2; bestC = { x: cx2, y: cy2 }; }
        }
        out.x = bestC.x; out.y = bestC.y;
        return out;
      }
    } else for (i = 0; i < sh.length; i++) {
      var b = sh[i];
      var sx = px - b.x, sy = py - b.y;
      var sd2 = sx * sx + sy * sy;
      if (sd2 > 140 * 140) continue;
      var v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 < 1) continue;
      var tt = (sx * b.vx + sy * b.vy) / v2;
      if (tt < 0 || tt > 1.4) continue;
      var cx = b.x + b.vx * tt - px, cy = b.y + b.vy * tt - py;
      var miss = Math.sqrt(cx * cx + cy * cy);
      if (miss < p.r + b.r + 16) {
        var vl = Math.sqrt(v2), nx = -b.vy / vl, ny = b.vx / vl;
        var sgn = (cx * nx + cy * ny) > 0 ? -1 : 1;
        rx += nx * sgn * 70; ry += ny * sgn * 70;
      }
    }
    out.x = clamp(gx + rx, p.r, run.w - p.r);
    out.y = clamp(gy + ry, p.r, run.h - p.r);
    return out;
  }

  // BY.Autopilot.target(run, opts) -> {x, y}
  function target(run, opts) {
    var skill = (opts && opts.skill) || 'attentive';
    var s = stateOf(run);
    if (skill === 'sloppy') {
      if (run.t >= s.next) {
        s.next = run.t + 0.5;
        s.ignore = rng(s) < 0.5;
        var a = rng(s) * Math.PI * 2, m = rng(s) * 40;
        var t = decide(run, s, s.ignore, false);
        s.tgt = { x: clamp(t.x + Math.cos(a) * m, 0, run.w), y: clamp(t.y + Math.sin(a) * m, 0, run.h) };
      }
      return s.tgt;
    }
    return decide(run, s, false, true);
  }

  // -------------------------------------------------------------------------
  // shopping
  // -------------------------------------------------------------------------
  var closure = {};
  (function () {
    function add(id) {
      if (closure[id]) return;
      closure[id] = true;
      var r = UPID[id].requires;
      for (var i = 0; i < r.length; i++) add(r[i][0]);
    }
    var tr = UPID.titan.requires;
    for (var i = 0; i < tr.length; i++) add(tr[i][0]);
  })();

  // Act II closure: everything Hostile Takeover needs, with the level it needs
  var need2 = {};
  (function () {
    function add(id, lvl) {
      if ((need2[id] || 0) >= lvl) return;
      need2[id] = lvl;
      var r = UPID[id].requires;
      for (var i = 0; i < r.length; i++) add(r[i][0], r[i][1]);
    }
    add('takeover', 1);
  })();

  // Act III closure: everything Majority Stake needs, with the level it needs
  var need3 = {};
  (function () {
    function add(id, lvl) {
      if ((need3[id] || 0) >= lvl) return;
      need3[id] = lvl;
      var r = UPID[id].requires;
      for (var i = 0; i < r.length; i++) add(r[i][0], r[i][1]);
    }
    add('stake', 1);
  })();

  function worth(st) {
    var hit = st.damage * (1 + st.critChance * (st.critMult - 1));
    var tg = 1 + 0.6 * (st.targets - 1);
    var oc = st.ocUnlocked ? 1 + 0.1 + 0.04 * st.ocDur : 1;
    var chain = 1 + st.chainPct * 0.5 + st.overloadPct * 1.5;
    var dps = hit * tg / st.pulseInterval * oc * chain + st.drones * st.droneDmg / st.droneInterval * (st.collector ? 1.05 : 1);
    // Act II extras (each is exactly 0 / 1 when not owned, so Act I valuations do not move)
    if (st.stormEvery > 0) dps += 3 * st.damage * 4 / (st.stormEvery * st.pulseInterval);
    if (st.latticeDps > 0) dps += st.latticeDps * 1.5;
    if (st.wellEvery > 0) dps += st.wellMult * st.damage * 3 / st.wellEvery;
    if (st.naniteDps > 0) dps += st.naniteDps * 4;
    if (st.rehireChance > 0) dps *= 1 + 2 * st.rehireChance * st.internMult * (st.internLife / 6) * (st.internMax / 4);
    // Act III extras (each is exactly neutral when not owned)
    if (st.orbitalEvery > 0) dps += st.orbitalMult * st.damage / st.orbitalEvery * 0.6;
    if (st.burstChance > 0) dps *= 1 + 3 * st.burstChance;
    if (st.wardenMult > 1) dps *= Math.pow(st.wardenMult, 0.4);
    var B = st.maxBattery * (1 + 6 * st.recycle) / (1 - st.plating * 0.6) * (1 + st.sparePct * 0.8);
    if (st.severancePct > 0) B *= 1.1 + 0.03 * st.severancePay;
    var life = st.sag > 0 ? (-1 + Math.sqrt(1 + 2 * st.sag * B)) / st.sag : B;
    var range = Math.pow(st.radius / 46, 0.6);
    var spd = Math.pow(st.speed / 260, 0.3);
    var mag = Math.pow(st.magnet / 60, 0.35);
    var misc = st.boltMult * (1 + 14 * (st.gildedChance - 0.005)) * (1 + st.sweepPct * 0.15) *
               Math.pow(1 / st.signalMult, 0.5) * (1 + 0.04 * st.bossCoreBonus);
    if (st.stockCap > 0) misc *= 1 + 0.35 * st.stockCap;
    if (st.compoundCap > 0) misc *= 1 + 0.5 * st.compoundCap;
    if (st.expenseCap > 0) life += 0.6 * st.expenseCap;
    if (st.holdMult < 1) misc *= 1 + 0.25 * (1 - st.holdMult) + 0.15 * (1 - st.injunctionR) + 0.15 * (1 - st.clawMult);
    return Math.pow(dps, 0.85) * life * range * spd * mag * misc;
  }

  // Test/ablation knobs (tools only). policy: 'best' | 'cheapest' | 'random'. cap: { id: maxLevelToBuy }.
  // force: [[id, level], ...] bought first (with prerequisites) whenever affordable.
  var config = { policy: 'best', cap: {}, force: [], rs: 12345 };

  function capOf(id) { return config.cap[id] === undefined ? 1e9 : config.cap[id]; }

  // Act II shopping is on once the Overseer has fallen, unless the R&D tree is capped off (Act I-only simbot runs)
  function act2On(save) { return !!(save.flags && save.flags.act2) && capOf('fusion') > 0; }
  // Act III shopping is on once the Chairman has fallen, unless the Executive tree is capped off (Act I/II-only simbot runs)
  function act3On(save) { return !!(save.flags && save.flags.chairman) && capOf('megacoil') > 0; }

  function coreVal(save) {
    var sec = D.SECTORS[Math.min(act3On(save) ? 15 : act2On(save) ? 10 : 5, save.sectorsCleared + 1) - 1];
    return 60 * sec.bolts;
  }

  // Buy toward id:level, prerequisites first. Returns the id bought or null.
  function forceStep(save, id, level, depth) {
    var def = UPID[id];
    if ((save.up[id] || 0) >= level || depth > 12) return null;
    for (var i = 0; i < def.requires.length; i++) {
      var r = def.requires[i];
      if ((save.up[r[0]] || 0) < r[1]) {
        var got = forceStep(save, r[0], r[1], depth + 1);
        if (got) return got;
        return null;
      }
    }
    return E.buy(save, id) ? id : null;
  }

  // SPEC 12.16: capstones follow the real human rule (requires + actReq + gate, enforced by the engine); legacyReq is no longer read
  function legacyMet(save, id) {
    var r = UPID[id].requires;
    for (var i = 0; i < r.length; i++) if ((save.up[r[i][0]] || 0) < r[i][1]) return false;
    return true;
  }

  function shop(save) {
    var bought = [], guard = 0, ap = apOf(save), i, id, info;
    ap.wantCores = false;
    while (guard++ < 800) {
      var did = null;
      for (i = 0; i < config.force.length && !did; i++) did = forceStep(save, config.force[i][0], config.force[i][1], 0);
      if (did) { bought.push(did); continue; }
      if (config.policy === 'cheapest' || config.policy === 'random') {
        var aff = [];
        for (i = 0; i < UP.length; i++) {
          id = UP[i].id;
          if (id === 'boot' || (save.up[id] || 0) >= capOf(id)) continue;
          info = E.upgradeInfo(save, id);
          if (info.affordable) aff.push(info);
        }
        if (!aff.length) break;
        var pick;
        if (config.policy === 'random') { config.rs = (config.rs * 1103515245 + 12345) & 0x7fffffff; pick = aff[config.rs % aff.length]; }
        else { pick = aff[0]; for (i = 1; i < aff.length; i++) if (aff[i].cost.bolts < pick.cost.bolts) pick = aff[i]; }
        E.buy(save, pick.id); bought.push(pick.id);
        continue;
      }
      var cur = worth(E.stats(save));
      var bestAll = null, bestAllR = -1, bestAff = null, bestAffR = -1, coreR = -1;
      var titanReady = E.upgradeInfo(save, 'titan').unlocked && legacyMet(save, 'titan') && save.up.titan < 1;
      var act2 = act2On(save);
      var takeReady = act2 && save.sectorsCleared >= 9 && E.upgradeInfo(save, 'takeover').unlocked && legacyMet(save, 'takeover') && save.up.takeover < 1;
      var act3 = act3On(save);
      var stakeReady = act3 && save.sectorsCleared >= 14 && E.upgradeInfo(save, 'stake').unlocked && legacyMet(save, 'stake') && save.up.stake < 1;
      var cv = coreVal(save);
      for (i = 0; i < UP.length; i++) {
        id = UP[i].id;
        if (id === 'boot' || (save.up[id] || 0) >= capOf(id)) continue;
        info = E.upgradeInfo(save, id);
        if (!info.unlocked || info.maxed) continue;
        if (titanReady && id !== 'titan' && info.cost.cores > 0 && save.cores - info.cost.cores < 8) continue;
        if (takeReady && id !== 'takeover' && info.cost.cores > 0 && save.cores - info.cost.cores < UPID.takeover.cores[0]) continue;
        var tmp = { up: Object.assign({}, save.up) };
        tmp.up[id] = info.level + 1;
        var gain = Math.log(worth(E.stats(tmp)) / cur);
        if (gain < 1e-6) gain = 1e-6;
        if (closure[id] && info.level === 0) gain *= 3;
        if (act2 && need2[id] && info.level < need2[id] && !closure[id]) gain *= 3;
        if (stakeReady && id !== 'stake' && info.cost.cores > 0 && save.cores - info.cost.cores < UPID.stake.cores[0]) continue;
        if (act3 && UPID[id].branch === 'exec' && need3[id] && info.level < need3[id]) gain *= 3;
        var ratio = gain / (info.cost.bolts + cv * info.cost.cores);
        var canPay = info.cost.cores <= save.cores;
        if (!canPay) { if (info.cost.bolts <= save.bolts * 4 && ratio > coreR) coreR = ratio; continue; }
        if (ratio > bestAllR) { bestAllR = ratio; bestAll = info; }
        if (info.affordable && ratio > bestAffR) { bestAffR = ratio; bestAff = info; }
      }
      if (coreR > 0.6 * Math.max(bestAllR, 0)) ap.wantCores = true;
      if (!bestAff) break;
      if (bestAffR < 0.35 * bestAllR) break; // save up for the better thing
      E.buy(save, bestAff.id);
      bought.push(bestAff.id);
    }
    return bought;
  }

  // -------------------------------------------------------------------------
  // sector choice
  // -------------------------------------------------------------------------
  function apOf(save) {
    if (!save._ap) Object.defineProperty(save, '_ap', { value: { hist: {}, farm: 0, w: {}, coreRun: 0, wantCores: false, kt: {}, chRuns: 0 }, enumerable: false, writable: true });
    return save._ap;
  }
  function avg2(a) {
    var n = a.length;
    return (a[n - 1] + a[n - 2]) / 2;
  }
  function record(save, report) {
    var ap = apOf(save), h = ap.hist[report.sector] || (ap.hist[report.sector] = []);
    if (report.sector === 10) ap.n10 = (ap.n10 || 0) + 1;
    if (report.sector === 15) ap.n15 = (ap.n15 || 0) + 1;
    h.push(report.bolts);
    if (h.length > 4) h.shift();
    var w = ap.w[report.sector] || (ap.w[report.sector] = { att: 0, kill: 0 });
    if (report.bossSeen) { w.att++; if (report.bossDefeated) w.kill++; }
    if (report.bossDefeated) {
      var kt = ap.kt[report.sector] || (ap.kt[report.sector] = []);
      kt.push(report.time); if (kt.length > 3) kt.shift();
    }
  }
  // cores still missing for the Titan route (first level of every prerequisite + the Frame itself)
  function coresWanted(save) {
    if (save.up.titan >= 1) return 0;
    var need = D.UPGRADE_BY_ID.titan.cores[0];
    for (var id in closure) {
      if (save.up[id] < 1) need += UPID[id].cores ? UPID[id].cores[0] : 0;
    }
    return need - save.cores;
  }
  // cores still missing for Hostile Takeover (every prerequisite level + the Takeover itself)
  function coresWanted2(save) {
    if (save.up.takeover >= 1) return 0;
    var need = 0;
    for (var id in need2) {
      var u = UPID[id];
      if (!u.cores) continue;
      for (var l = save.up[id] || 0; l < need2[id]; l++) need += u.cores[l] || 0;
    }
    return need - save.cores;
  }
  // cores still missing for Majority Stake (every prerequisite level + the Stake itself)
  function coresWanted3(save) {
    if (save.up.stake >= 1) return 0;
    var need = 0;
    for (var id in need3) {
      var u = UPID[id];
      if (!u.cores) continue;
      for (var l = save.up[id] || 0; l < need3[id]; l++) need += u.cores[l] || 0;
    }
    return need - save.cores;
  }
  // best earlier sector to re-fight for cores: cores per second of expected shift time
  function coreSector(save, ap) {
    var best = 1, bestV = -1, st = E.stats(save), hiS = (save.flags && save.flags.act2) ? Math.min(9, save.sectorsCleared) : 4;
    if (act3On(save)) hiS = Math.min(14, save.sectorsCleared);
    if (hiS > 4) best = 6;
    for (var s = (hiS > 4 ? 6 : 1); s <= Math.min(hiS, save.sectorsCleared); s++) {
      var w = ap.w[s] || { att: 0, kill: 0 };
      var rate = (w.kill + 1) / (w.att + 2);
      var kt = ap.kt[s], t = kt && kt.length ? kt.reduce(function (a, b) { return a + b; }, 0) / kt.length : 20 + 12 * s;
      var c = D.SECTORS[s - 1].coresRepeat + st.bossCoreBonus;
      var v = c * rate / (t + 8);
      if (v > bestV * 1.05) { bestV = v; best = s; }
    }
    return best;
  }
  // Act II: sectors 6-10 (the Chairman only once Hostile Takeover is built), then Overtime
  function pickSectorAct2(save) {
    var ap = apOf(save);
    if (save.flags.chairman) return pickSectorAct3(save);
    var top = Math.min(10, save.sectorsCleared + 1);
    if (top < 6) top = 6;
    var chairmanBlocked = top === 10 && !save.up.takeover;
    if (chairmanBlocked && coresWanted2(save) > 0) return coreSector(save, ap);
    var atCh = top === 10 && save.up.takeover;   // on the Chairman with cores to spend: now and then go and farm Wardens like a player would
    if (ap.wantCores && ap.coreRun < 3 && !(atCh && (ap.n10 || 0) < 3 * (1 + ap.chRuns))) { ap.coreRun++; if (atCh && ap.coreRun === 3) ap.chRuns++; return coreSector(save, ap); }
    ap.coreRun = 0;
    if (chairmanBlocked) return 9;
    if (ap.farm > 0 && top > 6) { ap.farm--; return top - 1; }
    var h = ap.hist[top] || [], below = ap.hist[top - 1] || [];
    if (top > 6 && h.length >= 2 && below.length >= 2 && avg2(h) < avg2(below)) {
      ap.farm = 2; ap.hist[top] = [];
      return top - 1;
    }
    return top;
  }

  // Act III: sectors 11-15 (the Founder only once Majority Stake is built), then Overtime (16)
  function pickSectorAct3(save) {
    var ap = apOf(save);
    if (save.flags.founder) return 16;
    var top = Math.min(15, Math.max(11, save.sectorsCleared + 1));
    var blocked = top === 15 && !save.up.stake;
    if (blocked && coresWanted3(save) > 0) return coreSector(save, ap);
    var atF = top === 15 && save.up.stake;
    if (ap.wantCores && ap.coreRun < 3 && !(atF && (ap.n15 || 0) < 3 * (1 + (ap.fRuns || 0)))) { ap.coreRun++; if (atF && ap.coreRun === 3) ap.fRuns = (ap.fRuns || 0) + 1; return coreSector(save, ap); }
    ap.coreRun = 0;
    if (blocked) return 14;
    if (ap.farm > 0 && top > 11) { ap.farm--; return top - 1; }
    var h = ap.hist[top] || [], below = ap.hist[top - 1] || [];
    if (top > 11 && h.length >= 2 && below.length >= 2 && avg2(h) < avg2(below)) {
      ap.farm = 2; ap.hist[top] = [];
      return top - 1;
    }
    return top;
  }

  function pickSector(save) {
    if (save.flags && save.flags.act2) return pickSectorAct2(save);
    var ap = apOf(save);
    var top = Math.min(5, save.sectorsCleared + 1);
    if (top <= 1) return 1;
    if (top === 5 && !save.up.titan && coresWanted(save) > 0) return coreSector(save, ap);
    // core-starved: something worth buying is waiting on cores -> re-fight an earlier Warden (at most 3 in a row)
    if (ap.wantCores && ap.coreRun < 3 && !(top === 5 && save.up.titan)) { ap.coreRun++; return coreSector(save, ap); }
    ap.coreRun = 0;
    // sector 5 is closed (no Warden) until the Titan Frame is built: keep earning in Assembly Line instead
    if (top === 5 && !save.up.titan) return 4;
    if (ap.farm > 0) { ap.farm--; return top - 1; }
    var h = ap.hist[top] || [], below = ap.hist[top - 1] || [];
    if (h.length >= 2 && below.length >= 2 && avg2(h) < avg2(below)) {
      ap.farm = 2; ap.hist[top] = [];
      return top - 1;
    }
    return top;
  }

  BY.Autopilot = { config: config, closure: closure, target: target, shop: shop, pickSector: pickSector, record: record, worth: worth };
})(typeof globalThis !== 'undefined' ? globalThis : this);
