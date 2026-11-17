/* Experiment 1 in the app: catch & drop a virtual ball with hand gestures.
 * The camera fills the screen (object-fit: cover), so hand landmarks are
 * mapped from video coordinates into screen coordinates; all game state is
 * in fractions of the visible stage, whose bottom edge is the floor.
 * Physics: core/gesture.js (CatchBall). Drawing and the fit: lab/catchview.js. */
import * as AR from "../core/index.js";
import { loadHandTracker, HandTracker } from "../lab/handtrack.js";
import { Sounds } from "../lab/sounds.js";
import {
  drawCatchScene, plotDrops, summarizeDrops, pickMystery, planetName, inkOf, pointerHand
} from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { startCamera, stopCamera, cameraError } from "./camera.js";
import { makePanels } from "./panels.js";

var R = AR.render;
var MAX_TRIALS = 50;
var NO_HAND_HINT_MS = 2500;
var WORLDS = { "9.81": "Earth", "1.62": "Moon", "3.71": "Mars", "24.79": "Jupiter", "mystery": "Mystery planet" };

export var Catch = {
  ball: new AR.CatchBall(),
  tracker: null,
  source: null,         // "camera" | "touch" while running
  live: false, raf: 0, clock: null,
  hand: null, lastHandAt: 0, hinted: false,
  pointer: { inside: false, down: false, x: 0.5, y: 0.5 },
  trail: [], drop: null, trials: [],
  settings: null,
  mysteryG: null, revealed: false,
  skin: null,

  /* ---------- settings ---------- */
  loadSettings: function() {
    var s = store.get("catch", {});
    this.settings = {
      gravity: WORLDS[s.gravity] ? s.gravity : "9.81",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      ball: R.isBallStyle(s.ball) ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("catch", this.settings); },
  mystery: function() { return this.settings.gravity === "mystery"; },
  params: function() {
    var g = this.mystery() ? this.mysteryG : parseFloat(this.settings.gravity);
    var wrap = $("c-wrap");
    return {
      g: g > 0 ? g : 9.81,
      h: this.settings.view,
      slow: parseFloat(this.settings.slow) || 1,
      aspect: wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3
    };
  },

  status: function(msg, cls) {
    var el = $("c-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("c-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2200);
  },

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    var btn = $("c-cam");
    btn.disabled = true;
    $("c-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    var cam = startCamera($("c-video"), self.settings.back).catch(function(e) {
      throw { camera: true, err: e };
    });
    Promise.all([loadHandTracker(), cam]).then(function(r) {
      self.tracker = new HandTracker(r[0]);
      self.run("camera");
      self.status("Show your open hand ✋, then make a fist ✊ on the ball.", "ok");
    }, function(err) {
      if (err && err.camera && err.err && err.err.name === "AbortError") return;
      var msg = (err && err.camera ? cameraError(err.err) : "The hand tracker couldn't load (check the internet).") +
        " You can use your finger or the mouse instead.";
      stopCamera();
      self.status(msg, "err");
      $("c-start-note").textContent = msg;
    }).then(function() { btn.disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    stopCamera();
    this.run("touch");
    this.status("Press and hold on the ball to catch it, slide up, then let go.", "ok");
  },
  run: function(source) {
    var self = this;
    self.stop();
    self.source = source;
    $("c-start").hidden = true;
    $("c-wrap").classList.toggle("touch-play", source === "touch");
    self.ball.reset(0.5, 0.35);
    self.trail = []; self.drop = null; self.hand = null;
    self.lastHandAt = performance.now(); self.hinted = false;
    self.live = true;
    if (source === "camera") {
      self.clock = new AR.FrameClock($("c-video"));
      self.clock.start();
    }
    keepAwake(true);
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
  },
  stop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    this.clock = null;
    this.source = null;
    $("c-wrap").classList.remove("touch-play", "pressing");
    keepAwake(false);
  },
  /* Back to the start card: camera off, loop stopped. */
  leave: function() {
    this.stop();
    stopCamera();
    $("c-start").hidden = false;
    $("c-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
    this.status("Pick camera or finger to start.", "");
    this.panels.closeSheets();
    this.drawIdle();
  },
  /* ---------- the loop ---------- */
  loop: function(now) {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
    var p = self.params();
    var fresh = false;
    if (self.source === "camera") {
      if (self.clock.next(now)) { self.hand = self.detectHand(now); fresh = true; }
    } else {
      self.hand = pointerHand(self.pointer, self.hand, now);
      fresh = true;
    }
    if (fresh) {
      if (self.hand) { self.lastHandAt = now; self.hinted = false; }
      else if (self.source === "camera" && !self.hinted && now - self.lastHandAt > NO_HAND_HINT_MS &&
               self.ball.state !== "falling") {
        self.hinted = true;
        self.status("I can't see a hand. Step back so your hand is in the picture.", "err");
      }
      var ev = self.ball.update(now, self.hand, p);
      if (ev) self.onEvent(ev);
    }
    var landed = self.ball.tick(now, p);
    if (landed) self.onEvent(landed);
    if (self.ball.state === "falling") self.trail.push({ x: self.ball.x, y: self.ball.y });
    self.draw(p);
    self.readouts(p);
  },

  /* Hand landmarks → stage fractions. The video is scaled to cover the
   * stage (cropped on two sides) and flipped when mirrored. */
  detectHand: function(now) {
    var video = $("c-video");
    var lm = null;
    try { lm = this.tracker.detect(video, now); } catch (e) { lm = null; }
    if (!lm) return null;
    var wrap = $("c-wrap"), SW = wrap.clientWidth, SH = wrap.clientHeight;
    var VW = video.videoWidth, VH = video.videoHeight;
    var k = Math.max(SW / VW, SH / VH), dw = VW * k, dh = VH * k;
    var ox = (dw - SW) / 2, oy = (dh - SH) / 2, flip = this.settings.mirror;
    var shown = lm.map(function(q) {
      var x = flip ? 1 - q.x : q.x;
      return { x: (x * dw - ox) / SW, y: (q.y * dh - oy) / SH };
    });
    var c = AR.palmCenter(shown);
    return { x: c.x, y: c.y, open: AR.handOpenness(lm, VW / VH), lm: shown };
  },

  onEvent: function(ev) {
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.trail = []; this.drop = null;
      this.status("Got it! Lift it up, then open your hand to drop it.", "ok");
    } else if (ev.type === "released") {
      Sounds.release();
      this.trail = [];
      this.drop = { x: this.ball.x, y: this.ball.y, h0: ev.h0 };
      this.status((ev.how === "lost" ? "Your hand left the picture, so the ball slipped " : "Dropped ") +
        "from " + ev.h0.toFixed(2) + " m…", "");
    } else if (ev.type === "caught") {
      Sounds.catchAir();
      this.drop = null;
      this.toast("Great catch! 🙌", "info");
      this.status("Caught after " + ev.t.toFixed(2) + " s, " + ev.fallenM.toFixed(2) +
        " m down. Open your hand to drop it again.", "ok");
    } else if (ev.type === "landed") {
      Sounds.land();
      // Exact fall time: screen frames would add up to a frame (~2%).
      this.addTrial(ev.h0, ev.exactT);
      this.toast(ev.h0.toFixed(2) + " m in " + ev.exactT.toFixed(3) + " s");
      this.status(this.trials.length < 3
        ? "Drop " + this.trials.length + " saved. Pick it up and drop it from a different height."
        : "Drop " + this.trials.length + " saved. Open Results to see your graph.", "ok");
    }
  },

  /* ---------- results ---------- */
  addTrial: function(h, t) {
    if (!(h > 0.05) || !(t > 0)) return;
    this.trials.push({ h: h, t: t, g: 2 * h / (t * t) });
    if (this.trials.length > MAX_TRIALS) this.trials.shift();
    this.renderResults();
  },
  renderResults: function() {
    var rows = $("c-rows");
    rows.textContent = "";
    for (var i = this.trials.length - 1; i >= 0; i--) {
      var tr = this.trials[i], r = document.createElement("tr");
      [String(i + 1), tr.h.toFixed(2), tr.t.toFixed(3), (tr.t * tr.t).toFixed(3), tr.g.toFixed(2)]
        .forEach(function(text) { var td = document.createElement("td"); td.textContent = text; r.appendChild(td); });
      rows.appendChild(r);
    }
    var s = summarizeDrops(this.trials);
    $("c-count").textContent = String(s.n);
    $("c-g-label").textContent = this.mystery() ? "Mystery planet's g" : "Your g";
    if (!s.n) {
      $("c-g").textContent = "—";
      $("c-summary").textContent = "No drops yet. Drop the ball from a few different heights.";
    } else {
      $("c-g").textContent = s.gFit.toFixed(2) + " m/s²";
      var txt = "From the slope of " + s.n + (s.n === 1 ? " drop." : " drops.");
      if (s.n < 3 || s.spread < 0.5) txt += " Tip: drop from low, middle and high to make a good line.";
      else if (!this.mystery()) txt += " " + this.settings.gravity + " m/s² is the real value for " +
        WORLDS[this.settings.gravity] + ".";
      $("c-summary").textContent = txt;
    }
    $("c-mystery").hidden = !this.mystery();
    $("c-reveal").textContent = this.revealed
      ? "It's " + planetName(this.mysteryG) + ": g = " + this.mysteryG + " m/s²" : "Reveal the answer";
    this.plot(s.gFit);
  },
  plot: function(gFit) {
    var cv = $("c-plot");
    if (!cv.getBoundingClientRect().width) return; // panel closed
    plotDrops(cv, this.trials, isFinite(gFit) ? gFit : summarizeDrops(this.trials).gFit, inkOf(cv));
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("c-canvas");
    drawCatchScene(cv.getContext("2d"), R.fitCanvas(cv), {
      p: p, ball: this.ball, hand: this.hand, drop: this.drop, trail: this.trail, skin: this.skin
    });
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(p) {
    var b = this.ball;
    $("c-hand").textContent = !this.hand ? "—" : b.gate.closed ? "✊" : "✋";
    $("c-h").textContent = b.heightM(p).toFixed(2) + " m";
    $("c-t").textContent = b.state === "falling" || b.t > 0 ? b.t.toFixed(3) + " s" : "—";
    var h = b.state === "falling" ? b.h0 : b.heightM(p);
    $("c-theory").textContent = this.mystery() ? "?" : h > 0.01 ? AR.fallTime(h, p.g).toFixed(3) + " s" : "—";
  },
  showWorld: function() {
    var g = this.settings.gravity;
    $("c-world").textContent = this.mystery() ? "Mystery planet · g = ?" : WORLDS[g] + " · g = " + g + " m/s²";
  },

  /* ---------- setup ---------- */
  initSettings: function() {
    var self = this, s = self.settings;
    var seg = function(id, key, after) {
      var group = $(id);
      var mark = function() {
        group.querySelectorAll("button").forEach(function(b) {
          b.setAttribute("aria-checked", b.getAttribute("data-v") === String(s[key]) ? "true" : "false");
        });
      };
      group.addEventListener("click", function(e) {
        var b = e.target.closest("button");
        if (!b) return;
        s[key] = b.getAttribute("data-v");
        mark(); self.saveSettings();
        if (after) after();
      });
      mark();
    };
    seg("c-gravity", "gravity", function() {
      if (self.mystery()) { self.mysteryG = pickMystery(self.mysteryG); self.revealed = false; }
      self.trials = [];          // new world, new table
      self.showWorld();
      self.renderResults();
      self.toast(self.mystery() ? "New mystery planet. Drop to find its g!" : "Now on " + WORLDS[s.gravity], "info");
    });
    seg("c-slow", "slow");
    seg("c-ball", "ball", function() { self.skin = R.makeBall(s.ball); if (!self.live) self.drawIdle(); });

    var view = $("c-view");
    view.value = s.view;
    view.addEventListener("change", function() {
      var v = parseFloat(view.value);
      s.view = v >= 0.3 && v <= 20 ? v : 2;
      view.value = s.view;
      self.saveSettings();
      if (!self.live) self.drawIdle();
    });
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    var applyMirror = function() { $("c-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("c-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("c-sound", "sound", function() {
      Sounds.enabled = s.sound;
      if (s.sound) { Sounds.unlock(); Sounds.grab(); }
    });
    Sounds.enabled = s.sound;
    toggle("c-backcam", "back", function() {
      // The facing camera is mirrored, the back camera isn't.
      s.mirror = !s.back; $("c-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
      var wasLive = self.source === "camera";
      stopCamera();
      if (wasLive) self.startCamera();
    });
  },
  initPointer: function() {
    var self = this, cv = $("c-canvas"), wrap = $("c-wrap");
    var place = function(e) {
      var r = cv.getBoundingClientRect();
      self.pointer.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      self.pointer.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    };
    cv.addEventListener("pointermove", function(e) {
      if (self.source !== "touch") return;
      self.pointer.inside = true; place(e);
    });
    cv.addEventListener("pointerdown", function(e) {
      if (self.source !== "touch") return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      self.pointer.inside = true; self.pointer.down = true; place(e);
      wrap.classList.add("pressing");
    });
    var up = function(e) {
      if (self.source !== "touch") return;
      if (self.pointer.down) self.pointer.upAt = performance.now();
      self.pointer.down = false;
      wrap.classList.remove("pressing");
      if (e.pointerType !== "mouse") self.pointer.inside = false; // a lifted finger is gone
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", function() { if (!self.pointer.down) self.pointer.inside = false; });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.mysteryG = pickMystery(null);
    self.skin = R.makeBall(self.settings.ball);
    self.initSettings();
    self.initPointer();
    self.showWorld();

    $("c-cam").addEventListener("click", function() { self.startCamera(); });
    $("c-touch").addEventListener("click", function() { self.startTouch(); });
    $("c-reset").addEventListener("click", function() {
      self.ball.reset(0.5, 0.35);
      self.trail = []; self.drop = null;
      if (!self.live) self.drawIdle();
      self.status("Ball is back in the middle.", "");
    });
    $("c-clear").addEventListener("click", function() { self.trials = []; self.renderResults(); });
    $("c-reveal").addEventListener("click", function() { self.revealed = true; self.renderResults(); });
    self.panels = makePanels($("screen-catch"), "catch", function() { self.renderResults(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-catch").hidden) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (e.code !== "Space" || tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("c-reset").click();
    });
    window.addEventListener("resize", function() {
      if (!self.live && !$("screen-catch").hidden) self.drawIdle();
      self.plot(NaN);
    });
    self.renderResults();
  },
  /* Called when the screen is shown. */
  enter: function() {
    var self = this;
    requestAnimationFrame(function() { self.drawIdle(); self.renderResults(); });
  }
};
