// Usage: node tools/render-act2-shot.js [only-substring] ; saves shots/render-a2-*.png (Act II feature shots + perf)
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, '../shots');
const URL = 'file://' + path.resolve(__dirname, 'render-harness.html');
const only = process.argv[2] || '';

const RND = { fusion: 3, supercell: 2, dividends: 3, lattice: 3, storm: 3, singularity: 3, severance: 2, stockopt: 3, rehire: 3, nanites: 3, parachute: 2 };
const BASE = { coil: 14, pulse: 8, field: 6, fork: 3, amp: 3, chain: 2, overload: 2, cell: 10, thrust: 4, magnet: 5, capacitor: 2, drone: 3, titan: 1 };
const ALL = Object.assign({}, BASE, RND);

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  async function page(w, h, o) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: (o && o.dpr) || 2, hasTouch: true, isMobile: true });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(URL);
    await p.waitForFunction(() => document.title === 'ready');
    await p.evaluate((o) => H.init(o), o || {});
    return p;
  }
  async function snap(p, name) { await p.screenshot({ path: `${OUT}/render-a2-${name}.png` }); console.log('saved', name); }
  const want = (n) => !only || n.includes(only);
  async function scene(name, fn, arg, o) {
    if (!want(name)) return;
    const p = await page(390, 700, o);
    await p.evaluate(fn, arg);
    await snap(p, name);
    await p.close();
  }

  // sector looks 6-11, calm floor, a few bots + bolts so readability can be judged
  if (want('sector')) {
    for (const s of [6, 7, 8, 9, 10, 11]) {
      const p = await page(390, 700);
      await p.evaluate(([s]) => {
        H.start({ sector: s, up: { coil: 20, field: 6, titan: 1, cell: 10 }, overtime: s === 11 ? 5 : 0, seed: 40 + s, flags: { act2: true } });
        H.hold(180, 380);
        H.clearBots();
        H.fill('scrapling', 5, 180, 330, 110); H.fill('sparker', 3, 180, 430, 90); H.fill('hauler', 1, 90, 250); H.fill('shieldbot', 2, 280, 520, 20);
        H.pickups(30, 180, 380, 240, 3);
        H.run.player.battery = H.run.player.maxBattery;
        H.seconds(1.2, null, 2);
      }, [s]);
      await snap(p, 'sector' + s); await p.close();
    }
  }

  // laser lane: windup, then firing (Firewall boss)
  if (want('laser')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 7, up, seed: 5, flags: { act2: true } });
      H.hold(180, 420); H.clearBots();
      H.spawn('firewall'); H.seconds(3, null, 4);
      H.step(60 * 30, (r) => r.hazards.some(h => h.kind === 'laser' && !h.firing && h.t / h.dur > 0.7), 1);
    }, ALL);
    await snap(p, 'laser-windup');
    await p.evaluate(() => { H.step(60 * 5, (r) => r.hazards.some(h => h.kind === 'laser' && h.firing && (h.t - h.dur) / h.fire > 0.25), 1); });
    await snap(p, 'laser-fire');
    await p.evaluate(() => { H.step(60 * 5, (r, ev) => !r.hazards.some(h => h.kind === 'laser'), 1); H.step(4, null, 1); });
    await snap(p, 'laser-afterglow');
    await p.close();
  }

  // barrage (Forklift) + grid barrage (Inspector)
  if (want('barrage')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 6, up, seed: 6, flags: { act2: true } });
      H.hold(180, 420); H.clearBots(); H.spawn('forklift', 180, 90); H.keepBoss = 0.9;
      H.step(60 * 40, (r) => r.hazards.filter(h => h.kind === 'slam').length >= 3 && r.hazards.filter(h => h.kind === 'slam').every(h => h.t > 0.1), 1);
      H.step(14, null, 1);
    }, ALL);
    await snap(p, 'barrage');
    await p.close();
  }

  // blink: reticle + vanish
  if (want('blink')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 8, up, seed: 8, flags: { act2: true } });
      H.hold(180, 440); H.clearBots(); H.spawn('inspector', 180, 120); H.keepBoss = 0.9;
      H.step(60 * 40, (r) => r.hazards.some(h => h.kind === 'blink' && h.t / h.dur > 0.5), 1);
    }, ALL);
    await snap(p, 'blink');
    await p.evaluate(() => { H.step(60 * 3, (r, ev) => H.hasEvent(ev, 'blink'), 1); H.step(3, null, 1); });
    await snap(p, 'blink-land');
    await p.close();
  }

  // Firewall Node links
  await scene('firenode', (up) => {
    H.start({ sector: 7, up, seed: 9, flags: { act2: true } });
    H.hold(180, 560); H.clearBots();
    const n1 = H.spawn('firenode', 110, 250), n2 = H.spawn('firenode', 260, 330);
    H.fill('sparker', 4, 110, 270, 70); H.fill('hauler', 2, 260, 350, 50); H.fill('scrapling', 3, 190, 300, 60);
    H.seconds(1.5, null, 2);
  }, ALL);

  // Repo steal (bolts flying into the sack) + refund
  if (want('repo')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 6, up, seed: 10, flags: { act2: true } });
      H.hold(180, 420); H.clearBots();
      H.run.earned.bolts = 4000;
      const r = H.spawn('repo', 190, 330);
      H.step(60 * 6, (rr, ev) => H.hasEvent(ev, 'steal'), 1);
      H.step(5, null, 1);
    }, ALL);
    await snap(p, 'repo-steal');
    await p.evaluate(() => {
      const r = H.run.enemies.find(e => e.type === 'repo');
      H.input = () => ({ x: r.x, y: r.y });
      H.step(60 * 5, (rr, ev) => H.hasEvent(ev, 'refund'), 1); H.step(5, null, 1);
    });
    await snap(p, 'repo-refund');
    await p.close();
  }

  // printer puff + mimic wake
  if (want('printer')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 8, up, seed: 11, flags: { act2: true } });
      H.hold(180, 560); H.clearBots();
      H.spawn('printer', 150, 300); H.spawn('mimic', 250, 470);
      H.step(60 * 8, (r, ev) => H.hasEvent(ev, 'print'), 1); H.step(4, null, 1);
    }, ALL);
    await snap(p, 'printer');
    await p.evaluate(() => { H.hold(250, 440); H.step(60 * 6, (r, ev) => H.hasEvent(ev, 'mimicWake'), 1); H.step(4, null, 1); });
    await snap(p, 'mimic-wake');
    await p.close();
  }

  // nanites: 40 infected
  await scene('nanites', (up) => {
    H.start({ sector: 9, up, seed: 12, flags: { act2: true } });
    H.hold(180, 560); H.clearBots();
    const bots = H.fill('scrapling', 14, 180, 300, 150).concat(H.fill('roller', 8, 180, 340, 120), H.fill('sparker', 6, 180, 280, 130));
    bots.forEach(e => { e.infected = 4; e.hp = e.maxHp * 1000; e.maxHp = e.hp; });
    H.seconds(0.5, null, 2);
  }, ALL);

  // Storm Coil
  if (want('storm')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 9, up: Object.assign({}, up, { storm: 5 }), seed: 13, flags: { act2: true } });
      H.hold(180, 560); H.clearBots();
      H.fill('hauler', 8, 180, 300, 150); H.fill('sparker', 6, 180, 330, 130);
      H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
      H.run.pulses = 0;
      H.step(60 * 20, (r, ev) => H.hasEvent(ev, 'storm'), 1); H.step(3, null, 1);
    }, ALL);
    await snap(p, 'storm');
    await p.close();
  }

  // Tesla lattice (links)
  await scene('lattice', (up) => {
    H.start({ sector: 7, up: Object.assign({}, up, { drone: 4, lattice: 5 }), seed: 14, flags: { act2: true } });
    H.hold(180, 420); H.clearBots();
    H.fill('hauler', 5, 180, 420, 90); H.fill('sparker', 3, 180, 420, 70);
    H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
    H.seconds(1.2, null, 2);
  }, ALL);

  // Singularity well: pull and boom
  if (want('well')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 8, up: Object.assign({}, up, { singularity: 5 }), seed: 15, flags: { act2: true } });
      H.hold(180, 600); H.clearBots();
      H.fill('hauler', 4, 190, 300, 110); H.fill('sparker', 5, 190, 320, 100); H.fill('scrapling', 5, 190, 300, 90);
      H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
      H.pickups(30, 190, 310, 200, 4);
      H.run._wellT = 0.1;
      H.step(60 * 6, (r) => r.wells.length && r.wells[0].t > 1.0, 1);
    }, ALL);
    await snap(p, 'well-pull');
    await p.evaluate(() => { H.step(60 * 3, (r, ev) => H.hasEvent(ev, 'wellBoom'), 1); H.step(5, null, 1); });
    await snap(p, 'well-boom');
    await p.close();
  }

  // interns
  await scene('interns', (up) => {
    H.start({ sector: 6, up: Object.assign({}, up, { rehire: 5 }), seed: 16, flags: { act2: true } });
    H.hold(180, 560); H.clearBots();
    H.fill('sparker', 6, 180, 280, 120);
    const it = (x, y) => H.run.interns.push({ id: 9100 + H.run.interns.length, x, y, vx: 0, vy: 0, age: 1, life: 6 });
    it(120, 330); it(200, 300); it(250, 360); it(160, 250);
    H.run.events.push({ type: 'intern', id: 1, x: 200, y: 300 }); H.run.events.push({ type: 'internEnd', id: 2, x: 120, y: 330 });
    H.step(8, null, 1);
  }, ALL);

  // Severance
  if (want('severance')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 9, up: Object.assign({}, up, { severance: 3 }), seed: 17, flags: { act2: true } });
      H.hold(180, 400); H.clearBots();
      H.fill('hauler', 6, 180, 400, 120); H.fill('sparker', 5, 180, 400, 100);
      H.pickups(60, 180, 400, 330, 6);
      H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
      H.god = false; H.run.player.battery = 0.001;
      H.step(60 * 3, (r, ev) => H.hasEvent(ev, 'severance'), 1); H.step(4, null, 1);
    }, ALL);
    await snap(p, 'severance');
    await p.close();
  }

  // Stock Options popup
  await scene('stock', (up) => {
    H.start({ sector: 9, up: Object.assign({}, up, { stockopt: 5 }), seed: 18, flags: { act2: true } });
    H.hold(180, 420); H.clearBots();
    H.fill('scrapling', 5, 180, 330, 90);
    H.run.events.push({ type: 'stock', n: 1, mult: 1.1 });
    H.run.stock.mult = 1.1;
    H.step(14, null, 1);
  }, ALL);

  // Colossus + budget cut
  await scene('colossus-budget', (up) => {
    H.start({ sector: 9, up: Object.assign({}, up, { takeover: 1 }), seed: 19, flags: { act2: true } });
    H.hold(180, 400); H.clearBots();
    H.fill('sparker', 6, 180, 330, 110); H.run.player.budget = true;
    H.seconds(1.4, null, 2);
  }, ALL);

  // vice president boss phase 2 (laser + budget + repo summons)
  if (want('vp')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 9, up, seed: 20, flags: { act2: true } });
      H.hold(180, 440); H.clearBots(); const bo = H.spawn('vp', 180, 120); H.keepBoss = 0.45;
      bo.hp = bo.maxHp * 0.45; H.run.boss.hp = bo.hp;
      H.step(60 * 30, (r) => r.hazards.some(h => h.kind === 'laser' && h.firing), 1); H.step(6, null, 1);
    }, ALL);
    await snap(p, 'vp');
    await p.close();
  }

  // chairman phase 4 in the boardroom (blink + budget)
  if (want('chairman')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 10, up, seed: 21, flags: { act2: true } });
      H.hold(180, 500); H.clearBots(); const bo = H.spawn('chairman', 180, 120);
      bo.hp = bo.maxHp * 0.2; H.run.boss.hp = bo.hp; H.keepBoss = 0.2;
      H.step(60 * 40, (r) => r.hazards.some(h => h.kind === 'blink') && r.hazards.some(h => h.kind === 'slam' || h.kind === 'laser'), 1);
    }, ALL);
    await snap(p, 'chairman');
    await p.close();
  }

  // big numbers
  await scene('bignums', (up) => {
    H.start({ sector: 11, up, overtime: 4, seed: 22, flags: { act2: true } });
    H.hold(180, 420); H.clearBots();
    H.fill('hauler', 6, 180, 330, 100);
    H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e40; });
    H.seconds(3, null, 2);
    const ev = H.run.events;
    [['1.23e15', 330, 300, 0], ['4.5e18', 120, 260, 1], ['7.8e24', 240, 300, 1], ['9e30', 180, 360, 0]].forEach(([v, x, y, c]) => ev.push({ type: 'hit', x, y, dmg: Number(v), crit: !!c, armored: false, enemyId: 77000 + x }));
    ev.push({ type: 'pickup', kind: 'bolt', value: 3.4e16, x: 180, y: 420 });
    H.step(8, null, 1);
  }, ALL);

  // reduced motion variants
  if (want('reduced')) {
    const p = await page(390, 700, { reducedMotion: true });
    await p.evaluate((up) => {
      H.start({ sector: 9, up: Object.assign({}, up, { singularity: 5, storm: 5, lattice: 5, drone: 4 }), seed: 23, flags: { act2: true } });
      H.hold(180, 560); H.clearBots();
      H.fill('hauler', 8, 190, 300, 120); H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; e.infected = 4; });
      H.run.pulses = 0; H.run._wellT = 0.1;
      H.step(60 * 6, (r) => r.wells.length && r.wells[0].t > 0.9, 1);
    }, ALL);
    await snap(p, 'reduced'); await p.close();
  }

  // perf
  if (want('perf')) {
    const p = await page(390, 700);
    const r = await p.evaluate(() => H.perf2(300));
    console.log('PERF2 390x700 dpr2', JSON.stringify(r));
    fs.writeFileSync(`${OUT}/render-a2-perf.json`, JSON.stringify(r, null, 1));
    await snap(p, 'perf-scene');
    await p.close();
    // Act I scene again for regression
    const p2 = await page(390, 700);
    const r2 = await p2.evaluate(() => H.perf(300));
    console.log('PERF1 (Act I scene)', JSON.stringify({ avg: r2.avg, p95: r2.p95, worst: r2.worst, js: r2.avgJsOnly }));
    await p2.close();
  }

  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await b.close();
})();
