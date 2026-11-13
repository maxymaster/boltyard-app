// Usage: node tools/render-act3-shot.js [only-substring] ; renders Act III sector looks + effects into
// shots/render-act3.png (one contact sheet) and prints page errors.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, '../shots');
const URL = 'file://' + path.resolve(__dirname, 'render-harness.html');
const only = process.argv[2] || '';
const UP = { coil: 14, pulse: 8, field: 6, fork: 3, amp: 3, chain: 2, overload: 2, cell: 10, thrust: 4, magnet: 5, capacitor: 2, drone: 3, titan: 1 };
const FL = { act2: true, act3: true };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [], tiles = [];
  async function scene(name, fn, arg) {
    if (only && !name.includes(only)) return;
    const p = await b.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    p.on('pageerror', e => errs.push(name + ': ' + String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + m.text()); });
    await p.goto(URL);
    await p.waitForFunction(() => document.title === 'ready');
    await p.evaluate(() => H.init({}));
    await p.evaluate(fn, arg);
    tiles.push({ name, img: (await p.screenshot()).toString('base64') });
    await p.close();
  }
  const start = (sector, seed, extra) => `H.start(Object.assign({ sector: ${sector}, up: ${JSON.stringify(UP)}, seed: ${seed}, flags: ${JSON.stringify(FL)} }, ${JSON.stringify(extra || {})}));`;
  const common = (sector, seed, extra) => new Function(`${start(sector, seed, extra)} H.hold(180, 380); H.clearBots();`);

  // sector looks 11..16
  for (const s of [11, 12, 13, 14, 15, 16]) {
    await scene('sector' + s, (s) => {
      H.start({ sector: s, up: { coil: 20, field: 6, titan: 1, cell: 10 }, overtime: s === 16 ? 5 : 0, seed: 40 + s, flags: { act2: true, act3: true } });
      H.hold(180, 380); H.clearBots();
      H.fill('scrapling', 5, 180, 330, 110); H.fill('sparker', 3, 180, 430, 90); H.fill('hauler', 1, 90, 250); H.fill('shieldbot', 2, 280, 520, 20);
      H.pickups(30, 180, 380, 240, 3);
      H.run.player.battery = H.run.player.maxBattery;
      H.seconds(1.2, null, 2);
    }, s);
  }
  // hold telegraph + held clamp (Receptionist)
  await scene('hold', () => {
    H.start({ sector: 11, up: { coil: 14, field: 6 }, seed: 3, flags: { act2: true, act3: true } });
    H.hold(180, 420); H.clearBots();
    H.run.hazards.push({ kind: 'hold', x: 110, y: 330, r: 40, t: 0.55, dur: 1.0 });
    H.run.hazards.push({ kind: 'hold', x: 180, y: 430, r: 40, t: 0.9, dur: 1.0 });
    H.fill('spam', 4, 250, 300, 40);
    H.run.player.held = 0.8; H.draw(1 / 60); H.draw(1 / 60);
  });
  // injunction seals + enjoined Sprocket
  await scene('injunction', () => {
    H.start({ sector: 12, up: { coil: 14, field: 6 }, seed: 4, flags: { act2: true, act3: true } });
    H.hold(180, 400); H.clearBots();
    H.run.hazards.push({ kind: 'injunction', x: 180, y: 400, r: 50, t: 1.5, dur: 0.8, life: 6, active: true });
    H.run.hazards.push({ kind: 'injunction', x: 90, y: 300, r: 50, t: 4.5, dur: 0.8, life: 6, active: true });
    H.run.hazards.push({ kind: 'injunction', x: 270, y: 300, r: 50, t: 0.4, dur: 0.8, life: 6, active: false });
    H.run.player.enjoined = true; H.draw(1 / 60); H.run.hazards.forEach(h => { if (h.x === 270) h.t = 0.6; });
    H.draw(1 / 60);
  });
  // clawback stream + copy + HR links
  await scene('clawback', () => {
    H.start({ sector: 13, up: { coil: 14, field: 6 }, seed: 5, flags: { act2: true, act3: true } });
    H.hold(180, 480); H.clearBots();
    const bo = H.spawn('comptroller', 180, 90); H.run.boss.state = 'active'; H.run.boss.enemyId = bo.id;
    H.run.events.push({ type: 'clawback', bolts: 4.2e9 }); H.step(1, null, 1); H.step(14, null, 1);
  });
  await scene('copy-hr', () => {
    H.start({ sector: 11, up: { coil: 14, field: 6 }, seed: 6, flags: { act2: true, act3: true } });
    H.hold(180, 560); H.clearBots();
    const a = H.spawn('hr', 200, 330), s1 = H.spawn('scrapling', 130, 300), s2 = H.spawn('hauler', 270, 340);
    const k = H.spawn('copier', 140, 400), c = H.spawn('scrapling', 100, 400, { copy: true });
    c.copy = true; c.hp *= 0.6;
    H.run.heals.push({ x1: 200, y1: 330, x2: 130, y2: 300 }, { x1: 200, y1: 330, x2: 270, y2: 340 });
    H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; e.vx = e.vy = 0; });
    H.run.events.push({ type: 'copy', enemyId: c.id, srcId: s1.id });
    H.step(6, null, 1);
  });
  // courier + spam
  await scene('courier-spam', () => {
    H.start({ sector: 14, up: { coil: 14, field: 6 }, seed: 7, flags: { act2: true, act3: true } });
    H.hold(180, 560); H.clearBots();
    const c = H.spawn('courier', 120, 300); c.vx = 150; c.vy = 40;
    H.fill('spam', 8, 240, 400, 45);
    H.run.events.push({ type: 'spawn', enemyId: 1, enemyType: 'spam', x: 300, y: 200 });
    H.step(3, null, 1);
  });
  // orbital marker, then beam + restructuring burst
  await scene('orbital', () => {
    H.start({ sector: 15, up: { coil: 14, field: 6 }, seed: 8, flags: { act2: true, act3: true } });
    H.hold(180, 560); H.clearBots();
    H.fill('hauler', 4, 180, 300, 50);
    H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
    H.run.strikes.push({ id: 9001, x: 180, y: 300, r: 40, t: 0.7, dur: 1.0, targetId: 0 });
    H.run.strikes.push({ id: 9002, x: 90, y: 420, r: 40, t: 0.3, dur: 1.0, targetId: 0 });
    H.draw(1 / 60);
  });
  await scene('beam-burst', () => {
    H.start({ sector: 15, up: { coil: 14, field: 6 }, seed: 9, flags: { act2: true, act3: true } });
    H.hold(180, 560); H.clearBots();
    H.fill('hauler', 4, 180, 300, 60);
    H.run.enemies.forEach(e => { e.hp = e.maxHp = 1e30; });
    H.run.events.push({ type: 'orbital', x: 160, y: 300, r: 40, n: 3 }, { type: 'burst', x: 240, y: 400, r: 60, n: 2 });
    H.step(8, null, 1);
  });
  // market volatility
  await scene('market', () => {
    H.start({ sector: 14, up: { coil: 14, field: 6 }, seed: 10, flags: { act2: true, act3: true } });
    H.hold(180, 560); H.clearBots();
    const bo = H.spawn('market', 180, 200); H.run.boss.state = 'active'; H.run.boss.enemyId = bo.id; H.run.boss.vol = 2.14;
    H.run.boss.phase = 2; H.draw(1 / 60); H.draw(1 / 60);
  });
  // founder aura + phase flash + magnate
  await scene('founder-magnate', () => {
    H.start({ sector: 15, up: { coil: 14, field: 6, titan: 1 }, seed: 11, flags: { act2: true, act3: true } });
    H.hold(180, 440); H.clearBots();
    const bo = H.spawn('founder', 180, 230); H.run.boss.state = 'active'; H.run.boss.enemyId = bo.id; H.run.boss.aura = 90; H.run.boss.phase = 4;
    H.run.player.magnate = true;
    H.run.events.push({ type: 'founder', phase: 4 }); H.step(1, null, 1); H.step(8, null, 1);
  });
  await scene('founder-phase', () => {
    H.start({ sector: 16, up: { coil: 14, field: 6 }, seed: 12, flags: { act2: true, act3: true }, overtime: 3 });
    H.hold(180, 560); H.clearBots();
    const bo = H.spawn('founder', 180, 200); H.run.boss.state = 'active'; H.run.boss.enemyId = bo.id; H.run.boss.phase = 2;
    H.run.events.push({ type: 'founder', phase: 2 }); H.step(1, null, 1); H.step(4, null, 1);
  });

  // contact sheet
  const cols = 6, tw = 260, th = Math.round(700 * tw / 390), lh = 16;
  const rows = Math.ceil(tiles.length / cols);
  const p = await b.newPage({ viewport: { width: cols * tw, height: rows * (th + lh) } });
  const html = '<body style="margin:0;background:#000;color:#cfe;font:12px monospace">' + tiles.map((t, i) =>
    `<div style="position:absolute;left:${(i % cols) * tw}px;top:${Math.floor(i / cols) * (th + lh)}px;width:${tw}px"><div style="height:${lh}px">${t.name}</div><img width="${tw}" src="data:image/png;base64,${t.img}"></div>`).join('') + '</body>';
  await p.setContent(html);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/render-act3.png` });
  console.log('saved', `${OUT}/render-act3.png`, tiles.length, 'tiles');
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await b.close();
})();
