import { test, assert, near, throws } from "./harness.js";
import { simulateFall, DRAG_COEFFICIENTS } from "../core/models.js";
import { fallTime } from "../core/physics.js";

test("simulateFall: no drag matches the exact free-fall answers", () => {
  const r = simulateFall({ h: 2, m: 1 });
  near(r.landingTime, fallTime(2, 9.81), 1e-9, "landing time");
  near(r.impactSpeed, Math.sqrt(2 * 9.81 * 2), 1e-9, "impact speed");
  near(r.impactEnergyJ, 9.81 * 2, 1e-8, "energy = m·g·h");
  assert(r.terminalSpeed === Infinity, "no terminal speed without drag");
  const thrown = simulateFall({ h: 2, m: 1, v0: 3 });
  near(thrown.landingTime, fallTime(2, 9.81, 3), 1e-9, "thrown down");
});

test("simulateFall: drag slows the fall, approaching terminal speed", () => {
  // A ping-pong ball: 2.7 g, 40 mm.
  const area = Math.PI * 0.02 ** 2;
  const p = { h: 30, m: 0.0027, cd: DRAG_COEFFICIENTS.sphere, areaM2: area };
  const r = simulateFall(p);
  const vt = Math.sqrt(2 * 0.0027 * 9.81 / (1.225 * 0.47 * area));
  near(r.terminalSpeed, vt, 1e-9, "terminal speed");
  assert(r.impactSpeed < vt && r.impactSpeed > 0.97 * vt, "near terminal after 30 m: " + r.impactSpeed);
  assert(r.landingTime > r.vacuumTime, "slower than in vacuum");
  for (let i = 1; i < r.v.length; i++) assert(r.v[i] >= r.v[i - 1] - 1e-12, "speed never drops from rest");
  near(r.a[r.a.length - 1], 9.81 * (1 - (r.impactSpeed / vt) ** 2), 1e-9, "a = g(1 − v²/vt²)");
});

test("simulateFall: exact terminal-velocity solution from rest", () => {
  // v(t) = vt·tanh(g·t/vt) and y(t) = (vt²/g)·ln cosh(g·t/vt).
  const p = { h: 10, m: 0.05, cd: 0.47, areaM2: 0.003 };
  const r = simulateFall(p), vt = r.terminalSpeed, g = 9.81;
  const tExact = (vt / g) * Math.acosh(Math.exp(p.h * g / (vt * vt)));
  near(r.landingTime, tExact, 1e-7, "landing time");
  near(r.impactSpeed, vt * Math.tanh(g * tExact / vt), 1e-7, "impact speed");
  assert(r.t.length <= 1002, "series is thinned for plotting: " + r.t.length);
});

test("simulateFall: validates its inputs", () => {
  throws(() => simulateFall({ h: 0, m: 1 }), RangeError);
  throws(() => simulateFall({ h: 1, m: -1 }), RangeError);
  throws(() => simulateFall({ h: 1, m: 1, cd: -0.1, areaM2: 1 }), RangeError);
});
