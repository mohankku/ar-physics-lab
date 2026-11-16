/* The test bench's scenes: their stated truth must match their motion, or
 * the bench would grade the lab against the wrong answers. Each scene is
 * sampled like a camera would, and run through the real analyses. */
import { test, assert, near } from "./harness.js";
import { makeScene, defaultParams, HOLD_S } from "./bench/scene.js";
import { analyzeFall } from "../core/analysis.js";
import { analyzeProjectile } from "../core/projectile.js";
import { analyzePendulum } from "../core/pendulum.js";

function film(scene, p, { fps = 30, seconds = 6, phase = 0.37 } = {}) {
  const W = p.frameH * p.aspect, out = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i + phase) / fps; // frames don't line up with the release
    const pose = scene.at(t);
    if (pose.visible) out.push({ t, x: pose.x / W, y: pose.y / p.frameH });
  }
  return out;
}

test("bench: drop scene falls at its g", () => {
  for (const g of [9.81, 6]) {
    const p = { ...defaultParams(), g };
    const s = makeScene("drop", p);
    const res = analyzeFall(film(s, p), { frameHeightM: p.frameH });
    assert(res.ok, res.error);
    near(res.fit.g, g, 0.02 * g, "g " + g);
  }
});

test("bench: throw scene matches its truth, with and without a wind-up", () => {
  for (const th of [{}, { dir: -1, angleDeg: 45, dip: 0.06 }]) {
    const p = defaultParams();
    Object.assign(p.throw, th);
    const s = makeScene("throw", p);
    const res = analyzeProjectile(film(s, p), { frameHeightM: p.frameH, aspect: p.aspect });
    assert(res.ok, res.error);
    near(res.g, s.truth.g, 0.05, "g");
    near(res.vx, s.truth.vx, 0.03, "vx");
    near(res.speed, s.truth.speed, 0.08 * s.truth.speed, "speed");
    near(res.angleDeg, s.truth.angleDeg, 4, "angle");
  }
});

test("bench: pendulum scene's period and g", () => {
  for (const ampDeg of [12, 25]) {
    const p = defaultParams();
    p.pend.ampDeg = ampDeg;
    const s = makeScene("pendulum", p);
    const rec = film(s, p, { seconds: HOLD_S + 12 });
    const res = analyzePendulum(rec, { lengthM: s.truth.L, frameHeightM: p.frameH, aspect: p.aspect });
    assert(res.ok, res.error);
    near(res.T, s.truth.T, 0.003 * s.truth.T, "T at " + ampDeg + "°");
    near(res.g, p.g, 0.01 * p.g, "g at " + ampDeg + "°");
  }
});
