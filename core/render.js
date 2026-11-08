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
export function drawTrackMarker(ctx, dims, c) {
  ctx.strokeStyle = "#4ecd64";
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
