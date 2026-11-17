/* Offline support for the Physics Lab app.
 * - App files: network first (updates show up right away), cache as backup.
 * - Hand tracker (MediaPipe library + model, versioned URLs that never
 *   change): cache first, saved the first time the camera is used.
 * Bump VERSION when the PRECACHE list changes. */
var VERSION = "v6";
var APP_CACHE = "physlab-app-" + VERSION;
var LIB_CACHE = "physlab-lib-v1";

var CORE = ["index", "physics", "analysis", "projectile", "pendulum", "models", "gesture", "calibration",
  "vision", "camera", "sim", "trigger", "replay", "framebuffer", "render"];
var PRECACHE = [
  "./", "index.html", "app.css", "app.js", "catch.js", "throw.js", "swing.js", "ramp.js", "camera.js", "panels.js", "handinput.js", "worlds.js", "place.js", "util.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-180.png",
  "../lab/handtrack.js", "../lab/sounds.js", "../lab/catchview.js"
].concat(CORE.map(function(m) { return "../core/" + m + ".js"; }));

var LIB_HOSTS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/",
  "https://storage.googleapis.com/mediapipe-models/"
];

self.addEventListener("install", function(e) {
  e.waitUntil(caches.open(APP_CACHE).then(function(c) { return c.addAll(PRECACHE); }).then(function() {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k) {
      return k.indexOf("physlab-") === 0 && k !== APP_CACHE && k !== LIB_CACHE;
    }).map(function(k) { return caches.delete(k); }));
  }).then(function() { return self.clients.claim(); }));
});

/* An opaque (no-cors) response can only answer a no-cors request. */
function usable(res, req) {
  return res && (res.type !== "opaque" || req.mode === "no-cors");
}

self.addEventListener("fetch", function(e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = req.url;

  if (LIB_HOSTS.some(function(h) { return url.indexOf(h) === 0; })) {
    e.respondWith(caches.open(LIB_CACHE).then(function(c) {
      return c.match(req).then(function(hit) {
        if (usable(hit, req)) return hit;
        return fetch(req).then(function(res) {
          if (res.ok || res.type === "opaque") c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  if (new URL(url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function(res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(APP_CACHE).then(function(c) { c.put(req, copy); });
    }
    return res;
  }, function() {
    return caches.match(req, { ignoreSearch: true }).then(function(hit) {
      return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
    });
  }));
});
