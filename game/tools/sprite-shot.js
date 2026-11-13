const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1030, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.resolve(__dirname, 'sprite-sheet.html'));
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 5000 }).catch(() => {});
  const out = path.resolve(__dirname, '../shots');
  for (const id of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13']) {
    await p.locator('#' + id).screenshot({ path: out + '/sprites-' + id + '.png' });
  }
  await p.locator('#s13').screenshot({ path: out + '/sprites-act3.png' });
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
  await b.close();
})();
