/* Mode 3 — auto-track a real falling ball and fit g. */
import * as AR from "../../core/index.js";

var K = AR, R = AR.render;
import { $, setStatus, numberIn, readGravity, onSpace, selectSwatch, remember, recall, restoreSettings, saveSettings, ballStyle, camera, openCamera } from "../ui.js";
import { LabLog } from "../lablog.js";

var Track = {
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  recording: false, samples: [], raf: 0, clock: null,
  loop: function() {
    var self = this;
    if (!self.recording) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return; // no new camera frame since last time
    var c = self.tracker.locate($("track-video"), {
      target: self.target, tol: parseFloat($("track-tol").value) || 80
    });
    var cv = $("track-overlay");
    var dims = R.fitCanvas(cv);
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (c) {
      self.samples.push({ t: frame.time / 1000, y: c.y });
      R.drawTrackMarker(ctx, dims, c);
    }
    $("track-count").textContent = String(self.samples.length);
  },
  start: function() {
    var video = $("track-video");
    if (camera.liveVideo() !== video) {
      setStatus($("track-status"), "Open the camera first.", "err");
      return;
    }
    this.samples = [];
    this.recording = true;
    this.tracker.reset();
    this.clock = new AR.FrameClock(video);
    this.clock.start();
    $("btn-track-rec").innerHTML = '<i class="fa-solid fa-stop"></i> Stop & fit';
    setStatus($("track-status"), "Recording — drop the ball through the frame.", "");
    this.loop();
  },
  cancel: function() {
    this.recording = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    $("btn-track-rec").innerHTML = '<i class="fa-solid fa-circle"></i> Record fall';
  },
  stop: function() {
    this.cancel();
    this.fit();
  },
  toggle: function() { if (this.recording) this.stop(); else this.start(); },
  fit: function() {
    var h = numberIn("track-height", 0.05, 50, 1);
    // Scale is in camera pixels; blank means the full frame spans h.
    var pxPerM = parseFloat($("track-scale").value);
    var frameH = $("track-video").videoHeight;
    var frameHeightM = pxPerM > 0 && frameH > 0 ? frameH / pxPerM : h;
    var res = AR.analyzeFall(this.samples, { frameHeightM: frameHeightM });
    if (!res.ok) {
      setStatus($("track-status"), res.error, "err");
      LabLog.push("auto-track", res.detail);
      return;
    }
    var fit = res.fit, err = K.percentError(fit.g);
    LabLog.lastFit = { g: fit.g, gStdErr: fit.gStdErr, rmse: fit.rmse, n: res.points.length,
      span: res.span, h: h, fps: res.fps, rejected: res.rejected };
    setStatus($("track-status"), "g ≈ " + fit.g.toFixed(2) + " ± " + fit.gStdErr.toFixed(2) +
      " m/s² from " + res.points.length + " points (" + res.span.toFixed(2) + " s at " +
      Math.round(res.fps) + " fps" + (res.rejected ? ", " + res.rejected + " outlier(s) ignored" : "") +
      ", v0 ≈ " + fit.v0.toFixed(2) + " m/s, RMSE " + (fit.rmse * 100).toFixed(1) + " cm, " +
      (err >= 0 ? "+" : "") + err.toFixed(1) + "% vs 9.81).", "ok");
    var cv = $("track-plot");
    R.drawFitPlot(cv.getContext("2d"), R.fitCanvas(cv), res.points, fit);
  },
  init: function() {
    var self = this;
    var pane = $("mode-track");
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        self.target = AR.colorPreset(sw.getAttribute("data-color"));
        setStatus($("track-status"), "Tracking " + sw.getAttribute("data-color") + " — or click the video to sample.", "");
      });
    });
    restoreSettings([["track-height", "track-h"]]);
    $("track-height").addEventListener("input", function() { remember("track-h", $("track-height").value); });
    $("btn-track-cam").addEventListener("click", function() {
      openCamera($("track-video"), $("track-status")).then(function() {
        R.fitCanvas($("track-overlay"));
      }, function() {});
    });
    camera.onChange(function(live) {
      if (self.recording && live !== $("track-video")) {
        self.cancel();
        setStatus($("track-status"), "Camera moved to another mode — recording stopped.", "err");
      }
    });
    $("track-video").addEventListener("click", function(e) {
      var video = $("track-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { setStatus($("track-status"), "Could not sample that pixel.", "err"); return; }
      self.target = c;
      selectSwatch(pane, null);
      setStatus($("track-status"),
        "Sampled color rgb(" + c.r + "," + c.g + "," + c.b + ") — press Record fall.", "ok");
    });
    $("btn-track-rec").addEventListener("click", function() { self.toggle(); });
    $("btn-track-clear").addEventListener("click", function() {
      self.cancel();
      self.samples = [];
      $("track-count").textContent = "0";
      var cv = $("track-plot");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      setStatus($("track-status"), "Cleared.", "");
    });
    onSpace("mode-track", function() { self.toggle(); });
  }
};

export { Track };
