/* Exp 02 — auto-track a thrown ball: g, launch speed and angle.
 * Auto mode (default): Arm, hold the ball still, throw — recording starts
 * and stops by itself (core ThrowTrigger). Manual mode: Record / Stop.
 * Same structure as track.js; scale and replay come from scale.js and
 * review.js with the "proj" element prefix. */
import * as AR from "../../core/index.js";
import { $, setStatus, onSpace, selectSwatch, camera, openCamera } from "../ui.js";
import { LabLog } from "../lablog.js";
import { makeReview } from "./review.js";
import { makeScale } from "./scale.js";

var R = AR.render;
var Review = makeReview("proj", {
  path: function(res) { return AR.projectilePath(res); },
  draw: AR.drawProjectileReplay,
  g: function(res) { return res.g; }
});
var Scale = makeScale("proj");

var REC_ICON = '<i class="fa-solid fa-circle"></i> ';
var STOP_ICON = '<i class="fa-solid fa-stop"></i> ';
var STATE_COLOR = { waiting: "#f5a524", ready: "#4ecd64", recording: "#e5484d", manual: "#4ecd64" };
var STOP_NOTE = { "left-frame": "ball left the frame", bounced: "bounce", caught: "caught",
                  lost: "lost sight of the ball", timeout: "time limit" };

function signed(v, d) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d); }

var Projectile = {
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  active: false,
  trigger: null,      // ThrowTrigger in auto mode, null in manual mode
  samples: [],        // manual mode recording
  prev: null,         // last detection {t, x, y}, for the ball's velocity
  raf: 0, clock: null,

  auto: function() { return $("proj-auto").checked; },
  colorOpts: function() { return { target: this.target, tol: parseFloat($("proj-tol").value) || 80 }; },
  status: function(msg, cls) { setStatus($("proj-status"), msg, cls); },
  button: function(html) { $("btn-proj-rec").innerHTML = html; },
  idleButton: function() { this.button(REC_ICON + (this.auto() ? "Arm" : "Record throw")); },

  loop: function() {
    var self = this;
    if (!self.active) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return;
    var video = $("proj-video");
    var colorOpts = self.colorOpts();
    var c = self.tracker.locate(video, colorOpts);
    var t = frame.time / 1000;
    var recording = !self.trigger || self.trigger.state === "recording";
    Review.capture(video, t, recording);
    var vel = null;
    if (c && self.prev && t > self.prev.t) {
      vel = { x: (c.x - self.prev.x) / (t - self.prev.t), y: (c.y - self.prev.y) / (t - self.prev.t) };
    }
    if (c) self.prev = { t: t, x: c.x, y: c.y };
    var state = "manual";
    if (self.trigger) {
      var ev = self.trigger.push(t, c);
      state = self.trigger.state;
      if (state === "recording" && !(ev && ev.type === "started")) Scale.observe(self.tracker, video, c, colorOpts, vel);
      if (ev) self.onTrigger(ev);
      if (!self.active) return;
    } else if (c) {
      self.samples.push({ t: t, x: c.x, y: c.y });
      Scale.observe(self.tracker, video, c, colorOpts, vel);
    }
    var cv = $("proj-overlay");
    var dims = R.fitCanvas(cv);
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    // Live trail of this recording.
    if (recording) {
      ctx.fillStyle = "rgba(229,72,77,0.75)";
      this.recorded().forEach(function(s) {
        ctx.beginPath(); ctx.arc(s.x * dims.w, s.y * dims.h, 2.5 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
      });
    }
    if (c) R.drawTrackMarker(ctx, dims, c, STATE_COLOR[state]);
    $("proj-count").textContent = String(this.recorded().length);
  },
  onTrigger: function(ev) {
    if (ev.type === "ready") {
      this.status("Ready — throw the ball across the frame.", "ok");
    } else if (ev.type === "started") {
      this.button(STOP_ICON + "Stop & fit");
      this.status("Recording…", "");
    } else if (ev.type === "stopped") {
      this.stopNote = STOP_NOTE[ev.reason] || ev.reason;
      this.stop();
    }
  },
  recorded: function() {
    return this.trigger ? this.trigger.samples() : this.samples;
  },
  start: function() {
    var video = $("proj-video");
    if (camera.liveVideo() !== video) {
      this.status("Open the camera first.", "err");
      return;
    }
    Review.reset();
    Scale.reset();
    this.samples = [];
    this.prev = null;
    this.stopNote = null;
    this.trigger = this.auto() ? new AR.ThrowTrigger() : null;
    this.active = true;
    this.tracker.reset();
    this.clock = new AR.FrameClock(video);
    this.clock.start();
    if (this.trigger) {
      this.button(STOP_ICON + "Disarm");
      this.status("Armed — hold the ball still in view, then throw.", "");
    } else {
      this.button(STOP_ICON + "Stop & fit");
      this.status("Recording — throw the ball across the frame.", "");
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
  clearReadouts: function() {
    ["ro-p-g", "ro-p-v", "ro-p-ang", "ro-p-apex", "ro-p-range", "ro-p-ax"].forEach(function(id) {
      $(id).textContent = "—";
    });
  },
  fit: function() {
    var video = $("proj-video");
    var scale = Scale.resolve();
    var aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    var pts = this.recorded().map(function(s) { return { t: s.t, x: s.x, y: s.y }; });
    var res = AR.analyzeProjectile(pts, { frameHeightM: scale.frameHeightM, aspect: aspect });
    if (!res.ok) {
      this.clearReadouts();
      this.status(res.error, "err");
      LabLog.push("projectile", res.detail);
      return;
    }
    var err = AR.percentError(res.g);
    var axOk = Math.abs(res.ax) <= 2 * res.axStdErr + 0.05;
    $("ro-p-g").textContent = res.g.toFixed(2) + " ± " + res.gStdErr.toFixed(2) + " m/s²";
    $("ro-p-v").textContent = res.speed.toFixed(2) + " m/s";
    $("ro-p-ang").textContent = res.angleDeg.toFixed(1) + "°";
    $("ro-p-apex").textContent = res.vy > 0 ? (res.apexM * 100).toFixed(0) + " cm" : "thrown down";
    $("ro-p-range").textContent = res.rangeM != null ? res.rangeM.toFixed(2) + " m" : "—";
    $("ro-p-ax").textContent = signed(res.ax, 2) + " ± " + res.axStdErr.toFixed(2) + " m/s²";
    LabLog.projectile = { g: res.g, gStdErr: res.gStdErr, speed: res.speed, angleDeg: res.angleDeg,
      vx: res.vx, ax: res.ax, axStdErr: res.axStdErr, rmse: res.rmse, n: res.points.length,
      span: res.span, fps: res.fps, rejected: res.rejected, trimmed: res.trimmed,
      scale: scale.label + (scale.note ? " (" + scale.note + ")" : "") };
    this.status("g ≈ " + res.g.toFixed(2) + " ± " + res.gStdErr.toFixed(2) + " m/s² (" +
      signed(err, 1) + "% vs 9.81) from " + res.points.length + " points over " +
      res.span.toFixed(2) + " s at " + Math.round(res.fps) + " fps. Thrown " +
      (res.vx >= 0 ? "right" : "left") + " at " + res.speed.toFixed(2) + " m/s, " +
      res.angleDeg.toFixed(0) + "° (vx " + Math.abs(res.vx).toFixed(2) + ", vy " + res.vy.toFixed(2) +
      " m/s). Sideways speed " + (axOk ? "stayed constant" : "changed by " + signed(res.ax, 2) + " m/s²") +
      "; " + res.trimmed + " hand/landing frame(s) left out" +
      (res.rejected ? ", " + res.rejected + " outlier(s) ignored" : "") +
      (this.stopNote ? "; stopped: " + this.stopNote : "") + "; " + scale.label + "." +
      (scale.note ? " Note: " + scale.note + " — used the frame height instead." : ""),
      scale.note ? "" : "ok");
    var cv = $("proj-plot");
    R.drawProjectilePlot(cv.getContext("2d"), R.fitCanvas(cv), res);
    Review.show(res);
  },
  init: function() {
    var self = this;
    var pane = $("mode-proj");
    Review.init();
    Scale.init(function(msg, cls) { self.status(msg, cls); });
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        self.target = AR.colorPreset(sw.getAttribute("data-color"));
        self.status("Tracking " + sw.getAttribute("data-color") + " — or click the video to sample.", "");
      });
    });
    $("proj-auto").addEventListener("change", function() {
      if (self.active) self.cancel();
      self.idleButton();
    });
    self.idleButton();
    $("btn-proj-cam").addEventListener("click", function() {
      openCamera($("proj-video"), $("proj-status")).then(function() {
        R.fitCanvas($("proj-overlay"));
      }, function() {});
    });
    camera.onChange(function(live) {
      if (live !== $("proj-video")) Review.reset();
      if (self.active && live !== $("proj-video")) {
        self.cancel();
        self.status("Camera moved to another experiment — recording stopped.", "err");
      }
    });
    $("proj-video").addEventListener("click", function(e) {
      if (Scale.tap(e)) return;
      var video = $("proj-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { self.status("Could not sample that pixel.", "err"); return; }
      self.target = c;
      selectSwatch(pane, null);
      self.status("Sampled color rgb(" + c.r + "," + c.g + "," + c.b + ") — press " +
        (self.auto() ? "Arm" : "Record throw") + ".", "ok");
    });
    $("btn-proj-rec").addEventListener("click", function() { self.toggle(); });
    $("btn-proj-clear").addEventListener("click", function() {
      self.cancel();
      Review.reset();
      self.samples = [];
      self.trigger = null;
      $("proj-count").textContent = "0";
      self.clearReadouts();
      var cv = $("proj-plot");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      self.status("Cleared.", "");
    });
    onSpace("mode-proj", function() { self.toggle(); });
  }
};

export { Projectile };
