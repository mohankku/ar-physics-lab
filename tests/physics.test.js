import { test, assert, near, rng, gaussian } from "./harness.js";
import {
  fallTime, gravityFromDrop, mean, std, median, percentError,
  fitGravity, fitFreeFall, robustFitFreeFall
} from "../core/physics.js";

test("fallTime and gravityFromDrop are inverses", () => {
  const t = fallTime(2, 9.81);
  near(t, 0.63855, 1e-5, "t");
  near(gravityFromDrop(2, t), 9.81, 1e-9, "g");
});

test("fallTime with a downward throw is shorter and exact", () => {
  const t = fallTime(2, 9.81, 3);
  near(3 * t + 0.5 * 9.81 * t * t, 2, 1e-12, "distance covered");
  assert(t < fallTime(2, 9.81), "throw lands sooner");
});

test("mean, std, median, percentError", () => {
  near(mean([1, 2, 3, 4]), 2.5, 1e-12);
  near(std([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 1e-3);
  near(std([5]), 0, 0);
  near(median([3, 1, 2]), 2, 0);
  near(median([4, 1, 3, 2]), 2.5, 0);
  near(percentError(9.81), 0, 1e-12);
  near(percentError(10.791), 10, 1e-9);
});

test("fitGravity recovers g from rest", () => {
  const pts = [0.1, 0.2, 0.3, 0.4].map((t) => ({ t, y: 0.5 * 9.81 * t * t }));
  near(fitGravity(pts).g, 9.81, 1e-9, "g");
  assert(fitGravity(pts.slice(0, 2)) === null, "needs 3+ points");
});

test("fitFreeFall recovers g, v0, y0 exactly from clean data", () => {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const t = i / 60;
    pts.push({ t, y: 0.1 + 0.5 * t + 0.5 * 9.81 * t * t });
  }
  const f = fitFreeFall(pts);
  near(f.g, 9.81, 1e-8, "g"); near(f.v0, 0.5, 1e-8, "v0"); near(f.y0, 0.1, 1e-8, "y0");
  near(f.gStdErr, 0, 1e-6, "no noise, no uncertainty");
  assert(f.n === 20, "n");
  assert(fitFreeFall(pts.slice(0, 3)) === null, "needs 4+ points");
});

test("fitFreeFall stays accurate with a large time offset", () => {
  // Frame clocks can start far from zero; centering keeps this well conditioned.
  const pts = [];
  for (let i = 0; i < 30; i++) {
    const t = 5000 + i / 60, u = i / 60;
    pts.push({ t, y: 0.5 * 9.81 * u * u });
  }
  near(fitFreeFall(pts).g, 9.81, 1e-4, "g");
});

test("fitFreeFall standard error matches the scatter of repeated fits", () => {
  const rand = rng(7);
  const gs = [], ses = [];
  for (let trial = 0; trial < 200; trial++) {
    const pts = [];
    for (let i = 0; i < 25; i++) {
      const t = i / 60;
      pts.push({ t, y: 0.5 * 9.81 * t * t + gaussian(rand, 0.004) });
    }
    const f = fitFreeFall(pts);
    gs.push(f.g); ses.push(f.gStdErr);
  }
  near(mean(gs), 9.81, 0.15, "unbiased");
  const ratio = mean(ses) / std(gs);
  assert(ratio > 0.8 && ratio < 1.25, "reported σ ≈ actual scatter, ratio " + ratio.toFixed(2));
});

test("robustFitFreeFall ignores false detections", () => {
  const pts = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 60;
    pts.push({ t, y: 0.5 * 9.81 * t * t });
  }
  pts[24] = { t: pts[24].t, y: pts[24].y + 0.25 }; // jumped to another object
  pts[27] = { t: pts[27].t, y: pts[27].y + 0.3 };
  const plain = fitFreeFall(pts);
  const robust = robustFitFreeFall(pts);
  assert(Math.abs(plain.g - 9.81) > 0.5, "outliers spoil a plain fit (g=" + plain.g.toFixed(2) + ")");
  near(robust.fit.g, 9.81, 1e-6, "robust g");
  assert(robust.rejected === 2, "rejected " + robust.rejected);
});

test("robustFitFreeFall keeps every point of clean, noisy data", () => {
  const rand = rng(3);
  const pts = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 60;
    pts.push({ t, y: 0.5 * 9.81 * t * t + gaussian(rand, 0.002) });
  }
  assert(robustFitFreeFall(pts).rejected === 0, "no false rejections at sigma below the floor");
});
