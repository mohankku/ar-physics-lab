/* Mode 3 — auto-track a real falling ball and fit g.
 * Auto mode (default): Arm, hold the ball still, let go — recording starts
 * and stops by itself (core FallTrigger). Manual mode: Record / Stop. */
import * as AR from "../../core/index.js";
import { $, setStatus, numberIn, onSpace, selectSwatch, remember, restoreSettings, camera, openCamera } from "../ui.js";
import { LabLog } from "../lablog.js";
import { TrackReview } from "./track-review.js";

var R = AR.render;

var REC_ICON = '<i class="fa-solid fa-circle"></i> ';
var STOP_ICON = '<i class="fa-solid fa-stop"></i> ';
// Marker ring color per trigger state.
var STATE_COLOR = { waiting: "#f5a524", ready: "#4ecd64", recording: "#e5484d", manual: "#4ecd64" };

var Track = {
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  active: false,      // loop running (armed or recording)
  trigger: null,      // FallTrigger in auto mode, null in manual mode
  samples: [],        // manual mode recording
  raf: 0, clock: null,

  auto: function() { return $("track-auto").checked; },
  status: function(msg, cls) { setStatus($("track-status"), msg, cls); },
  button: function(html) { $("btn-track-rec").innerHTML = html; },
  idleButton: function() { this.button(REC_ICON + (this.auto() ? "Arm" : "Record fall")); },

  loop: function() {
    var self = this;
    if (!self.active) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return; // no new camera frame since last time
    var c = self.tracker.locate($("track-video"), {
      target: self.target, tol: parseFloat($("track-tol").value) || 80
    });
    var t = frame.time / 1000;
    TrackReview.capture($("track-video"), t, !self.trigger || self.trigger.state === "recording");
    var state = "manual";
    if (self.trigger) {
      var ev = self.trigger.push(t, c);
      state = self.trigger.state;
      if (ev) self.onTrigger(ev);
      if (!self.active) return; // stopped this frame; the fit drew the overlay
    } else if (c) {
      self.samples.push({ t: t, y: c.y, x: c.x });
    }
    var cv = $("track-overlay");
    var dims = R.fitCanvas(cv);
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (c) R.drawTrackMarker(ctx, dims, c, STATE_COLOR[state]);
    $("track-count").textContent = String(this.recorded().length);
  },
  onTrigger: function(ev) {
    if (ev.type === "ready") {
      this.status("Ready — let go of the ball.", "ok");
    } else if (ev.type === "started") {
      this.button(STOP_ICON + "Stop & fit");
      this.status("Recording…", "");
    } else if (ev.type === "stopped") {
      this.stop();
    }
  },
  recorded: function() {
    return this.trigger ? this.trigger.samples() : this.samples;
  },
  start: function() {
    var video = $("track-video");
    if (camera.liveVideo() !== video) {
      this.status("Open the camera first.", "err");
      return;
    }
    TrackReview.reset();
    this.samples = [];
    this.trigger = this.auto() ? new AR.FallTrigger() : null;
    this.active = true;
    this.tracker.reset();
    this.clock = new AR.FrameClock(video);
    this.clock.start();
    if (this.trigger) {
      this.button(STOP_ICON + "Disarm");
      this.status("Armed — hold the ball still in view, then let go.", "");
    } else {
      this.button(STOP_ICON + "Stop & fit");
      this.status("Recording — drop the ball through the frame.", "");
    }
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
    var armedOnly = this.trigger && this.trigger.state !== "recording" && this.trigger.state !== "done";
    this.cancel();
    if (armedOnly) { this.status("Disarmed.", ""); return; }
    this.fit();
  },
  toggle: function() { if (this.active) this.stop(); else this.start(); },
  fit: function() {
    var h = numberIn("track-height", 0.05, 50, 1);
    // Scale is in camera pixels; blank means the full frame spans h.
    var pxPerM = parseFloat($("track-scale").value);
    var frameH = $("track-video").videoHeight;
    var frameHeightM = pxPerM > 0 && frameH > 0 ? frameH / pxPerM : h;
    var pts = this.recorded().map(function(s) { return { t: s.t, y: s.y, x: s.x }; });
    var res = AR.analyzeFall(pts, { frameHeightM: frameHeightM });
    if (!res.ok) {
      this.status(res.error, "err");
      LabLog.push("auto-track", res.detail);
      return;
    }
    var fit = res.fit, err = AR.percentError(fit.g);
    LabLog.lastFit = { g: fit.g, gStdErr: fit.gStdErr, rmse: fit.rmse, n: res.points.length,
      span: res.span, h: h, fps: res.fps, rejected: res.rejected };
    this.status("g ≈ " + fit.g.toFixed(2) + " ± " + fit.gStdErr.toFixed(2) +
      " m/s² from " + res.points.length + " points (" + res.span.toFixed(2) + " s at " +
      Math.round(res.fps) + " fps" + (res.rejected ? ", " + res.rejected + " outlier(s) ignored" : "") +
      ", v0 ≈ " + fit.v0.toFixed(2) + " m/s, RMSE " + (fit.rmse * 100).toFixed(1) + " cm, " +
      (err >= 0 ? "+" : "") + err.toFixed(1) + "% vs 9.81).", "ok");
    var cv = $("track-plot");
    R.drawFitPlot(cv.getContext("2d"), R.fitCanvas(cv), res.points, fit);
    TrackReview.show(res);
  },
  init: function() {
    var self = this;
    var pane = $("mode-track");
    TrackReview.init();
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        self.target = AR.colorPreset(sw.getAttribute("data-color"));
        self.status("Tracking " + sw.getAttribute("data-color") + " — or click the video to sample.", "");
      });
    });
    restoreSettings([["track-height", "track-h"]]);
    $("track-height").addEventListener("input", function() { remember("track-h", $("track-height").value); });
    $("track-auto").addEventListener("change", function() {
      if (self.active) self.cancel();
      self.idleButton();
    });
    self.idleButton();
    $("btn-track-cam").addEventListener("click", function() {
      openCamera($("track-video"), $("track-status")).then(function() {
        R.fitCanvas($("track-overlay"));
      }, function() {});
    });
    camera.onChange(function(live) {
      if (live !== $("track-video")) TrackReview.reset();
      if (self.active && live !== $("track-video")) {
        self.cancel();
        self.status("Camera moved to another mode — recording stopped.", "err");
      }
    });
    $("track-video").addEventListener("click", function(e) {
      var video = $("track-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { self.status("Could not sample that pixel.", "err"); return; }
      self.target = c;
      selectSwatch(pane, null);
      self.status("Sampled color rgb(" + c.r + "," + c.g + "," + c.b + ") — press " +
        (self.auto() ? "Arm" : "Record fall") + ".", "ok");
    });
    $("btn-track-rec").addEventListener("click", function() { self.toggle(); });
    $("btn-track-clear").addEventListener("click", function() {
      self.cancel();
      TrackReview.reset();
      self.samples = [];
      self.trigger = null;
      $("track-count").textContent = "0";
      var cv = $("track-plot");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      self.status("Cleared.", "");
    });
    onSpace("mode-track", function() { self.toggle(); });
  }
};

export { Track };
