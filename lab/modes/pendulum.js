/* Exp 03 — time a swinging pendulum and get g from T = 2π√(L/g).
 * Start (or Space) once the ball is swinging; each pass through the middle
 * is timed live, and recording stops by itself after the chosen number of
 * swings. L = string length + ball radius. The ball's measured size gives
 * the pixel scale, used only to correct the period for the swing's size. */
import * as AR from "../../core/index.js";
import { $, setStatus, numberIn, onSpace, selectSwatch, remember, restoreSettings, camera, openCamera } from "../ui.js";
import { LabLog } from "../lablog.js";

var R = AR.render;
var SETTINGS = [["pend-length", "pend-length"], ["pend-ball-kind", "pend-ball-kind"],
                ["pend-ball-d", "pend-ball-d"], ["pend-swings", "pend-swings"]];
var LIVE_EVERY_S = 0.4;  // re-analyze this often while recording
var TRAIL_S = 1.5;       // overlay trail length
var MAX_S = 180;         // never record longer than this

var Pendulum = {
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  active: false,
  samples: [],
  widths: [],        // ball sizes (camera px) across its motion
  live: null,        // latest successful analysis while recording
  lastLive: 0,
  t0: 0,
  raf: 0, clock: null,

  colorOpts: function() { return { target: this.target, tol: parseFloat($("pend-tol").value) || 80 }; },
  status: function(msg, cls) { setStatus($("pend-status"), msg, cls); },
  button: function(html) { $("btn-pend-rec").innerHTML = html; },
  idleButton: function() { this.button('<i class="fa-solid fa-play"></i> Start'); },

  diameterM: function() { return numberIn("pend-ball-d", 0.5, 100, 6.7) / 100; },
  /* Pivot to the ball's center. */
  lengthM: function() { return numberIn("pend-length", 1, 5000, 80) / 100 + this.diameterM() / 2; },
  targetSwings: function() { return Math.round(numberIn("pend-swings", 2, 100, 10)); },

  /* Meters per frame height from the ball's size, or null if unmeasured. */
  frameHeightM: function() {
    var v = $("pend-video");
    var s = AR.scaleFromBallWidths(this.widths, this.diameterM());
    return s && v.videoHeight ? v.videoHeight / s.pxPerM : null;
  },
  analyze: function() {
    var v = $("pend-video");
    return AR.analyzePendulum(this.samples, {
      lengthM: this.lengthM(),
      aspect: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3,
      frameHeightM: this.frameHeightM()
    });
  },

  loop: function() {
    var self = this;
    if (!self.active) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return;
    var video = $("pend-video");
    var colorOpts = self.colorOpts();
    var c = self.tracker.locate(video, colorOpts);
    var t = frame.time / 1000;
    if (!self.t0) self.t0 = t;
    if (c) {
      var prev = self.samples[self.samples.length - 1];
      self.samples.push({ t: t, x: c.x, y: c.y });
      // Size the ball across its motion (it blurs along it).
      var size = self.tracker.measureSize(video, c, colorOpts);
      if (size && prev && t > prev.t) {
        var sideways = Math.abs((c.x - prev.x) * video.videoWidth) > Math.abs((c.y - prev.y) * video.videoHeight);
        self.widths.push(sideways ? size.h : size.w);
        if (self.widths.length > 400) self.widths.shift();
      }
    }
    if (t - self.lastLive > LIVE_EVERY_S) {
      self.lastLive = t;
      var res = self.analyze();
      if (res.ok) {
        self.live = res;
        self.showReadouts(res);
        if (res.periods >= self.targetSwings()) { self.stop(); return; }
      }
      $("ro-pd-n").textContent = self.live ? String(Math.floor(self.live.periods)) : "0";
    }
    if (t - self.t0 > MAX_S) { self.stop(); return; }
    self.drawOverlay(c, t);
  },
  drawOverlay: function(c, t) {
    var cv = $("pend-overlay");
    var dims = R.fitCanvas(cv);
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    var v = $("pend-video");
    var aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    if (this.live) {
      // Center line: through the rest point, across the swing direction.
      var ce = this.live.center;
      var dx = -Math.sin(ce.angle) / aspect, dy = Math.cos(ce.angle);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = Math.max(1, dims.dpr);
      ctx.setLineDash([6 * dims.dpr, 5 * dims.dpr]);
      ctx.beginPath();
      ctx.moveTo((ce.x - 0.35 * dx) * dims.w, (ce.y - 0.35 * dy) * dims.h);
      ctx.lineTo((ce.x + 0.35 * dx) * dims.w, (ce.y + 0.35 * dy) * dims.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Fading trail of the last moments.
    for (var i = this.samples.length - 1; i >= 0; i--) {
      var s = this.samples[i], age = t - s.t;
      if (age > TRAIL_S) break;
      ctx.fillStyle = "rgba(229,72,77," + (0.8 * (1 - age / TRAIL_S)).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(s.x * dims.w, s.y * dims.h, 2.5 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
    }
    if (c) R.drawTrackMarker(ctx, dims, c, "#e5484d");
  },
  showReadouts: function(res) {
    $("ro-pd-n").textContent = String(Math.floor(res.periods));
    $("ro-pd-t").textContent = res.T.toFixed(3) + " ± " + res.TStdErr.toFixed(3) + " s";
    $("ro-pd-g").textContent = res.g.toFixed(2) + " ± " + res.gStdErr.toFixed(2) + " m/s²";
    $("ro-pd-amp").textContent = res.amplitudeDeg != null ? res.amplitudeDeg.toFixed(1) + "°" : "—";
    $("ro-pd-q").textContent = res.Q ? String(Math.round(res.Q)) : "—";
  },
  showTheory: function() {
    var L = this.lengthM();
    $("ro-pd-theory").textContent = (2 * Math.PI * Math.sqrt(L / AR.REFERENCE_G)).toFixed(3) + " s";
  },
  clearReadouts: function() {
    ["ro-pd-t", "ro-pd-g", "ro-pd-amp", "ro-pd-q"].forEach(function(id) { $(id).textContent = "—"; });
    $("ro-pd-n").textContent = "0";
  },
  start: function() {
    var video = $("pend-video");
    if (camera.liveVideo() !== video) {
      this.status("Open the camera first.", "err");
      return;
    }
    this.samples = [];
    this.widths = [];
    this.live = null;
    this.lastLive = 0;
    this.t0 = 0;
    this.clearReadouts();
    this.active = true;
    this.tracker.reset();
    this.clock = new AR.FrameClock(video);
    this.clock.start();
    this.button('<i class="fa-solid fa-stop"></i> Stop & fit');
    this.status("Timing… stops by itself after " + this.targetSwings() + " swings.", "");
    this.loop();
  },
  cancel: function() {
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    this.idleButton();
  },
  stop: function() {
    this.cancel();
    this.fit();
  },
  toggle: function() { if (this.active) this.stop(); else this.start(); },
  fit: function() {
    var res = this.analyze();
    if (!res.ok) {
      this.status(res.error, "err");
      LabLog.push("pendulum", res.detail);
      return;
    }
    this.live = res;
    this.showReadouts(res);
    var L = this.lengthM(), err = AR.percentError(res.g);
    var T0 = res.T / res.factor;
    LabLog.pendulum = { g: res.g, gStdErr: res.gStdErr, T: res.T, TStdErr: res.TStdErr, L: L,
      periods: res.periods, amplitudeDeg: res.amplitudeDeg, factor: res.factor, Q: res.Q,
      fps: res.fps, rejected: res.rejected };
    this.status("g ≈ " + res.g.toFixed(3) + " ± " + res.gStdErr.toFixed(3) + " m/s² (" +
      (err >= 0 ? "+" : "") + err.toFixed(2) + "% vs 9.81) from T = " + res.T.toFixed(4) + " ± " +
      res.TStdErr.toFixed(4) + " s over " + res.periods + " swings at " + Math.round(res.fps) +
      " fps, L = " + (L * 100).toFixed(1) + " cm. " +
      (res.ampKnown
        ? "Swing " + res.amplitudeDeg.toFixed(1) + "° made the period " +
          ((res.factor - 1) * 100).toFixed(2) + "% longer than a tiny swing (T₀ = " + T0.toFixed(4) + " s); corrected."
        : "Ball size not measured, so no correction for the swing's size (small if under 15°).") +
      (res.rejected ? " " + res.rejected + " off-beat pass(es) ignored." : "") +
      " A 1 cm error in L shifts g by " + (100 / (L * 100)).toFixed(1) + "%.", "ok");
    var cv = $("pend-plot");
    var H = this.frameHeightM();
    R.drawPendulumPlot(cv.getContext("2d"), R.fitCanvas(cv), res,
      function(t) { return AR.pendulumModel(res, t); },
      H ? { k: H * 100, label: "cm" } : { k: 100, label: "% of frame" });
  },
  init: function() {
    var self = this;
    var pane = $("mode-pend");
    var kind = $("pend-ball-kind");
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
      if (d) $("pend-ball-d").value = (d * 100).toFixed(1);
      self.showTheory();
    });
    $("pend-ball-d").addEventListener("input", function() {
      var cm = parseFloat($("pend-ball-d").value);
      var match = Object.keys(AR.BALL_DIAMETERS).filter(function(n) {
        return Math.abs(AR.BALL_DIAMETERS[n] * 100 - cm) < 0.05;
      })[0];
      kind.value = match || "custom";
      self.showTheory();
    });
    $("pend-length").addEventListener("input", function() { self.showTheory(); });
    SETTINGS.forEach(function(pair) {
      $(pair[0]).addEventListener("change", function() { remember(pair[1], $(pair[0]).value); });
    });
    self.showTheory();
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        self.target = AR.colorPreset(sw.getAttribute("data-color"));
        self.status("Tracking " + sw.getAttribute("data-color") + " — or click the video to sample.", "");
      });
    });
    $("btn-pend-cam").addEventListener("click", function() {
      openCamera($("pend-video"), $("pend-status")).then(function() {
        R.fitCanvas($("pend-overlay"));
      }, function() {});
    });
    camera.onChange(function(live) {
      if (self.active && live !== $("pend-video")) {
        self.cancel();
        self.status("Camera moved to another experiment — timing stopped.", "err");
      }
    });
    $("pend-video").addEventListener("click", function(e) {
      var video = $("pend-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { self.status("Could not sample that pixel.", "err"); return; }
      self.target = c;
      selectSwatch(pane, null);
      self.status("Sampled color rgb(" + c.r + "," + c.g + "," + c.b + ") — set it swinging, then press Start.", "ok");
    });
    $("btn-pend-rec").addEventListener("click", function() { self.toggle(); });
    $("btn-pend-clear").addEventListener("click", function() {
      self.cancel();
      self.samples = [];
      self.live = null;
      self.clearReadouts();
      var cv = $("pend-overlay");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      cv = $("pend-plot");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      self.status("Cleared.", "");
    });
    onSpace("mode-pend", function() { self.toggle(); });
  }
};

export { Pendulum };
