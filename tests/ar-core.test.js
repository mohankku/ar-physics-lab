/* Unit tests for core/ar-core.js — no camera or page needed.
 * Browser: open tests/index.html.  Node: node --test tests/ */
(function() {
"use strict";

var isNode = typeof module !== "undefined" && module.exports;
var AR = isNode ? require("../core/ar-core.js") : window.ARCore;
var test = isNode ? require("node:test") : window.miniTest;
var K = AR.physics;

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function near(a, b, tol, what) {
  assert(Math.abs(a - b) <= tol, (what || "value") + ": expected " + b + " ± " + tol + ", got " + a);
}

/* ---------- kinematics ---------- */
test("fallTime and gravityFromDrop are inverses", function() {
  var t = K.fallTime(2, 9.81);
  near(t, 0.6386, 1e-4, "t");
  near(K.gravityFromDrop(2, t), 9.81, 1e-9, "g");
});

test("mean, std, median", function() {
  near(K.mean([1, 2, 3, 4]), 2.5, 1e-12);
  near(K.std([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 1e-3);
  near(K.median([3, 1, 2]), 2, 0);
  near(K.median([4, 1, 3, 2]), 2.5, 0);
  near(K.percentError(9.81), 0, 1e-12);
});

test("fitFreeFall recovers g and v0 from clean data", function() {
  var pts = [];
  for (var i = 0; i < 20; i++) {
    var t = i / 60;
    pts.push({ t: t, y: 0.1 + 0.5 * t + 0.5 * 9.81 * t * t });
  }
  var f = K.fitFreeFall(pts);
  near(f.g, 9.81, 1e-6, "g"); near(f.v0, 0.5, 1e-6, "v0"); near(f.y0, 0.1, 1e-6, "y0");
  assert(K.fitFreeFall(pts.slice(0, 3)) === null, "needs 4+ points");
});

test("fitGravity recovers g from rest", function() {
  var pts = [0.1, 0.2, 0.3, 0.4].map(function(t) { return { t: t, y: 0.5 * 9.81 * t * t }; });
  near(K.fitGravity(pts).g, 9.81, 1e-9, "g");
});

/* ---------- analyzeFall ---------- */
function trackedDrop(pxPerM, loiter) {
  var s = [], t = 0, i;
  for (i = 0; i < loiter; i++, t += 1 / 60) s.push({ t: t, yPx: 50 });
  for (i = 0; i < 25; i++, t += 1 / 60) {
    var ft = i / 60;
    s.push({ t: t, yPx: 50 + 0.5 * 9.81 * ft * ft * pxPerM });
  }
  return s;
}

test("analyzeFall measures g from tracked pixels", function() {
  var res = AR.analyzeFall(trackedDrop(400, 0), 400);
  assert(res.ok, res.error);
  near(res.fit.g, 9.81, 0.05, "g");
});

test("analyzeFall trims frames before the drop", function() {
  var res = AR.analyzeFall(trackedDrop(400, 15), 400);
  assert(res.ok, res.error);
  near(res.fit.g, 9.81, 0.3, "g");
});

test("analyzeFall explains bad recordings", function() {
  var few = AR.analyzeFall(trackedDrop(400, 0).slice(0, 5), 400);
  assert(!few.ok && /need 8\+/.test(few.error), "too few points");
  var still = [];
  for (var i = 0; i < 20; i++) still.push({ t: i / 60, yPx: 100 });
  var r = AR.analyzeFall(still, 400);
  assert(!r.ok && /moved only/.test(r.error), "no motion: " + r.error);
});

/* ---------- color tracker ---------- */
function frame(W, H, rects) { // rects: [x0, y0, x1, y1, [r,g,b]]
  var d = new Uint8ClampedArray(W * H * 4);
  for (var p = 0; p < W * H; p++) { d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255; d[p * 4 + 3] = 255; }
  rects.forEach(function(rc) {
    for (var y = rc[1]; y < rc[3]; y++) for (var x = rc[0]; x < rc[2]; x++) {
      var i = (y * W + x) * 4;
      d[i] = rc[4][0]; d[i + 1] = rc[4][1]; d[i + 2] = rc[4][2];
    }
  });
  return d;
}
var RED = [229, 72, 77];

test("tracker finds the centroid of a colored blob", function() {
  var tr = new AR.ColorTracker(160, 120);
  var c = tr.locateInPixels(frame(160, 120, [[70, 50, 90, 70, RED]]), { target: AR.color.preset("red"), tol: 60 });
  near(c.x, 79.5 / 160, 1e-9, "x"); near(c.y, 59.5 / 120, 1e-9, "y");
  assert(c.n === 400, "blob size " + c.n);
});

test("tracker prefers the largest blob, unless locked near another", function() {
  var tr = new AR.ColorTracker(160, 120);
  var px = frame(160, 120, [[10, 10, 20, 20, RED], [100, 60, 140, 100, RED]]);
  var opts = { target: AR.color.preset("red"), tol: 60 };
  var big = tr.locateInPixels(px, opts);
  assert(big.n === 1600, "largest blob wins");
  opts.pref = { x: 15 / 160, y: 15 / 120 };
  var held = tr.locateInPixels(px, opts);
  assert(held.n === 100, "lock keeps the smaller blob near pref, got n=" + held.n);
});

test("tracker motion gate ignores a still blob", function() {
  var tr = new AR.ColorTracker(160, 120);
  var px = frame(160, 120, [[70, 50, 90, 70, RED]]);
  var opts = { target: AR.color.preset("red"), tol: 60, motion: true };
  assert(tr.locateInPixels(px, opts) !== null, "first frame differs from blank history");
  assert(tr.locateInPixels(px, opts) === null, "same frame again: nothing moved");
});

test("skin and blue-backdrop classifiers", function() {
  assert(AR.color.isSkinPixel(224, 172, 105), "typical skin tone");
  assert(!AR.color.isSkinPixel(31, 111, 235), "blue is not skin");
  assert(AR.color.isBlueBackdrop(31, 111, 235), "blue sheet");
  assert(!AR.color.isBlueBackdrop(229, 72, 77), "red is not backdrop");
});

/* ---------- simulations ---------- */
test("FreeFall lands at the theoretical time", function() {
  var f = new AR.FreeFall();
  var steps = 0;
  while (!f.step(1 / 1000, 9.81, 2, false) && steps < 1e5) steps++;
  near(f.t, K.fallTime(2, 9.81), 0.002, "t");
  assert(f.y === 2, "clamped to the ground");
});

test("HandBall releases when lifted above the drop line, then lands", function() {
  var hb = new AR.HandBall();
  var p = { g: 9.81, h: 2, motion: false, dropLine: 0.2 };
  var pos = { x: 0.5, y: 0.6 };
  function detect() { return { x: pos.x, y: pos.y }; }
  var now = 1000, ev = null;
  hb.start(now);
  for (var i = 0; i < 60; i++) { now += 16; ev = hb.update(now, p, detect); } // hold still ~1 s
  assert(ev === null && hb.fix && !hb.falling, "holding");
  near(hb.yM, 2 * (1 - 0.6), 0.01, "ball follows hand height");
  pos.y = 0.1; // lift above the line
  for (i = 0; i < 30 && !(ev && ev.type === "released"); i++) { now += 16; ev = hb.update(now, p, detect); }
  assert(ev && ev.type === "released", "released");
  assert(hb.falling, "falling");
  var h0 = ev.h0;
  for (i = 0; i < 500 && !(ev && ev.type === "landed"); i++) { now += 16; ev = hb.update(now, p, detect); }
  assert(ev && ev.type === "landed", "landed");
  assert(hb.landed && hb.yM === 0, "on the ground");
  assert(hb.drop(0, "button", now).reason === "landed", "can't drop a landed ball");
  assert(h0 > 0.05 && h0 <= 2, "drop height in range: " + h0);
});

test("HandBall reports a lost hand and refuses to drop without one", function() {
  var hb = new AR.HandBall();
  var p = { g: 9.81, h: 2, motion: false, dropLine: null };
  var seen = true, now = 0, ev;
  function detect() { return seen ? { x: 0.5, y: 0.5 } : null; }
  hb.start(now);
  for (var i = 0; i < 5; i++) hb.update(now += 16, p, detect);
  seen = false;
  for (i = 0; i < 20 && !(ev && ev.type === "lost"); i++) ev = hb.update(now += 16, p, detect);
  assert(ev && ev.type === "lost", "lost");
  assert(hb.drop(0, "button", now).reason === "no-hand", "no hand to drop from");
});

})();
