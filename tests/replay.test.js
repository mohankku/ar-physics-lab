import { test, assert, near } from "./harness.js";
import { analyzeFall } from "../core/analysis.js";
import { fallPath, ReplayLoop } from "../core/replay.js";

const FRAME_M = 1.5, G = 9.6; // a slightly-off measurement, so measured ≠ reference

function analysis() {
  const s = [];
  for (let i = 0; i < 6; i++) s.push({ t: 10 + i / 30, y: 0.1, x: 0.42 }); // resting
  for (let i = 0; i < 18; i++) {
    const ft = i / 30;
    s.push({ t: 10.2 + ft, y: 0.1 + (0.5 * G * ft * ft) / FRAME_M, x: 0.42 + (i % 2) * 0.002 });
  }
  const a = analyzeFall(s, { frameHeightM: FRAME_M });
  assert(a.ok, a.error);
  return { a, s };
}

test("analyzeFall reports where the fit sits in the frame", () => {
  const { a } = analysis();
  assert(a.origin.t >= 10.2 && a.origin.y > 0.1, "origin after the rest");
  near(a.frameHeightM, FRAME_M, 0, "scale passed through");
  near(a.x, 0.42, 0.002, "median x");
});

test("fallPath maps the fit back onto the tracked frame positions", () => {
  const { a, s } = analysis();
  const path = fallPath(a);
  for (const p of path.points) {
    const src = s.find((q) => Math.abs(q.t - (a.origin.t + p.t)) < 1e-9);
    assert(src, "point maps to a source sample");
    near(p.y, src.y, 1e-9, "point y");
    near(path.measuredY(p.t), src.y, 1e-6, "fitted curve through the point");
  }
});

test("reference ghost falls at 9.81 from the same start", () => {
  const { a } = analysis();
  const path = fallPath(a);
  near(path.referenceY(0), path.measuredY(0), 1e-12, "same start");
  const tau = 0.4;
  const gap = (path.referenceY(tau) - path.measuredY(tau)) * FRAME_M;
  near(gap, 0.5 * (9.81 - a.fit.g) * tau * tau, 1e-9, "separation from the g difference");
  assert(gap > 0, "9.81 ghost is ahead of a 9.6 measurement");
});

test("ReplayLoop plays slowed down, holds the end, then loops", () => {
  const loop = new ReplayLoop(0.5, () => {}, { slow: 0.25, pauseS: 1 });
  near(loop.tauAt(0), 0, 0);
  near(loop.tauAt(1000), 0.25, 1e-9, "1 s of wall time = 0.25 s of fall");
  near(loop.tauAt(2500), 0.5, 1e-9, "holds the last frame");
  near(loop.tauAt(3000 + 400), 0.1, 1e-9, "loops after play + pause");
});
