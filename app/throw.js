/* Experiment 2 in the app: throw a virtual ball with your hand. Make a fist
 * on the ball, swing your arm and open your hand: the ball leaves with
 * your hand's speed and direction (core ThrowBall) and flies as a
 * projectile under the chosen world's gravity. While it flies, arrows show
 * its two speeds: across (never changes) and up-down (gravity changes it
 * by g every second). Each throw goes into a table; the graphs show the
 * last throw's path and speeds, and how far each throw went for its speed
 * against its angle (45° goes farthest). Floor = bottom of the picture. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { BONES, label, inkOf, BOUNCE } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makePanels } from "./panels.js";
import { makeHandInput } from "./handinput.js";
import { makeWorld } from "./worlds.js";
import { Place } from "./place.js";

var R = AR.render;
var MAX_THROWS = 40;
var START = { x: 0.25, y: 0.6 };
var BACK_AFTER_MS = 1200;   // a ball that flew off comes back after this

export var Throw = {
  ball: new AR.ThrowBall(),
  input: null, world: null, panels: null,
  live: false, raf: 0,
  hand: null,
  flight: null,       // {x0, y0, pts: [{t, x, y}]} of the current/last flight (frame fractions)
  landing: null,      // {x, range} of the last landing, for the marker
  goneAt: 0,
  throws: [],
  lastRes: null,      // last flight as a projectile "result", for the graph
  settings: null, skin: null,

  loadSettings: function() {
    var s = store.get("throw2", {});
    this.settings = {
      gravity: s.gravity || "earth",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      ball: R.isBallStyle(s.ball) ? s.ball : "tennis",
      view: s.view > 0.3 && s.view <= 20 ? s.view : 2,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("throw2", this.settings); },
  params: function() {
    var wrap = $("t-wrap");
    return {
      g: this.world.g(),
      h: this.settings.view,
      slow: parseFloat(this.settings.slow) || 1,
      e: BOUNCE[this.settings.ball] || 0,
      aspect: wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3
    };
  },
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

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    $("t-cam").disabled = true;
    $("t-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    self.input.startCamera().then(function() {
      self.run();
      self.status("Make a fist ✊ on the ball, swing your arm, and open your hand to throw.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("t-start-note").textContent = err.message;
    }).then(function() { $("t-cam").disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press and hold on the ball, flick it, and let go to throw.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("t-start").hidden = true;
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
    $("t-start").hidden = false;
    $("t-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
    this.status("Pick camera or finger to start.", "");
    this.panels.closeSheets();
    this.drawIdle();
  },
  ballBack: function() {
    this.ball.reset(START.x, START.y);
    this.flight = null; this.landing = null; this.hand = null; this.goneAt = 0;
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
      if (ev) self.onEvent(ev, p, now);
    }
    var end = self.ball.tick(now, p);
    if (self.ball.state === "flying" && self.flight) {
      self.flight.pts.push({ t: self.ball.t, x: self.ball.x, y: self.ball.y });
    }
    if (end) self.onEvent(end, p, now);
    if (self.ball.state === "gone" && now - self.goneAt > BACK_AFTER_MS) {
      self.ballBack();
      self.status("The ball is back. Grab it and throw again!", "");
    }
    self.draw(p);
    self.readouts(p);
  },
  onEvent: function(ev, p, now) {
    var b = this.ball;
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.flight = null; this.landing = null;
      this.status("Got it! Swing your arm and open your hand to throw.", "ok");
    } else if (ev.type === "thrown") {
      Sounds.release();
      this.flight = { x0: b.x, y0: b.y, pts: [{ t: 0, x: b.x, y: b.y }] };
      this.status(ev.speed < 0.3
        ? (ev.how === "lost" ? "Your hand left the picture, so the ball dropped." : "That was a drop, not a throw: move your hand as you open it!")
        : "Thrown at " + ev.speed.toFixed(1) + " m/s, " + Math.round(ev.angleDeg) + "° " + (ev.vy >= 0 ? "up" : "down") + "…", "");
    } else if (ev.type === "caught") {
      Sounds.catchAir();
      this.flight = null;
      this.toast("Great catch! 🙌", "info");
      this.status("Caught it! Open your hand to throw again.", "ok");
    } else if (ev.type === "bounce") {
      Sounds.bounce(ev.speed / 4);
    } else if (ev.type === "gone" && ev.bouncing) {
      this.goneAt = now;           // bounced out of the picture: the throw is already saved
    } else if (ev.type === "landed" || ev.type === "gone") {
      var p0 = this.flight;
      if (p0) p0.pts.push({ t: ev.t, x: ev.type === "landed" ? ev.x : b.x, y: ev.type === "landed" ? 1 : b.y });
      if (ev.type === "landed") {
        Sounds.land();
        if (ev.bounceHeight > 0.01) Sounds.bounce(1);
        this.landing = { x: ev.x, range: ev.range };
      } else {
        this.goneAt = now;
      }
      if (ev.speed >= 0.3) this.addThrow(ev, p);
      else this.status("That was a drop, not a throw. Grab it and move your hand as you open it.", "");
    }
  },

  /* ---------- results ---------- */
  addThrow: function(ev, p) {
    var landed = ev.type === "landed";
    this.throws.push({ speed: ev.speed, angle: ev.angleDeg, t: ev.t, range: landed ? ev.range : null,
      apex: ev.apex, h0: ev.h0, vx: ev.vx, vy: ev.vy, g: p.g });
    if (this.throws.length > MAX_THROWS) this.throws.shift();
    this.lastRes = this.asResult(ev, p);
    this.toast(landed ? "Flew " + ev.range.toFixed(2) + " m" : "Out of the picture!", landed ? "" : "info");
    this.status((landed
      ? "Flew " + ev.range.toFixed(2) + " m in " + ev.t.toFixed(2) + " s"
      : "It flew out of the picture after " + ev.t.toFixed(2) + " s") +
      (ev.apex > 0.01 ? ", " + ev.apex.toFixed(2) + " m above your hand at the top" : "") +
      ". Across, it kept " + Math.abs(ev.vx).toFixed(1) + " m/s the whole way.", "ok");
    this.renderResults();
  },
  /* The flight in meters, shaped like an analyzeProjectile result, so the
   * shared path-and-speeds graph can draw it. */
  asResult: function(ev, p) {
    var f = this.flight;
    if (!f || f.pts.length < 3) return null;
    var W = p.h * p.aspect, H = p.h;
    return {
      vx: ev.vx, vy: ev.vy, g: p.g, span: ev.t,
      origin: { t: 0, x: f.x0 * W, y: f.y0 * H },
      points: f.pts.map(function(q) { return { t: q.t, x: q.x * W, y: q.y * H }; })
    };
  },
  /* g as the slope of the up-down speed: it changes by g every second. */
  measuredG: function() {
    var res = this.lastRes;
    if (!res || res.points.length < 4) return NaN;
    var pts = res.points, vys = [];
    for (var i = 1; i < pts.length - 1; i++) {
      var dt = pts[i + 1].t - pts[i - 1].t;
      // The average speed between two frames is the speed exactly halfway
      // between them (for a parabola), even when frames are unevenly spaced.
      if (dt > 0) vys.push({ t: (pts[i + 1].t + pts[i - 1].t) / 2, v: -(pts[i + 1].y - pts[i - 1].y) / dt });
    }
    var fit = vys.length >= 3 ? AR.fitLine(vys) : null;
    return fit ? -fit.b : NaN;
  },
  renderResults: function() {
    var rows = $("t-rows");
    rows.textContent = "";
    for (var i = this.throws.length - 1; i >= 0; i--) {
      var th = this.throws[i], tr = document.createElement("tr");
      [String(i + 1), th.speed.toFixed(1), Math.round(th.angle) + "°",
        th.range != null ? th.range.toFixed(2) : "off", th.apex.toFixed(2)].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    var n = this.throws.length;
    $("t-count").textContent = String(n);
    var landed = this.throws.filter(function(t) { return t.range != null; });
    var mystery = this.world.mystery();
    if (mystery) {
      var g = this.measuredG();
      $("t-g-label").textContent = "Mystery planet's g";
      $("t-g").textContent = isFinite(g) ? g.toFixed(2) + " m/s²" : "—";
      $("t-summary").textContent = isFinite(g)
        ? "From your last throw: its up-down speed dropped by " + g.toFixed(2) + " m/s every second. That's g!"
        : "Throw the ball to measure this planet's gravity.";
    } else {
      var best = landed.reduce(function(a, t) { return !a || t.range > a.range ? t : a; }, null);
      $("t-g-label").textContent = "Farthest throw";
      $("t-g").textContent = best ? best.range.toFixed(2) + " m" : "—";
      $("t-summary").textContent = !n ? "No throws yet. Throw at different angles: which goes farthest?"
        : best ? "At " + Math.round(best.angle) + "°, " + best.speed.toFixed(1) + " m/s. " +
          (landed.length < 4 ? "Try steep, flat and in-between throws." : "For the same speed, about 45° goes farthest.")
          : "Every throw so far flew out of the picture. Throw a bit gentler!";
    }
    $("t-mystery").hidden = !mystery;
    $("t-reveal").textContent = this.world.revealText();
    this.plots();
  },
  plots: function() {
    $("t-plot-wrap").hidden = !this.lastRes;
    $("t-angle-wrap").hidden = this.throws.filter(function(t) { return t.range != null; }).length < 2;
    if (!this.panels || !this.panels.resultsVisible()) return;
    if (this.lastRes) {
      var cv = $("t-plot");
      R.drawProjectilePlot(cv.getContext("2d"), R.fitCanvas(cv), this.lastRes, inkOf(cv));
    }
    if (!$("t-angle-wrap").hidden) this.plotAngles();
  },
  /* How far each throw went for its speed (distance ÷ v²/g) against its
   * angle, over the ideal curve sin 2θ (same height start and finish). */
  plotAngles: function() {
    var cv = $("t-angle-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, 90], [0, 1.6],
      ["throw angle (°)", "distance for its speed"], ink);
    ctx.strokeStyle = "#1a56db"; ctx.lineWidth = 2 * d;
    ctx.beginPath();
    for (var a = 0; a <= 90; a += 2) {
      var y = Math.sin(2 * a * Math.PI / 180);
      if (a === 0) ctx.moveTo(A.X(a), A.Y(y)); else ctx.lineTo(A.X(a), A.Y(y));
    }
    ctx.stroke();
    ctx.fillStyle = "#3b6fe0";
    ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
    ctx.fillText("best: 45°", A.X(40), A.Y(1.08));
    ctx.fillStyle = "#e5484d";
    this.throws.forEach(function(t) {
      if (t.range == null || !(t.speed > 0) || t.angle < 0) return;
      var k = t.range / (t.speed * t.speed / t.g);
      ctx.beginPath(); ctx.arc(A.X(t.angle), A.Y(Math.min(1.6, k)), 4 * d, 0, 2 * Math.PI); ctx.fill();
    });
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("t-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    var mW = p.h * p.aspect;               // meters across the picture
    // Rulers: height on the left, distance along the floor.
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = d;
    var step = p.h > 4 ? 1 : 0.5;
    for (var m = step; m < p.h; m += step) {
      var py = H * (1 - m / p.h);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(10 * d, py); ctx.stroke();
      if (py > 16 * d) label(ctx, d, m.toFixed(1) + " m", 13 * d, py + 4 * d, "left", 11);
    }
    var f = this.flight, b = this.ball;
    // Distance marks from where it was thrown, while flying and after.
    if (f && b.state !== "held") {
      var dir = b.vx < 0 ? -1 : 1, x0 = f.x0 * W;
      for (var k = 0.5; k < mW; k += 0.5) {
        var px = x0 + dir * k / mW * W;
        if (px < 0 || px > W) break;
        ctx.beginPath(); ctx.moveTo(px, H); ctx.lineTo(px, H - (k % 1 ? 6 : 12) * d); ctx.stroke();
        if (!(k % 1)) label(ctx, d, k.toFixed(0) + " m", px, H - 16 * d, "center", 11);
      }
      // The flight so far.
      ctx.fillStyle = "rgba(78,205,196,0.75)";
      f.pts.forEach(function(q, i) {
        if (i % 2) return;
        ctx.beginPath(); ctx.arc(q.x * W, q.y * H, 3 * d, 0, 2 * Math.PI); ctx.fill();
      });
    }
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
    // The ball, and its two speeds while it flies.
    var r = Math.max(R.ballRadius(dims), 0.035 * Math.min(W, H));
    var bx = b.x * W, by = Math.min(H - r, b.y * H);
    R.drawShadow(ctx, bx, H, r, Math.min(1, Math.max(0, b.y)));
    R.drawBall(this.skin, ctx, bx, by, r);
    // Where it landed, and how far that was (above the ball, which sits there).
    if (this.landing && b.state !== "held") {
      label(ctx, d, this.landing.range.toFixed(2) + " m", this.landing.x * W, H - 2 * r - 10 * d, "center", 16);
    }
    if (b.state === "flying") {
      var vy = b.vy - p.g * b.t, k2 = 0.1 * H / Math.max(1, p.h);   // px per (m/s)
      arrow(ctx, d, bx, by, bx + b.vx * k2, by, "#2dd4bf", "across " + Math.abs(b.vx).toFixed(1));
      arrow(ctx, d, bx, by, bx, by - vy * k2, "#f59e0b", (vy >= 0 ? "up " : "down ") + Math.abs(vy).toFixed(1));
    }
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(p) {
    var b = this.ball, last = this.throws[this.throws.length - 1];
    var flying = b.state === "flying";
    $("t-hand").textContent = !this.hand ? "—" : b.gate.closed ? "✊" : "✋";
    $("t-speed").textContent = flying ? Math.hypot(b.vx, b.vy).toFixed(1) + " m/s" : last ? last.speed.toFixed(1) + " m/s" : "—";
    $("t-angle").textContent = flying ? Math.round(Math.atan2(b.vy, Math.abs(b.vx)) * 180 / Math.PI) + "°" : last ? Math.round(last.angle) + "°" : "—";
    $("t-dist").textContent = flying ? (Math.abs(b.vx) * b.t).toFixed(2) + " m" : last && last.range != null ? last.range.toFixed(2) + " m" : "—";
  },
  showWorld: function() { $("t-world").textContent = this.world.label(); },

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
    seg("t-gravity", "gravity", function() {
      self.world.set(s.gravity);
      self.throws = []; self.lastRes = null;
      self.showWorld();
      self.renderResults();
      self.toast(self.world.mystery() ? "New mystery planet. Throw to find its g!" : "Now on " + self.world.name(), "info");
    });
    seg("t-slow", "slow");
    seg("t-ball", "ball", function() { self.skin = R.makeBall(s.ball); if (!self.live) self.drawIdle(); });
    var view = $("t-view");
    view.value = s.view;
    view.addEventListener("change", function() {
      var v = parseFloat(view.value);
      s.view = v >= 0.3 && v <= 20 ? v : 2;
      view.value = s.view; self.saveSettings();
      if (!self.live) self.drawIdle();
    });
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    var applyMirror = function() { $("t-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("t-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("t-sound", "sound", function() { Sounds.enabled = s.sound; if (s.sound) { Sounds.unlock(); Sounds.grab(); } });
    toggle("t-backcam", "back", function() {
      s.mirror = !s.back; $("t-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
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
    self.ball.reset(START.x, START.y);
    self.input = makeHandInput({ wrap: $("t-wrap"), video: $("t-video"), canvas: $("t-canvas") }, {
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      quiet: function() { return self.ball.state === "flying"; },
      handBack: function() {
        self.status(self.ball.state === "held" ? "Got it! Swing your arm and open your hand to throw."
          : "I see your hand ✋. Make a fist ✊ on the ball to grab it.", "ok");
      }
    });
    self.panels = makePanels($("screen-throw"), "throw", function() { self.renderResults(); });
    self.initSettings();
    self.showWorld();
    $("t-cam").addEventListener("click", function() { self.startCamera(); });
    $("t-touch").addEventListener("click", function() { self.startTouch(); });
    $("t-reset").addEventListener("click", function() {
      self.ballBack();
      if (!self.live) self.drawIdle();
      self.status("Ball is back.", "");
    });
    $("t-clear").addEventListener("click", function() { self.throws = []; self.lastRes = null; self.renderResults(); });
    $("t-reveal").addEventListener("click", function() { self.world.reveal(); self.renderResults(); });
    Place.onChange(function() { self.showWorld(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-throw").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("t-reset").click();
    });
    window.addEventListener("resize", function() {
      if ($("screen-throw").hidden) return;
      if (!self.live) self.drawIdle();
      self.plots();
    });
    self.renderResults();
  },
  enter: function() {
    var self = this;
    Place.refreshIfAllowed();
    requestAnimationFrame(function() { self.drawIdle(); self.renderResults(); });
  }
};

/* An arrow from (x0, y0) to (x1, y1) with a label at its tip. */
function arrow(ctx, d, x0, y0, x1, y1, color, text) {
  var len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 4 * d) return;
  var a = Math.atan2(y1 - y0, x1 - x0), hd = 8 * d;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 * d;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - hd * Math.cos(a - 0.45), y1 - hd * Math.sin(a - 0.45));
  ctx.lineTo(x1 - hd * Math.cos(a + 0.45), y1 - hd * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
  label(ctx, d, text, x1 + 6 * d * Math.cos(a), y1 + 6 * d * Math.sin(a) + 4 * d, Math.cos(a) < -0.3 ? "right" : "left", 12);
}
