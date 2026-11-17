/* Experiment 5 in the app: light. A laser you hold in your fist always
 * aims at one point on a surface; where you hold it sets the angle (from
 * the dashed normal). Over a mirror, it bounces at the same angle. Into
 * water, glass or diamond it bends toward the normal (Snell's law), and a
 * little bounces off (more at grazing angles: Fresnel). Take it under the
 * surface and aim up: past the critical angle it can't get out (total
 * internal reflection, how optical fibers work). Each time you put the
 * laser down, a reading is saved; from them the child measures n, and can
 * identify a mystery material. Physics: core/optics.js. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { BONES, label, inkOf } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makePanels } from "./panels.js";
import { makeHandInput } from "./handinput.js";

var R = AR.render;
var TARGET = { x: 0.5, y: 0.55 };
var MAX_READINGS = 60;
var LOOK = {
  mirror: { name: "mirror", icon: "🪞", fill: "rgba(190,200,215,0.55)" },
  water: { name: "water", icon: "💧", fill: "rgba(40,140,255,0.28)" },
  glass: { name: "glass", icon: "🔷", fill: "rgba(150,225,255,0.24)" },
  diamond: { name: "diamond", icon: "💎", fill: "rgba(225,240,255,0.30)" },
  mystery: { name: "mystery material", icon: "❓", fill: "rgba(180,120,255,0.26)" }
};
var MYSTERY_PICKS = ["ice", "alcohol", "oil", "amber", "sapphire", "water", "glass", "diamond"];

export var Light = {
  laser: new AR.LaserPointer({ target: TARGET }),
  input: null, panels: null,
  live: false, raf: 0,
  hand: null,
  readings: [],
  mysteryKey: null, revealed: false,
  wasTrapped: false, lastMsg: "",
  settings: null,

  loadSettings: function() {
    var s = store.get("light", {});
    this.settings = {
      material: LOOK[s.material] ? s.material : "water",
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("light", this.settings); },
  pickMystery: function() {
    var prev = this.mysteryKey, k;
    do { k = MYSTERY_PICKS[Math.floor(Math.random() * MYSTERY_PICKS.length)]; } while (k === prev);
    this.mysteryKey = k; this.revealed = false;
  },
  /* n of the material under the surface (null for the mirror). */
  n: function() {
    var m = this.settings.material;
    if (m === "mirror") return null;
    return AR.MATERIALS[m === "mystery" ? this.mysteryKey : m];
  },
  matName: function() { return LOOK[this.settings.material].name; },
  params: function() {
    var wrap = $("l-wrap");
    return {
      aspect: wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3,
      below: this.settings.material !== "mirror"
    };
  },
  /* What the light does for the laser where it is now. */
  optics: function(p) {
    var g = this.laser.geometry(p), n = this.n();
    if (n == null) return { g: g, mirror: true, inDeg: g.inDeg, outDeg: g.inDeg, R: 1, trapped: false };
    var r = g.above ? AR.refract(1, n, g.inDeg) : AR.refract(n, 1, g.inDeg);
    return { g: g, mirror: false, n: n, fromAir: g.above, inDeg: g.inDeg, outDeg: r.outDeg, R: r.R, trapped: r.trapped,
      critical: g.above ? null : AR.criticalAngle(n, 1) };
  },
  status: function(msg, cls) {
    var el = $("l-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("l-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2400);
  },

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    $("l-cam").disabled = true;
    $("l-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    self.input.startCamera().then(function() {
      self.run();
      self.status("Make a fist ✊ on the laser to pick it up, and move it to aim.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("l-start-note").textContent = err.message;
    }).then(function() { $("l-cam").disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press on the laser and drag it to aim. Let go to save a reading.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("l-start").hidden = true;
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
    $("l-start").hidden = false;
    $("l-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
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
      var ev = self.laser.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p);
    }
    var o = self.optics(p);
    if (self.laser.state === "held") self.explain(o);
    if (o.trapped && !self.wasTrapped) { Sounds.bounce(0.7); self.toast("Trapped! ✨", "info"); }
    self.wasTrapped = o.trapped;
    self.draw(p, o);
    self.readouts(o);
  },
  onEvent: function(ev, p) {
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.lastMsg = "";
    } else if (ev.type === "placed") {
      Sounds.release();
      this.addReading(this.optics(p));
    }
  },
  /* A sentence for what the light is doing right now. */
  explain: function(o) {
    var a = Math.round(o.inDeg), msg, name = this.matName();
    if (o.mirror) msg = "In at " + a + "°, out at " + a + "°: a mirror bounces light back at the same angle.";
    else if (o.fromAir) msg = "Into " + name + ", light bends toward the dashed line: " + a + "° becomes " + Math.round(o.outDeg) + "°.";
    else if (o.trapped) msg = "Trapped! Past " + o.critical.toFixed(1) + "° the light can't get out of the " + name +
      ": it all bounces back inside. That's how optical fibers carry light.";
    else msg = "Out of the " + name + ", light bends away from the dashed line: " + a + "° becomes " + Math.round(o.outDeg) +
      "°. Tilt it more: past " + o.critical.toFixed(1) + "° it gets trapped!";
    if (msg !== this.lastMsg) { this.lastMsg = msg; this.status(msg, o.trapped ? "ok" : ""); }
  },

  /* ---------- results ---------- */
  addReading: function(o) {
    var prev = this.readings[this.readings.length - 1];
    var r = { material: this.settings.material, key: this.settings.material === "mystery" ? this.mysteryKey : this.settings.material,
      mirror: o.mirror, fromAir: o.mirror || o.fromAir, inDeg: o.inDeg, outDeg: o.outDeg, trapped: o.trapped,
      n: !o.mirror && !o.trapped && o.inDeg > 1 ? AR.indexFrom(o.inDeg, o.outDeg, o.fromAir) : null };
    if (prev && prev.material === r.material && prev.fromAir === r.fromAir && Math.abs(prev.inDeg - r.inDeg) < 0.5) return;
    this.readings.push(r);
    if (this.readings.length > MAX_READINGS) this.readings.shift();
    this.toast(o.mirror ? "In " + Math.round(o.inDeg) + "°, out " + Math.round(o.outDeg) + "°"
      : o.trapped ? "Saved: trapped at " + Math.round(o.inDeg) + "°"
      : "Saved: " + Math.round(o.inDeg) + "° → " + Math.round(o.outDeg) + "°");
    this.renderResults();
  },
  /* Readings for the material chosen now. */
  current: function() {
    var m = this.settings.material, key = m === "mystery" ? this.mysteryKey : m;
    return this.readings.filter(function(r) { return r.material === m && r.key === key; });
  },
  renderResults: function() {
    var rows = $("l-rows");
    rows.textContent = "";
    for (var i = this.readings.length - 1; i >= 0; i--) {
      var r = this.readings[i], tr = document.createElement("tr");
      var from = r.mirror ? "air" : r.fromAir ? "air" : LOOK[r.material].name.replace(" material", "");
      [String(i + 1), LOOK[r.material].icon, from, Math.round(r.inDeg) + "°",
        r.trapped ? "trapped" : Math.round(r.outDeg) + "°", r.n != null ? r.n.toFixed(2) : "—"].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    $("l-count").textContent = String(this.readings.length);
    var cur = this.current(), m = this.settings.material, name = this.matName();
    var ns = cur.filter(function(r) { return r.n != null; }).map(function(r) { return r.n; });
    var trappedOne = cur.filter(function(r) { return r.trapped; })[0];
    if (m === "mirror") {
      $("l-head-label").textContent = "Mirror";
      $("l-head").textContent = cur.length ? "in = out" : "—";
      $("l-summary").textContent = cur.length
        ? "Every time, the angle out matched the angle in. That's the law of reflection."
        : "Put the laser down at a few angles: how does the angle out compare?";
    } else {
      $("l-head-label").textContent = (m === "mystery" ? "The mystery material's" : name.charAt(0).toUpperCase() + name.slice(1) + "'s") +
        " n (how much it slows light)";
      $("l-head").textContent = ns.length ? AR.mean(ns).toFixed(2) : "—";
      var crit = AR.criticalAngle(this.n(), 1);
      $("l-summary").textContent = !ns.length && !trappedOne
        ? "Put the laser down at a few angles to save readings. n = sin(angle in air) ÷ sin(angle in the " + name + ")."
        : (ns.length ? "From " + ns.length + " reading" + (ns.length > 1 ? "s" : "") + ": n = sin(angle in air) ÷ sin(angle in the " + name + "). " : "") +
          (trappedOne ? "And the light got trapped past " + crit.toFixed(1) + "°: total internal reflection."
            : "Now take the laser under the surface and aim up at a slant: past a certain angle, the light can't get out!");
    }
    $("l-mystery").hidden = m !== "mystery";
    $("l-reveal").textContent = this.revealed
      ? "It's " + this.mysteryKey + ": n = " + AR.MATERIALS[this.mysteryKey] : "Reveal the answer";
    $("l-plot-wrap").hidden = !cur.length;
    if (cur.length && this.panels && this.panels.resultsVisible()) this.plot(cur);
  },
  /* Angle out against angle in: the readings over the law's curves. */
  plot: function(cur) {
    var cv = $("l-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, 90], [0, 95],
      ["angle in (°)", "angle out (°)"], ink);
    var n = this.n();
    var line = function(f, color, dash, to) {
      ctx.strokeStyle = color; ctx.lineWidth = 2 * d; ctx.setLineDash(dash || []);
      ctx.beginPath();
      var started = false;
      for (var a = 0; a <= (to || 89.9); a += 0.5) {
        var y = f(a);
        if (y == null) break;
        if (!started) { ctx.moveTo(A.X(a), A.Y(y)); started = true; } else ctx.lineTo(A.X(a), A.Y(y));
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.font = "600 " + (10 * d) + "px system-ui, sans-serif";
    if (n == null) {
      line(function(a) { return a; }, "#1a56db");
      ctx.fillStyle = "#3b6fe0"; ctx.fillText("out = in", A.X(60), A.Y(70));
    } else {
      line(function(a) { return AR.refract(1, n, a).outDeg; }, "#1a56db");
      line(function(a) { return AR.refract(n, 1, a).outDeg; }, "#f59e0b", [6 * d, 4 * d]);
      var crit = AR.criticalAngle(n, 1);
      ctx.fillStyle = "#3b6fe0"; ctx.fillText("from air", A.X(62), A.Y(AR.refract(1, n, 62).outDeg) + 14 * d);
      ctx.fillStyle = "#d97706"; ctx.fillText("from inside: trapped past " + crit.toFixed(0) + "°", A.X(Math.min(crit, 60) - 30), A.Y(93));
      ctx.strokeStyle = "rgba(" + ink + ",0.35)"; ctx.setLineDash([3 * d, 3 * d]);
      ctx.beginPath(); ctx.moveTo(A.X(crit), A.Y(0)); ctx.lineTo(A.X(crit), A.Y(90)); ctx.stroke(); ctx.setLineDash([]);
    }
    cur.forEach(function(r) {
      var y = r.trapped ? 90 : r.outDeg;
      ctx.lineWidth = 2 * d;
      ctx.strokeStyle = ctx.fillStyle = r.mirror || r.fromAir ? "#e5484d" : "#f59e0b";
      ctx.beginPath(); ctx.arc(A.X(r.inDeg), A.Y(y), 4.5 * d, 0, 2 * Math.PI);
      if (r.fromAir || r.mirror) ctx.fill(); else ctx.stroke();
    });
  },

  /* ---------- drawing ---------- */
  draw: function(p, o) {
    var cv = $("l-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    o = o || this.optics(p);
    var look = LOOK[this.settings.material], O = { x: TARGET.x * W, y: TARGET.y * H };
    // The material (or the mirror) below the surface.
    ctx.fillStyle = look.fill;
    if (o.mirror) {
      var gr = ctx.createLinearGradient(0, O.y, 0, O.y + 18 * d);
      gr.addColorStop(0, "rgba(235,240,248,0.95)"); gr.addColorStop(1, "rgba(120,130,150,0.9)");
      ctx.fillStyle = gr; ctx.fillRect(0, O.y, W, 18 * d);
      ctx.fillStyle = "rgba(60,66,80,0.6)"; ctx.fillRect(0, O.y + 18 * d, W, H - O.y);
    } else {
      ctx.fillRect(0, O.y, W, H - O.y);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.moveTo(0, O.y); ctx.lineTo(W, O.y); ctx.stroke();
      label(ctx, d, "air", 14 * d, O.y - 10 * d, "left", 13);
      label(ctx, d, look.name + (this.settings.material === "mystery" ? "" : "  n = " + this.n()), 14 * d, O.y + 22 * d, "left", 13);
    }
    // The normal.
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.5 * d; ctx.setLineDash([7 * d, 6 * d]);
    ctx.beginPath(); ctx.moveTo(O.x, O.y - 0.4 * H); ctx.lineTo(O.x, Math.min(H, O.y + 0.4 * H)); ctx.stroke();
    ctx.setLineDash([]);
    // Rays: in, reflected, and through (or trapped).
    var L = { x: this.laser.x * W, y: this.laser.y * H };
    var g = o.g, sx = -g.side;                 // the light travels toward this side (−1 left, +1 right)
    var vUp = g.above ? 1 : -1;                // incoming goes down (from above) or up (from below)
    var rad = Math.PI / 180;
    var reflDir = { x: sx * Math.sin(o.inDeg * rad), y: -vUp * Math.cos(o.inDeg * rad) };
    this.beam(ctx, d, L, O, 1);
    this.beam(ctx, d, O, this.toEdge(O, reflDir, W, H), o.mirror ? 0.95 : Math.max(0.12, o.R));
    if (!o.mirror && !o.trapped) {
      var outDir = { x: sx * Math.sin(o.outDeg * rad), y: vUp * Math.cos(o.outDeg * rad) };
      this.beam(ctx, d, O, this.toEdge(O, outDir, W, H), Math.max(0.15, 1 - o.R));
    }
    // Angles from the normal.
    var arcR = 56 * d;
    var arc = function(fromUp, ang, side, color, text) {
      // ang from the normal; fromUp: measured from the upward normal, else downward
      var base = fromUp ? -Math.PI / 2 : Math.PI / 2;
      var end = base + (fromUp ? 1 : -1) * side * ang * rad;
      ctx.strokeStyle = color; ctx.lineWidth = 2.5 * d;
      ctx.beginPath(); ctx.arc(O.x, O.y, arcR, Math.min(base, end), Math.max(base, end)); ctx.stroke();
      var mid = (base + end) / 2;
      label(ctx, d, text, O.x + Math.cos(mid) * (arcR + 22 * d), O.y + Math.sin(mid) * (arcR + 22 * d) + 5 * d, "center", 15);
    };
    var inSide = g.side;                        // laser's side
    arc(g.above, o.inDeg, inSide, "#fbbf24", Math.round(o.inDeg) + "°");
    if (o.mirror) arc(true, o.inDeg, -inSide, "#fbbf24", Math.round(o.inDeg) + "°");
    else if (!o.trapped) arc(!g.above, o.outDeg, -inSide, "#22d3ee", Math.round(o.outDeg) + "°");
    else label(ctx, d, "trapped!", O.x - inSide * 80 * d, O.y + 44 * d, "center", 16);   // beside the beam bouncing back inside
    // The laser itself, pointing at the target.
    var ang = Math.atan2(O.y - L.y, O.x - L.x);
    ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(ang);
    ctx.fillStyle = "#2b2f3a"; ctx.strokeStyle = "#9aa3b5"; ctx.lineWidth = 1.5 * d;
    ctx.beginPath(); ctx.rect(-54 * d, -8 * d, 54 * d, 16 * d); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff4d4d"; ctx.fillRect(-14 * d, -3 * d, 6 * d, 6 * d);
    ctx.restore();
    if (this.laser.state !== "held" && !this.hand) {
      ctx.strokeStyle = "rgba(245,165,36,0.9)"; ctx.lineWidth = 2 * d; ctx.setLineDash([5 * d, 4 * d]);
      ctx.beginPath(); ctx.arc(L.x, L.y, 30 * d, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, d, "✊ grab the laser", L.x, L.y - 38 * d, "center", 13);
    }
    // The hand.
    var hand = this.hand;
    if (hand) {
      ctx.strokeStyle = this.laser.gate.closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
      ctx.lineWidth = 2 * d;
      if (hand.lm) {
        BONES.forEach(function(bn) {
          ctx.beginPath(); ctx.moveTo(hand.lm[bn[0]].x * W, hand.lm[bn[0]].y * H);
          ctx.lineTo(hand.lm[bn[1]].x * W, hand.lm[bn[1]].y * H); ctx.stroke();
        });
      }
      ctx.beginPath(); ctx.arc(hand.x * W, hand.y * H, this.laser.catchR * H, 0, 2 * Math.PI);
      ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
      if (!hand.lm) label(ctx, d, this.laser.gate.closed ? "✊" : "✋", hand.x * W, hand.y * H + 5 * d, "center", 18);
    }
  },
  /* A glowing red beam; alpha: how much light it carries. */
  beam: function(ctx, d, a, b, alpha) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,40,40," + (0.9 * alpha).toFixed(3) + ")";
    ctx.shadowBlur = 14 * d;
    ctx.strokeStyle = "rgba(255,70,70," + alpha.toFixed(3) + ")";
    ctx.lineWidth = 3.5 * d;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,230,230," + (0.8 * alpha).toFixed(3) + ")";
    ctx.lineWidth = 1.2 * d;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  },
  /* From point o along direction v (pixels) to the edge of the picture. */
  toEdge: function(o, v, W, H) {
    var t = Infinity;
    if (v.x > 1e-9) t = Math.min(t, (W - o.x) / v.x);
    if (v.x < -1e-9) t = Math.min(t, -o.x / v.x);
    if (v.y > 1e-9) t = Math.min(t, (H - o.y) / v.y);
    if (v.y < -1e-9) t = Math.min(t, -o.y / v.y);
    return { x: o.x + v.x * t, y: o.y + v.y * t };
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(o) {
    $("l-hand").textContent = !this.hand ? "—" : this.laser.gate.closed ? "✊" : "✋";
    $("l-in").textContent = Math.round(o.inDeg) + "°";
    $("l-out").textContent = o.trapped ? "trapped" : Math.round(o.outDeg) + "°";
    $("l-bounce").textContent = Math.round((o.mirror ? 1 : o.R) * 100) + "%";
  },

  /* ---------- setup ---------- */
  initSettings: function() {
    var self = this, s = self.settings;
    var group = $("l-material");
    var mark = function() {
      group.querySelectorAll("button").forEach(function(b) {
        b.setAttribute("aria-checked", b.getAttribute("data-v") === s.material ? "true" : "false");
      });
    };
    group.addEventListener("click", function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      s.material = b.getAttribute("data-v");
      if (s.material === "mystery") self.pickMystery();
      mark(); self.saveSettings();
      // A mirror can't have the laser underneath it.
      if (s.material === "mirror" && self.laser.y > TARGET.y) self.laser.reset();
      self.lastMsg = "";
      self.toast(LOOK[s.material].icon + " " + LOOK[s.material].name, "info");
      self.renderResults();
      if (!self.live) self.drawIdle();
    });
    mark();
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    var applyMirror = function() { $("l-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("l-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("l-sound", "sound", function() { Sounds.enabled = s.sound; if (s.sound) { Sounds.unlock(); Sounds.grab(); } });
    toggle("l-backcam", "back", function() {
      s.mirror = !s.back; $("l-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
      var wasLive = self.input.source === "camera";
      self.input.close();
      if (wasLive) self.startCamera();
    });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.pickMystery();
    self.input = makeHandInput({ wrap: $("l-wrap"), video: $("l-video"), canvas: $("l-canvas") }, {
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      handBack: function() { self.status("I see your hand ✋. Make a fist ✊ on the laser to pick it up.", "ok"); }
    });
    self.panels = makePanels($("screen-light"), "light", function() { self.renderResults(); });
    self.initSettings();
    $("l-cam").addEventListener("click", function() { self.startCamera(); });
    $("l-touch").addEventListener("click", function() { self.startTouch(); });
    $("l-reset").addEventListener("click", function() {
      self.laser.reset();
      if (!self.live) self.drawIdle();
      self.status("The laser is back.", "");
    });
    $("l-clear").addEventListener("click", function() { self.readings = []; self.renderResults(); });
    $("l-reveal").addEventListener("click", function() { self.revealed = true; self.renderResults(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-light").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("l-reset").click();
    });
    window.addEventListener("resize", function() {
      if ($("screen-light").hidden) return;
      if (!self.live) self.drawIdle();
      self.renderResults();
    });
    self.renderResults();
  },
  enter: function() {
    var self = this;
    requestAnimationFrame(function() { self.drawIdle(); self.renderResults(); });
  }
};
