/* Experiment 2 in the app: throw a real ball across the camera and get g,
 * the launch speed and angle from its arc. Tap the ball once so the
 * tracker learns its color; press Ready, hold it still, throw. Recording
 * starts and stops by itself (core ThrowTrigger), the arc is fitted (core
 * analyzeProjectile), and the throw replays in slow motion over the video.
 * The video sits in a frame of its own shape (no cropping), so tracker
 * coordinates are canvas coordinates. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { store, $, keepAwake } from "./util.js";
import { startCamera, stopCamera, cameraError, fitFrame } from "./camera.js";
import { makePanels } from "./panels.js";
import { makeReview } from "./review.js";
import { inkOf } from "../lab/catchview.js";
import { Place } from "./place.js";

var R = AR.render;
var MAX_THROWS = 30;
var STATE_COLOR = { waiting: "#f5a524", ready: "#4ecd64", recording: "#e5484d" };
var STOP_NOTE = { "left-frame": "it left the picture", bounced: "it bounced", caught: "it was caught",
  lost: "I lost sight of it", timeout: "time ran out" };

export var Throw = {
  tracker: new AR.ColorTracker(),
  settings: null,
  live: false, raf: 0, clock: null,
  trigger: null,      // ThrowTrigger while armed or recording
  prev: null,         // last detection, for the ball's direction of motion
  widths: [],         // ball sizes (camera px) during the flight, for the scale
  seen: null,         // last detection
  throws: [],
  last: null,         // last successful analysis
  review: null, panels: null,

  loadSettings: function() {
    var s = store.get("throw", {});
    this.settings = {
      color: s.color && s.color.r != null ? s.color : null,  // {r, g, b, name?}
      ball: AR.BALL_DIAMETERS[s.ball] ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      ghost: s.ghost !== false,
      back: s.back !== false
    };
  },
  saveSettings: function() { store.set("throw", this.settings); },
  target: function() { return this.settings.color || AR.colorPreset("red"); },
  colorOpts: function() { return { target: this.target(), tol: 80 }; },

  status: function(msg, cls) {
    var el = $("t-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("t-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2400);
  },
  nextStep: function() {
    if (!this.settings.color) this.status("Hold the ball up and tap it in the picture, so I know its color.", "");
    else this.status("Press Ready, hold the ball still, then throw it across.", "");
  },

  /* ---------- camera ---------- */
  openCamera: function() {
    var self = this;
    Sounds.unlock();
    $("t-cam").disabled = true;
    $("t-start-note").textContent = "Starting the camera…";
    startCamera($("t-video"), self.settings.back).then(function() {
      $("t-start").hidden = true;
      self.layout();
      self.run();
      self.nextStep();
    }, function(err) {
      if (err && err.name === "AbortError") return;
      $("t-start-note").textContent = cameraError(err);
      self.status(cameraError(err), "err");
    }).then(function() { $("t-cam").disabled = false; });
  },
  layout: function() { fitFrame($("t-wrap"), $("t-frame"), $("t-video")); },
  run: function() {
    var self = this;
    self.stopLoop();
    self.live = true;
    self.tracker.reset();
    self.clock = new AR.FrameClock($("t-video"));
    self.clock.start();
    keepAwake(true);
    self.raf = requestAnimationFrame(function() { self.loop(); });
  },
  stopLoop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    this.clock = null;
    keepAwake(false);
  },
  leave: function() {
    this.disarm();
    this.stopLoop();
    if (this.review) this.review.reset();
    stopCamera();
    $("t-start").hidden = false;
    $("t-start-note").textContent = "Works best with a brightly colored ball and a plain wall behind.";
    this.status("Open the camera to start.", "");
    if (this.panels) this.panels.closeSheets();
    var cv = $("t-canvas");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* ---------- the loop ---------- */
  loop: function() {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return;
    var video = $("t-video");
    var opts = self.colorOpts();
    var c = self.settings.color ? self.tracker.locate(video, opts) : null;
    var t = frame.time / 1000;
    self.seen = c;
    var trig = self.trigger;
    if (trig) {
      self.review.capture(video, t, trig.state === "recording");
      var vel = null;
      if (c && self.prev && t > self.prev.t) {
        vel = { x: (c.x - self.prev.x) / (t - self.prev.t), y: (c.y - self.prev.y) / (t - self.prev.t) };
      }
      var ev = trig.push(t, c);
      if (trig.state === "recording" && c && !(ev && ev.type === "started")) self.measure(video, c, opts, vel);
      if (ev) self.onTrigger(ev);
    }
    if (c) self.prev = { t: t, x: c.x, y: c.y };
    $("t-seen").textContent = !self.settings.color ? "tap it" : c ? "seen ✓" : "not seen";
    if (!self.trigger && self.review.showing) return; // the replay owns the canvas
    self.drawLive(c);
  },
  /* Ball size across its motion (it blurs along it), for the scale. */
  measure: function(video, c, opts, vel) {
    var size = this.tracker.measureSize(video, c, opts);
    if (!size) return;
    var sideways = vel && Math.abs(vel.x * video.videoWidth) > Math.abs(vel.y * video.videoHeight);
    this.widths.push(sideways ? size.h : size.w);
  },
  drawLive: function(c) {
    var cv = $("t-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (this.trigger) {
      ctx.fillStyle = "rgba(229,72,77,0.8)";
      this.trigger.samples().forEach(function(s) {
        ctx.beginPath(); ctx.arc(s.x * dims.w, s.y * dims.h, 3 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
      });
    }
    if (c) R.drawTrackMarker(ctx, dims, c, this.trigger ? STATE_COLOR[this.trigger.state] || "#4ecd64" : "#4ecd64");
  },

  /* ---------- a throw ---------- */
  toggle: function() {
    Sounds.unlock();
    if (this.trigger) { this.disarm(); this.nextStep(); return; }
    if (!this.live) { this.status("Open the camera first.", "err"); return; }
    if (!this.settings.color) { this.status("First tap the ball in the picture, so I know its color.", "err"); return; }
    this.review.reset();
    this.widths = [];
    this.prev = null;
    this.trigger = new AR.ThrowTrigger();
    $("t-go").textContent = "Cancel";
    $("t-go").classList.remove("accent");
    this.status("Hold the ball still in the picture…", "");
  },
  disarm: function() {
    this.trigger = null;
    $("t-go").textContent = "Ready";
    $("t-go").classList.add("accent");
  },
  onTrigger: function(ev) {
    if (ev.type === "ready") {
      Sounds.grab();
      this.status("Ready! Throw it across the picture.", "ok");
    } else if (ev.type === "started") {
      Sounds.release();
      this.status("Flying…", "");
    } else if (ev.type === "stopped") {
      var pts = this.trigger.samples().map(function(s) { return { t: s.t, x: s.x, y: s.y }; });
      this.disarm();
      this.fit(pts, STOP_NOTE[ev.reason] || ev.reason);
    }
  },
  fit: function(pts, why) {
    var video = $("t-video");
    var scale = AR.resolveScale({
      mode: "ball", videoHeightPx: video.videoHeight, dropHeightM: this.settings.view,
      ballWidthsPx: this.widths, ballDiameterM: AR.BALL_DIAMETERS[this.settings.ball]
    });
    var aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    var res = AR.analyzeProjectile(pts, { frameHeightM: scale.frameHeightM, aspect: aspect });
    if (!res.ok) {
      Sounds.land();
      this.toast("Let's try that again", "warn");
      this.status("That throw didn't work: " + res.error + " Press Ready to try again.", "err");
      return;
    }
    Sounds.catchAir();
    this.last = res;
    this.throws.push({ g: res.g, gErr: res.gStdErr, speed: res.speed, angle: res.angleDeg, vx: res.vx,
      ax: res.ax, axErr: res.axStdErr, scale: scale.source });
    if (this.throws.length > MAX_THROWS) this.throws.shift();
    this.toast("g ≈ " + res.g.toFixed(1) + " m/s²");
    var steady = Math.abs(res.ax) <= 2 * res.axStdErr + 0.05;
    this.status("Thrown at " + res.speed.toFixed(1) + " m/s, " + Math.round(res.angleDeg) + "° " +
      (res.vy >= 0 ? "up" : "down") + ". " +
      (steady ? "Its sideways speed stayed the same, " + Math.abs(res.vx).toFixed(1) + " m/s, while gravity pulled it down."
              : "Its sideways speed changed a little (air, or the throw wasn't straight across).") +
      (scale.source === "ball" ? "" : " (Couldn't measure the ball's size, so I used the screen height setting.)"),
      "ok");
    this.review.show(res);
    this.renderResults();
  },

  /* ---------- results ---------- */
  renderResults: function() {
    var rows = $("t-rows");
    rows.textContent = "";
    for (var i = this.throws.length - 1; i >= 0; i--) {
      var th = this.throws[i], r = document.createElement("tr");
      [String(i + 1), th.speed.toFixed(2), Math.round(th.angle) + "°", th.g.toFixed(2)].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; r.appendChild(td);
      });
      rows.appendChild(r);
    }
    var n = this.throws.length;
    $("t-count").textContent = String(n);
    var gs = this.throws.map(function(t) { return t.g; });
    var last = this.throws[n - 1];
    $("t-speed").textContent = last ? last.speed.toFixed(2) + " m/s" : "—";
    $("t-angle").textContent = last ? Math.round(last.angle) + "°" : "—";
    $("t-gchip").textContent = last ? last.g.toFixed(2) : "—";
    if (!n) {
      $("t-g").textContent = "—";
      $("t-summary").textContent = "No throws yet. Each good throw adds a row here.";
    } else {
      var mean = AR.mean(gs);
      $("t-g").textContent = (n > 1 ? mean : last.g).toFixed(2) + " m/s²";
      $("t-summary").textContent = (n > 1
        ? "Average of " + n + " throws (spread ± " + AR.std(gs).toFixed(2) + "). "
        : "From your throw (± " + last.gErr.toFixed(2) + "). ") +
        Place.compareText().trim() + (n < 3 ? " Throw a few more times for a better average." : "");
    }
    $("t-plot-wrap").hidden = !this.last;
    if (this.last && this.panels && this.panels.resultsVisible()) {
      var cv = $("t-plot");
      R.drawProjectilePlot(cv.getContext("2d"), R.fitCanvas(cv), this.last, inkOf(cv));
    }
  },

  /* ---------- setup ---------- */
  pickColor: function(e) {
    if (!this.live || this.trigger) return;
    var video = $("t-video");
    var c = this.tracker.sampleAtPoint(video, e.clientX, e.clientY);
    if (!c) return;
    this.settings.color = { r: c.r, g: c.g, b: c.b };
    this.saveSettings();
    this.markColor();
    this.toast("Got the ball's color", "info");
    this.status("Got it! Now press Ready, hold the ball still, then throw it across.", "ok");
  },
  markColor: function() {
    var c = this.settings.color;
    $("t-color").querySelectorAll("button").forEach(function(b) {
      var p = AR.COLOR_PRESETS[b.getAttribute("data-v")];
      b.setAttribute("aria-checked", c && p && c.r === p.r && c.g === p.g && c.b === p.b ? "true" : "false");
    });
    $("t-swatch").style.background = c ? "rgb(" + c.r + "," + c.g + "," + c.b + ")" : "transparent";
  },
  initSettings: function() {
    var self = this, s = self.settings;
    $("t-color").addEventListener("click", function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      s.color = AR.colorPreset(b.getAttribute("data-v"));
      self.saveSettings(); self.markColor();
      if (self.live && !self.trigger) self.nextStep();
    });
    self.markColor();
    var kinds = $("t-ballkind");
    Object.keys(AR.BALL_DIAMETERS).forEach(function(name) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", name);
      b.textContent = name.replace(/ \(.*\)/, "").replace(/^./, function(ch) { return ch.toUpperCase(); }) +
        " · " + (AR.BALL_DIAMETERS[name] * 100).toFixed(1) + " cm";
      kinds.appendChild(b);
    });
    var markBall = function() {
      kinds.querySelectorAll("button").forEach(function(b) {
        b.setAttribute("aria-checked", b.getAttribute("data-v") === s.ball ? "true" : "false");
      });
    };
    kinds.addEventListener("click", function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      s.ball = b.getAttribute("data-v"); self.saveSettings(); markBall();
    });
    markBall();
    var view = $("t-view");
    view.value = s.view;
    view.addEventListener("change", function() {
      var v = parseFloat(view.value);
      s.view = v >= 0.3 && v <= 20 ? v : 2;
      view.value = s.view; self.saveSettings();
    });
    var ghost = $("t-ghost");
    ghost.checked = s.ghost;
    ghost.addEventListener("change", function() { s.ghost = ghost.checked; self.review.ghost = s.ghost; self.saveSettings(); });
    var back = $("t-backcam");
    back.checked = s.back;
    back.addEventListener("change", function() {
      s.back = back.checked; self.saveSettings();
      if (self.live) { self.disarm(); self.stopLoop(); stopCamera(); self.openCamera(); }
    });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.review = makeReview({
      canvas: $("t-canvas"), row: $("t-review"), slider: $("t-scrub"), label: $("t-scrub-t"), play: $("t-play")
    }, {
      path: function(res) { return AR.projectilePath(res, Place.g()); },  // ghost: a throw at local g
      draw: AR.drawProjectileReplay,
      g: function(res) { return res.g; }
    });
    self.review.ghost = self.settings.ghost;
    self.panels = makePanels($("screen-throw"), "throw", function() { self.renderResults(); });
    self.initSettings();
    $("t-cam").addEventListener("click", function() { self.openCamera(); });
    $("t-go").addEventListener("click", function() { self.toggle(); });
    $("t-canvas").addEventListener("pointerdown", function(e) { self.pickColor(e); });
    $("t-clear").addEventListener("click", function() {
      self.throws = []; self.last = null; self.review.reset(); self.renderResults();
    });
    $("t-video").addEventListener("loadedmetadata", function() { self.layout(); });
    window.addEventListener("resize", function() {
      if ($("screen-throw").hidden) return;
      self.layout();
      self.renderResults();
    });
    document.addEventListener("keydown", function(e) {
      if ($("screen-throw").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      self.toggle();
    });
    Place.onChange(function() { self.renderResults(); });
    self.renderResults();
  },
  enter: function() {
    var self = this;
    Place.refreshIfAllowed();
    requestAnimationFrame(function() { self.layout(); self.renderResults(); });
  }
};
