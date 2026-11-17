/* Where the child is, for Earth's gravity there. g on Earth depends on
 * latitude (9.780 at the equator to 9.832 at the poles: the Earth spins
 * and bulges) and a little on height. The place comes from the device's
 * location or is typed in; it's kept on this device only, never sent
 * anywhere (no address lookup: latitude and height are all we need).
 * Until a place is set, Earth's g is the usual rounded 9.81. */
import * as AR from "../core/index.js";
import { store } from "./util.js";

var listeners = [];

export var Place = {
  /* {lat, alt, source: "gps"|"typed"} or null */
  get: function() {
    var p = store.get("place", null);
    return p && p.lat >= -90 && p.lat <= 90 ? p : null;
  },
  set: function(p) {
    var old = this.get();
    if (old && p && old.lat === p.lat && (old.alt || 0) === (p.alt || 0)) { store.set("place", p); return; } // no change
    store.set("place", p);
    listeners.forEach(function(fn) { fn(p); });
  },
  clear: function() { this.set(null); },
  onChange: function(fn) { listeners.push(fn); },

  /* Earth's g where the child is (m/s²). */
  g: function() {
    var p = this.get();
    return p ? AR.localGravity(p.lat, p.alt || 0) : AR.REFERENCE_G;
  },
  /* g as text: 3 decimals for a real place (the differences are small). */
  gText: function() { return this.get() ? this.g().toFixed(3) : "9.81"; },
  /* The comparison sentence for results: the real g where the child is. */
  compareText: function() {
    return this.get() ? " The real value where you are is " + this.gText() + " m/s²."
      : " Earth's g is about 9.81 m/s².";
  },
  /* e.g. "latitude 37.4° N, 30 m up" */
  describe: function() {
    var p = this.get();
    if (!p) return "";
    var where = Math.abs(p.lat) < 0.05 ? "the equator"
      : "latitude " + Math.abs(p.lat).toFixed(1) + "° " + (p.lat >= 0 ? "N" : "S");
    return where +
      (p.alt ? ", " + Math.round(p.alt) + " m up" : "");
  },

  /* If this site may already use the location (allowed before), refresh it
   * quietly, so the phone or laptop keeps the place current with no prompt.
   * Never asks: only a button press does. */
  refreshIfAllowed: function() {
    var self = this;
    if (!navigator.permissions || !navigator.geolocation) return;
    navigator.permissions.query({ name: "geolocation" }).then(function(st) {
      if (st.state === "granted") self.locate().catch(function() {});
    }, function() {});
  },

  /* Ask the device where it is. Resolves with the saved place; rejects with
   * a child-friendly message. Height is used when the device knows it. */
  locate: function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!navigator.geolocation) { reject(new Error("This device can't tell its location. Type your latitude instead.")); return; }
      navigator.geolocation.getCurrentPosition(function(pos) {
        var c = pos.coords;
        var prev = self.get();
        var p = { lat: Math.round(c.latitude * 100) / 100, // ~1 km: plenty for g, kinder to privacy
          alt: c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude) : (prev ? prev.alt || 0 : 0),
          source: "gps" };
        self.set(p);
        resolve(p);
      }, function(err) {
        reject(new Error(err && err.code === 1
          ? "Location is blocked. Allow it in the browser settings, or type your latitude."
          : "Couldn't find the location. Type your latitude instead."));
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 });
    });
  }
};
