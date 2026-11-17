/* Experiment 1 in the app: catch & drop a virtual ball with hand gestures.
 * The camera fills the screen (object-fit: cover), so hand landmarks are
 * mapped from video coordinates into screen coordinates; all game state is
 * in fractions of the visible stage, whose bottom edge is the floor.
 * Physics: core/gesture.js (CatchBall). Drawing and the fit: lab/catchview.js. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import {
  drawCatchScene, plotDrops, summarizeDrops, inkOf
} from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makeHandInput } from "./handinput.js";
import { makeWorld } from "./worlds.js";
import { makePanels } from "./panels.js";
import { Place } from "./place.js";

var R = AR.render;
var MAX_TRIALS = 50;

export var Catch = {
  ball: new AR.CatchBall(),
  input: null,          // hand from the camera or a finger (handinput.js)
  world: null,          // Earth / Moon / … / mystery (worlds.js)
  live: false, raf: 0,
  hand: null,
  trail: [], drop: null, trials: [],
  settings: null,
  skin: null,

  /* ---------- settings ---------- */
  loadSettings: function() {
    var s = store.get("catch", {});
    this.settings = {
      gravity: s.gravity === "9.81" ? "earth" : s.gravity || "earth",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      ball: R.isBallStyle(s.ball) ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("catch", this.settings); },
  mystery: function() { return this.world.mystery(); },
  params: function() {
    var g = this.world.g();
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
    self.input.startCamera().then(function() {
      self.run();
      self.status("Show your open hand ✋, then make a fist ✊ on the ball.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("c-start-note").textContent = err.message;
    }).then(function() { btn.disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press and hold on the ball to catch it, slide up, then let go.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("c-start").hidden = true;
    self.ball.reset(0.5, 0.35);
    self.trail = []; self.drop = null; self.hand = null;
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
  /* Back to the start card: camera off, loop stopped. */
  leave: function() {
    this.stop();
    this.input.close();
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
    var r = self.input.read(now);
    self.hand = r.hand;
    if (r.fresh) {
      var ev = self.ball.update(now, self.hand, p);
      if (ev) self.onEvent(ev);
    }
    var landed = self.ball.tick(now, p);
    if (landed) self.onEvent(landed);
    if (self.ball.state === "falling") self.trail.push({ x: self.ball.x, y: self.ball.y });
    self.draw(p);
    self.readouts(p);
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
      // Earth's g only differs from place to place in the third decimal.
      $("c-g").textContent = s.gFit.toFixed(this.world.digits()) + " m/s²";
      var txt = "From the slope of " + s.n + (s.n === 1 ? " drop." : " drops.");
      if (s.n < 3 || s.spread < 0.5) txt += " Tip: drop from low, middle and high to make a good line.";
      else if (this.world.key === "earth" && !Place.get())
        txt += " Earth's g is about 9.81 m/s². Set your location in Settings for the exact value where you are.";
      else txt += this.world.compare();
      $("c-summary").textContent = txt;
    }
    $("c-mystery").hidden = !this.mystery();
    $("c-reveal").textContent = this.world.revealText();
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
    $("c-world").textContent = this.world.label();
    $("c-earth-g").textContent = Place.gText();
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
      self.world.set(s.gravity);
      self.trials = [];          // new world, new table
      self.showWorld();
      self.renderResults();
      self.toast(self.mystery() ? "New mystery planet. Drop to find its g!" : "Now on " + self.world.name(), "info");
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
      var wasLive = self.input.source === "camera";
      self.input.close();
      if (wasLive) self.startCamera();
    });
  },
  /* "Where are you?" in Settings: Earth's g depends on the place. */
  initPlace: function() {
    var self = this;
    var chip = $("c-place-chip");
    var show = function() {
      var p = Place.get();
      chip.textContent = p ? "📍 Gravity here: " + Place.gText() + " m/s² (" + Place.describe() + ")"
        : "📍 Use my location for exact gravity";
      chip.classList.toggle("set", !!p);
      $("c-lat").value = p ? p.lat : "";
      $("c-alt").value = p && p.alt ? p.alt : "";
      $("c-place").textContent = p
        ? "Earth's g at " + Place.describe() + ": " + Place.gText() + " m/s²."
        : "Not set: Earth's g is taken as 9.81 m/s². It's 9.780 at the equator and 9.832 at the poles.";
    };
    var typed = function() {
      var lat = parseFloat($("c-lat").value), alt = parseFloat($("c-alt").value);
      if (!(lat >= -90 && lat <= 90)) { show(); return; }
      Place.set({ lat: lat, alt: alt >= -500 && alt <= 9000 ? alt : 0, source: "typed" });
    };
    $("c-lat").addEventListener("change", typed);
    $("c-alt").addEventListener("change", typed);
    var locate = function() {
      $("c-locate").disabled = chip.disabled = true;
      $("c-place").textContent = chip.textContent = "📍 Finding where you are…";
      Place.locate().then(show, function(err) {
        show();
        $("c-place").textContent = err.message;
        chip.textContent = "📍 " + err.message;
      }).then(function() { $("c-locate").disabled = chip.disabled = false; });
    };
    $("c-locate").addEventListener("click", locate);
    chip.addEventListener("click", locate);
    Place.onChange(function() {
      show();
      self.showWorld();
      if (self.world.key !== "earth") return;
      self.trials = [];           // drops made with the old g don't belong in the new table
      self.renderResults();
      self.toast("Gravity here: " + Place.gText() + " m/s²", "info");
    });
    show();
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.world = makeWorld(self.settings.gravity);
    self.settings.gravity = self.world.key;
    self.skin = R.makeBall(self.settings.ball);
    self.input = makeHandInput({ wrap: $("c-wrap"), video: $("c-video"), canvas: $("c-canvas") }, {
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      quiet: function() { return self.ball.state === "falling"; },
      handBack: function() {
        self.status(self.ball.state === "held" ? "Got it! Lift it up, then open your hand to drop it."
          : "I see your hand ✋. Make a fist ✊ on the ball to catch it.", "ok");
      }
    });
    self.initSettings();
    self.showWorld();
    self.initPlace();

    $("c-cam").addEventListener("click", function() { self.startCamera(); });
    $("c-touch").addEventListener("click", function() { self.startTouch(); });
    $("c-reset").addEventListener("click", function() {
      self.ball.reset(0.5, 0.35);
      self.trail = []; self.drop = null;
      if (!self.live) self.drawIdle();
      self.status("Ball is back in the middle.", "");
    });
    $("c-clear").addEventListener("click", function() { self.trials = []; self.renderResults(); });
    $("c-reveal").addEventListener("click", function() { self.world.reveal(); self.renderResults(); });
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
    Place.refreshIfAllowed();
    requestAnimationFrame(function() { self.drawIdle(); self.renderResults(); });
  }
};
