#!/usr/bin/env node
// node tools/play-through.js [--seed N] [--skill attentive|sloppy] [--nostorage] [--scale 24] [--max-wall 900] [--quiet]
//
// Drives the REAL page (dist/test.html: real engine, real renderer, real UI) at 390x844 with touch, from a fresh save
// to the Victory screen. Steering comes from the autopilot through BY.UI.debug.setInput; Clock In, Workshop buttons,
// sector tiles and the first few purchases are real touch taps; the remaining purchases fire the real pointer events
// on the real node / Bolt on button inside the page (so the UI buy path, save and refresh all run).
//
// Fails on: any console error, page error or unhandled rejection; a save that does not resume exactly after a reload
// (mid-Workshop, after a Warden kill, after the Titan Frame); a UI purchase that disagrees with the engine plan;
// a missing sector / Warden / Titan / Victory; keep-playing or reset-save not working.
'use strict';
const L = require('./lib-page.js');
const { sleep } = L;

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const SEED = +opt('seed', 1), SKILL = opt('skill', 'attentive'), NOSTORE = !!opt('nostorage', false);
const SCALE = +opt('scale', 24), MAX_WALL = +opt('max-wall', 900) * 1000, QUIET = !!opt('quiet', false);
const MAX_SHIFTS = +opt('max-shifts', 400);

const log = (...a) => { if (!QUIET) console.log(...a); };
const problems = [];
const fail = (msg) => { problems.push(msg); console.log('  FAIL ' + msg); };
const ok = (cond, msg) => { if (!cond) fail(msg); else log('  ok   ' + msg); };

// everything that must survive a reload
const SNAP = () => {
  const s = BY.UI.debug.save();
  return JSON.stringify({ bolts: s.bolts, cores: s.cores, up: s.up, sectorsCleared: s.sectorsCleared, bossKills: s.bossKills,
    sector: s.sector, shifts: s.stats.shifts, kills: s.stats.kills, boltsTotal: s.stats.boltsTotal, playTime: Math.round(s.stats.playTime * 1000), seen: s.seen, flags: s.flags });
};

(async () => {
  const t0 = Date.now();
  const browser = await L.launch();
  const errors = [];
  let { page } = await L.open(browser, { w: 390, h: 844, dpr: 1, touch: true, noStorage: NOSTORE, errors, seed: SEED * 7919 });
  const wall = () => Date.now() - t0;

  async function install() {   // after a reload: autopilot + steering + time scale again
    await page.evaluate(() => BY.UI.debug.timeScale);
  }
  async function configure() {
    await page.evaluate(([skill, scale]) => {
      window.__skill = skill;
      BY.UI.debug.setInput((run) => BY.Autopilot.target(run, { skill: window.__skill }));
      BY.UI.debug.timeScale = scale;
    }, [SKILL, SCALE]);
  }
  async function reload(label, before) {
    await page.reload();
    await page.addScriptTag({ path: require('path').join(L.root, 'tools/autopilot.js') });
    await page.waitForFunction(() => window.BY && BY.UI && BY.UI.debug && BY.UI.debug.screen() !== 'boot');
    await sleep(200);
    const after = await page.evaluate(SNAP);
    const scr = await L.screen(page);
    ok(after === before, 'reload ' + label + ': save resumed exactly');
    if (after !== before) { log('    before ' + before.slice(0, 400)); log('    after  ' + after.slice(0, 400)); }
    ok(scr === 'workshop', 'reload ' + label + ': boots into the Workshop (got ' + scr + ')');
    reloads++;
  }

  let reloads = 0, simTime = 0, shifts = 0, workshopVisits = 0, tapBuys = 0, uiBuys = 0;
  const sectorsSeen = new Set(), wardensSeen = new Set(), wardensKilled = new Set(), reasons = {};
  let reloadedMid = false, reloadedWarden = false, reloadedTitan = false, titanSeen = false;
  let won = false, stuck = false;

  // ---- title
  let scr = await L.screen(page);
  ok(scr === 'title', 'fresh page opens on the title (got ' + scr + ')');
  await configure();
  await page.tap('#btnTitleClock');

  while (!won && shifts < MAX_SHIFTS && wall() < MAX_WALL) {
    scr = await L.waitScreen(page, ['report', 'victory', 'workshop', 'title'], 120000);
    if (!scr) { fail('timed out waiting for the end of a shift'); stuck = true; break; }
    if (scr === 'title') { fail('unexpected title screen mid-game'); stuck = true; break; }
    if (scr === 'workshop') { /* fall through to shopping below */ }
    else {
      // ---- shift finished: record, inspect
      const rep = await page.evaluate(() => {
        const r = BY.UI.debug.report(), s = BY.UI.debug.save();
        BY.Autopilot.record(s, r);
        return Object.assign({}, r, { affordable: BY.Engine.affordableCount(s), nextSector: BY.Autopilot.pickSector(s), curSector: s.sector });
      });
      shifts++; simTime += rep.time; sectorsSeen.add(rep.sector); reasons[rep.reason] = (reasons[rep.reason] || 0) + 1;
      if (rep.bossSeen) wardensSeen.add(rep.sector);
      if (rep.bossDefeated) wardensKilled.add(rep.sector);
      if (!QUIET && shifts % 10 === 0) console.log('  .. shift ' + shifts + ' sector ' + rep.sector + ' sim ' + Math.round(simTime) + 's wall ' + Math.round(wall() / 1000) + 's');
      if (scr === 'victory') { won = true; break; }

      // reload #2: right after a Warden kill, on the report screen
      if (rep.bossDefeated && !reloadedWarden && !NOSTORE) {
        reloadedWarden = true;
        const snap = await page.evaluate(SNAP);
        await reload('after a Warden kill (sector ' + rep.sector + ')', snap);
        await configure();
        scr = 'workshop';
      }
      if (scr === 'report') {
        // real taps on the report buttons: Workshop, or straight back in when nothing is affordable and the sector is right
        if (rep.affordable === 0 && rep.nextSector === rep.curSector && shifts % 3 !== 0) {
          await page.tap('#btnRepPrimary'); await sleep(30);
          const lbl = await page.evaluate(() => document.getElementById('btnRepPrimary').textContent);
          // primary is "Clock in again" when nothing is affordable
          if (!/clock in/i.test(lbl)) { /* it was Workshop after all; the tap already went there */ }
          await configure();
          continue;
        }
        const wsBtn = await page.evaluate(() => /workshop/i.test(document.getElementById('btnRepPrimary').textContent) ? '#btnRepPrimary' : '#btnRepSecond');
        await page.tap(wsBtn);
        if (await L.waitScreen(page, ['workshop'], 3000) !== 'workshop') fail('report -> Workshop button did not open the Workshop');
      }
    }

    // ---- workshop: shop (real UI path), pick the sector, clock in
    scr = await L.screen(page);
    if (scr !== 'workshop') { fail('expected the workshop, got ' + scr); stuck = true; break; }
    workshopVisits++;
    const plan = await page.evaluate(() => {
      const real = BY.UI.debug.save();
      const clone = BY.Engine.loadSave(JSON.parse(JSON.stringify(real)));
      if (real._ap) Object.defineProperty(clone, '_ap', { value: real._ap, enumerable: false, writable: true });
      const bought = BY.Autopilot.shop(clone);
      return { bought, final: { bolts: clone.bolts, cores: clone.cores, up: clone.up } };
    });
    // first few purchases of the game: real touch taps (node, then Bolt on)
    let i = 0;
    while (i < plan.bought.length && tapBuys < 3) {
      const id = plan.bought[i];
      try {
        const selected = await page.evaluate((id) => { const n = document.querySelector('.node.sel'); return n && n.getAttribute('data-id') === id && !document.getElementById('sheet').hidden; }, id);
        if (!selected) await page.tap('.node[data-id="' + id + '"]', { timeout: 4000 });
        const before = await page.evaluate((id) => BY.UI.debug.save().up[id], id);
        await page.tap('#btnBuy', { timeout: 4000 });
        await sleep(60);
        const after = await page.evaluate((id) => BY.UI.debug.save().up[id], id);
        if (after !== before + 1) { fail('real tap buy of ' + id + ' did not buy (' + before + ' -> ' + after + ')'); break; }
        tapBuys++; i++;
      } catch (e) { fail('real tap buy threw: ' + e.message.split('\n')[0]); break; }
    }
    const rest = plan.bought.slice(i);
    if (rest.length) {
      const bad = await page.evaluate((ids) => {
        const res = [];
        const PE = (t) => new PointerEvent(t, { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: 'touch', isPrimary: true });
        for (const id of ids) {
          const sel = document.querySelector('.node.sel');
          if (!sel || sel.getAttribute('data-id') !== id || document.getElementById('sheet').hidden) {
            document.querySelector('.node[data-id="' + id + '"]').click();
          }
          const before = BY.UI.debug.save().up[id], btn = document.getElementById('btnBuy');
          btn.dispatchEvent(PE('pointerdown')); btn.dispatchEvent(PE('pointerup'));
          const after = BY.UI.debug.save().up[id];
          if (after !== before + 1) res.push(id + ' ' + before + '->' + after);
        }
        return res;
      }, rest);
      if (bad.length) fail('UI purchases failed: ' + bad.slice(0, 5).join(', '));
      uiBuys += rest.length;
    }
    if (plan.bought.length) {
      const cmp = await page.evaluate((f) => {
        const s = BY.UI.debug.save();
        return { bolts: s.bolts === f.bolts, cores: s.cores === f.cores, up: JSON.stringify(s.up) === JSON.stringify(f.up), stored: (() => { try { return JSON.parse(localStorage.getItem('boltyard.save.v1')).bolts === s.bolts; } catch (e) { return null; } })() };
      }, plan.final);
      if (!(cmp.bolts && cmp.cores && cmp.up)) fail('UI purchases ended in a different save than the engine plan (' + JSON.stringify(cmp) + ')');
      if (!NOSTORE && cmp.stored === false) fail('purchases were not written to localStorage');
      if (!titanSeen && plan.final.up.titan >= 1) {
        titanSeen = true;
        log('  Titan Frame bought at shift ' + shifts + ', sim ' + Math.round(simTime) + 's');
      }
    }

    // reload #1: mid-Workshop, once a decent number of purchases exist; reload #3 right after the Titan Frame
    if (!NOSTORE && ((!reloadedMid && workshopVisits >= 6) || (titanSeen && !reloadedTitan))) {
      const label = titanSeen && !reloadedTitan ? 'after the Titan Frame' : 'mid-Workshop (visit ' + workshopVisits + ')';
      if (titanSeen && !reloadedTitan) reloadedTitan = true; else reloadedMid = true;
      const snap = await page.evaluate(SNAP);
      await reload(label, snap);
      await configure();
    }

    // sector: real tap on the tile if it is not the selected one
    const want = await page.evaluate(() => BY.Autopilot.pickSector(BY.UI.debug.save()));
    const cur = await page.evaluate(() => BY.UI.debug.save().sector);
    if (want !== cur) {
      // a player closes an open node sheet (it covers the sector row) before picking a sector
      if (await page.evaluate(() => !document.getElementById('sheet').hidden)) { await page.tap('#nsClose'); await sleep(250); }
      try { if (await page.evaluate(() => document.getElementById('workshop').classList.contains('slim'))) { await page.tap('#btnSecBar'); await sleep(200); } await page.tap('.stile[data-n="' + want + '"]', { timeout: 6000 }); }
      catch (e) {
        const d = await page.evaluate(() => { const a = document.getElementById('app'); const t = document.querySelector('.stile').getBoundingClientRect(); const sh = document.getElementById('sheet'); return { appScrollTop: a.scrollTop, docScroll: [scrollX, scrollY], tile: [t.top, t.bottom], sheetHidden: sh.hidden, sheet: sh.hidden ? null : [sh.getBoundingClientRect().top, sh.getBoundingClientRect().bottom], ws: (() => { const w = document.getElementById('workshop'); return [w.scrollTop, w.getBoundingClientRect().top]; })() }; });
        await page.screenshot({ path: process.env.PT_DIAG || '/tmp/pt-diag.png' });
        fail('sector tile tap blocked: ' + JSON.stringify(d)); stuck = true; break;
      }
      const now = await page.evaluate(() => BY.UI.debug.save().sector);
      if (now !== want) fail('sector tile ' + want + ' did not select (sector ' + now + ')');
    }
    if (await page.evaluate(() => !document.getElementById('sheet').hidden)) { await page.tap('#nsClose'); await sleep(250); }
    await page.tap('#btnClockIn');
    await sleep(30);
    await configure();
  }

  // ---- results
  const end = await page.evaluate(() => {
    const s = BY.UI.debug.save();
    return { screen: BY.UI.debug.screen(), won: s.flags.won, titan: s.up.titan, cleared: s.sectorsCleared, kills: s.bossKills, shifts: s.stats.shifts,
      wonShifts: s.stats.wonShifts, wonPlayTime: s.stats.wonPlayTime, rej: window.__rej.slice() };
  });
  log('');
  ok(won && end.screen === 'victory', 'reached the Victory screen (screen ' + end.screen + ')');
  ok(end.won && end.cleared === 5, 'save says won, sectors cleared ' + end.cleared);
  ok(end.titan === 1, 'Titan Frame built');
  for (let n = 1; n <= 5; n++) {
    ok(sectorsSeen.has(n), 'visited sector ' + n);
    ok(wardensSeen.has(n) && end.kills[n] > 0, 'fought and scrapped the sector ' + n + ' Warden (kills ' + end.kills[n] + ')');
  }
  if (!NOSTORE) ok(reloads >= 3, 'reloaded ' + reloads + ' times (mid-Workshop, after a Warden kill, after the Titan Frame)');
  if (won) {
    const vic = await page.evaluate(() => document.getElementById('vicRows').textContent);
    ok(/Shifts worked/.test(vic), 'victory card shows totals: ' + vic.replace(/\s+/g, ' ').slice(0, 80));

    // keep playing: button works, Workshop opens, another shift runs and ends in a report
    await sleep(1800);
    ok(await page.evaluate(() => /\bin\b/.test(document.getElementById('vicStamp2').className)) && /MANAGEMENT HAS NOTICED/i.test(await page.textContent('#vicStamp2')), 'victory card: the second stamp "MANAGEMENT HAS NOTICED" has landed');
    await page.tap('#btnKeep');
    ok(await L.waitScreen(page, ['workshop'], 3000) === 'workshop', 'Keep playing opens the Workshop');
    const rv = await page.evaluate(() => { const s = BY.UI.debug.save(); return { act2: s.flags.act2, reveal: s.flags.reveal, sector: s.sector, six: !!document.querySelector('.stile[data-n="6"]:not(.locked)'), plates: document.querySelectorAll('.node.cls').length }; });
    ok(rv.act2 && rv.reveal && rv.sector === 6 && rv.six && rv.plates >= 12, 'Act II reveal: flags.act2 + flags.reveal set, sector 6 open and selected, R&D plates un-redacting ' + JSON.stringify(rv));
    await page.tap('#btnClockIn'); await sleep(30);
    await configure();
    const after = await L.waitScreen(page, ['report', 'victory'], 120000);
    ok(after === 'report', 'a shift after victory runs and ends with a normal report (got ' + after + ')');
    const sh = await page.evaluate(() => BY.UI.debug.save().stats);
    ok(sh.wonShifts === end.wonShifts, 'the win stats are frozen after victory (wonShifts ' + sh.wonShifts + ')');
    await page.tap('#btnRepSecond').catch(() => {}); await sleep(100);
    if (await L.screen(page) !== 'workshop') await page.tap('#btnRepPrimary');
    ok(await L.waitScreen(page, ['workshop'], 3000) === 'workshop', 'back in the Workshop after the extra shift');

    // reset: settings -> Reset progress twice -> title with a fresh save (sound / shake preferences kept)
    await page.evaluate(() => { const s = BY.UI.debug.save(); s.settings.sound = false; });
    await page.tap('#btnGear');
    await page.tap('#btnReset');
    ok(/again/i.test(await page.textContent('#btnReset')), 'first Reset tap only arms the button');
    await page.tap('#btnReset');
    ok(await L.waitScreen(page, ['title'], 3000) === 'title', 'second Reset tap erases and returns to the title');
    const fresh = await page.evaluate(() => { const s = BY.UI.debug.save(); return { shifts: s.stats.shifts, bolts: s.bolts, titan: s.up.titan, won: s.flags.won, sound: s.settings.sound, stored: (() => { try { const j = JSON.parse(localStorage.getItem('boltyard.save.v1')); return j.stats.shifts; } catch (e) { return 'n/a'; } })() }; });
    ok(fresh.shifts === 0 && fresh.bolts === 0 && fresh.titan === 0 && !fresh.won, 'reset save is fresh: ' + JSON.stringify(fresh));
    ok(NOSTORE || fresh.stored === 0, 'reset is written to localStorage');
    await page.tap('#btnTitleClock');
    ok(await L.waitScreen(page, ['shift'], 3000) === 'shift', 'a new game starts after reset');
  }
  if (errors.length) errors.slice(0, 8).forEach((e) => fail('browser error: ' + e));
  if (end.rej && end.rej.length) fail('unhandled rejections: ' + end.rej.join(' | '));
  const reasonStr = Object.keys(reasons).map((k) => k + ' ' + reasons[k]).join(', ');
  console.log('PLAY-THROUGH seed=' + SEED + ' skill=' + SKILL + (NOSTORE ? ' storage=BLOCKED' : '') + ': ' +
    (problems.length ? problems.length + ' PROBLEM(S)' : 'PASS') + ' | shifts ' + shifts + ' (' + reasonStr + ') | sim ' + Math.round(simTime) + 's (' + (simTime / 60).toFixed(1) + ' min) | wall ' +
    Math.round(wall() / 1000) + 's | reloads ' + reloads + ' | purchases ' + (tapBuys + uiBuys) + ' (' + tapBuys + ' real taps) | console errors ' + errors.length);
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.log('PLAY-THROUGH crashed: ' + (e && e.stack || e)); process.exit(2); });
