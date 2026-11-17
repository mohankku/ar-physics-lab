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
import { drawCatchScene, plotDrops, fitDropsG, pickMystery, planetName, inkOf, pointerHand, BOUNCE } from "../catchview.js";

var R = AR.render;
var SETTINGS = [["catch-view", "catch-view"], ["catch-gravity", "catch-g"], ["catch-slow", "catch-slow"]];
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
      e: BOUNCE[(this.ballSkin || {}).style] || 0,
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
      self.hand = pointerHand(self.pointer, self.hand, now);
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
    } else if (ev.type === "bounce") {
      Sounds.bounce(ev.speed / 4);
    } else if (ev.type === "landed") {
      Sounds.land();
      if (ev.bounceHeight > 0.01) Sounds.bounce(1);
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
  fitG: function() { return fitDropsG(this.trials); },
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
    plotDrops(cv, this.trials, gFit, inkOf(cv));
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("catch-overlay");
    drawCatchScene(cv.getContext("2d"), R.fitCanvas(cv), {
      p: p, ball: this.ball, hand: this.hand, drop: this.drop, trail: this.trail, skin: this.ballSkin
    });
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
    this.mysteryG = pickMystery(this.mysteryG);
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
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      self.pointer.inside = true; self.pointer.down = true; place(e);
    });
    var up = function(e) {
      if (self.source !== "pointer") return;
      if (self.pointer.down) self.pointer.upAt = performance.now();
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
      $("catch-reveal").textContent = "g = " + g + " m/s² (" + planetName(g) + ")";
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

export { Catch };
