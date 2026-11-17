/* Experiment 3 in the app: a virtual pendulum you set swinging by hand.
 * A ball hangs on a string from the top of the picture. Make a fist on it,
 * pull it aside (it stays on its string), open your hand: it swings
 * (core SwingBall: the full pendulum equation), and each pass through the
 * middle is timed. After the chosen number of swings the run is saved:
 * string length, how far it was pulled, the time for one swing, and g from
 * T = 2π√(L/g). Change the string and swing again: the T²-vs-L graph shows
 * what sets the beat (the length), and the table what doesn't (the pull). */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { BONES, label, inkOf } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makePanels } from "./panels.js";
import { makeHandInput } from "./handinput.js";
import { makeWorld } from "./worlds.js";
import { Place } from "./place.js";

var R = AR.render;
var MAX_RUNS = 30;
var FOUR_PI2 = 4 * Math.PI * Math.PI;
var PIVOT = { x: 0.5, y: 0.15 };   // just below the title bar
var TRAIL_MS = 1200;
/* How little air slows each ball (quality factor Q: the swing shrinks by
 * e^(−π/Q) per swing). Light, big balls feel the air most. */
var BALL_Q = { tennis: 50, basketball: 20, bowling: 400 };

export var Swing = {
  ball: new AR.SwingBall({ pivot: PIVOT }),
  input: null, world: null, panels: null,
  live: false, raf: 0,
  hand: null,
  trail: [],
  saved: false,        // this release's run is already in the table
  runs: [],
  settings: null, skin: null,

  loadSettings: function() {
    var s = store.get("swing2", {});
    this.settings = {
      gravity: s.gravity || "earth",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      ball: R.isBallStyle(s.ball) ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      lengthCm: s.lengthCm >= 10 && s.lengthCm <= 2000 ? s.lengthCm : 80,
      swings: [5, 10, 20].indexOf(s.swings) >= 0 ? s.swings : 5,
      air: s.air !== false,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("swing2", this.settings); },
  /* The longest string that fits under the pivot on screen (cm). */
  maxLengthCm: function() { return Math.floor((1 - PIVOT.y - 0.06) * this.settings.view * 100); },
  lengthM: function() { return Math.min(this.settings.lengthCm, this.maxLengthCm()) / 100; },
  params: function() {
    var wrap = $("s-wrap");
    return {
      g: this.world.g(),
      h: this.settings.view,
      L: this.lengthM(),
      Q: this.settings.air ? BALL_Q[this.settings.ball] || 50 : Infinity,
      slow: parseFloat(this.settings.slow) || 1,
      aspect: wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3
    };
  },
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

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    $("s-cam").disabled = true;
    $("s-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    self.input.startCamera().then(function() {
      self.run();
      self.status("Make a fist ✊ on the ball, pull it to the side, and open your hand to let go.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("s-start-note").textContent = err.message;
    }).then(function() { $("s-cam").disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press and hold on the ball, pull it to the side, and let go.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("s-start").hidden = true;
    self.ballBack();
    self.live = true;
    keepAwake(true);
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
  },
  stop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    keepAwake(false);
  },
  leave: function() {
    this.stop();
    this.input.close();
    $("s-start").hidden = false;
    $("s-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
    this.status("Pick camera or finger to start.", "");
    this.panels.closeSheets();
    this.drawIdle();
  },
  ballBack: function() {
    this.ball.reset();
    this.trail = []; this.saved = false; this.hand = null;
  },

  /* ---------- the loop ---------- */
  loop: function(now) {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
    var p = self.params();
    var r = self.input.read(now);
    self.hand = r.hand;
    if (r.fresh) {
      var ev = self.ball.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p);
    }
    var pass = self.ball.tick(now, p);
    if (pass && pass.type === "pass") self.onPass(pass, p);
    else if (pass && pass.type === "stopped") self.onStopped(pass, p);
    var b = self.ball.pos(p);
    self.trail.push({ x: b.x, y: b.y, at: now });
    while (self.trail.length && now - self.trail[0].at > TRAIL_MS) self.trail.shift();
    self.draw(p);
    self.readouts(p);
  },
  onEvent: function(ev, p) {
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.saved = false;
      this.status("Got it! Pull it to the side, then open your hand to let go.", "ok");
    } else if (ev.type === "released") {
      Sounds.release();
      this.saved = false;
      var deg = Math.abs(ev.angleDeg);
      this.status(deg < 2
        ? "Pull it further to the side before you let go."
        : "Let go at " + Math.round(deg) + "°. Timing " + this.settings.swings + " swings…", "");
    }
  },
  onPass: function(pass, p) {
    if (Math.abs(this.ball.releaseDeg) < 2) return;
    var size = Math.round(this.ball.amplitude(p) * 180 / Math.PI);
    if (pass.swings >= 1 && !this.saved) {
      $("s-status").textContent = "Swing " + pass.swings + " of " + this.settings.swings +
        ": one swing takes " + pass.period.toFixed(3) + " s. Size now " + size + "°…";
    } else if (this.saved && pass.swings >= this.settings.swings + 4 && pass.swings % 4 === 0) {
      $("s-status").textContent = "Still swinging: " + pass.swings + " swings, size now " + size + "°" +
        (p.Q < Infinity ? ". The air is slowing it down." : ". With no air, it never slows down!");
    }
    if (pass.swings >= this.settings.swings && !this.saved) {
      this.saved = true;
      this.addRun(pass.period, p);
    }
  },

  /* The air took all its energy: say so, and save a run cut short. */
  onStopped: function(ev, p) {
    var short = !this.saved && Math.abs(this.ball.releaseDeg) >= 2 && ev.swings >= 2;
    if (short) { this.saved = true; this.addRun(this.ball.period, p, ev.swings); }
    Sounds.land();
    this.toast("It stopped", "info");
    this.status("It stopped after " + ev.swings + " swings (" + Math.round(ev.t) + " s): the air slowed it down." +
      (this.settings.ball === "bowling" ? "" : " A heavy bowling ball keeps going much longer: try it!") +
      " Grab it to swing again.", "");
  },

  /* ---------- results ---------- */
  addRun: function(T, p, timed) {
    timed = timed || this.settings.swings;
    var amp0 = Math.abs(this.ball.releaseDeg) * Math.PI / 180;
    var ampMid = (amp0 + this.ball.amplitude(p)) / 2;      // it shrinks as it swings
    var T0 = T / AR.periodFactor(ampMid);                  // a tiny swing's period
    var run = { L: p.L, deg: amp0 * 180 / Math.PI, T: T, T0: T0, g: FOUR_PI2 * p.L / (T0 * T0) };
    this.runs.push(run);
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    Sounds.catchAir();
    this.toast("One swing: " + T.toFixed(2) + " s");
    var theory = 2 * Math.PI * Math.sqrt(p.L / p.g) * AR.periodFactor(ampMid);
    this.status("One swing takes " + T.toFixed(3) + " s (timed over " + timed + " swings)" +
      (this.world.mystery() ? ", so g ≈ " + run.g.toFixed(2) + " m/s²." : ". The formula says " + theory.toFixed(3) + " s.") +
      " Now try a different string, or a bigger or smaller pull!", "ok");
    this.renderResults();
  },
  /* g from the slope of T₀² vs L through the origin: T₀² = (4π²/g)·L. */
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
  renderResults: function() {
    var rows = $("s-rows");
    rows.textContent = "";
    for (var i = this.runs.length - 1; i >= 0; i--) {
      var r = this.runs[i], tr = document.createElement("tr");
      [String(i + 1), (r.L * 100).toFixed(0), Math.round(r.deg) + "°", r.T.toFixed(3), r.g.toFixed(2)].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    var n = this.runs.length, digits = this.world.digits();
    $("s-count").textContent = String(n);
    $("s-g-label").textContent = this.world.mystery() ? "Mystery planet's g" : "Your g";
    if (!n) {
      $("s-g").textContent = "—";
      $("s-summary").textContent = "No runs yet. Each run adds a row here.";
    } else if (n > 1 && this.lengthSpread() >= 0.1) {
      $("s-g").textContent = this.fitRuns().toFixed(digits) + " m/s²";
      $("s-summary").textContent = "From the slope of " + n + " runs with different strings: longer strings swing slower." +
        this.world.compare();
    } else {
      var last = this.runs[n - 1];
      $("s-g").textContent = last.g.toFixed(digits) + " m/s²";
      $("s-summary").textContent = "From your last run. Try a different string length: does one swing take longer?" +
        this.world.compare();
    }
    $("s-mystery").hidden = !this.world.mystery();
    $("s-reveal").textContent = this.world.revealText();
    $("s-runs-wrap").hidden = n < 2;
    if (n >= 2 && this.panels && this.panels.resultsVisible()) this.plotRuns(this.fitRuns());
  },
  plotRuns: function(gFit) {
    var cv = $("s-runs-plot");
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

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("s-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    var b = this.ball, px = PIVOT.x * W, py = PIVOT.y * H, pos = b.pos(p);
    var bx = pos.x * W, by = pos.y * H;
    // The middle line: each time the ball crosses it, half a swing is timed.
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = d;
    ctx.setLineDash([6 * d, 6 * d]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + p.L / p.h * H + 30 * d); ctx.stroke();
    ctx.setLineDash([]);
    // Fading trail.
    var now = performance.now();
    this.trail.forEach(function(t) {
      var age = (now - t.at) / TRAIL_MS;
      ctx.fillStyle = "rgba(78,205,196," + (0.6 * (1 - age)).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(t.x * W, t.y * H, 3 * d, 0, 2 * Math.PI); ctx.fill();
    });
    // The support, the string, the ball.
    ctx.fillStyle = "rgba(200,206,220,0.95)";
    ctx.fillRect(px - 50 * d, py - 8 * d, 100 * d, 8 * d);
    ctx.strokeStyle = "rgba(240,240,240,0.95)"; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
    var r = Math.max(R.ballRadius(dims), 0.035 * Math.min(W, H));
    R.drawBall(this.skin, ctx, bx, by, r);
    // The pull angle while holding it.
    if (b.state === "held" && Math.abs(b.theta) > 0.02) {
      var arcR = Math.min(80 * d, p.L / p.h * H * 0.4);
      ctx.strokeStyle = "rgba(245,165,36,0.9)"; ctx.lineWidth = 2 * d;
      ctx.beginPath();
      ctx.arc(px, py, arcR, Math.PI / 2, Math.PI / 2 - b.theta, b.theta > 0);
      ctx.stroke();
      label(ctx, d, Math.round(Math.abs(b.theta) * 180 / Math.PI) + "°", px + (b.theta > 0 ? 8 : -8) * d,
        py + arcR + 16 * d, b.theta > 0 ? "left" : "right", 15);
    }
    label(ctx, d, "L = " + Math.round(p.L * 100) + " cm", px + 58 * d, py + 4 * d, "left", 12);
    // The hand.
    var hand = this.hand;
    if (hand) {
      ctx.strokeStyle = b.gate.closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
      ctx.lineWidth = 2 * d;
      if (hand.lm) {
        BONES.forEach(function(bn) {
          ctx.beginPath(); ctx.moveTo(hand.lm[bn[0]].x * W, hand.lm[bn[0]].y * H);
          ctx.lineTo(hand.lm[bn[1]].x * W, hand.lm[bn[1]].y * H); ctx.stroke();
        });
      }
      ctx.beginPath(); ctx.arc(hand.x * W, hand.y * H, b.catchR * H, 0, 2 * Math.PI);
      ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
      if (!hand.lm) label(ctx, d, b.gate.closed ? "✊" : "✋", hand.x * W, hand.y * H + 5 * d, "center", 18);
    }
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(p) {
    var b = this.ball;
    $("s-hand").textContent = !this.hand ? "—" : b.gate.closed ? "✊" : "✋";
    $("s-n").textContent = (b.state === "held" ? 0 : Math.min(b.swings, this.settings.swings)) + " / " + this.settings.swings;
    var T = b.period, last = this.runs[this.runs.length - 1];
    $("s-T").textContent = isFinite(T) ? T.toFixed(3) + " s" : last ? last.T.toFixed(3) + " s" : "—";
    $("s-gchip").textContent = last ? last.g.toFixed(2) : "—";
  },
  showWorld: function() { $("s-world").textContent = this.world.label(); },
  showTheory: function() {
    var g = this.world.mystery() ? NaN : this.world.g();
    $("s-theory").textContent = isFinite(g) ? (2 * Math.PI * Math.sqrt(this.lengthM() / g)).toFixed(2) + " s" : "?";
  },

  /* ---------- setup ---------- */
  initSettings: function() {
    var self = this, s = self.settings;
    var seg = function(id, key, after, values, labelOf) {
      var group = $(id);
      if (values) values.forEach(function(v) {
        var b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", String(v));
        b.textContent = labelOf(v);
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
        mark(); self.saveSettings();
        if (after) after();
      });
      mark();
    };
    seg("s-gravity", "gravity", function() {
      self.world.set(s.gravity);
      self.runs = [];
      self.ballBack();
      self.showWorld(); self.showTheory();
      self.renderResults();
      self.toast(self.world.mystery() ? "New mystery planet. Swing to find its g!" : "Now on " + self.world.name(), "info");
    });
    seg("s-slow", "slow");
    seg("s-ball", "ball", function() { self.skin = R.makeBall(s.ball); if (!self.live) self.drawIdle(); });
    seg("s-swings", "swings", null, [5, 10, 20], function(v) { return v + " swings"; });
    var view = $("s-view");
    view.value = s.view;
    view.addEventListener("change", function() {
      var v = parseFloat(view.value);
      s.view = v >= 0.3 && v <= 20 ? v : 2;
      view.value = s.view; self.saveSettings();
      self.applyLength();
    });
    var len = $("s-length");
    len.value = s.lengthCm;
    var setLen = function(commit) {
      var v = parseFloat(len.value);
      if (v >= 10 && v <= 2000) {
        s.lengthCm = v;
        self.applyLength();
      } else if (commit) {
        len.value = s.lengthCm;
      }
      if (commit) { len.value = Math.round(self.lengthM() * 100); s.lengthCm = +len.value; self.saveSettings(); }
    };
    len.addEventListener("input", function() { setLen(false); });
    len.addEventListener("change", function() { setLen(true); });
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    var applyMirror = function() { $("s-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("s-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("s-sound", "sound", function() { Sounds.enabled = s.sound; if (s.sound) { Sounds.unlock(); Sounds.grab(); } });
    toggle("s-air", "air", function() {
      self.toast(s.air ? "Air is back: it will slow down" : "No air: it will swing forever", "info");
    });
    toggle("s-backcam", "back", function() {
      s.mirror = !s.back; $("s-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
      var wasLive = self.input.source === "camera";
      self.input.close();
      if (wasLive) self.startCamera();
    });
  },
  /* A new string length: the swing starts over (its timing would mix two lengths). */
  applyLength: function() {
    $("s-length").max = String(this.maxLengthCm());
    this.ball.reset();
    this.trail = []; this.saved = false;
    this.showTheory();
    if (!this.live) this.drawIdle();
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.world = makeWorld(self.settings.gravity);
    self.settings.gravity = self.world.key;
    self.skin = R.makeBall(self.settings.ball);
    self.input = makeHandInput({ wrap: $("s-wrap"), video: $("s-video"), canvas: $("s-canvas") }, {
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      quiet: function() { return self.ball.state === "hanging" && self.ball.swings > 0; },
      handBack: function() {
        self.status(self.ball.state === "held" ? "Got it! Pull it to the side, then open your hand to let go."
          : "I see your hand ✋. Make a fist ✊ on the ball to grab it.", "ok");
      }
    });
    self.panels = makePanels($("screen-swing"), "swing", function() { self.renderResults(); });
    self.initSettings();
    self.showWorld();
    self.applyLength();
    $("s-cam").addEventListener("click", function() { self.startCamera(); });
    $("s-touch").addEventListener("click", function() { self.startTouch(); });
    $("s-reset").addEventListener("click", function() {
      self.ballBack();
      if (!self.live) self.drawIdle();
      self.status("The ball is still. Grab it and pull it aside.", "");
    });
    $("s-clear").addEventListener("click", function() { self.runs = []; self.renderResults(); });
    $("s-reveal").addEventListener("click", function() { self.world.reveal(); self.renderResults(); });
    Place.onChange(function() { self.showWorld(); self.showTheory(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-swing").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("s-reset").click();
    });
    window.addEventListener("resize", function() {
      if ($("screen-swing").hidden) return;
      if (!self.live) self.drawIdle();
      self.renderResults();
    });
    self.renderResults();
  },
  enter: function() {
    var self = this;
    Place.refreshIfAllowed();
    requestAnimationFrame(function() { self.drawIdle(); self.renderResults(); });
  }
};
