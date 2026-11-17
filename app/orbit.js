/* Experiment 6 in the app: orbits. Grab the satellite with your fist, move
 * it, and flick it: it keeps your hand's on-screen speed and flies under a
 * real planet's gravity (core Satellite: Newton's law, step by step), with
 * time sped up so an orbit takes seconds. Too slow and it crashes, faster
 * than escape speed and it leaves, in between it orbits: the dashed ellipse
 * has the planet at a focus (Kepler 1), colored slices of equal time have
 * equal areas so it speeds up close in (Kepler 2), and each orbit's time
 * goes on a T²-vs-a³ graph (Kepler 3). Speeds and times are real.
 * The satellite is small, so it's held with a pinch (thumb and index
 * finger), and a pinch anywhere picks it up. */
import * as AR from "../core/index.js";
import { Sounds } from "../lab/sounds.js";
import { BONES, label, inkOf } from "../lab/catchview.js";
import { store, $, keepAwake } from "./util.js";
import { makePanels } from "./panels.js";
import { makeHandInput } from "./handinput.js";

var R = AR.render;
var CENTER = { x: 0.5, y: 0.52 };
var SLICES = 12;              // equal-time slices per orbit
var BACK_AFTER_MS = 1500;
var MAX_RUNS = 40;
var LOOK = {
  earth: { icon: "🌍", light: "#7cc4ff", base: "#2563eb", dark: "#0b2a6b", land: "#3fa34d", glow: "rgba(120,190,255,0.35)" },
  moon: { icon: "🌕", light: "#f1f1ee", base: "#b9b9b2", dark: "#5d5d58", land: null, glow: null },
  mars: { icon: "🔴", light: "#f6a77a", base: "#c4522a", dark: "#5e1d0a", land: null, glow: "rgba(255,150,110,0.18)" },
  jupiter: { icon: "🪐", light: "#f3dcb6", base: "#c99a63", dark: "#6b4724", land: null, glow: null }
};
/* Deterministic stars. */
var STARS = [];
for (var i = 0; i < 90; i++) STARS.push({ x: (i * 0.6180339887) % 1, y: (i * 0.4142135 + 0.37 * (i % 7)) % 1, r: 0.5 + (i % 3) * 0.5 });

/* 5432 s → "1 h 31 min"; long times in days. */
export function formatDuration(s) {
  if (!isFinite(s)) return "—";
  if (s < 3600) return Math.round(s / 60) + " min";
  if (s < 86400 * 2) { var h = Math.floor(s / 3600), m = Math.round((s - h * 3600) / 60); if (m === 60) { h++; m = 0; } return h + " h " + m + " min"; }
  return (s / 86400).toFixed(1) + " days";
}
function km(m) { return Math.round(m / 1000).toLocaleString("en") + " km"; }
function kms(v) { return (v / 1000).toFixed(1) + " km/s"; }

export var Orbit = {
  sat: new AR.Satellite({ grabAnywhere: true }),
  input: null, panels: null,
  live: false, raf: 0,
  hand: null,
  runs: [],
  launch: null,          // the current flight's launch event
  endedAt: 0,
  settings: null,

  loadSettings: function() {
    var s = store.get("orbit", {});
    this.settings = {
      planet: AR.PLANETS[s.planet] ? s.planet : "earth",
      slow: ["1", "0.5", "0.25"].indexOf(s.slow) >= 0 ? s.slow : "1",
      slices: s.slices !== false,
      mirror: s.mirror !== false,
      sound: s.sound !== false,
      back: s.back === true
    };
  },
  saveSettings: function() { store.set("orbit", this.settings); },
  planet: function() { return AR.PLANETS[this.settings.planet]; },
  params: function() {
    var wrap = $("o-wrap"), aspect = wrap.clientWidth && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : 4 / 3;
    var pl = this.planet();
    return {
      planet: pl,
      H: 12 * pl.R / Math.min(1, aspect),     // at least 12 planet radii across the narrow way
      center: CENTER,
      warp: AR.defaultWarp(pl),
      slow: parseFloat(this.settings.slow) || 1,
      aspect: aspect
    };
  },
  startPoint: function(p) { return { x: CENTER.x, y: CENTER.y - 2.6 * p.planet.R / p.H }; },
  status: function(msg, cls) {
    var el = $("o-status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  },
  toast: function(msg, kind) {
    var el = $("o-toast");
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function() { el.className = "toast"; }, 2400);
  },

  /* ---------- starting and stopping ---------- */
  startCamera: function() {
    var self = this;
    Sounds.unlock();
    $("o-cam").disabled = true;
    $("o-start-note").textContent = "Loading the hand tracker… (about 18 MB the first time, then it's saved)";
    self.status("Starting the camera…", "");
    self.input.startCamera().then(function() {
      self.run();
      self.status("Pinch 🤏 (thumb and finger together): the satellite jumps between your fingers. Swing sideways and let go.", "ok");
    }, function(err) {
      if (err && err.aborted) return;
      self.status(err.message, "err");
      $("o-start-note").textContent = err.message;
    }).then(function() { $("o-cam").disabled = false; });
  },
  startTouch: function() {
    Sounds.unlock();
    this.input.startTouch();
    this.run();
    this.status("Press anywhere: the satellite jumps to your finger. Flick sideways and let go.", "ok");
  },
  run: function() {
    var self = this;
    self.stop();
    $("o-start").hidden = true;
    self.satBack();
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
    $("o-start").hidden = false;
    $("o-start-note").textContent = "The first time, the hand tracker downloads (about 18 MB). Video never leaves this device.";
    this.status("Pick camera or finger to start.", "");
    this.panels.closeSheets();
    this.drawIdle();
  },
  satBack: function() {
    this.sat.reset(this.startPoint(this.params()));
    this.launch = null; this.endedAt = 0; this.hand = null;
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
      var ev = self.sat.update(now, self.hand, p);
      if (ev) self.onEvent(ev, p, now);
    }
    var t = self.sat.tick(now, p);
    if (t) self.onEvent(t, p, now);
    if ((self.sat.state === "crashed" || self.sat.state === "escaped") && now - self.endedAt > BACK_AFTER_MS) {
      self.satBack();
      self.status("Here's a new satellite. Grab it and try again!", "");
    }
    self.draw(p);
    self.readouts(p);
  },
  onEvent: function(ev, p, now) {
    var name = p.planet.name;
    if (ev.type === "grabbed") {
      Sounds.grab();
      this.launch = null;
      this.status("Got it! Move it where you like, then swing it sideways and open your fingers to let go.", "ok");
    } else if (ev.type === "launched") {
      Sounds.release();
      this.launch = ev;
      this.status("Launched at " + kms(ev.speed) + ", " + km(ev.altitude) + " up. Here, a circle needs " + kms(ev.vCirc) +
        " and escaping needs " + kms(ev.vEsc) + "." + (ev.elements.bound ? "" : " That's faster than escape speed!"), "");
    } else if (ev.type === "orbit") {
      if (ev.n === 1) {
        Sounds.catchAir();
        this.addRun("orbit", ev, p);
        this.toast("One orbit: " + formatDuration(ev.T));
        this.status("One orbit took " + formatDuration(ev.T) + " (Kepler's third law says " + formatDuration(ev.Tkepler) +
          "). Watch it speed up close to " + name + " and slow down far away: Kepler's second law.", "ok");
      }
    } else if (ev.type === "crashed") {
      Sounds.land(1);
      this.endedAt = now;
      this.addRun("crashed", ev, p);
      this.toast("Crash! 💥", "warn");
      this.status("It crashed into " + name + ": not fast enough sideways. Newton's idea: throw it faster, and it falls around " +
        name + " instead of into it.", "err");
    } else if (ev.type === "escaped") {
      Sounds.bounce(1);
      this.endedAt = now;
      this.addRun("escaped", ev, p);
      this.toast("Escaped! 🚀", "info");
      this.status("It escaped! At " + kms(this.launch.speed) + " it beat the escape speed there (" + kms(this.launch.vEsc) +
        "), so " + name + "'s gravity can never pull it back.", "ok");
    }
  },

  /* ---------- results ---------- */
  addRun: function(result, ev, p) {
    var L = this.launch;
    if (!L) return;
    this.runs.push({ planet: this.settings.planet, result: result, altitude: L.altitude, speed: L.speed,
      vCirc: L.vCirc, vEsc: L.vEsc, T: result === "orbit" ? ev.T : null, a: L.elements.a, e: L.elements.e,
      R: p.planet.R, GM: p.planet.GM });
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    this.renderResults();
  },
  renderResults: function() {
    var rows = $("o-rows");
    rows.textContent = "";
    for (var i = this.runs.length - 1; i >= 0; i--) {
      var r = this.runs[i], tr = document.createElement("tr");
      [String(i + 1), LOOK[r.planet].icon, km(r.altitude), (r.speed / 1000).toFixed(1), (r.vEsc / 1000).toFixed(1),
        r.result === "orbit" ? formatDuration(r.T) : r.result === "crashed" ? "💥 crashed" : "🚀 escaped"].forEach(function(text) {
        var td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
      });
      rows.appendChild(tr);
    }
    $("o-count").textContent = String(this.runs.length);
    var last = this.runs[this.runs.length - 1], pl = this.planet();
    if (!last) {
      $("o-head-label").textContent = "Escape speed at the surface of " + pl.name;
      $("o-head").textContent = kms(AR.escapeSpeed(pl.GM, pl.R));
      $("o-summary").textContent = "No launches yet. Flick the satellite sideways: too slow, too fast, or just right?";
    } else if (last.result === "orbit") {
      $("o-head-label").textContent = "Last orbit took";
      $("o-head").textContent = formatDuration(last.T);
      $("o-summary").textContent = "Launched at " + kms(last.speed) + " (a circle needed " + kms(last.vCirc) +
        "). The bigger the orbit, the longer it takes: T² grows with a³ (Kepler's third law).";
    } else {
      $("o-head-label").textContent = last.result === "crashed" ? "Crashed at" : "Escaped at";
      $("o-head").textContent = kms(last.speed);
      $("o-summary").textContent = "Escape speed at that height was " + kms(last.vEsc) + "; a circular orbit needed " + kms(last.vCirc) +
        ". Anything in between makes an orbit.";
    }
    var orbits = this.runs.filter(function(r) { return r.result === "orbit" && r.planet === this.settings.planet; }, this);
    $("o-plot-wrap").hidden = orbits.length < 2;
    if (orbits.length >= 2 && this.panels && this.panels.resultsVisible()) this.plot(orbits);
  },
  /* Kepler's third law: T² (hours²) against a³ (planet radii³). */
  plot: function(orbits) {
    var cv = $("o-plot");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr, ink = inkOf(cv);
    ctx.clearRect(0, 0, dims.w, dims.h);
    var pts = orbits.map(function(r) { var a = r.a / r.R; return { x: a * a * a, y: Math.pow(r.T / 3600, 2) }; });
    var xMax = Math.max.apply(null, pts.map(function(q) { return q.x; })) * 1.15;
    var pl = this.planet(), k = 4 * Math.PI * Math.PI * Math.pow(pl.R, 3) / pl.GM / (3600 * 3600);   // T² per a³
    var yMax = Math.max(k * xMax, Math.max.apply(null, pts.map(function(q) { return q.y; })) * 1.1);
    var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, xMax], [0, yMax],
      ["orbit size³ (a³, in " + pl.name.replace("the ", "") + " radii³)", "T² (hours²)"], ink);
    ctx.strokeStyle = "#1a56db"; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(A.X(0), A.Y(0)); ctx.lineTo(A.X(xMax), A.Y(k * xMax)); ctx.stroke();
    ctx.fillStyle = "#3b6fe0"; ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
    ctx.fillText("Kepler: T² ∝ a³", A.X(xMax * 0.05), A.Y(yMax * 0.86));
    ctx.fillStyle = "#e5484d";
    pts.forEach(function(q) { ctx.beginPath(); ctx.arc(A.X(q.x), A.Y(q.y), 4.5 * d, 0, 2 * Math.PI); ctx.fill(); });
  },

  /* ---------- drawing ---------- */
  draw: function(p) {
    var cv = $("o-canvas");
    var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), W = dims.w, H = dims.h, d = dims.dpr;
    ctx.clearRect(0, 0, W, H);
    // Space over the camera, with stars.
    ctx.fillStyle = "rgba(3,6,18,0.62)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    STARS.forEach(function(s) { ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * d, 0, 2 * Math.PI); ctx.fill(); });
    var sat = this.sat, pl = p.planet, look = LOOK[this.settings.planet];
    var cx = CENTER.x * W, cy = CENTER.y * H, ppm = H / p.H, Rp = pl.R * ppm;
    var toPx = function(m) { return { x: cx + m.x * ppm, y: cy - m.y * ppm }; };
    var el = sat.state === "flying" ? sat.elements : null;
    // Equal-time slices (Kepler's second law), from the trail.
    if (el && el.bound && this.settings.slices && sat.trail.length > 2) {
      var dt = el.T / SLICES;
      var groups = {};
      sat.trail.forEach(function(q) { var k = Math.floor(q.t / dt); (groups[k] = groups[k] || []).push(q); });
      Object.keys(groups).forEach(function(k) {
        var g = groups[k];
        var next = groups[+k + 1];
        if (next) g = g.concat([next[0]]);
        ctx.fillStyle = +k % 2 ? "rgba(250,204,21,0.20)" : "rgba(56,189,248,0.22)";
        ctx.beginPath(); ctx.moveTo(cx, cy);
        g.forEach(function(q) { ctx.lineTo(q.x * W, q.y * H); });
        ctx.closePath(); ctx.fill();
      });
    }
    // The orbit it's on (Kepler's first law): an ellipse with the planet at a focus.
    if (el && el.bound) {
      var r = sat.pos, v = sat.vel, rr = Math.hypot(r.x, r.y), v2 = v.x * v.x + v.y * v.y, rv = r.x * v.x + r.y * v.y;
      var ex = ((v2 - pl.GM / rr) * r.x - rv * v.x) / pl.GM, ey = ((v2 - pl.GM / rr) * r.y - rv * v.y) / pl.GM;
      var w = Math.atan2(ey, ex), semi = el.h * el.h / pl.GM;
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.5 * d; ctx.setLineDash([6 * d, 6 * d]);
      ctx.beginPath();
      for (var j = 0; j <= 240; j++) {
        var th = j / 240 * 2 * Math.PI, rad = semi / (1 + el.e * Math.cos(th - w));
        var q = toPx({ x: rad * Math.cos(th), y: rad * Math.sin(th) });
        if (j === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (el.e > 0.08) {
        // The other focus: where a second "planet" would sit in the ellipse.
        var f2 = toPx({ x: -2 * el.a * el.e * Math.cos(w), y: -2 * el.a * el.e * Math.sin(w) });
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5 * d;
        ctx.beginPath(); ctx.moveTo(f2.x - 6 * d, f2.y); ctx.lineTo(f2.x + 6 * d, f2.y);
        ctx.moveTo(f2.x, f2.y - 6 * d); ctx.lineTo(f2.x, f2.y + 6 * d); ctx.stroke();
        label(ctx, d, "other focus", f2.x, f2.y - 10 * d, "center", 11);
      }
    }
    // Trail.
    if (sat.trail.length > 1) {
      ctx.strokeStyle = "rgba(125,211,252,0.9)"; ctx.lineWidth = 2 * d;
      ctx.beginPath();
      sat.trail.forEach(function(q, i) { if (i === 0) ctx.moveTo(q.x * W, q.y * H); else ctx.lineTo(q.x * W, q.y * H); });
      ctx.stroke();
    }
    // The planet.
    if (look.glow) {
      var gl = ctx.createRadialGradient(cx, cy, Rp * 0.95, cx, cy, Rp * 1.18);
      gl.addColorStop(0, look.glow); gl.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, Rp * 1.18, 0, 2 * Math.PI); ctx.fill();
    }
    var gr = ctx.createRadialGradient(cx - Rp * 0.35, cy - Rp * 0.4, Rp * 0.1, cx, cy, Rp);
    gr.addColorStop(0, look.light); gr.addColorStop(0.6, look.base); gr.addColorStop(1, look.dark);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, 2 * Math.PI); ctx.fill();
    if (this.settings.planet === "jupiter") {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, 2 * Math.PI); ctx.clip();
      ctx.fillStyle = "rgba(120,70,30,0.35)";
      [-0.45, -0.15, 0.2, 0.5].forEach(function(b) { ctx.fillRect(cx - Rp, cy + b * Rp, 2 * Rp, Rp * 0.12); });
      ctx.restore();
    } else if (look.land) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, 2 * Math.PI); ctx.clip();
      ctx.fillStyle = look.land;
      [[-0.3, -0.2, 0.35], [0.25, 0.25, 0.28], [0.1, -0.5, 0.18]].forEach(function(c) {
        ctx.beginPath(); ctx.ellipse(cx + c[0] * Rp, cy + c[1] * Rp, c[2] * Rp, c[2] * Rp * 0.7, 0.5, 0, 2 * Math.PI); ctx.fill();
      });
      ctx.restore();
    }
    label(ctx, d, pl.name.replace("the ", "The "), cx, cy + 5 * d, "center", 13);
    // The satellite, its speed arrow, or a pointer when it's off screen.
    var sx = sat.x * W, sy = sat.y * H, off = sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8;
    if (off && sat.state === "flying") {
      var ax = Math.min(W - 18 * d, Math.max(18 * d, sx)), ay = Math.min(H - 18 * d, Math.max(18 * d, sy));
      label(ctx, d, sat.elements.bound ? "↗ coming back" : "→ leaving", ax, ay, ax > W / 2 ? "right" : "left", 13);
    } else if (sat.state !== "escaped") {
      if (sat.state === "flying" && sat.vel) {
        var sp = sat.speed(), vx = sat.vel.x / sp, vy = -sat.vel.y / sp, len = 26 * d + sp / 1000 * 6 * d;
        ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2.5 * d;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + vx * len, sy + vy * len); ctx.stroke();
        label(ctx, d, (sp / 1000).toFixed(1) + " km/s", sx + vx * (len + 8 * d), sy + vy * (len + 8 * d) + 4 * d, vx < 0 ? "right" : "left", 13);
      }
      var k = 1.7 * d;                                               // satellite size
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(sx - 15 * k, sy - 3.5 * k, 30 * k, 7 * k);         // solar panels
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(sx - 15 * k, sy - 3.5 * k, 9 * k, 7 * k); ctx.fillRect(sx + 6 * k, sy - 3.5 * k, 9 * k, 7 * k);
      ctx.fillStyle = sat.state === "crashed" ? "#ef4444" : "#f8fafc";
      ctx.beginPath(); ctx.arc(sx, sy, 6 * k, 0, 2 * Math.PI); ctx.fill();
      if (sat.state === "resting" && !this.hand) {
        ctx.strokeStyle = "rgba(245,165,36,0.9)"; ctx.lineWidth = 2 * d; ctx.setLineDash([5 * d, 4 * d]);
        ctx.beginPath(); ctx.arc(sx, sy, 34 * d, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, d, "🤏 pinch anywhere, then swing sideways", sx, sy - 44 * d, "center", 14);
      }
    }
    // The hand.
    var hand = this.hand;
    if (hand) {
      ctx.strokeStyle = sat.gate.closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
      ctx.lineWidth = 2 * d;
      if (hand.lm) {
        BONES.forEach(function(bn) {
          ctx.beginPath(); ctx.moveTo(hand.lm[bn[0]].x * W, hand.lm[bn[0]].y * H);
          ctx.lineTo(hand.lm[bn[1]].x * W, hand.lm[bn[1]].y * H); ctx.stroke();
        });
      }
      if (hand.lm) {
        // Thumb tip to index tip, and the pinch point between them.
        ctx.lineWidth = 3 * d;
        ctx.beginPath(); ctx.moveTo(hand.lm[4].x * W, hand.lm[4].y * H); ctx.lineTo(hand.lm[8].x * W, hand.lm[8].y * H); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.arc(hand.x * W, hand.y * H, (sat.gate.closed ? 7 : 5) * d, 0, 2 * Math.PI); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(hand.x * W, hand.y * H, 22 * d, 0, 2 * Math.PI);
        ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, d, sat.gate.closed ? "🤏" : "✋", hand.x * W, hand.y * H + 5 * d, "center", 18);
      }
    }
  },
  drawIdle: function() { this.draw(this.params()); },
  readouts: function(p) {
    var sat = this.sat, r = sat.r(p);
    $("o-hand").textContent = !this.hand ? "—" : sat.gate.closed ? "🤏" : "✋";
    $("o-speed").textContent = sat.state === "flying" ? kms(sat.speed()) : this.launch ? kms(this.launch.speed) : "—";
    $("o-alt").textContent = km(Math.max(0, r - p.planet.R));
    $("o-esc").textContent = kms(AR.escapeSpeed(p.planet.GM, Math.max(r, p.planet.R)));
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
    seg("o-planet", "planet", function() {
      self.satBack();
      self.renderResults();
      if (!self.live) self.drawIdle();
      var pl = self.planet();
      self.toast(LOOK[s.planet].icon + " " + pl.name.replace("the ", "The "), "info");
      self.status("Around " + pl.name + ": escape speed at the surface is " + kms(AR.escapeSpeed(pl.GM, pl.R)) + ".", "");
    });
    seg("o-slow", "slow");
    var toggle = function(id, key, after) {
      var el = $(id);
      el.checked = !!s[key];
      el.addEventListener("change", function() { s[key] = el.checked; self.saveSettings(); if (after) after(); });
    };
    toggle("o-slices", "slices");
    var applyMirror = function() { $("o-wrap").classList.toggle("mirrored", s.mirror); };
    toggle("o-mirror", "mirror", applyMirror);
    applyMirror();
    toggle("o-sound", "sound", function() { Sounds.enabled = s.sound; if (s.sound) { Sounds.unlock(); Sounds.grab(); } });
    toggle("o-backcam", "back", function() {
      s.mirror = !s.back; $("o-mirror").checked = s.mirror; applyMirror(); self.saveSettings();
      var wasLive = self.input.source === "camera";
      self.input.close();
      if (wasLive) self.startCamera();
    });
  },
  init: function() {
    var self = this;
    self.loadSettings();
    self.input = makeHandInput({ wrap: $("o-wrap"), video: $("o-video"), canvas: $("o-canvas") }, {
      grip: "pinch",                      // a small satellite: hold it between thumb and finger
      mirror: function() { return self.settings.mirror; },
      back: function() { return self.settings.back; },
      status: function(msg, cls) { self.status(msg, cls); },
      quiet: function() { return self.sat.state === "flying"; },
      handBack: function() {
        self.status(self.sat.state === "held" ? "Got it! Swing it sideways and open your fingers to let go."
          : "I see your hand ✋. Pinch 🤏 thumb and finger together to pick up the satellite.", "ok");
      }
    });
    self.panels = makePanels($("screen-orbit"), "orbit", function() { self.renderResults(); });
    self.initSettings();
    $("o-cam").addEventListener("click", function() { self.startCamera(); });
    $("o-touch").addEventListener("click", function() { self.startTouch(); });
    $("o-reset").addEventListener("click", function() {
      self.satBack();
      if (!self.live) self.drawIdle();
      self.status("Here's a new satellite.", "");
    });
    $("o-clear").addEventListener("click", function() { self.runs = []; self.renderResults(); });
    document.addEventListener("keydown", function(e) {
      if ($("screen-orbit").hidden || e.code !== "Space") return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      $("o-reset").click();
    });
    window.addEventListener("resize", function() {
      if ($("screen-orbit").hidden) return;
      if (self.sat.state === "resting") self.satBack();
      if (!self.live) self.drawIdle();
      self.renderResults();
    });
    self.satBack();
    self.renderResults();
  },
  enter: function() {
    var self = this;
    requestAnimationFrame(function() { self.satBack(); self.drawIdle(); self.renderResults(); });
  }
};
