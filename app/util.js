/* Small app helpers. */
export function $(id) { return document.getElementById(id); }

/* Saved settings, this device only. Storage can be missing or throw
 * (private windows, blocked site data): fall back to defaults. */
export var store = {
  get: function(key, fallback) {
    try {
      var v = localStorage.getItem("physapp_" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set: function(key, value) {
    try { localStorage.setItem("physapp_" + key, JSON.stringify(value)); } catch (e) {}
  }
};

/* Keep the screen on while an experiment runs (tablets dim after ~30 s
 * without a touch). Re-acquired when the page becomes visible again. */
var lock = null, wanted = false;
export function keepAwake(on) {
  wanted = on;
  if (!on) {
    if (lock) lock.release().catch(function() {});
    lock = null;
    return;
  }
  if (lock || !navigator.wakeLock) return;
  navigator.wakeLock.request("screen").then(function(l) {
    if (wanted) { lock = l; l.addEventListener("release", function() { if (lock === l) lock = null; }); }
    else l.release();
  }, function() {});
}
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "visible" && wanted) keepAwake(true);
});
