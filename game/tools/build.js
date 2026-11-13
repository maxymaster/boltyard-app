#!/usr/bin/env node
// node tools/build.js [--stub-render] [--app]
// Assembles dist/index.html (page contract, SPEC 8) and dist/test.html (same, wrapped in the host skeleton).
// --app also writes dist-app/index.html: the offline iPhone-app page (fonts inlined, src/native.js first,
// full document with viewport-fit=cover). Fonts come from ../ios-app/node_modules/@fontsource or tools/fonts/.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const useStub = process.argv.includes('--stub-render') || !fs.existsSync(path.join(root, 'src/render.js'));
const appBuild = process.argv.includes('--app');
const scripts = [
  ['src/data.js'], ['src/engine.js'], ['src/sprites.js'], ['src/audio.js'],
  [useStub ? 'tools/stub-render.js' : 'src/render.js'], ['src/ui.js']
];

function scriptTags(list) {
  let s = '';
  for (const p of list) {
    const code = rd(p);
    if (/<\/script/i.test(code)) { console.error('build: ' + p + ' contains a literal </script sequence'); process.exit(1); }
    s += '<script>\n/* ' + p + ' */\n' + code + '\n</script>\n';
  }
  return s;
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Saira+Stencil+One&display=swap';
if (/<!doctype|<(html|head|body)[\s>]/i.test(rd('src/shell.html'))) { console.error('build: shell.html must not contain doctype/html/head/body'); process.exit(1); }
const body = rd('src/shell.html').trim() + '\n';
const css = '<style>\n' + rd('src/style.css') + '\n</style>\n';

let out = '<title>Boltyard</title>\n' +
  '<meta name="claude:viewport-fit-sides" content="cover">\n' +
  '<link rel="stylesheet" href="' + FONTS + '">\n' + css + body + scriptTags(scripts.map(x => x[0]));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), out);
const wrapped = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>\n' +
  '</head><body>\n' + out + '</body></html>\n';
fs.writeFileSync(path.join(root, 'dist/test.html'), wrapped);
console.log('build ok: dist/index.html ' + (out.length / 1024).toFixed(0) + ' KB, render = ' + (useStub ? 'stub' : 'src/render.js'));

if (appBuild) {
  const dirs = [path.join(root, 'tools/fonts'), path.join(root, '../../ios-app/node_modules/@fontsource'), path.join(root, '../ios-app/node_modules/@fontsource')];
  const find = (pkg, file) => {
    for (const d of dirs) for (const p of [path.join(d, file), path.join(d, pkg, 'files', file)]) if (fs.existsSync(p)) return p;
    console.error('build --app: font not found: ' + file + ' (put it in tools/fonts/)'); process.exit(1);
  };
  const faces = [['chakra-petch', 'Chakra Petch', 400], ['chakra-petch', 'Chakra Petch', 500], ['chakra-petch', 'Chakra Petch', 600],
    ['chakra-petch', 'Chakra Petch', 700], ['saira-stencil-one', 'Saira Stencil One', 400]];
  let fontCss = '';
  for (const [pkg, fam, w] of faces) {
    const b64 = fs.readFileSync(find(pkg, pkg + '-latin-' + w + '-normal.woff2')).toString('base64');
    fontCss += '@font-face{font-family:"' + fam + '";font-style:normal;font-weight:' + w + ';font-display:block;src:url(data:font/woff2;base64,' + b64 + ') format("woff2")}\n';
  }
  const app = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' +
    '<meta name="format-detection" content="telephone=no">\n<title>Boltyard</title>\n' +
    '<style>\n' + fontCss + ':root{color-scheme:dark}html,body{margin:0;height:100%;background:#0e1a21}[hidden]{display:none!important}\n</style>\n' +
    scriptTags(['src/native.js']) + css + '</head><body>\n' + body + scriptTags(scripts.map(x => x[0])) + '</body></html>\n';
  if (/https?:\/\/(?!www\.w3\.org)/.test(app)) { console.error('build --app: page still references the network'); process.exit(1); }
  fs.mkdirSync(path.join(root, 'dist-app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist-app/index.html'), app);
  console.log('build ok: dist-app/index.html ' + (app.length / 1024).toFixed(0) + ' KB (offline app page)');
}
