/* Catch & drop, shared by the classic lab page (lab/modes/catch.js) and the
 * app (app/catch.js): the scene drawing, the t²-vs-h graph, the fit, and the
 * mystery planets. Canvas only: callers pass contexts and plain state. */
import * as AR from "../core/index.js";

var R = AR.render;

export var BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
export var MYSTERY = [3.7, 8.87, 1.62, 3.71, 24.79, 10.44, 8.69, 11.15, 0.62, 2.3, 15.2, 6.1]; // incl. made-up worlds
export var PLANETS = { 3.7: "Mercury", 8.87: "Venus", 1.62: "the Moon", 3.71: "Mars", 24.79: "Jupiter",
  10.44: "Saturn", 8.69: "Uranus", 11.15: "Neptune", 0.62: "Pluto" };

/* A new mystery g, never the same twice in a row. */
export function pickMystery(prev) {
  var g;
  do { g = MYSTERY[Math.floor(Math.random() * MYSTERY.length)]; } while (g === prev);
  return g;
}
export function planetName(g) { return PLANETS[g] || "an imaginary planet"; }

/* Mouse / touch as a hand: pressed = fist, hovering = open hand.
 * pt: {inside, down, x, y, t (ms, when it was at x, y), upAt (ms)};
 * prev: last frame's hand (or null).
 * A finger has no hover, so it is shown as an open hand for the first
 * frame of a press (or the fist would already be "closed" when first
 * seen, and first sightings don't count as a grab), and for a moment after
 * it lifts (so lifting reads as opening the hand, not as the hand leaving). */
export var LIFT_MS = 120;
export function pointerHand(pt, prev, now) {
  var lingering = !pt.down && now - (pt.upAt || -Infinity) < LIFT_MS;
  if (!pt.down && !pt.inside && !lingering) return null;
  var closed = pt.down && !!prev;
  // t: when the finger was last at (x, y) — truer than the frame's time.
  return { x: pt.x, y: pt.y, open: closed ? 0 : 1, lm: null, t: pt.t };
}

/* g from the slope of t² vs h through the origin (t² = (2/g)·h).
 * trials: [{h, t}] → g in m/s², NaN with no data. */
export function fitDropsG(trials) {
  var shh = 0, sht = 0;
  trials.forEach(function(tr) { shh += tr.h * tr.h; sht += tr.h * tr.t * tr.t; });
  return sht > 0 ? 2 * shh / sht : NaN;
}

/* Summary of a set of drops: n, mean/std of 2h/t², the fitted g, the
 * height spread (a good line needs low, middle and high drops). */
export function summarizeDrops(trials) {
  var gs = trials.map(function(t) { return t.g; });
  var hs = trials.map(function(t) { return t.h; });
  return {
    n: trials.length,
    gMean: gs.length ? AR.mean(gs) : NaN,
    gStd: gs.length > 1 ? AR.std(gs) : 0,
    gFit: fitDropsG(trials),
    spread: hs.length > 1 ? Math.max.apply(null, hs) - Math.min.apply(null, hs) : 0,
    heights: hs
  };
}

/**
 * Draw the game over the video. s: {p (CatchParams), ball (CatchBall),
 * hand ({x, y, lm|null}|null), drop ({x, y, h0}|null), trail ([{x, y}]),
 * skin (render ball), floorLabel?: bool}. Positions are fractions of the canvas.
 */
export function drawCatchScene(ctx, dims, s) {
  var W = dims.w, H = dims.h, d = dims.dpr, p = s.p, ball = s.ball;
  ctx.clearRect(0, 0, W, H);
  // Height ruler: the floor is the bottom of the view.
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = d;
  var step = p.h > 4 ? 1 : 0.5;
  for (var m = 0; m <= p.h + 1e-9; m += step) {
    var py = H * (1 - m / p.h);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(10 * d, py); ctx.stroke();
    if (m > 0 && py > 16 * d) label(ctx, d, m.toFixed(1) + " m", 13 * d, py + 4 * d, "left", 11);
  }
  // Drop-height marker: from the release point down to the floor.
  if (s.drop && ball.state !== "held") {
    var x = s.drop.x * W, y0 = s.drop.y * H;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.setLineDash([5 * d, 5 * d]);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x - 8 * d, y0); ctx.lineTo(x + 8 * d, y0); ctx.stroke();
    label(ctx, d, "h = " + s.drop.h0.toFixed(2) + " m", x - 12 * d, (y0 + H) / 2, "right");
  }
  // The hand: skeleton from the camera, or a ring for the pointer.
  var closed = ball.gate.closed;
  var hand = s.hand;
  if (hand) {
    ctx.strokeStyle = closed ? "rgba(245,165,36,0.95)" : "rgba(78,205,100,0.95)";
    ctx.lineWidth = 2 * d;
    var lm = hand.lm;
    if (lm) {
      BONES.forEach(function(b) {
        ctx.beginPath(); ctx.moveTo(lm[b[0]].x * W, lm[b[0]].y * H); ctx.lineTo(lm[b[1]].x * W, lm[b[1]].y * H); ctx.stroke();
      });
    }
    ctx.beginPath();
    ctx.arc(hand.x * W, hand.y * H, ball.catchR * H, 0, 2 * Math.PI);
    ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
    if (!lm) label(ctx, d, closed ? "✊" : "✋", hand.x * W, hand.y * H + 5 * d, "center", 18);
  }
  // Trail of the current fall, then the ball.
  ctx.fillStyle = "rgba(78,205,196,0.6)";
  s.trail.forEach(function(t) { ctx.beginPath(); ctx.arc(t.x * W, t.y * H, 3 * d, 0, 2 * Math.PI); ctx.fill(); });
  var r = Math.max(R.ballRadius(dims), 0.035 * Math.min(W, H));
  var bx = ball.x * W, by = Math.min(H - r, ball.y * H);
  R.drawShadow(ctx, bx, H, r, Math.min(1, ball.y));
  R.drawBall(s.skin || R.makeBall(), ctx, bx, by, r);
  if (ball.state === "falling") label(ctx, d, "t = " + ball.t.toFixed(2) + " s", bx + r + 8 * d, by, "left", 14);
}

/* The t²-vs-h graph with the fitted line. ink: "r,g,b" for axes and text. */
export function plotDrops(cv, trials, gFit, ink) {
  var dims = R.fitCanvas(cv), ctx = cv.getContext("2d"), d = dims.dpr;
  ctx.clearRect(0, 0, dims.w, dims.h);
  var hMax = Math.max(0.5, Math.max.apply(null, trials.map(function(t) { return t.h; }).concat([0])) * 1.1);
  var t2Max = Math.max(0.05, Math.max.apply(null, trials.map(function(t) { return t.t * t.t; }).concat([0])) * 1.15);
  var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, [0, hMax], [0, t2Max],
    ["drop height h (m)", "t² (s²)"], ink);
  if (trials.length && isFinite(gFit)) {
    ctx.strokeStyle = "#1a56db";
    ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.moveTo(A.X(0), A.Y(0)); ctx.lineTo(A.X(hMax), A.Y(2 * hMax / gFit)); ctx.stroke();
    ctx.fillStyle = "#3b6fe0";
    ctx.font = "600 " + (11 * d) + "px system-ui, sans-serif";
    ctx.fillText("slope = 2/g → g ≈ " + gFit.toFixed(2) + " m/s²", A.X(hMax * 0.04), A.Y(t2Max * 0.86));
  }
  ctx.fillStyle = "#e5484d";
  trials.forEach(function(t) {
    ctx.beginPath(); ctx.arc(A.X(t.h), A.Y(t.t * t.t), 3.5 * d, 0, 2 * Math.PI); ctx.fill();
  });
}

/* Text with a dark outline, readable over any video. */
export function label(ctx, d, text, x, y, align, size) {
  ctx.font = "600 " + ((size || 12) * d) + "px system-ui, sans-serif";
  ctx.textAlign = align || "left";
  ctx.lineWidth = 3 * d;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
  ctx.textAlign = "start";
}

/* An element's text color as "r,g,b", so charts follow the page theme. */
export function inkOf(el) {
  var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color || "");
  return m ? m[1] + "," + m[2] + "," + m[3] : "0,0,0";
}
