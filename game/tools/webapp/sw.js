/* Boltyard Home Screen app: offline cache. VERSION is stamped by tools/build.js --pwa. */
'use strict';
var VERSION = '__VERSION__';
var CACHE = 'boltyard-' + VERSION;
var FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('boltyard-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// The game page: network first (so updates arrive whenever you're online), cached copy when offline or slow.
// Everything else: cache first.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  var isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname);
  if (isPage) {
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var fallback = function () { caches.match('./index.html').then(function (r) { if (!done && r) { done = true; resolve(r); } }); };
      var timer = setTimeout(fallback, 3500);
      fetch(req).then(function (res) {
        clearTimeout(timer);
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }); }
        if (!done) { done = true; resolve(res); }
      }, function () { clearTimeout(timer); caches.match('./index.html').then(function (r) { if (!done) { done = true; resolve(r || Response.error()); } }); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
});
