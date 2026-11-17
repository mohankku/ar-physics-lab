/* Experiment 3 in the app: time a real pendulum and get g from
 * T = 2π√(L/g). Tap the ball once so the tracker learns its color, type the
 * string length, set it swinging and press Start: each pass through the
 * middle is timed live, and the run stops by itself after the chosen number
 * of swings (core analyzePendulum). Every run goes into a table and a
 * T²-vs-L graph, so changing the string shows how the beat depends on its
 * length (and not on the swing's size). L = string + ball radius. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { inkOf } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { startCamera, stopCamera, cameraError, fitFrame } from "./camera.js";
import { makePanels } from "./panels.js";
import { Place } from "./place.js";

var R = AR.render;
var LIVE_EVERY_S = 0.4;  // re-analyze this often while timing
var TRAIL_S = 1.5;       // overlay trail
var MAX_S = 180;         // never time longer than this
var MAX_RUNS = 30;
var FOUR_PI2 = 4 * Math.PI * Math.PI;

export var Swing = {
  tracker: new AR.ColorTracker(),
  settings: null,
  live: false, raf: 0, clock: null,
  timing: false,
  samples: [], widths: [], t0: 0, lastLive: 0, liveRes: null,
  runs: [],
  last: null,           // last finished analysis
  panels: null,

  loadSettings: function() {
    var s = store.get("swing", {});
    this.settings = {
      color: s.color && s.color.r != null ? s.color : null,
      ball: AR.BALL_DIAMETERS[s.ball] ? s.ball : "tennis",
      lengthCm: s.lengthCm >= 5 && s.lengthCm <= 1000 ? s.lengthCm : 80,
      swings: [5, 10, 20].indexOf(s.swings) >= 0 ? s.swings : 10,
      back: s.back !== false
    };
  },
  saveSettings: function() { store.set("swing", this.settings); },
  colorOpts: function() { return { target: this.settings.color || AR.colorPreset("red"), tol: 80 }; },
  diameterM: function() { return AR.BALL_DIAMETERS[this.settings.ball]; },
  /* Pivot to the ball's center. */
  lengthM: function() { return this.settings.lengthCm / 100 + this.diameterM() / 2; },
  predictedT: function() { return 2 * Math.PI * Math.sqrt(this.lengthM() / Place.g()); },

  status: function(msg, cls) {
    var el = $("s-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("s-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2400);
  },
  nextStep: function() {
    if (!this.settings.color) this.status("Tap the ball in the picture, so I know its color.", "");
    else this.status("Pull the ball a hand's width aside, let go, then press Start.", "");
  },

  /* ---------- camera ---------- */
  openCamera: function() {
    var self = this;
    Sounds.unlock();
    $("s-cam").disabled = true;
    $("s-start-note").textContent = "Starting the camera…";
    startCamera($("s-video"), self.settings.back).then(function() {
      $("s-start").hidden = true;
      self.layout();
      self.run();
      self.nextStep();
    }, function(err) {
      if (err && err.name === "AbortError") return;
      $("s-start-note").textContent = cameraError(err);
      self.status(cameraError(err), "err");
    }).then(function() { $("s-cam").disabled = false; });
  },
  layout: function() { fitFrame($("s-wrap"), $("s-frame"), $("s-video")); },
  run: function() {
    var self = this;
    self.stopLoop();
    self.live = true;
    self.tracker.reset();
    self.clock = new AR.FrameClock($("s-video"));
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
    this.cancel();
    this.stopLoop();
    stopCamera();
    $("s-start").hidden = false;
    $("s-start-note").textContent = "Works best with a brightly colored ball and a plain wall behind.";
    this.status("Open the camera to start.", "");
    if (this.panels) this.panels.closeSheets();
    var cv = $("s-canvas");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* ---------- the loop ---------- */
  loop: function() {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return;
    var video = $("s-video");
    var opts = self.colorOpts();
    var c = self.settings.color ? self.tracker.locate(video, opts) : null;
    var t = frame.time / 1000;
    $("s-seen").textContent = !self.settings.color ? "tap it" : c ? "seen ✓" : "not seen";
    if (self.timing) {
      if (!self.t0) self.t0 = t;
      if (c) {
        var prev = self.samples[self.samples.length - 1];
        self.samples.push({ t: t, x: c.x, y: c.y });
        // Size the ball across its motion (it blurs along it).
        var size = self.tracker.measureSize(video, c, opts);
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
          self.liveRes = res;
          self.readouts(res);
          if (res.periods >= self.settings.swings) { self.finish(); return; }
        }
      }
      if (t - self.t0 > MAX_S) { self.finish(); return; }
    }
    self.draw(c, t);
  },
  frameHeightM: function() {
    var v = $("s-video");
    var s = AR.scaleFromBallWidths(this.widths, this.diameterM());
    return s && v.videoHeight ? v.videoHeight / s.pxPerM : null;
  },
  analyze: function() {
    var v = $("s-video");
    return AR.analyzePendulum(this.samples, {
      lengthM: this.lengthM(),
      aspect: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3,
      frameHeightM: this.frameHeightM()
    });
  },
  draw: function(c, t) {
    var cv = $("s-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    var v = $("s-video");
    var aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    if (this.timing && this.liveRes) {
      // The middle line: each time the ball crosses it, a half swing is timed.
      var ce = this.liveRes.center;
      var dx = -Math.sin(ce.angle) / aspect, dy = Math.cos(ce.angle);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2 * dims.dpr;
      ctx.setLineDash([8 * dims.dpr, 6 * dims.dpr]);
      ctx.beginPath();
      ctx.moveTo((ce.x - 0.3 * dx) * dims.w, (ce.y - 0.3 * dy) * dims.h);
      ctx.lineTo((ce.x + 0.3 * dx) * dims.w, (ce.y + 0.3 * dy) * dims.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.timing) {
      for (var i = this.samples.length - 1; i >= 0; i--) {
        var s = this.samples[i], age = t - s.t;
        if (age > TRAIL_S) break;
        ctx.fillStyle = "rgba(229,72,77," + (0.85 * (1 - age / TRAIL_S)).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(s.x * dims.w, s.y * dims.h, 3 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
      }
    }
    if (c) R.drawTrackMarker(ctx, dims, c, this.timing ? "#e5484d" : "#4ecd64");
  },
  readouts: function(res) {
    $("s-n").textContent = (res ? Math.floor(res.periods) : 0) + " / " + this.settings.swings;
    $("s-T").textContent = res ? res.T.toFixed(3) + " s" : "—";
    $("s-gchip").textContent = res ? res.g.toFixed(2) : "—";
  },

  /* ---------- a run ---------- */
  toggle: function() {
    Sounds.unlock();
    if (this.timing) { this.finish(); return; }
    if (!this.live) { this.status("Open the camera first.", "err"); return; }
    if (!this.settings.color) { this.status("First tap the ball in the picture, so I know its color.", "err"); return; }
    this.samples = []; this.widths = []; this.t0 = 0; this.lastLive = 0; this.liveRes = null;
    this.timing = true;
    this.readouts(null);
    $("s-go").textContent = "Stop";
    $("s-go").classList.remove("accent");
    Sounds.grab();
    this.status("Timing… I'll stop by myself after " + this.settings.swings + " swings.", "");
  },
  cancel: function() {
    this.timing = false;
    $("s-go").textContent = "Start";
    $("s-go").classList.add("accent");
  },
  finish: function() {
    this.cancel();
    var res = this.analyze();
    if (!res.ok) {
      Sounds.land();
      this.toast("Let's try that again", "warn");
      this.status("I couldn't time that: " + res.error + " Press Start to try again.", "err");
      return;
    }
    Sounds.catchAir();
    this.last = res;
    this.readouts(res);
    var L = this.lengthM();
    // T0: the period of a tiny swing (the size correction the run's g uses too).
    this.runs.push({ L: L, T: res.T, T0: res.T / res.factor, TErr: res.TStdErr, g: res.g, gErr: res.gStdErr,
      periods: res.periods, amp: res.amplitudeDeg });
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    this.toast("One swing takes " + res.T.toFixed(2) + " s");
    var pred = this.predictedT();
    this.status("One full swing takes " + res.T.toFixed(3) + " s, timed over " + res.periods + " swings, so g ≈ " +
      res.g.toFixed(2) + " m/s². " + "Theory for a " + this.settings.lengthCm + " cm string: " + pred.toFixed(3) +
      " s. Now try a shorter or longer string!", "ok");
    this.renderResults();
  },

  /* ---------- results ---------- */
  renderResults: function() {
    var rows = $("s-rows");
    rows.textContent = "";
    for (var i = this.runs.length - 1; i >= 0; i--) {
      var r = this.runs[i], tr = document.createElement("tr");
      [String(i + 1), (r.L * 100).toFixed(1), r.T.toFixed(3), r.g.toFixed(2)].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    var n = this.runs.length;
    $("s-count").textContent = String(n);
    var fit = this.fitRuns();
    var spread = this.lengthSpread();
    if (!n) {
      $("s-g").textContent = "—";
      $("s-summary").textContent = "No runs yet. Each run adds a row here.";
    } else if (n > 1 && spread >= 0.1) {
      $("s-g").textContent = fit.toFixed(2) + " m/s²";
      $("s-summary").textContent = "From the slope of " + n + " runs with different strings. " +
        "Longer strings swing slower: T² grows in step with L." + Place.compareText();
    } else {
      var last = this.runs[n - 1];
      $("s-g").textContent = last.g.toFixed(2) + " m/s²";
      $("s-summary").textContent = "From your last run (± " + last.gErr.toFixed(2) + "). " +
        "Try a different string length: does the time for one swing change?" + Place.compareText();
    }
    $("s-plots").hidden = !this.last;
    if (this.last && this.panels && this.panels.resultsVisible()) {
      var cv = $("s-plot"), res = this.last;
      var fh = this.frameHeightM();
      R.drawPendulumPlot(cv.getContext("2d"), R.fitCanvas(cv), res,
        function(t) { return AR.pendulumModel(res, t); },
        fh ? { k: fh * 100, label: "cm" } : { k: 100, label: "% of picture" }, inkOf(cv));
      this.plotRuns(fit);
    }
    $("s-runs-wrap").hidden = n < 2;
  },
  /* g from the slope of T₀² vs L through the origin: T₀² = (4π²/g)·L, with
   * T₀ each run's period corrected to a tiny swing. */
  fitRuns: function() {
    var sll = 0, slt = 0;
    this.runs.forEach(function(r) { sll += r.L * r.L; slt += r.L * r.T0 * r.T0; });
    return slt > 0 ? FOUR_PI2 * sll / slt : NaN;
  },
  lengthSpread: function() {
    if (this.runs.length < 2) return 0;
    var Ls = this.runs.map(function(r) { return r.L; });
    return Math.max.apply(null, Ls) - Math.min.apply(null, Ls);
  },
  plotRuns: function(gFit) {
    var cv = $("s-runs-plot");
    if (this.runs.length < 2) return;
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var runs = this.runs;
    var lMax = Math.max(0.3, Math.max.apply(null, runs.map(function(r) { return r.L; })) * 1.15);
    var t2Max = Math.max(0.3, Math.max.apply(null, runs.map(function(r) { return r.T0 * r.T0; })) * 1.15);
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, lMax], [0, t2Max],
      ["string length L (m)", "T² (s²)"], ink);
    if (isFinite(gFit)) {
      ctx.strokeStyle = "#1a56db"; ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.moveTo(A.X(0), A.Y(0)); ctx.lineTo(A.X(lMax), A.Y(FOUR_PI2 * lMax / gFit)); ctx.stroke();
      ctx.fillStyle = "#3b6fe0";
      ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
      ctx.fillText("slope = 4π²/g → g ≈ " + gFit.toFixed(2) + " m/s²", A.X(lMax * 0.04), A.Y(t2Max * 0.86));
    }
    ctx.fillStyle = "#e5484d";
    runs.forEach(function(r) { ctx.beginPath(); ctx.arc(A.X(r.L), A.Y(r.T0 * r.T0), 4 * d, 0, 2 * Math.PI); ctx.fill(); });
  },
  showTheory: function() {
    $("s-theory").textContent = this.predictedT().toFixed(2) + " s";
  },

  /* ---------- setup ---------- */
  pickColor: function(e) {
    if (!this.live || this.timing) return;
    var c = this.tracker.sampleAtPoint($("s-video"), e.clientX, e.clientY);
    if (!c) return;
    this.settings.color = { r: c.r, g: c.g, b: c.b };
    this.saveSettings();
    this.markColor();
    this.toast("Got the ball's color", "info");
    this.status("Got it! Pull the ball a hand's width aside, let go, then press Start.", "ok");
  },
  markColor: function() {
    var c = this.settings.color;
    $("s-color").querySelectorAll("button").forEach(function(b) {
      var p = AR.COLOR_PRESETS[b.getAttribute("data-v")];
      b.setAttribute("aria-checked", c && p && c.r === p.r && c.g === p.g && c.b === p.b ? "true" : "false");
    });
    $("s-swatch").style.background = c ? "rgb(" + c.r + "," + c.g + "," + c.b + ")" : "transparent";
  },
  initSettings: function() {
    var self = this, s = self.settings;
    $("s-color").addEventListener("click", function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      s.color = AR.colorPreset(b.getAttribute("data-v"));
      self.saveSettings(); self.markColor();
      if (self.live && !self.timing) self.nextStep();
    });
    self.markColor();
    var seg = function(group, key, values, label, after) {
      values.forEach(function(v) {
        var b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", String(v));
        b.textContent = label(v);
        group.appendChild(b);
      });
      var mark = function() {
        group.querySelectorAll("button").forEach(function(b) {
          b.setAttribute("aria-checked", b.getAttribute("data-v") === String(s[key]) ? "true" : "false");
        });
      };
      group.addEventListener("click", function(e) {
        var b = e.target.closest("button");
        if (!b) return;
        var v = b.getAttribute("data-v");
        s[key] = typeof s[key] === "number" ? +v : v;
        self.saveSettings(); mark();
        if (after) after();
      });
      mark();
    };
    seg($("s-ballkind"), "ball", Object.keys(AR.BALL_DIAMETERS), function(name) {
      return name.replace(/ \(.*\)/, "").replace(/^./, function(ch) { return ch.toUpperCase(); }) +
        " · " + (AR.BALL_DIAMETERS[name] * 100).toFixed(1) + " cm";
    }, function() { self.showTheory(); });
    seg($("s-swings"), "swings", [5, 10, 20], function(v) { return v + " swings"; }, function() {
      if (!self.timing) self.readouts(self.last);
    });
    var len = $("s-length");
    len.value = s.lengthCm;
    len.addEventListener("change", function() {
      var v = parseFloat(len.value);
      if (v >= 5 && v <= 1000) s.lengthCm = v;
      len.value = s.lengthCm;
      self.saveSettings();
      self.showTheory();
    });
    len.addEventListener("input", function() {
      var v = parseFloat(len.value);
      if (v >= 5 && v <= 1000) { s.lengthCm = v; self.showTheory(); }
    });
    var back = $("s-backcam");
    back.checked = s.back;
    back.addEventListener("change", function() {
      s.back = back.checked; self.saveSettings();
      if (self.live) { self.cancel(); self.stopLoop(); stopCamera(); self.openCamera(); }
    });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.panels = makePanels($("screen-swing"), "swing", function() { self.renderResults(); });
    self.initSettings();
    self.showTheory();
    Place.onChange(function() { self.showTheory(); self.renderResults(); });
    self.readouts(null);
    $("s-cam").addEventListener("click", function() { self.openCamera(); });
    $("s-go").addEventListener("click", function() { self.toggle(); });
    $("s-canvas").addEventListener("pointerdown", function(e) { self.pickColor(e); });
    $("s-clear").addEventListener("click", function() { self.runs = []; self.last = null; self.renderResults(); });
    $("s-video").addEventListener("loadedmetadata", function() { self.layout(); });
    window.addEventListener("resize", function() {
      if ($("screen-swing").hidden) return;
      self.layout();
      self.renderResults();
    });
    document.addEventListener("keydown", function(e) {
      if ($("screen-swing").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      self.toggle();
    });
    self.renderResults();
  },
  enter: function() {
    var self = this;
    Place.refreshIfAllowed();
    requestAnimationFrame(function() { self.layout(); self.renderResults(); });
  }
};
