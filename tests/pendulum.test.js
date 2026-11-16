import { test, assert, near, throws, rng, gaussian } from "./harness.js";
import { analyzePendulum, pendulumModel, periodFactor } from "../core/pendulum.js";

const H = 1.5, ASPECT = 4 / 3, W = H * ASPECT;
const G = 9.81;

/* A real (nonlinear, lightly damped) pendulum, RK4-integrated, seen by a
 * camera: bob positions in frame fractions. */
function swing({
  L = 0.8, theta0Deg = 15, gamma = 0.05, fps = 30, seconds = 12, noise = 0,
  seed = 1, tilt = 0, hide = () => false, t0 = 100
} = {}) {
  const rand = rng(seed), out = [];
  let th = theta0Deg * Math.PI / 180, om = 0, t = 0;
  const acc = (a, w) => -(G / L) * Math.sin(a) - gamma * w;
  const h = 1 / 2000, frame = 1 / fps;
  let next = 0;
  const pivot = { x: W / 2, y: 0.1 };
  while (t <= seconds) {
    if (t >= next - 1e-12) {
      next += frame;
      if (!hide(t)) {
        let x = pivot.x + L * Math.sin(th), y = pivot.y + L * Math.cos(th);
        if (tilt) { // camera rolled by `tilt` rad about the pivot
          const dx = x - pivot.x, dy = y - pivot.y, c = Math.cos(tilt), s = Math.sin(tilt);
          x = pivot.x + c * dx - s * dy; y = pivot.y + s * dx + c * dy;
        }
        out.push({ t: t0 + t, x: x / W + gaussian(rand, noise), y: y / H + gaussian(rand, noise) });
      }
    }
    const k1a = om, k1w = acc(th, om);
    const k2a = om + h / 2 * k1w, k2w = acc(th + h / 2 * k1a, om + h / 2 * k1w);
    const k3a = om + h / 2 * k2w, k3w = acc(th + h / 2 * k2a, om + h / 2 * k2w);
    const k4a = om + h * k3w, k4w = acc(th + h * k3a, om + h * k3w);
    th += h / 6 * (k1a + 2 * k2a + 2 * k3a + k4a);
    om += h / 6 * (k1w + 2 * k2w + 2 * k3w + k4w);
    t += h;
  }
  return out;
}

test("periodFactor: exact large-amplitude period", () => {
  near(periodFactor(0), 1, 1e-15, "tiny swing");
  near(periodFactor(Math.PI / 2), 1.180340599, 1e-8, "90°");
  const th = 10 * Math.PI / 180;
  near(periodFactor(th), 1 + th * th / 16 + 11 * th ** 4 / 3072, 1e-6, "series at 10°");
});

test("pendulum: period and amplitude-corrected g from a 15° swing", () => {
  const res = analyzePendulum(swing(), { lengthM: 0.8, frameHeightM: H, aspect: ASPECT });
  assert(res.ok, res.error);
  near(res.g, G, 0.03, "g");
  near(res.amplitudeDeg, 15, 0.8, "amplitude");
  assert(res.periods >= 6, "periods " + res.periods);
  assert(res.gStdErr < 0.05, "σg " + res.gStdErr);
  near(res.tau, 2 / 0.05, 8, "damping time");
  near(res.Q, Math.PI * res.tau / res.T, 1e-9, "Q");
  assert(Math.abs(res.center.angle) < 0.02, "swing is horizontal");
  near(res.center.x, 0.5, 0.01, "center x");
});

test("pendulum: without a scale the amplitude goes uncorrected", () => {
  const raw = analyzePendulum(swing({ theta0Deg: 20 }), { lengthM: 0.8, aspect: ASPECT });
  const fixed = analyzePendulum(swing({ theta0Deg: 20 }), { lengthM: 0.8, frameHeightM: H, aspect: ASPECT });
  assert(raw.ok && fixed.ok, raw.error || fixed.error);
  assert(!raw.ampKnown && raw.factor === 1 && raw.amplitudeDeg === null, "uncorrected");
  assert(raw.g < 9.72, "large swing reads low uncorrected: " + raw.g);
  near(fixed.g, G, 0.03, "corrected g");
});

test("pendulum: noise, a tilted camera and a hidden stretch", () => {
  const rec = swing({ noise: 0.002, seed: 3, tilt: 0.15, hide: (t) => t > 4 && t < 5.2 });
  const res = analyzePendulum(rec, { lengthM: 0.8, frameHeightM: H, aspect: ASPECT });
  assert(res.ok, res.error);
  near(res.g, G, 0.08, "g");
  assert(Math.abs(res.g - G) < 4 * res.gStdErr + 0.02, "g within 4σ");
  near(res.center.angle, 0.15, 0.03, "found the tilt");
});

test("pendulum: model follows the recorded swing", () => {
  const res = analyzePendulum(swing(), { lengthM: 0.8, frameHeightM: H, aspect: ASPECT });
  let se = 0, amp = 0;
  const inside = res.series.filter((p) => p.t > res.crossings[0].t && p.t < res.crossings[res.crossings.length - 1].t);
  for (const p of inside) {
    se += (p.s - pendulumModel(res, p.t)) ** 2;
    amp = Math.max(amp, Math.abs(p.s));
  }
  assert(Math.sqrt(se / inside.length) < 0.05 * amp, "rms misfit " + Math.sqrt(se / inside.length));
});

test("pendulum: explains bad recordings", () => {
  const still = [];
  for (let i = 0; i < 60; i++) still.push({ t: i / 30, x: 0.5, y: 0.6 });
  const r = analyzePendulum(still, { lengthM: 1 });
  assert(!r.ok && /barely swinging/.test(r.error) && r.detail, r.error);
  const short = analyzePendulum(swing({ seconds: 1.2 }), { lengthM: 0.8 });
  assert(!short.ok && /need 4\+/.test(short.error), short.error);
  assert(/need 20\+/.test(analyzePendulum(swing().slice(0, 10), { lengthM: 0.8 }).error), "few points");
  throws(() => analyzePendulum([], {}), RangeError);
});
