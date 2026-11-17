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
