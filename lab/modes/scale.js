/* Scale controls: how camera pixels become meters, for any tracking mode.
 * Ball size (default) measures the moving ball's width each frame and uses
 * its known diameter. Tap mode sets px/m from two taps a known length apart.
 * Frame mode assumes the full frame height is a typed-in length (that
 * field is also the fallback when the chosen method has no data).
 *
 * makeScale("track") wires the elements track-scale-mode, track-ball-kind,
 * track-ball-d, track-scale, track-cal-len, track-height, btn-track-cal,
 * track-video, track-overlay and #mode-track [data-scale]; settings are
 * saved under the element ids. */
import * as AR from "../../core/index.js";
import { $, numberIn, remember, restoreSettings } from "../ui.js";

var R = AR.render;
function makeScale(p) {
var id = function(name) { return p + "-" + name; };
var SETTINGS = ["scale-mode", "ball-kind", "ball-d", "scale", "cal-len"].map(function(n) {
  return [id(n), id(n)];
});

return {
  widths: [],        // ball widths (camera px) from the current recording
  taps: null,        // camera-px points while calibrating, else null
  onStatus: null,    // fn(msg, cls) — the mode's status line

  mode: function() { return $(id("scale-mode")).value; },

  /* New recording: forget old widths. */
  reset: function() { this.widths = []; },

  /* Measure the ball on a frame where it's moving freely. vel (frame
   * fractions/s, optional): the ball's motion, to pick the unblurred side. */
  observe: function(tracker, video, blob, colorOpts, vel) {
    if (this.mode() !== "ball" || !blob) return;
    var size = tracker.measureSize(video, blob, colorOpts);
    if (!size) return;
    var sideways = vel && Math.abs(vel.x * video.videoWidth) > Math.abs(vel.y * video.videoHeight);
    this.widths.push(sideways ? size.h : size.w);
  },

  /* The scale for a fit, falling back to the frame height with a reason. */
  resolve: function() {
    return AR.resolveScale({
      mode: this.mode(),
      videoHeightPx: $(id("video")).videoHeight,
      dropHeightM: numberIn(id("height"), 0.05, 50, 1),
      ballWidthsPx: this.widths,
      ballDiameterM: numberIn(id("ball-d"), 0.5, 100, 6.7) / 100,
      pxPerM: parseFloat($(id("scale")).value)
    });
  },

  /* ---------- tap calibration ---------- */
  calibrating: function() { return this.taps !== null; },
  startTaps: function() {
    var v = $(id("video"));
    if (!v.srcObject || !v.videoWidth) { this.onStatus("Open the camera first.", "err"); return; }
    this.taps = [];
    $(id("scale-mode")).value = "pixels";
    this.showFields();
    this.onStatus("Tap one end of something " + this.tapLength() + " m long in the video…", "");
  },
  tapLength: function() { return numberIn(id("cal-len"), 0.01, 50, 1); },
  /* Returns true when the click was used for calibration. */
  tap: function(e) {
    if (!this.calibrating()) return false;
    var v = $(id("video"));
    this.taps.push(AR.clientToCamera(v.getBoundingClientRect(), v, e.clientX, e.clientY));
    this.drawTaps();
    if (this.taps.length === 1) {
      this.onStatus("Now tap the other end.", "");
      return true;
    }
    try {
      var pxPerM = AR.scaleFromPoints(this.taps[0], this.taps[1], this.tapLength());
      $(id("scale")).value = String(Math.round(pxPerM));
      remember(id("scale"), $(id("scale")).value);
      remember(id("scale-mode"), "pixels");
      this.onStatus("Scale set: " + Math.round(pxPerM) + " camera px per meter.", "ok");
    } catch (err) {
      this.onStatus("Those taps are too close together — try again.", "err");
    }
    this.taps = null;
    var self = this;
    setTimeout(function() { if (!self.calibrating()) self.clearOverlay(); }, 1500);
    return true;
  },
  drawTaps: function() {
    var cv = $(id("overlay")), v = $(id("video"));
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    var pts = this.taps.map(function(p) {
      return { x: p.x / v.videoWidth * dims.w, y: p.y / v.videoHeight * dims.h };
    });
    ctx.strokeStyle = "#f5a524"; ctx.fillStyle = "#f5a524";
    ctx.lineWidth = 2 * dims.dpr;
    if (pts.length === 2) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
    }
    pts.forEach(function(p) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
    });
  },
  clearOverlay: function() {
    var cv = $(id("overlay"));
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* Show only the inputs the chosen method needs. */
  showFields: function() {
    var mode = this.mode();
    document.querySelectorAll("#mode-" + p + " [data-scale]").forEach(function(el) {
      el.hidden = el.getAttribute("data-scale") !== mode;
    });
  },

  init: function(onStatus) {
    var self = this;
    this.onStatus = onStatus;
    // Ball presets from the core table, plus "Custom".
    var kind = $(id("ball-kind"));
    Object.keys(AR.BALL_DIAMETERS).forEach(function(name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = name.charAt(0).toUpperCase() + name.slice(1) + " · " +
        (AR.BALL_DIAMETERS[name] * 100).toFixed(1) + " cm";
      kind.insertBefore(o, kind.lastElementChild);
    });
    kind.value = "tennis";
    restoreSettings(SETTINGS);
    kind.addEventListener("change", function() {
      var d = AR.BALL_DIAMETERS[kind.value];
      if (d) $(id("ball-d")).value = (d * 100).toFixed(1);
    });
    $(id("ball-d")).addEventListener("input", function() {
      var cm = parseFloat($(id("ball-d")).value);
      var match = Object.keys(AR.BALL_DIAMETERS).filter(function(n) {
        return Math.abs(AR.BALL_DIAMETERS[n] * 100 - cm) < 0.05;
      })[0];
      kind.value = match || "custom";
    });
    $(id("scale-mode")).addEventListener("change", function() { self.showFields(); });
    SETTINGS.forEach(function(pair) {
      $(pair[0]).addEventListener("change", function() { remember(pair[1], $(pair[0]).value); });
    });
    $("btn-" + p + "-cal").addEventListener("click", function() { self.startTaps(); });
    this.showFields();
  }
};
}

export { makeScale };
