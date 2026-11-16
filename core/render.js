/**
 * Canvas drawing for the AR overlays: realistic balls, the simulate scene,
 * tracker feedback and the fit plot. Every function takes a 2D context and
 * the canvas size from fitCanvas(); none reads the page.
 * @module core/render
 */

/** @typedef {{w: number, h: number, dpr: number}} Dims  canvas size in device px */

/* Match a canvas's backing store to its CSS size × devicePixelRatio. */
export function fitCanvas(cv) {
  var r = cv.getBoundingClientRect();
  var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  var w = Math.max(1, Math.round(r.width * dpr));
  var h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w: w, h: h, dpr: dpr };
}

export const BALL_STYLES = Object.freeze({
  tennis:     { light: "#e9f27e", base: "#c4d000", dark: "#6d7800", seam: "#f5f5ec" },
  basketball: { light: "#f59a4e", base: "#dd671a", dark: "#7c3708", seam: "#2a1a10" },
  bowling:    { light: "#8494b3", base: "#2b3140", dark: "#080a0f", seam: "#04050a" },
  classic:    { light: "#ff8a7a", base: "#e5484d", dark: "#881b20", seam: null }
});
export function isBallStyle(s) { return Object.prototype.hasOwnProperty.call(BALL_STYLES, s); }
export function makeBall(style) { return { style: isBallStyle(style) ? style : "tennis", angle: 0 }; }
export function ballRadius(dims) { return Math.max(8 * dims.dpr, dims.w * 0.03); }

/* Soft ground shadow: tighter + darker as the ball nears the ground. */
export function drawShadow(ctx, x, groundY, r, prox) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0," + (0.06 + 0.28 * prox).toFixed(3) + ")";
  ctx.beginPath();
  ctx.ellipse(x, groundY - 2, r * (1.7 - 0.7 * prox), Math.max(1, r * 0.22), 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
export function drawBall(ball, ctx, x, y, r) {
  var P = BALL_STYLES[ball.style] || BALL_STYLES.tennis;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.clip();
  // Spherical shading: light from top-left, dark limb at the edge.
  var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.1, x, y, r * 1.3);
  g.addColorStop(0, P.light);
  g.addColorStop(0.55, P.base);
  g.addColorStop(1, P.dark);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  // Seams rotate as the ball spins.
  if (P.seam) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ball.angle);
    ctx.strokeStyle = P.seam;
    ctx.lineWidth = Math.max(1, r * 0.075);
    ctx.lineCap = "round";
    if (ball.style === "tennis") {
      ctx.beginPath(); ctx.arc(-r * 1.05, 0, r * 0.95, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 1.05, 0, r * 0.95, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      // Felt speckle (deterministic — no flicker between frames).
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (var i = 0; i < 50; i++) {
        var fx = (((i * 73) % 100) / 100) * 2 * r - r;
        var fy = (((i * 137) % 100) / 100) * 2 * r - r;
        if (fx * fx + fy * fy < r * r * 0.9) ctx.fillRect(fx, fy, 1.2, 1.2);
      }
    } else if (ball.style === "basketball") {
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 1.35, 0, r * 0.95, -0.7, 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 1.35, 0, r * 0.95, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
    } else if (ball.style === "bowling") {
      ctx.fillStyle = P.seam;
      [[-r * 0.25, -r * 0.3], [r * 0.22, -r * 0.34], [0, r * 0.02]].forEach(function(o) {
        ctx.beginPath(); ctx.arc(o[0], o[1], r * 0.11, 0, 2 * Math.PI); ctx.fill();
      });
    }
    ctx.restore();
  }
  // Specular highlight — fixed light source, does not rotate.
  ctx.save();
  ctx.translate(x - r * 0.36, y - r * 0.44); ctx.rotate(-0.5);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.26, r * 0.15, 0, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  // Contact shading along the lower limb + crisp outline.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}

/**
 * Simulate overlay: height ruler, ground, trail and the falling ball.
 * @param {import("./sim.js").FreeFall} fall  uses fall.h for the scale
 * @param {{trail?: boolean}} [opts]
 */
export function drawFallScene(ctx, dims, fall, opts = {}) {
  var W = dims.w, H = dims.h, h = fall.h;
  ctx.clearRect(0, 0, W, H);
  var pxPerM = H / h;
  // ruler ticks every h/4
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(1, dims.dpr);
  ctx.font = (11 * dims.dpr) + "px system-ui, sans-serif";
  for (var i = 0; i <= 4; i++) {
    var my = h * i / 4;
    var py = H - my * pxPerM;
    ctx.beginPath(); ctx.moveTo(8 * dims.dpr, py); ctx.lineTo(20 * dims.dpr, py); ctx.stroke();
    ctx.fillText(my.toFixed(2).replace(/\.?0+$/, "") + " m", 24 * dims.dpr, py + 4 * dims.dpr);
  }
  // ground line
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
  if (opts.trail) {
    ctx.fillStyle = "rgba(78,205,196,0.55)";
    fall.trail.forEach(function(ty) {
      ctx.beginPath();
      ctx.arc(W / 2, Math.min(H - 6 * dims.dpr, (ty / h) * H), 4 * dims.dpr, 0, 2 * Math.PI);
      ctx.fill();
    });
  }
  var r = ballRadius(dims);
  var by = Math.min(H - r, (fall.y / h) * H + r);
  drawShadow(ctx, W / 2, H, r, Math.min(1, fall.y / h));
  drawBall(fall.ball || makeBall(), ctx, W / 2, by, r);
}

/* Auto-track overlay: a ring on the tracked point {x, y} (0..1). */
export function drawTrackMarker(ctx, dims, c, color = "#4ecd64") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dims.dpr;
  ctx.beginPath();
  ctx.arc(c.x * dims.w, c.y * dims.h, 12 * dims.dpr, 0, 2 * Math.PI);
  ctx.stroke();
}

/* "Tracker view": paint the tracker's last match mask as green dots. */
export function drawTrackerMask(ctx, dims, tracker) {
  if (!tracker.mask) return;
  var MW = tracker.width, MH = tracker.height;
  ctx.fillStyle = "rgba(0,255,102,0.45)";
  for (var my = 0; my < MH; my += 2) {
    for (var mx = 0; mx < MW; mx += 2) {
      if (tracker.mask[my * MW + mx]) {
        ctx.fillRect(mx / MW * dims.w, my / MH * dims.h, 2 * dims.dpr, 2 * dims.dpr);
      }
    }
  }
}

/* Dashed release line at `frac` of the frame height. */
export function drawDropLine(ctx, dims, frac) {
  var ly = frac * dims.h;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = Math.max(1, dims.dpr);
  ctx.setLineDash([6 * dims.dpr, 5 * dims.dpr]);
  ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(dims.w, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = (11 * dims.dpr) + "px system-ui, sans-serif";
  ctx.fillText("lift to drop", 8 * dims.dpr, ly - 5 * dims.dpr);
}

/* Hand-hold overlay. x follows the hand, y follows the hand or the fall.
 * opts: {h (ceiling, m), dropLine (0..1 or null), tracker (show mask, or null)}. */
export function drawHandScene(ctx, dims, hb, opts) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var ynorm = 1 - hb.yM / opts.h;
  var bx = hb.sx * dims.w;
  var by = Math.min(dims.h - 8 * dims.dpr, Math.max(8 * dims.dpr, ynorm * dims.h));
  var r = ballRadius(dims);
  if (opts.tracker) drawTrackerMask(ctx, dims, opts.tracker);
  if (opts.dropLine != null && !hb.falling && !hb.landed) drawDropLine(ctx, dims, opts.dropLine);
  if (hb.fix) {
    ctx.strokeStyle = hb.falling ? "#e5484d" : "#4ecd64";
    ctx.lineWidth = 2 * dims.dpr;
    ctx.beginPath();
    ctx.arc(bx, by, r + 6 * dims.dpr, 0, 2 * Math.PI);
    ctx.stroke();
  }
  drawBall(hb.ball || makeBall(), ctx, bx, by, r);
}

/* Small y-vs-t chart: measured points and the fitted parabola. */
export function drawFitPlot(ctx, dims, points, fit) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var tMax = points[points.length - 1].t || 1;
  var yMax = 0;
  points.forEach(function(s) { yMax = Math.max(yMax, s.y); });
  yMax = Math.max(yMax, 0.01);
  function X(t) { return 30 * dims.dpr + (t / tMax) * (dims.w - 40 * dims.dpr); }
  function Y(y) { return dims.h - 14 * dims.dpr - (y / yMax) * (dims.h - 24 * dims.dpr); }
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = dims.dpr;
  ctx.beginPath(); ctx.moveTo(30 * dims.dpr, 4); ctx.lineTo(30 * dims.dpr, dims.h - 14 * dims.dpr);
  ctx.lineTo(dims.w - 6, dims.h - 14 * dims.dpr); ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = (10 * dims.dpr) + "px system-ui, sans-serif";
  ctx.fillText("t (s)", dims.w - 34 * dims.dpr, dims.h - 3 * dims.dpr);
  ctx.fillText("y (m)", 4 * dims.dpr, 10 * dims.dpr);
  ctx.strokeStyle = "#1a56db";
  ctx.lineWidth = 2 * dims.dpr;
  ctx.beginPath();
  for (var i = 0; i <= 40; i++) {
    var t = tMax * i / 40;
    var y = fit.y0 + (fit.v0 || 0) * t + (fit.g / 2) * t * t;
    if (i === 0) ctx.moveTo(X(t), Y(y)); else ctx.lineTo(X(t), Y(y));
  }
  ctx.stroke();
  ctx.fillStyle = "#e5484d";
  points.forEach(function(s) {
    ctx.beginPath(); ctx.arc(X(s.t), Y(s.y), 2.2 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
  });
}

/* Arrow from (x, y) to (x + dx, y + dy), canvas px. */
export function drawArrow(ctx, dims, x, y, dx, dy, color) {
  var len = Math.hypot(dx, dy);
  if (len < 2 * dims.dpr) return;
  var head = Math.min(8 * dims.dpr, len * 0.4), a = Math.atan2(dy, dx);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 2.5 * dims.dpr;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx - head * 0.6 * Math.cos(a), y + dy - head * 0.6 * Math.sin(a)); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - head * Math.cos(a - 0.45), y + dy - head * Math.sin(a - 0.45));
  ctx.lineTo(x + dx - head * Math.cos(a + 0.45), y + dy - head * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

/* Axes for a small chart in box {x, y, w, h} (canvas px) over the data
 * ranges given; returns value → px mappers. A zero line is drawn when 0 is
 * inside the y range. ink: axis/label color as "r,g,b" (default black;
 * pass a light one on dark backgrounds). */
export function chartFrame(ctx, dims, box, xr, yr, labels, ink) {
  var c = ink || "0,0,0";
  var d = dims.dpr, L = box.x + 30 * d, R = box.x + box.w - 6 * d;
  var T = box.y + 14 * d, B = box.y + box.h - 14 * d;
  var xs = xr[1] - xr[0] || 1, ys = yr[1] - yr[0] || 1;
  function X(v) { return L + (v - xr[0]) / xs * (R - L); }
  function Y(v) { return B - (v - yr[0]) / ys * (B - T); }
  ctx.strokeStyle = "rgba(" + c + ",0.25)";
  ctx.lineWidth = d;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();
  if (yr[0] < 0 && yr[1] > 0) {
    ctx.setLineDash([3 * d, 3 * d]);
    ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(R, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "rgba(" + c + ",0.6)";
  ctx.font = (10 * d) + "px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(labels[0], R, box.y + box.h - 2 * d);
  ctx.textAlign = "left";
  ctx.fillText(labels[1], box.x + 4 * d, box.y + 10 * d);
  ctx.fillText(fmtTick(yr[1]), box.x + 2 * d, T + 10 * d);
  ctx.fillText(fmtTick(yr[0]), box.x + 2 * d, B);
  return { X: X, Y: Y };
}
function fmtTick(v) { return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1); }

function range(vals, pad) {
  var lo = Infinity, hi = -Infinity;
  vals.forEach(function(v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  if (!isFinite(lo)) return [0, 1];
  var p = (hi - lo) * (pad || 0.08) || 0.5;
  return [lo - p, hi + p];
}
function dots(ctx, dims, pts, color) {
  ctx.fillStyle = color;
  pts.forEach(function(p) {
    ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
  });
}
function curve(ctx, dims, n, at, color, dash) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dims.dpr;
  if (dash) ctx.setLineDash([5 * dims.dpr, 4 * dims.dpr]);
  ctx.beginPath();
  for (var i = 0; i <= n; i++) {
    var p = at(i / n);
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/* Projectile results: the arc (height vs distance) and the two velocity
 * components vs time — vx stays flat, vy falls at slope −g.
 * res: a successful analyzeProjectile() result. */
export function drawProjectilePlot(ctx, dims, res) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var half = Math.floor(dims.w / 2), dir = res.vx < 0 ? -1 : 1, o = res.origin;
  var pts = res.points;
  // Left: height above launch vs horizontal distance.
  var dist = function(p) { return (p.x - o.x) * dir; };
  var rise = function(p) { return o.y - p.y; };
  var xr = range(pts.map(dist)), yr = range(pts.map(rise));
  var A = chartFrame(ctx, dims, { x: 0, y: 0, w: half - 8 * dims.dpr, h: dims.h }, xr, yr,
    ["distance (m)", "height (m)"]);
  curve(ctx, dims, 48, function(f) {
    var t = res.span * f;
    return [A.X(Math.abs(res.vx) * t), A.Y(res.vy * t - 0.5 * res.g * t * t)];
  }, "#1a56db");
  dots(ctx, dims, pts.map(function(p) { return [A.X(dist(p)), A.Y(rise(p))]; }), "#e5484d");
  // Right: velocity components from neighboring frames, with the fitted lines.
  var vxs = [], vys = [];
  for (var i = 1; i < pts.length - 1; i++) {
    var dt = pts[i + 1].t - pts[i - 1].t;
    if (!(dt > 0)) continue;
    vxs.push([pts[i].t, (pts[i + 1].x - pts[i - 1].x) / dt * dir]);
    vys.push([pts[i].t, -(pts[i + 1].y - pts[i - 1].y) / dt]);
  }
  var vr = range(vxs.concat(vys).map(function(p) { return p[1]; })
    .concat([res.vy, res.vy - res.g * res.span, Math.abs(res.vx), 0]));
  var B = chartFrame(ctx, dims, { x: half, y: 0, w: dims.w - half, h: dims.h }, [0, res.span], vr,
    ["t (s)", "velocity (m/s)"]);
  curve(ctx, dims, 2, function(f) { return [B.X(res.span * f), B.Y(Math.abs(res.vx))]; }, "#0e9f8f");
  curve(ctx, dims, 2, function(f) {
    var t = res.span * f; return [B.X(t), B.Y(res.vy - res.g * t)];
  }, "#d97706");
  dots(ctx, dims, vxs.map(function(p) { return [B.X(p[0]), B.Y(p[1])]; }), "#0e9f8f");
  dots(ctx, dims, vys.map(function(p) { return [B.X(p[0]), B.Y(p[1])]; }), "#d97706");
  ctx.font = "600 " + (10 * dims.dpr) + "px system-ui, sans-serif";
  ctx.fillStyle = "#0e9f8f"; ctx.fillText("vx", B.X(res.span) - 14 * dims.dpr, B.Y(Math.abs(res.vx)) - 4 * dims.dpr);
  ctx.fillStyle = "#d97706"; ctx.fillText("vy", B.X(0) + 4 * dims.dpr, B.Y(res.vy) - 4 * dims.dpr);
}

/* Pendulum results: displacement vs time with the fitted damped swing and
 * a tick at each center crossing used. unit: frame heights → display unit
 * ({k, label}), e.g. {k: 150, label: "cm"} when the frame is 1.5 m tall.
 * res: a successful analyzePendulum() result. model(t): fitted displacement. */
export function drawPendulumPlot(ctx, dims, res, model, unit) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var k = unit.k, ser = res.series, tEnd = ser[ser.length - 1].t;
  var yr = range(ser.map(function(p) { return p.s * k; }), 0.1);
  var A = chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, tEnd], yr,
    ["t (s)", "displacement (" + unit.label + ")"]);
  var t1 = res.crossings[0].t, t2 = res.crossings[res.crossings.length - 1].t;
  curve(ctx, dims, Math.max(60, Math.round((t2 - t1) * 40)), function(f) {
    var t = t1 + (t2 - t1) * f; return [A.X(t), A.Y(model(t) * k)];
  }, "#1a56db");
  dots(ctx, dims, ser.map(function(p) { return [A.X(p.t), A.Y(p.s * k)]; }), "rgba(229,72,77,0.8)");
  ctx.strokeStyle = "rgba(15,32,39,0.55)";
  ctx.lineWidth = dims.dpr;
  res.crossings.forEach(function(c) {
    var x = A.X(c.t);
    ctx.beginPath(); ctx.moveTo(x, A.Y(0) - 5 * dims.dpr); ctx.lineTo(x, A.Y(0) + 5 * dims.dpr); ctx.stroke();
  });
}
