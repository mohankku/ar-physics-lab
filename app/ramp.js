/* Experiment 4 in the app: Galileo's ramp. A ramp is hinged at the bottom
 * right; make a fist on its raised end and move your hand to tilt it, then
 * open your hand: the ball sets off from the top (core RampBall). Dots mark
 * where it is every 0.1 s, and their gaps grow 1 : 3 : 5 : 7, so distance
 * grows with time²: on a graph of distance against t² the runs are straight
 * lines, and their slope gives the acceleration. A rolling ball gets 5/7 of
 * g·sinθ (some of the push goes into spinning); on ice it skids and slides
 * instead; carpet can hold it still on a gentle slope. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { BONES, label, inkOf } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makePanels } from "./panels.js";
import { makeHandInput } from "./handinput.js";
import { makeWorld } from "./worlds.js";
import { Place } from "./place.js";

var R = AR.render;
var MAX_RUNS = 40;
var DOT_S = 0.1;           // a dot every 0.1 s of rolling
var HINGE = { x: 0.88, y: 0.9 };
var SURFACE_LOOK = {
  ice: { name: "ice", icon: "🧊", top: "#d9f1ff", side: "#8cc8ea" },
  wood: { name: "wood", icon: "🪵", top: "#c48a52", side: "#7a4f27" },
  carpet: { name: "carpet", icon: "🧶", top: "#b4466a", side: "#6e2340" }
};

export var Ramp = {
  ramp: new AR.RampBall({ hinge: HINGE }),
  input: null, world: null, panels: null,
  live: false, raf: 0,
  hand: null,
  runs: [],
  last: null,            // last finished run, for the graphs
  settings: null, skin: null,

  loadSettings: function() {
    var s = store.get("ramp", {});
    this.settings = {
      gravity: s.gravity && s.gravity !== "mystery" ? s.gravity : "earth",
      surface: SURFACE_LOOK[s.surface] ? s.surface : "wood",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      ball: R.isBallStyle(s.ball) ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("ramp", this.settings); },
  params: function() {
    var wrap = $("r-wrap");
    return {
      g: this.world.g(),
      h: this.settings.view,
      slow: parseFloat(this.settings.slow) || 1,
      surface: AR.SURFACES[this.settings.surface],
      aspect: wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3
    };
  },
  status: function(msg, cls) {
    var el = $("r-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("r-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2400);
  },

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    $("r-cam").disabled = true;
    $("r-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    self.input.startCamera().then(function() {
      self.run();
      self.status("Make a fist ✊ on the top of the ramp, tilt it, and open your hand to let the ball go.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("r-start-note").textContent = err.message;
    }).then(function() { $("r-cam").disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press on the top of the ramp, drag to tilt it, and let go to release the ball.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("r-start").hidden = true;
    self.ramp.reset();
    self.hand = null;
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
    $("r-start").hidden = false;
    $("r-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
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
      var ev = self.ramp.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p);
    }
    var done = self.ramp.tick(now, p);
    if (done) self.onDone(done, p);
    self.draw(p);
    self.readouts(p);
  },
  onEvent: function(ev, p) {
    var look = SURFACE_LOOK[this.settings.surface];
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.status("Got it! Move your hand up or down to tilt the ramp, then open it to let the ball go.", "ok");
    } else if (ev.type === "released") {
      Sounds.release();
      this.status("Rolling down " + Math.round(ev.angleDeg) + "° of " + look.name + "…" +
        (ev.rolls ? "" : " On " + look.name + " it's too slippery to roll: it slides!"), "");
    } else if (ev.type === "stuck") {
      Sounds.land(0.3);
      this.status("It won't move: " + Math.round(ev.angleDeg) + "° is too gentle for " + look.name +
        ". Tilt it a little steeper until it just starts. That angle shows how much " + look.name + " holds on.", "err");
    }
  },
  onDone: function(ev, p) {
    Sounds.land(0.6);
    var look = SURFACE_LOOK[this.settings.surface];
    var gs = p.g * Math.sin(ev.angleDeg * Math.PI / 180);       // a frictionless slide
    var run = { angle: ev.angleDeg, surface: this.settings.surface, t: ev.t, d: ev.d, a: ev.a, rolls: ev.rolls,
      share: ev.a / gs, g: p.g };
    this.runs.push(run);
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    this.last = run;
    this.toast(ev.d.toFixed(2) + " m in " + ev.t.toFixed(2) + " s");
    this.status(ev.d.toFixed(2) + " m in " + ev.t.toFixed(2) + " s: it sped up by " + ev.a.toFixed(2) +
      " m/s every second. " + (ev.rolls
        ? "That's " + Math.round(run.share * 100) + "% of a slide with no friction, because a rolling ball spends some of the push on spinning."
        : "It slid instead of rolling, so it got " + Math.round(run.share * 100) + "% of a slide with no friction.") +
      " Try steeper, or another surface!", "ok");
    this.renderResults();
  },

  /* ---------- results ---------- */
  renderResults: function() {
    var rows = $("r-rows");
    rows.textContent = "";
    for (var i = this.runs.length - 1; i >= 0; i--) {
      var run = this.runs[i], tr = document.createElement("tr");
      [String(i + 1), Math.round(run.angle) + "°", SURFACE_LOOK[run.surface].icon + (run.rolls ? "" : " slid"),
        run.t.toFixed(2), run.a.toFixed(2)].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    var n = this.runs.length, last = this.last;
    $("r-count").textContent = String(n);
    if (!last) {
      $("r-a").textContent = "—";
      $("r-summary").textContent = "No runs yet. Tilt the ramp and let the ball go.";
    } else {
      $("r-a").textContent = last.a.toFixed(2) + " m/s²";
      var steeper = this.runs.some(function(r) { return r.angle > last.angle + 5; });
      $("r-summary").textContent = "At " + Math.round(last.angle) + "° on " + SURFACE_LOOK[last.surface].name +
        ", " + Math.round(last.share * 100) + "% of g·sinθ = " + (last.g * Math.sin(last.angle * Math.PI / 180)).toFixed(2) + " m/s². " +
        (n < 3 ? "Tilt it steeper: the closer to straight down, the closer it gets to falling freely (g = " + last.g.toFixed(2) + ")."
          : steeper ? "Steeper ramps speed it up more, toward free fall." : "Try a steeper ramp, and ice or carpet.");
    }
    $("r-plot-wrap").hidden = !last;
    $("r-angle-wrap").hidden = n < 2;
    if (!this.panels || !this.panels.resultsVisible()) return;
    if (last) this.plotDistance(last);
    if (n >= 2) this.plotAngles();
  },
  /* Last run: distance against time², a straight line of slope a/2. */
  plotDistance: function(run) {
    var cv = $("r-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var t2 = run.t * run.t;
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, t2 * 1.1], [0, run.d * 1.15],
      ["t² (s²)", "distance (m)"], ink);
    ctx.strokeStyle = "#1a56db"; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(A.X(0), A.Y(0)); ctx.lineTo(A.X(t2), A.Y(run.d)); ctx.stroke();
    ctx.fillStyle = "#e5484d";
    for (var t = DOT_S; t < run.t; t += DOT_S) {
      ctx.beginPath(); ctx.arc(A.X(t * t), A.Y(0.5 * run.a * t * t), 3.5 * d, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(A.X(t2), A.Y(run.d), 3.5 * d, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "#3b6fe0";
    ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
    ctx.fillText("slope = a/2 → a = " + run.a.toFixed(2) + " m/s²", A.X(t2 * 0.04), A.Y(run.d * 1.02));
  },
  /* Every run: acceleration against the ramp's angle, with a frictionless
   * slide (g·sinθ) and a perfect roll (5/7 of it) for comparison. */
  plotAngles: function() {
    var cv = $("r-angle-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var g = this.world.g();
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, 90], [0, g * 1.08],
      ["ramp angle (°)", "a (m/s²)"], ink);
    var curve = function(k, dash, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 2 * d; ctx.setLineDash(dash);
      ctx.beginPath();
      for (var a = 0; a <= 90; a += 2) {
        var y = k * g * Math.sin(a * Math.PI / 180);
        if (a === 0) ctx.moveTo(A.X(a), A.Y(y)); else ctx.lineTo(A.X(a), A.Y(y));
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    curve(1, [6 * d, 4 * d], "rgba(" + ink + ",0.45)");
    curve(5 / 7, [], "#1a56db");
    ctx.font = "600 " + (10 * d) + "px system-ui, sans-serif";
    ctx.fillStyle = "rgba(" + ink + ",0.7)"; ctx.fillText("slide, no friction", A.X(52), A.Y(g * 0.97));
    ctx.fillStyle = "#3b6fe0"; ctx.fillText("rolling", A.X(60), A.Y(g * 0.55));
    this.runs.forEach(function(r) {
      ctx.fillStyle = SURFACE_LOOK[r.surface].side;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = d;
      ctx.beginPath(); ctx.arc(A.X(r.angle), A.Y(r.a), 4.5 * d, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    });
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("r-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    var rp = this.ramp, look = SURFACE_LOOK[this.settings.surface];
    var th = rp.angleDeg * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var P = function(q) { return { x: q.x * W, y: q.y * H }; };
    var hinge = P(rp.hinge), top = P(rp.top(p));
    var nx = sin, ny = -cos;                 // "up" off the ramp's surface, in pixels
    var thick = 12 * d;
    // Floor, and the leg holding the raised end.
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(0, hinge.y); ctx.lineTo(W, hinge.y); ctx.stroke();
    ctx.strokeStyle = "rgba(200,206,220,0.8)"; ctx.lineWidth = 4 * d;
    ctx.beginPath(); ctx.moveTo(top.x, top.y + thick); ctx.lineTo(top.x, hinge.y); ctx.stroke();
    // The plank, in the surface's colors.
    ctx.fillStyle = look.side;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y); ctx.lineTo(hinge.x, hinge.y);
    ctx.lineTo(hinge.x - nx * thick, hinge.y - ny * thick); ctx.lineTo(top.x - nx * thick, top.y - ny * thick);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = look.top; ctx.lineWidth = 4 * d;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(hinge.x, hinge.y); ctx.stroke();
    // Stop at the bottom.
    ctx.fillStyle = "rgba(230,230,230,0.9)";
    var stop = P(rp.along(rp.lengthM(p) - 0.02, p));
    ctx.fillRect(stop.x - 3 * d, stop.y - 22 * d, 6 * d, 22 * d);
    // Meter marks along the ramp, from the ball's start.
    var ppm = H / p.h;                        // pixels per meter (same both ways)
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = d;
    for (var m = 0.25; m <= rp.runM(p) + 1e-9; m += 0.25) {
      var q = P(rp.along(0.05 + m, p)), big = Math.abs(m * 2 - Math.round(m * 2)) < 1e-9;
      ctx.beginPath(); ctx.moveTo(q.x - nx * thick, q.y - ny * thick);
      ctx.lineTo(q.x - nx * (thick + (big ? 10 : 5) * d), q.y - ny * (thick + (big ? 10 : 5) * d)); ctx.stroke();
      if (big) label(ctx, d, m.toFixed(1) + " m", q.x - nx * (thick + 22 * d), q.y - ny * (thick + 22 * d) + 4 * d, "center", 11);
    }
    // Angle at the hinge.
    var arcR = 46 * d;
    ctx.strokeStyle = "rgba(245,165,36,0.95)"; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.arc(hinge.x, hinge.y, arcR, Math.PI, Math.PI + th); ctx.stroke();
    label(ctx, d, Math.round(rp.angleDeg) + "°", hinge.x - arcR - 8 * d, hinge.y - 8 * d, "right", 16);
    // Where the ball was every 0.1 s, and how the gaps grow (1, 3, 5, 7…).
    var r = Math.max(R.ballRadius(dims), 0.03 * Math.min(W, H));
    if ((rp.state === "rolling" || rp.state === "done") && rp.a > 0) {
      var k = 0;
      for (var t = DOT_S; t <= rp.t + 1e-9; t += DOT_S) {
        k++;
        var s = 0.5 * rp.a * t * t;
        if (s > rp.runM(p)) break;
        var dot = P(rp.along(0.05 + s, p));
        ctx.fillStyle = "rgba(78,205,196,0.9)";
        ctx.beginPath(); ctx.arc(dot.x + nx * r, dot.y + ny * r, 4 * d, 0, 2 * Math.PI); ctx.fill();
        if (rp.state === "done" && k <= 6) {
          var mid = P(rp.along(0.05 + 0.5 * rp.a * (t - DOT_S / 2) * (t - DOT_S / 2), p));
          label(ctx, d, String(2 * k - 1), mid.x + nx * (2 * r + 12 * d), mid.y + ny * (2 * r + 12 * d), "center", 13);
        }
      }
    }
    // The ball, sitting on the plank; it spins only while it rolls.
    var bp = P(rp.ball(p));
    if (rp.state === "rolling" && rp.rolls) this.skin.angle = rp.s * ppm / r;
    R.drawBall(this.skin, ctx, bp.x + nx * r, bp.y + ny * r, r);
    if (rp.state === "rolling") label(ctx, d, "t = " + rp.t.toFixed(2) + " s", bp.x + nx * (2 * r + 14 * d), bp.y + ny * (2 * r + 14 * d), "center", 14);
    // "Grab here" on the raised end while waiting.
    var hand = this.hand;
    if (rp.state !== "tilting") {
      ctx.strokeStyle = "rgba(245,165,36,0.9)"; ctx.lineWidth = 2 * d;
      ctx.setLineDash([5 * d, 4 * d]);
      ctx.beginPath(); ctx.arc(top.x, top.y, 22 * d, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      if (!hand) label(ctx, d, "✊ grab here", top.x, top.y - 30 * d, "center", 13);
    }
    // The hand.
    if (hand) {
      ctx.strokeStyle = rp.gate.closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
      ctx.lineWidth = 2 * d;
      if (hand.lm) {
        BONES.forEach(function(bn) {
          ctx.beginPath(); ctx.moveTo(hand.lm[bn[0]].x * W, hand.lm[bn[0]].y * H);
          ctx.lineTo(hand.lm[bn[1]].x * W, hand.lm[bn[1]].y * H); ctx.stroke();
        });
      }
      ctx.beginPath(); ctx.arc(hand.x * W, hand.y * H, rp.catchR * H, 0, 2 * Math.PI);
      ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
      if (!hand.lm) label(ctx, d, rp.gate.closed ? "✊" : "✋", hand.x * W, hand.y * H + 5 * d, "center", 18);
    }
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(p) {
    var rp = this.ramp, last = this.last;
    $("r-hand").textContent = !this.hand ? "—" : rp.gate.closed ? "✊" : "✋";
    $("r-angle").textContent = Math.round(rp.angleDeg) + "°";
    $("r-time").textContent = rp.state === "rolling" || rp.state === "done" ? rp.t.toFixed(2) + " s" : "—";
    $("r-acc").textContent = rp.state === "rolling" || rp.state === "done" ? rp.a.toFixed(2) : last ? last.a.toFixed(2) : "—";
  },
  showWorld: function() { $("r-world").textContent = this.world.label(); },

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
    seg("r-gravity", "gravity", function() {
      self.world.set(s.gravity);
      self.runs = []; self.last = null;
      self.ramp.reset();
      self.showWorld();
      self.renderResults();
      self.toast("Now on " + self.world.name(), "info");
    });
    seg("r-surface", "surface", function() {
      if (self.ramp.state !== "tilting") self.ramp.reset();
      if (!self.live) self.drawIdle();
      self.toast(SURFACE_LOOK[s.surface].icon + " " + SURFACE_LOOK[s.surface].name, "info");
    });
    seg("r-slow", "slow");
    seg("r-ball", "ball", function() { self.skin = R.makeBall(s.ball); if (!self.live) self.drawIdle(); });
    var view = $("r-view");
    view.value = s.view;
    view.addEventListener("change", function() {
      var v = parseFloat(view.value);
      s.view = v >= 0.3 && v <= 20 ? v : 2;
      view.value = s.view; self.saveSettings();
      self.ramp.reset();
      if (!self.live) self.drawIdle();
    });
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    var applyMirror = function() { $("r-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("r-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("r-sound", "sound", function() { Sounds.enabled = s.sound; if (s.sound) { Sounds.unlock(); Sounds.grab(); } });
    toggle("r-backcam", "back", function() {
      s.mirror = !s.back; $("r-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
      var wasLive = self.input.source === "camera";
      self.input.close();
      if (wasLive) self.startCamera();
    });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.world = makeWorld(self.settings.gravity);
    self.settings.gravity = self.world.key;
    self.skin = R.makeBall(self.settings.ball);
    self.input = makeHandInput({ wrap: $("r-wrap"), video: $("r-video"), canvas: $("r-canvas") }, {
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      quiet: function() { return self.ramp.state === "rolling"; },
      handBack: function() {
        self.status(self.ramp.state === "tilting" ? "Got it! Move your hand to tilt the ramp, then open it to let go."
          : "I see your hand ✋. Make a fist ✊ on the top of the ramp to tilt it.", "ok");
      }
    });
    self.panels = makePanels($("screen-ramp"), "ramp", function() { self.renderResults(); });
    self.initSettings();
    self.showWorld();
    $("r-cam").addEventListener("click", function() { self.startCamera(); });
    $("r-touch").addEventListener("click", function() { self.startTouch(); });
    $("r-reset").addEventListener("click", function() {
      self.ramp.reset();
      if (!self.live) self.drawIdle();
      self.status("The ball is back at the top.", "");
    });
    $("r-clear").addEventListener("click", function() { self.runs = []; self.last = null; self.renderResults(); });
    Place.onChange(function() { self.showWorld(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-ramp").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("r-reset").click();
    });
    window.addEventListener("resize", function() {
      if ($("screen-ramp").hidden) return;
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
