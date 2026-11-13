// Usage: node tools/render-shot.js [only-substring] ; saves shots/render-*.png
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, '../shots');
const URL = 'file://' + path.resolve(__dirname, 'render-harness.html');
const only = process.argv[2] || '';

const MID = { coil: 8, pulse: 6, field: 5, fork: 2, amp: 2, chain: 2, overload: 2, cell: 8, thrust: 3, magnet: 4, sorter: 3, drone: 2, dronedmg: 1 };
const STRONG = { coil: 14, pulse: 8, field: 6, fork: 3, amp: 3, chain: 3, overload: 3, surge: 3, cell: 10, thrust: 4, magnet: 5, capacitor: 2, drone: 3, dronedmg: 2, recycler: 3 };

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
  async function snap(p, name) { await p.screenshot({ path: `${OUT}/render-${name}.png` }); console.log('saved', name); }
  const want = (n) => !only || n.includes(only);

  // (a) first shift, sector 1, mid-zap
  if (want('a-first')) {
    const p = await page(390, 700);
    await p.evaluate(() => { H.start({ sector: 1, seed: 11 }); H.seconds(4, (r, ev) => r.t > 3 && H.hasEvent(ev, 'zap')); });
    await snap(p, 'a-first'); await p.close();
  }
  // (b) mid-game busy sector 3, chain/overload, bolts being vacuumed
  if (want('b-busy')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 3, up, seed: 5 });
      H.seconds(40, (r, ev) => r.t > 14 && r.pickups.length > 25 && H.hasEvent(ev, 'explode') && H.hasEvent(ev, 'zap'), 2);
    }, MID);
    await snap(p, 'b-busy'); await p.close();
  }
  if (want('b-sector')) {
    for (const s of [1, 2, 4, 5]) {
      const p = await page(390, 700);
      await p.evaluate(([up, s]) => { H.start({ sector: s, up, seed: 5 + s }); H.seconds(12, null, 2); }, [MID, s]);
      await snap(p, 'b-sector' + s); await p.close();
    }
  }
  // (c) overclock
  if (want('c-oc')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 2, up, seed: 9 });
      H.seconds(8, null, 2);
      H.run.player.oc.charge = 1;
      H.seconds(10, (r, ev) => H.hasEvent(ev, 'ocStart'), 1);
      H.seconds(0.5, null, 1);
    }, Object.assign({ capacitor: 2 }, MID));
    await snap(p, 'c-oc'); await p.close();
  }
  // (d) low battery
  if (want('d-low')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 2, up, seed: 9, god: false });
      H.seconds(6, null, 2);
      H.run.player.battery = H.run.player.maxBattery * 0.12;
      H.seconds(0.8, null, 1);
    }, MID);
    await snap(p, 'd-low'); await p.close();
  }
  // (e) wardens
  const W = [
    ['compactor', 1, { coil: 3, field: 2 }, (r) => r.hazards.some(h => h.kind === 'slam' && h.t / h.dur > 0.6)],
    ['shredder', 2, { coil: 4, field: 2 }, (r) => r.hazards.some(h => h.kind === 'charge' && h.t / h.dur > 0.55)],
    ['furnace', 3, { coil: 4, field: 2 }, (r) => r.shots.length >= 8 && r.boss.state === 'active'],
    ['foreman', 4, { coil: 4, field: 2 }, null],
    ['overseer', 5, { coil: 4, field: 2, titan: 1, cell: 4, capacitor: 1 }, (r) => r.hazards.some(h => h.kind === 'slam' && h.t / h.dur > 0.6)],
  ];
  for (const [id, sec, up, pred] of W) {
    if (!want('e-' + id)) continue;
    const p = await page(390, 700);
    await p.evaluate(([id, sec, up, hasPred]) => {
      H.start({ sector: sec, up, seed: 21 + sec });
      H.seconds(3, null, 3);
      H.summon(); H.keepBoss = 0.8;
      H.seconds(3.2, null, 3);
    }, [id, sec, up, !!pred]);
    if (id === 'foreman') {
      await p.evaluate(() => {
        const bo = H.bossEnemy(); H.keepBoss = 0; bo.hp = bo.maxHp * 0.74; H.run.boss.hp = bo.hp;
        H.step(120, (r) => r.enemies.some(e => e.type === 'pylon' && !e.dead) && H.bossEnemy() && H.bossEnemy().invuln, 1);
        H.seconds(0.7);
      });
    } else {
      // run until the telegraph predicate (evaluated in page via string)
      await p.evaluate(([id]) => {
        const preds = {
          compactor: (r) => r.hazards.some(h => h.kind === 'slam' && h.t / h.dur > 0.6),
          shredder: (r) => r.hazards.some(h => h.kind === 'charge' && h.t / h.dur > 0.55),
          furnace: (r) => r.shots.length >= 8,
          overseer: (r) => r.hazards.some(h => h.kind === 'slam' && h.t / h.dur > 0.6),
        };
        H.step(60 * 40, preds[id], 1);
        if (id === 'furnace') H.step(18, null, 1);
      }, [id]);
    }
    await snap(p, 'e-' + id); await p.close();
  }
  // furnace: slam variant too
  if (want('e-furnace-slam')) {
    const p = await page(390, 700);
    await p.evaluate(() => {
      H.start({ sector: 3, up: { coil: 4, field: 2 }, seed: 24 });
      H.seconds(3, null, 3); H.summon(); H.keepBoss = 0.8;
      H.step(60 * 40, (r) => r.hazards.some(h => h.kind === 'slam' && h.t / h.dur > 0.7), 1);
    });
    await snap(p, 'e-furnace-slam'); await p.close();
  }
  // warning phase
  if (want('e-warn')) {
    const p = await page(390, 700);
    await p.evaluate(() => {
      H.start({ sector: 2, up: { coil: 6, field: 3 }, seed: 31 });
      H.seconds(4, null, 3); H.summon(); H.seconds(1.4, null, 1);
    });
    await snap(p, 'e-warn'); await p.close();
  }
  // (f) warden death sequence
  if (want('f-death')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 2, up, seed: 41 });
      H.seconds(3, null, 3); H.summon(); H.keepBoss = 0.5;
      H.seconds(3.2, null, 3);
      H.keepBoss = 0;
      const bo = H.bossEnemy(); bo.hp = 0.5; H.run.boss.hp = 0.5;
      H.run.player.x = bo.x; H.run.player.y = bo.y + bo.r + 20; H.run.player.vx = 0; H.run.player.vy = 0;
      H.input = (r) => ({ x: bo.x, y: bo.y + bo.r + 20 });
      H.step(240, (r, ev) => H.hasEvent(ev, 'bossDead'), 1);
    }, { coil: 5, field: 3 });
    const marks = [0, 0.08, 0.25, 0.5, 0.8, 1.15, 1.6, 2.2];
    let last = 0;
    for (const m of marks) {
      await p.evaluate(([dt]) => { if (dt > 0) H.idle(dt); H.sheetAdd(); }, [m - last]);
      last = m;
    }
    const url = await p.evaluate(() => H.sheetBuild(4));
    fs.writeFileSync(`${OUT}/render-f-death.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved f-death'); await p.close();
  }
  // (g) the Titan, sector 5
  if (want('g-titan')) {
    const p = await page(390, 700);
    await p.evaluate(() => {
      H.start({ sector: 5, up: { coil: 12, pulse: 6, field: 6, fork: 3, chain: 3, overload: 3, cell: 10, thrust: 4, magnet: 5, capacitor: 2, drone: 3, titan: 1, spare: 1 }, seed: 17 });
      H.run.player.x = 180; H.run.player.y = 330;
      H.input = (r) => ({ x: 180 + Math.sin(r.t) * 40, y: 330 + Math.cos(r.t * 0.8) * 40 });
      H.seconds(20, (r, ev) => r.t > 8 && r.pickups.length > 6 && H.hasEvent(ev, 'zap'), 2); H.input = null;
    });
    await snap(p, 'g-titan'); await p.close();
  }
  // (h) other viewports
  if (want('h-')) {
    for (const [w, h, n] of [[320, 520, 'h-320x520'], [480, 900, 'h-480x900'], [800, 500, 'h-landscape']]) {
      const p = await page(w, h);
      await p.evaluate((up) => {
        H.start({ sector: 2, up, seed: 5 });
        H.seconds(30, (r, ev) => r.t > 9 && H.hasEvent(ev, 'zap') && r.pickups.length > 6, 2);
      }, MID);
      await snap(p, n); await p.close();
    }
    // rotation: a run created at portrait, then the canvas becomes landscape
    const p = await page(390, 700);
    await p.evaluate((up) => { H.start({ sector: 2, up, seed: 5 }); H.seconds(8, null, 2); }, MID);
    await p.setViewportSize({ width: 700, height: 390 });
    await p.evaluate(() => { H.resize(); H.draw(1 / 60); });
    await snap(p, 'h-rotated'); await p.close();
  }
  // (i) paused
  if (want('i-paused')) {
    const p = await page(390, 700);
    await p.evaluate((up) => {
      H.start({ sector: 2, up, seed: 5 });
      H.seconds(10, (r, ev) => r.t > 8 && H.hasEvent(ev, 'zap'), 2);
      H.dopt = { paused: true }; H.draw(1 / 60); H.draw(1 / 60);
    }, MID);
    await snap(p, 'i-paused'); await p.close();
  }
  // (j) reduced motion
  if (want('j-reduced')) {
    const p = await page(390, 700, { reducedMotion: true });
    await p.evaluate((up) => {
      H.start({ sector: 3, up, seed: 5 });
      H.seconds(30, (r, ev) => r.t > 12 && H.hasEvent(ev, 'explode') && r.pickups.length > 12, 2);
    }, MID);
    await snap(p, 'j-reduced'); await p.close();
  }
  // reticle + attract + over
  if (want('k-misc')) {
    const p = await page(390, 700);
    await p.evaluate(() => {
      H.start({ sector: 1, seed: 3 });
      H.seconds(5, null, 2);
      H.dopt = { reticle: { x: H.run.player.tx, y: H.run.player.ty } }; H.draw(1 / 60);
    });
    await snap(p, 'k-reticle');
    await p.evaluate(() => { H.dopt = null; H.start({ sector: 1, attract: true, seed: 3 }); H.seconds(4, null, 2); });
    await snap(p, 'k-attract');
    await p.evaluate(() => { H.dopt = null; H.start({ sector: 1, seed: 3, god: false }); H.run.player.battery = 0.01; H.seconds(3, null, 1); H.idle(0.5); });
    await snap(p, 'k-over');
    await p.close();
  }
  // perf
  if (want('perf')) {
    const p = await page(390, 700);
    const r = await p.evaluate(() => H.perf(300));
    console.log('PERF 390x700 dpr2', JSON.stringify(r));
    fs.writeFileSync(`${OUT}/render-perf.json`, JSON.stringify(r, null, 1));
    await snap(p, 'perf-scene');
    await p.close();
  }
  // robustness
  if (want('robust')) {
    const p = await page(390, 700);
    const r = await p.evaluate(() => {
      const R = BY.Render, out = [];
      try { R.handle(undefined); R.handle([]); R.handle([null, { type: 'nope' }, { type: 'kill' }, { type: 'zap' }, { type: 'hit' }, { type: 'pickup' }], undefined); out.push('ok1'); } catch (e) { out.push('FAIL1 ' + e); }
      H.start({ sector: 1 });
      try {
        R.handle([null, undefined, { type: 'nope' }, { type: 'kill' }, { type: 'zap' }, { type: 'hit' }, { type: 'pickup' }, { type: 'explode' }, { type: 'bossDead' }, { type: 'slam' }, { type: 'shield', on: true }, { type: 'bossSpawn' }, { type: 'spawn' }, { type: 'hurt' }], H.run);
        H.run.enemies.push({ type: 'zzz', x: 10, y: 10, r: 10, hp: 1, maxHp: 2 });
        H.run.hazards.push({ kind: 'weird' }, { kind: 'slam', x: 10, y: 10 });
        R.draw(H.run, 0.016, {}); R.draw(H.run, undefined, undefined); R.draw(null, 0.016); out.push('ok2');
      } catch (e) { out.push('FAIL2 ' + e + e.stack); }
      // before init-ish calls
      out.push(JSON.stringify(R.arenaSize()), R.scale(), JSON.stringify(R.toArena(100, 100)));
      return out;
    });
    console.log('ROBUST', JSON.stringify(r));
    await p.close();
  }
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await b.close();
})();
