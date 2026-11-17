import { test, assert, near, throws, rng, gaussian } from "./harness.js";
import { analyzeProjectile, projectilePath } from "../core/projectile.js";

const H = 1.5, ASPECT = 4 / 3, W = H * ASPECT; // frame 2 m × 1.5 m
const SCALE = { frameHeightM: H, aspect: ASPECT };
const G = 9.81;

/* A throw: ball still in the hand, pushed for `pushS` seconds at constant
 * acceleration, then free flight until it leaves the frame (or `flightS`
 * ends), then optionally caught and held. Returns frame-fraction samples. */
function throwRecording({
  fps = 30, rest = 0.4, pushS = 0.15, push = { x: 10, y: 30 }, start = { x: 0.3, y: 1.0 },
  flightS = 5, holdS = 0, noise = 0, seed = 1, mirror = false, t0 = 500
} = {}) {
  const rand = rng(seed), out = [];
  const dt = 1 / fps;
  const add = (t, x, y) => out.push({
    t: t0 + t,
    x: (mirror ? W - x : x) / W + gaussian(rand, noise),
    y: y / H + gaussian(rand, noise)
  });
  let t = 0;
  for (; t < rest; t += dt) add(t, start.x, start.y);
  const tPush = t;
  for (; t < tPush + pushS; t += dt) {
    const s = t - tPush;
    add(t, start.x + 0.5 * push.x * s * s, start.y - 0.5 * push.y * s * s);
  }
  // Release state.
  const rx = start.x + 0.5 * push.x * pushS * pushS, ry = start.y - 0.5 * push.y * pushS * pushS;
  const vx = push.x * pushS, vyUp = push.y * pushS;
  const tRel = tPush + pushS;
  let last = null;
  for (; t < tRel + flightS; t += dt) {
    const s = t - tRel;
    const x = rx + vx * s, y = ry - vyUp * s + 0.5 * G * s * s;
    if (x > W * 0.97 || y > H * 0.97) break;
    add(t, x, y);
    last = { x, y };
  }
  const tCatch = t;
  for (; t < tCatch + holdS; t += dt) add(t, last.x, last.y);
  return { samples: out, vx: mirror ? -vx : vx, vyUp, tRelease: t0 + tRel };
}

test("projectile: measures g, launch speed and angle from a clean throw", () => {
  const rec = throwRecording();
  const res = analyzeProjectile(rec.samples, SCALE);
  assert(res.ok, res.error);
  near(res.g, G, 0.05, "g");
  near(res.vx, rec.vx, 0.03, "vx");
  // Launch = first point on the arc, possibly a frame before the release.
  near(res.vy, rec.vyUp - G * (res.origin.t - rec.tRelease), 0.02, "vy at launch");
  near(res.angleDeg, Math.atan2(rec.vyUp, rec.vx) * 180 / Math.PI, 1.5, "angle");
  near(res.ax, 0, 0.05, "no horizontal acceleration");
  assert(res.trimmed >= 3, "hand phase trimmed: " + res.trimmed);
  near(res.apexM, res.vy * res.vy / (2 * res.g), 1e-9, "apex");
  near(res.fps, 30, 1e-6, "fps");
});

test("projectile: noisy throw gives an honest uncertainty", () => {
  const res = analyzeProjectile(throwRecording({ noise: 0.002, seed: 4 }).samples, SCALE);
  assert(res.ok, res.error);
  assert(res.gStdErr > 0 && res.gStdErr < 1, "σg " + res.gStdErr);
  assert(Math.abs(res.g - G) < 4 * res.gStdErr + 0.05, "g within 4σ: " + res.g);
  assert(Math.abs(res.ax) < 4 * res.axStdErr + 0.05, "ax consistent with 0: " + res.ax);
});

test("projectile: works thrown to the left, at 60 fps", () => {
  const rec = throwRecording({ mirror: true, fps: 60 });
  const res = analyzeProjectile(rec.samples, SCALE);
  assert(res.ok, res.error);
  near(res.vx, rec.vx, 0.03, "vx (negative)");
  assert(res.angleDeg > 60 && res.angleDeg < 80, "angle " + res.angleDeg);
  near(res.g, G, 0.05, "g");
});

test("projectile: ignores a false detection and a catch at the end", () => {
  const rec = throwRecording({ holdS: 0.5 });
  const mid = Math.floor(rec.samples.length * 0.55);
  rec.samples[mid] = { ...rec.samples[mid], y: rec.samples[mid].y - 0.15 };
  const res = analyzeProjectile(rec.samples, SCALE);
  assert(res.ok, res.error);
  assert(res.rejected >= 1, "outlier rejected");
  near(res.g, G, 0.1, "g");
});

test("projectile: a lob that is nearly vertical still fits", () => {
  const rec = throwRecording({ push: { x: 0.5, y: 30 }, start: { x: 1, y: 1.2 } });
  const res = analyzeProjectile(rec.samples, SCALE);
  assert(res.ok, res.error);
  near(res.g, G, 0.05, "g");
  assert(res.angleDeg > 85, "almost straight up: " + res.angleDeg);
});

test("projectile: replay path maps the fit back onto the frame", () => {
  const res = analyzeProjectile(throwRecording().samples, SCALE);
  const path = projectilePath(res);
  const first = path.points[0], last = path.points[path.points.length - 1];
  near(path.x(0), first.x, 0.005, "x at launch");
  near(path.measuredY(0), first.y, 0.005, "y at launch");
  near(path.measuredY(path.span), last.y, 0.005, "y at the end");
  near(path.referenceY(1) - path.measuredY(1), (9.81 - res.g) / 2 / H, 1e-9, "ghost differs only by g");
  near(path.velocity(0).vy, -res.vy, 1e-12, "launch vy (down positive)");
});

test("projectile: explains bad recordings", () => {
  const still = [];
  for (let i = 0; i < 30; i++) still.push({ t: i / 30, x: 0.5, y: 0.5 });
  const r = analyzeProjectile(still, SCALE);
  assert(!r.ok && /moved only/.test(r.error) && r.detail, "still ball: " + r.error);
  const few = analyzeProjectile(throwRecording().samples.slice(0, 5), SCALE);
  assert(!few.ok && /need 8\+/.test(few.error), "too few: " + few.error);
  throws(() => analyzeProjectile([], { frameHeightM: 1 }), RangeError);
  throws(() => analyzeProjectile([], { aspect: 1 }), RangeError);
});
