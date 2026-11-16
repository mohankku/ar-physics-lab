/* Exp 01, first tab — catch & drop a virtual ball with hand gestures.
 * MediaPipe finds the hand; a fist on the ball catches it, opening the hand
 * lets go, and it falls from that height at the chosen g (core CatchBall).
 * Every landing is timed frame by frame and added to a table that works
 * out g = 2h/t², so a "mystery planet" can be discovered from drops. */
import * as AR from "../../core/index.js";
import { $, setStatus, numberIn, onSpace, remember, restoreSettings, ballStyle, camera, openCamera } from "../ui.js";
import { loadHandTracker, HandTracker } from "../handtrack.js";

var R = AR.render;
var SETTINGS = [["catch-view", "catch-view"], ["catch-gravity", "catch-g"], ["catch-slow", "catch-slow"]];
var BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
var MYSTERY = [3.7, 8.87, 1.62, 3.71, 24.79, 10.44, 8.69, 11.15, 0.62, 2.3, 15.2, 6.1]; // incl. made-up worlds
var MAX_TRIALS = 50;

var Catch = {
  ball: new AR.CatchBall(),
  tracker: null,     // HandTracker once loaded
  live: false, raf: 0, clock: null,
  hand: null,        // last {x, y, open, lm}
  trail: [],
  trials: [],
  mysteryG: null,

  status: function(msg, cls) { setStatus($("catch-status"), msg, cls); },
  aspect: function() {
    var v = $("catch-video");
    return v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
  },
  mystery: function() { return $("catch-gravity").value === "mystery"; },
  params: function() {
    var sel = $("catch-gravity").value;
    var g = sel === "mystery" ? this.mysteryG : parseFloat(sel);
    return {
      g: g > 0 ? g : 9.81,
      h: numberIn("catch-view", 0.3, 20, 2),
      slow: parseFloat($("catch-slow").value) || 1,
      aspect: this.aspect()
    };
  },

  start: function() {
    var self = this;
    self.status("Loading hand tracking… (about 18 MB the first time, then it's saved)", "");
    $("btn-catch-cam").disabled = true;
    Promise.all([
      loadHandTracker(),
      openCamera($("catch-video"), $("catch-status"))
    ]).then(function(r) {
      self.tracker = new HandTracker(r[0]);
      R.fitCanvas($("catch-overlay"));
      self.ball.reset(0.5, 0.35);
      self.trail = [];
      self.live = true;
      self.clock = new AR.FrameClock($("catch-video"));
      self.clock.start();
      self.raf = requestAnimationFrame(function(n) { self.loop(n); });
      self.status("Show your open hand, then make a fist on the ball to catch it.", "ok");
    }, function(err) {
      if (err && err.name === "AbortError") return;
      if (!camera.liveVideo()) return; // openCamera already explained the camera problem
      self.status("Hand tracking couldn't load (" + (err && err.message || err) +
        "). Check the internet connection and try again.", "err");
    }).then(function() { $("btn-catch-cam").disabled = false; });
  },
  stop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    var cv = $("catch-overlay");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  loop: function(now) {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
    var p = self.params();
    if (self.clock.next(now)) { // one hand detection per camera frame
      var lm = null;
      try { lm = self.tracker.detect($("catch-video"), now); } catch (e) { lm = null; }
      if (lm) {
        var c = AR.palmCenter(lm);
        self.hand = { x: c.x, y: c.y, open: AR.handOpenness(lm, p.aspect), lm: lm };
      } else {
        self.hand = null;
      }
      var ev = self.ball.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p);
    }
    var landed = self.ball.tick(now, p);
    if (landed) self.onEvent(landed, p);
    if (self.ball.state === "falling") self.trail.push({ x: self.ball.x, y: self.ball.y });
    self.draw(p);
    self.readouts(p);
  },

  onEvent: function(ev, p) {
    if (ev.type === "grabbed") {
      this.trail = [];
      this.status("Caught! Raise it up, then open your hand to drop it.", "ok");
    } else if (ev.type === "released") {
      this.trail = [];
      this.status((ev.how === "lost" ? "Hand lost — the ball slipped " : "Dropped ") + "from " +
        ev.h0.toFixed(2) + " m…", "");
    } else if (ev.type === "caught") {
      this.status("Caught in mid-air after " + ev.t.toFixed(3) + " s, " + ev.fallenM.toFixed(2) +
        " m down. Open your hand to drop it again.", "ok");
    } else if (ev.type === "landed") {
      this.addTrial(ev.h0, ev.t);
      var theory = this.mystery() ? "" : " (theory √(2h/g) = " + ev.exactT.toFixed(3) + " s)";
      this.status("Landed: fell " + ev.h0.toFixed(2) + " m in " + ev.t.toFixed(3) + " s" + theory +
        ". Make a fist on it to pick it up again.", "ok");
    }
  },

  addTrial: function(h, t) {
    if (!(h > 0.05) || !(t > 0)) return;
    this.trials.push({ h: h, t: t, g: 2 * h / (t * t), slow: this.params().slow });
    if (this.trials.length > MAX_TRIALS) this.trials.shift();
    this.renderTrials();
  },
  renderTrials: function() {
    var rows = $("catch-rows");
    rows.innerHTML = "";
    this.trials.forEach(function(tr, i) {
      var r = document.createElement("tr");
      [String(i + 1), tr.h.toFixed(2), tr.t.toFixed(3), (tr.t * tr.t).toFixed(4), tr.g.toFixed(2)]
        .forEach(function(text) { var td = document.createElement("td"); td.textContent = text; r.appendChild(td); });
      rows.appendChild(r);
    });
    var stats = $("catch-stats");
    if (!this.trials.length) { stats.textContent = "No drops yet."; return; }
    var gs = this.trials.map(function(tr) { return tr.g; });
    // Slope of t² vs h through the origin is 2/g: uses every drop at once.
    var shh = 0, sht = 0;
    this.trials.forEach(function(tr) { shh += tr.h * tr.h; sht += tr.h * tr.t * tr.t; });
    var gFit = 2 * shh / sht;
    stats.textContent = this.trials.length + " drop(s). Average g = " + AR.mean(gs).toFixed(2) +
      (gs.length > 1 ? " ± " + AR.std(gs).toFixed(2) : "") + " m/s²; from the t² vs h line: " +
      gFit.toFixed(2) + " m/s²." + (this.mystery() ? " Which planet could it be?" : "");
  },

  draw: function(p) {
    var cv = $("catch-overlay");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    // Height ruler on the left: the floor is the bottom of the view.
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = d;
    ctx.font = (11 * d) + "px system-ui, sans-serif";
    var step = p.h > 4 ? 1 : 0.5;
    for (var m = 0; m <= p.h + 1e-9; m += step) {
      var py = H * (1 - m / p.h);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(10 * d, py); ctx.stroke();
      if (m > 0) ctx.fillText(m.toFixed(1) + " m", 13 * d, py + 4 * d);
    }
    // Hand skeleton: green while open, orange while closed.
    if (this.hand) {
      var closed = this.ball.gate.closed;
      ctx.strokeStyle = closed ? "rgba(245,165,36,0.9)" : "rgba(78,205,100,0.9)";
      ctx.lineWidth = 2 * d;
      var lm = this.hand.lm;
      BONES.forEach(function(b) {
        ctx.beginPath(); ctx.moveTo(lm[b[0]].x * W, lm[b[0]].y * H); ctx.lineTo(lm[b[1]].x * W, lm[b[1]].y * H); ctx.stroke();
      });
      ctx.beginPath();
      ctx.arc(this.hand.x * W, this.hand.y * H, this.ball.catchR * H, 0, 2 * Math.PI);
      ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
    }
    // Trail of the current fall.
    ctx.fillStyle = "rgba(78,205,196,0.6)";
    this.trail.forEach(function(t) { ctx.beginPath(); ctx.arc(t.x * W, t.y * H, 3 * d, 0, 2 * Math.PI); ctx.fill(); });
    var r = R.ballRadius(dims);
    var bx = this.ball.x * W, by = Math.min(H - r, this.ball.y * H);
    R.drawShadow(ctx, bx, H, r, Math.min(1, this.ball.y));
    R.drawBall(this.ballSkin || R.makeBall(), ctx, bx, by, r);
    if (this.ball.state === "falling") {
      ctx.font = "600 " + (14 * d) + "px system-ui, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText("t = " + this.ball.t.toFixed(2) + " s", bx + r + 8 * d, by);
    }
  },

  readouts: function(p) {
    var b = this.ball;
    $("ro-c-hand").textContent = !this.hand ? "not seen" : b.gate.closed ? "closed ✊" : "open ✋";
    $("ro-c-h").textContent = b.heightM(p).toFixed(2) + " m";
    $("ro-c-t").textContent = b.state === "falling" || b.t > 0 ? b.t.toFixed(3) + " s" : "—";
    var h = b.state === "falling" ? b.h0 : b.heightM(p);
    $("ro-c-theory").textContent = this.mystery() ? "?" : h > 0.01 ? AR.fallTime(h, p.g).toFixed(3) + " s" : "—";
  },

  newMystery: function() {
    var prev = this.mysteryG;
    do { this.mysteryG = MYSTERY[Math.floor(Math.random() * MYSTERY.length)]; } while (this.mysteryG === prev);
    $("catch-reveal").textContent = "Reveal";
  },

  init: function() {
    var self = this;
    restoreSettings(SETTINGS);
    self.newMystery();
    self.ballSkin = R.makeBall(ballStyle($("catch-ball")));
    $("catch-ball").addEventListener("change", function() {
      self.ballSkin = R.makeBall(ballStyle($("catch-ball")));
      remember("ball", self.ballSkin.style);
    });
    SETTINGS.forEach(function(pair) {
      $(pair[0]).addEventListener("change", function() { remember(pair[1], $(pair[0]).value); });
    });
    var showMystery = function() { $("catch-mystery").hidden = !self.mystery(); };
    $("catch-gravity").addEventListener("change", function() {
      if (self.mystery()) self.newMystery();
      self.trials = [];
      self.renderTrials();
      showMystery();
    });
    showMystery();
    $("catch-reveal").addEventListener("click", function() {
      var g = self.mysteryG;
      var name = { 3.7: "Mercury", 8.87: "Venus", 1.62: "the Moon", 3.71: "Mars", 24.79: "Jupiter", 10.44: "Saturn",
        8.69: "Uranus", 11.15: "Neptune", 0.62: "Pluto" }[g] || "an imaginary planet";
      $("catch-reveal").textContent = "g = " + g + " m/s² (" + name + ")";
    });
    $("btn-catch-cam").addEventListener("click", function() { self.start(); });
    $("btn-catch-reset").addEventListener("click", function() {
      self.ball.reset(0.5, 0.35);
      self.trail = [];
      self.status("Ball back in the middle — make a fist on it to catch it.", "");
    });
    $("btn-catch-clear").addEventListener("click", function() { self.trials = []; self.renderTrials(); });
    camera.onChange(function(live) {
      if (self.live && live !== $("catch-video")) self.stop();
    });
    onSpace("mode-catch", function() { $("btn-catch-reset").click(); });
    self.renderTrials();
  }
};

export { Catch };
