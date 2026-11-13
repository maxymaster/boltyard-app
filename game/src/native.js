/* src/native.js — only included in the app build (node tools/build.js --app).
 * Runs before every other game script. Marks the page as running inside the native iPhone app,
 * so ui.js can hide browser-only controls (Focus/fullscreen) and wording.
 * The native shell itself keeps the screen awake, hides the status bar and defers edge gestures. */
(function () {
  'use strict';
  window.BY_NATIVE = true;
  var root = document.documentElement;
  root.classList.add('native');
  // Make sure the bundled fonts are decoded before the canvas first draws text with them.
  try {
    if (document.fonts && document.fonts.load) {
      ['400 16px "Chakra Petch"', '600 16px "Chakra Petch"', '700 16px "Chakra Petch"', '16px "Saira Stencil One"']
        .forEach(function (f) { document.fonts.load(f).catch(function () {}); });
    }
  } catch (e) { /* fonts fall back to system faces */ }
  // No long-press callouts, link previews or text selection anywhere in the app.
  var s = document.createElement('style');
  s.textContent = 'html.native,html.native body{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;' +
    'overscroll-behavior:none;-webkit-text-size-adjust:100%}';
  (document.head || root).appendChild(s);
})();
