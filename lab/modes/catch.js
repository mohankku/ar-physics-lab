/* Exp 01, first tab — catch & drop a virtual ball with hand gestures.
 * MediaPipe finds the hand; a fist on the ball catches it, opening the hand
 * lets go, and it falls from that height at the chosen g (core CatchBall).
 * Every landing's fall time goes into a table and a t²-vs-h graph that
 * work out g, so a "mystery planet" can be discovered.
 * No camera (or no hand tracker)? Play with the mouse or a finger: press
 * and hold = fist. Everything on screen is in display coordinates; with
 * Mirror on, the camera image and the hand are flipped left-right. */
import * as AR from "../../core/index.js";
import { $, setStatus, numberIn, onSpace, remember, recall, restoreSettings, ballStyle, camera, openCamera } from "../ui.js";
import { loadHandTracker, HandTracker } from "../handtrack.js";
import { Sounds } from "../sounds.js";
import { LabLog } from "../lablog.js";

var R = AR.render;
var SETTINGS = [["catch-view", "catch-view"], ["catch-gravity", "catch-g"], ["catch-slow", "catch-slow"]];
var BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
var MYSTERY = [3.7, 8.87, 1.62, 3.71, 24.79, 10.44, 8.69, 11.15, 0.62, 2.3, 15.2, 6.1]; // incl. made-up worlds
var PLANETS = { 3.7: "Mercury", 8.87: "Venus", 1.62: "the Moon", 3.71: "Mars", 24.79: "Jupiter",
  10.44: "Saturn", 8.69: "Uranus", 11.15: "Neptune", 0.62: "Pluto" };
var MAX_TRIALS = 50;

var Catch = {
  ball: new AR.CatchBall(),
  tracker: null,       // HandTracker once loaded
  source: null,        // "camera" | "pointer" while running
  live: false, raf: 0, clock: null,
  hand: null,          // last {x, y, open, lm (display coords) | null}
  pointer: { inside: false, down: false, x: 0.5, y: 0.5 },
  trail: [],
  drop: null,          // {x, y, h0} of the last release, for the height marker
  trials: [],
  mysteryG: null,

  status: function(msg, cls) { setStatus($("catch-status"), msg, cls); },
  mirrored: function() { return $("catch-mirror").checked; },
  aspect: function() {
    var v = $("catch-video");
    if (this.source === "camera" && v.videoWidth && v.videoHeight) return v.videoWidth / v.videoHeight;
    var r = $("catch-stage").getBoundingClientRect();
    return r.width && r.height ? r.width / r.height : 4 / 3;
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

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    self.status("Loading hand tracking… (about 18 MB the first time, then it's saved)", "");
    $("btn-catch-cam").disabled = true;
    Promise.all([
      loadHandTracker(),
      openCamera($("catch-video"), $("catch-status"))
    ]).then(function(r) {
      self.tracker = new HandTracker(r[0]);
      self.run("camera");
      self.status("Show your open hand ✋, then make a fist ✊ on the ball to catch it.", "ok");
    }, function(err) {
      if (err && err.name === "AbortError") return;
      if (!camera.liveVideo()) return; // openCamera already explained the camera problem
      self.status("Hand tracking couldn't load (" + (err && err.message || err) +
        "). Check the internet connection, or press Use mouse / touch.", "err");
    }).then(function() { $("btn-catch-cam").disabled = false; });
  },
  startPointer: function() {
    Sounds.unlock();
    if (camera.liveVideo() === $("catch-video")) camera.stopAll();
    this.run("pointer");
    this.status("Mouse / touch: press and hold on the ball to catch it, move up, let go to drop it.", "ok");
  },
  run: function(source) {
    var self = this;
    self.stop();
    self.source = source;
    $("catch-stage").classList.toggle("pointer-play", source === "pointer");
    R.fitCanvas($("catch-overlay"));
    self.ball.reset(0.5, 0.35);
    self.trail = [];
    self.drop = null;
    self.hand = null;
    self.live = true;
    if (source === "camera") {
      self.clock = new AR.FrameClock($("catch-video"));
      self.clock.start();
    }
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
  },
  stop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    this.clock = null;
    this.source = null;
    $("catch-stage").classList.remove("pointer-play");
    var cv = $("catch-overlay");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* ---------- the loop ---------- */
  loop: function(now) {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
    var p = self.params();
    var fresh = false;
    if (self.source === "camera") {
      if (self.clock.next(now)) { self.hand = self.detectHand(now, p); fresh = true; }
    } else {
      var pt = self.pointer;
      self.hand = pt.inside || pt.down ? { x: pt.x, y: pt.y, open: pt.down ? 0 : 1, lm: null } : null;
      fresh = true;
    }
    if (fresh) {
      var ev = self.ball.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p);
    }
    var landed = self.ball.tick(now, p);
    if (landed) self.onEvent(landed, p);
    if (self.ball.state === "falling") self.trail.push({ x: self.ball.x, y: self.ball.y });
    self.draw(p);
    self.readouts(p);
  },
  /* Hand in display coordinates (flipped when mirrored), or null. */
  detectHand: function(now, p) {
    var lm = null;
    try { lm = this.tracker.detect($("catch-video"), now); } catch (e) { lm = null; }
    if (!lm) return null;
    var flip = this.mirrored();
    var shown = lm.map(function(q) { return { x: flip ? 1 - q.x : q.x, y: q.y }; });
    var c = AR.palmCenter(shown);
    return { x: c.x, y: c.y, open: AR.handOpenness(lm, p.aspect), lm: shown };
  },

  onEvent: function(ev, p) {
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.trail = [];
      this.drop = null;
      this.status("Caught! Raise it up, then open your hand to drop it.", "ok");
    } else if (ev.type === "released") {
      Sounds.release();
      this.trail = [];
      this.drop = { x: this.ball.x, y: this.ball.y, h0: ev.h0 };
      this.status((ev.how === "lost" ? "Hand lost — the ball slipped " : "Dropped ") + "from " +
        ev.h0.toFixed(2) + " m…", "");
    } else if (ev.type === "caught") {
      Sounds.catchAir();
      this.drop = null;
      this.status("Great catch! Caught after " + ev.t.toFixed(3) + " s, " + ev.fallenM.toFixed(2) +
        " m down. Open your hand to drop it again.", "ok");
    } else if (ev.type === "landed") {
      Sounds.land();
      // The exact fall time: screen frames would add up to a frame (~2%),
      // which reads as "g is wrong" rather than teaching anything.
      this.addTrial(ev.h0, ev.exactT);
      this.status("Landed: fell " + ev.h0.toFixed(2) + " m in " + ev.exactT.toFixed(3) + " s" +
        (this.mystery() ? "" : ", just as √(2h/g) predicts") +
        ". Make a fist on it to pick it up again.", "ok");
    }
  },

  /* ---------- results ---------- */
  addTrial: function(h, t) {
    if (!(h > 0.05) || !(t > 0)) return;
    this.trials.push({ h: h, t: t, g: 2 * h / (t * t) });
    if (this.trials.length > MAX_TRIALS) this.trials.shift();
    this.renderTrials();
  },
  /* g from the slope of t² vs h through the origin (t² = (2/g)·h). */
  fitG: function() {
    var shh = 0, sht = 0;
    this.trials.forEach(function(tr) { shh += tr.h * tr.h; sht += tr.h * tr.t * tr.t; });
    return sht > 0 ? 2 * shh / sht : NaN;
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
    var gs = this.trials.map(function(tr) { return tr.g; });
    var gFit = this.fitG();
    if (!this.trials.length) {
      stats.textContent = "No drops yet. Drop the ball from a few different heights.";
    } else {
      var spread = this.trials.length > 1
        ? Math.max.apply(null, this.trials.map(function(t) { return t.h; })) -
          Math.min.apply(null, this.trials.map(function(t) { return t.h; })) : 0;
      stats.textContent = this.trials.length + " drop(s). Average g = " + AR.mean(gs).toFixed(2) +
        (gs.length > 1 ? " ± " + AR.std(gs).toFixed(2) : "") + " m/s²; from the graph's slope: " +
        gFit.toFixed(2) + " m/s²." +
        (this.trials.length < 3 || spread < 0.5 ? " Tip: drop from low, middle and high to make a good line." : "") +
        (this.mystery() ? " Which planet could it be?" : "");
    }
    LabLog.catchDrops = this.trials.length ? {
      n: this.trials.length, gMean: AR.mean(gs), gStd: AR.std(gs), gFit: gFit,
      heights: this.trials.map(function(t) { return t.h; }), mystery: this.mystery(),
      trueG: this.mystery() ? null : this.params().g
    } : null;
    this.plot(gFit);
  },
  plot: function(gFit) {
    var cv = $("catch-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr;
    ctx.clearRect(0, 0, dims.w, dims.h);
    var ink = inkOf(cv);
    var pts = this.trials;
    var hMax = Math.max(0.5, Math.max.apply(null, pts.map(function(t) { return t.h; }).concat([0])) * 1.1);
    var t2Max = Math.max(0.05, Math.max.apply(null, pts.map(function(t) { return t.t * t.t; }).concat([0])) * 1.15);
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, hMax], [0, t2Max],
      ["drop height h (m)", "t² (s²)"], ink);
    if (pts.length && isFinite(gFit)) {
      ctx.strokeStyle = "#1a56db";
      ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.moveTo(A.X(0), A.Y(0)); ctx.lineTo(A.X(hMax), A.Y(2 * hMax / gFit)); ctx.stroke();
      ctx.fillStyle = "#1a56db";
      ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
      ctx.fillText("slope = 2/g → g ≈ " + gFit.toFixed(2) + " m/s²", A.X(hMax * 0.04), A.Y(t2Max * 0.86));
    }
    ctx.fillStyle = "#e5484d";
    pts.forEach(function(t) {
      ctx.beginPath(); ctx.arc(A.X(t.h), A.Y(t.t * t.t), 3.5 * d, 0, 2 * Math.PI); ctx.fill();
    });
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("catch-overlay");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    // Height ruler: the floor is the bottom of the view.
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
    // Drop-height marker: from the release point down to the floor.
    if (this.drop && this.ball.state !== "held") {
      var x = this.drop.x * W, y0 = this.drop.y * H;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.setLineDash([5 * d, 5 * d]);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x - 8 * d, y0); ctx.lineTo(x + 8 * d, y0); ctx.stroke();
      label(ctx, d, "h = " + this.drop.h0.toFixed(2) + " m", x - 12 * d, (y0 + H) / 2, "right");
    }
    // The hand: skeleton from the camera, or a ring for the pointer.
    var closed = this.ball.gate.closed;
    if (this.hand) {
      ctx.strokeStyle = closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
      ctx.lineWidth = 2 * d;
      var lm = this.hand.lm;
      if (lm) {
        BONES.forEach(function(b) {
          ctx.beginPath(); ctx.moveTo(lm[b[0]].x * W, lm[b[0]].y * H); ctx.lineTo(lm[b[1]].x * W, lm[b[1]].y * H); ctx.stroke();
        });
      }
      ctx.beginPath();
      ctx.arc(this.hand.x * W, this.hand.y * H, this.ball.catchR * H, 0, 2 * Math.PI);
      ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
      if (!lm) label(ctx, d, closed ? "✊" : "✋", this.hand.x * W, this.hand.y * H + 5 * d, "center", 18);
    }
    // Trail of the current fall, then the ball.
    ctx.fillStyle = "rgba(78,205,196,0.6)";
    this.trail.forEach(function(t) { ctx.beginPath(); ctx.arc(t.x * W, t.y * H, 3 * d, 0, 2 * Math.PI); ctx.fill(); });
    var r = R.ballRadius(dims);
    var bx = this.ball.x * W, by = Math.min(H - r, this.ball.y * H);
    R.drawShadow(ctx, bx, H, r, Math.min(1, this.ball.y));
    R.drawBall(this.ballSkin || R.makeBall(), ctx, bx, by, r);
    if (this.ball.state === "falling") label(ctx, d, "t = " + this.ball.t.toFixed(2) + " s", bx + r + 8 * d, by, "left", 14);
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

  /* ---------- setup ---------- */
  initPointer: function() {
    var self = this, stage = $("catch-stage");
    var place = function(e) {
      var r = stage.getBoundingClientRect();
      self.pointer.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      self.pointer.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    };
    stage.addEventListener("pointermove", function(e) {
      if (self.source !== "pointer") return;
      self.pointer.inside = true; place(e);
    });
    stage.addEventListener("pointerdown", function(e) {
      if (self.source !== "pointer") return;
      e.preventDefault();
      if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId);
      self.pointer.inside = true; self.pointer.down = true; place(e);
    });
    var up = function(e) {
      if (self.source !== "pointer") return;
      self.pointer.down = false;
      if (e.pointerType !== "mouse") self.pointer.inside = false; // a lifted finger is gone
    };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("pointerleave", function() { if (!self.pointer.down) self.pointer.inside = false; });
  },
  init: function() {
    var self = this;
    restoreSettings(SETTINGS);
    var mirror = recall("catch-mirror");
    $("catch-mirror").checked = mirror === null ? true : mirror === "1";
    var applyMirror = function() { $("catch-stage").classList.toggle("mirrored", self.mirrored()); };
    applyMirror();
    $("catch-mirror").addEventListener("change", function() {
      remember("catch-mirror", self.mirrored() ? "1" : "0");
      applyMirror();
    });
    var sound = recall("catch-sound");
    $("catch-sound").checked = sound === null ? true : sound === "1";
    Sounds.enabled = $("catch-sound").checked;
    $("catch-sound").addEventListener("change", function() {
      Sounds.enabled = $("catch-sound").checked;
      remember("catch-sound", Sounds.enabled ? "1" : "0");
      if (Sounds.enabled) { Sounds.unlock(); Sounds.grab(); }
    });
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
      $("catch-reveal").textContent = "g = " + g + " m/s² (" + (PLANETS[g] || "an imaginary planet") + ")";
    });
    $("btn-catch-cam").addEventListener("click", function() { self.startCamera(); });
    $("btn-catch-pointer").addEventListener("click", function() { self.startPointer(); });
    $("btn-catch-reset").addEventListener("click", function() {
      self.ball.reset(0.5, 0.35);
      self.trail = [];
      self.drop = null;
      self.status("Ball back in the middle — make a fist on it to catch it.", "");
    });
    $("btn-catch-clear").addEventListener("click", function() { self.trials = []; self.renderTrials(); });
    camera.onChange(function(live) {
      if (self.live && self.source === "camera" && live !== $("catch-video")) self.stop();
    });
    self.initPointer();
    onSpace("mode-catch", function() { $("btn-catch-reset").click(); });
    window.addEventListener("resize", function() { self.plot(self.fitG()); });
    self.renderTrials();
  }
};

/* Text with a dark outline, readable over any video. */
function label(ctx, d, text, x, y, align, size) {
  ctx.font = "600 " + ((size || 12) * d) + "px system-ui, sans-serif";
  ctx.textAlign = align || "left";
  ctx.lineWidth = 3 * d;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
  ctx.textAlign = "start";
}

/* The canvas's text color as "r,g,b", so charts follow the page theme. */
function inkOf(el) {
  var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color || "");
  return m ? m[1] + "," + m[2] + "," + m[3] : "0,0,0";
}

export { Catch };
