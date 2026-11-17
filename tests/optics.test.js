import { test, assert, near } from "./harness.js";
import { MATERIALS, refract, criticalAngle, indexFrom, LaserPointer } from "../core/optics.js";

const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;

test("refract: Snell's law, n1·sin(in) = n2·sin(out)", () => {
  const r = refract(1, 1.33, 45);
  near(r.outDeg, deg(Math.asin(Math.sin(rad(45)) / 1.33)), 1e-9, "air → water at 45°");
  near(r.outDeg, 32.12, 0.01, "≈ 32.1°: bent toward the normal");
  near(refract(1.33, 1, 30).outDeg, 41.68, 0.01, "water → air: bent away from the normal");
  near(refract(1, 1.5, 0).outDeg, 0, 1e-12, "straight in, straight through");
  for (const n of [1.33, 1.5, 2.42]) {
    for (const a of [10, 35, 60, 80]) {
      const o = refract(1, n, a).outDeg;
      near(indexFrom(a, o, true), n, 1e-9, "n back from a reading, " + n + " at " + a + "°");
    }
  }
});

test("criticalAngle and total internal reflection", () => {
  near(criticalAngle(1.33, 1), 48.75, 0.01, "water");
  near(criticalAngle(1.5, 1), 41.81, 0.01, "glass");
  near(criticalAngle(2.42, 1), 24.41, 0.01, "diamond: why it sparkles");
  assert(criticalAngle(1, 1.33) === null, "no trap going into the denser one");
  const below = refract(1.33, 1, 48), past = refract(1.33, 1, 49.5);
  assert(!below.trapped && below.outDeg > 80, "just below: skims along the surface");
  assert(past.trapped && past.outDeg === null && past.R === 1, "past it: all reflected");
});

test("Fresnel: a little reflects head-on, nearly all at grazing angles", () => {
  near(refract(1, 1.33, 0).R, Math.pow(0.33 / 2.33, 2), 1e-9, "water head-on: 2%");
  near(refract(1, 1.5, 0).R, 0.04, 1e-9, "glass head-on: 4%");
  assert(refract(1, 1.33, 85).R > 0.5, "grazing: most of it bounces");
  let last = 0;
  for (let a = 0; a <= 89; a += 1) { const R = refract(1, 1.5, a).R; assert(R >= last - 1e-12, "more reflection as it gets steeper"); last = R; }
  assert(Object.keys(MATERIALS).every((k) => MATERIALS[k] > 1), "all denser than air");
});

test("LaserPointer: grab it, move it, put it down; the angle follows", () => {
  const p = { aspect: 4 / 3 };
  const L = new LaserPointer({ target: { x: 0.5, y: 0.55 }, at: { x: 0.3, y: 0.2 } });
  const T = L.target;
  // Somewhere 30° from the normal, above the surface on the left.
  const want = { x: T.x - 0.3 * Math.sin(rad(30)) / p.aspect, y: T.y - 0.3 * Math.cos(rad(30)) };
  const events = [];
  for (let i = 0; i < 90; i++) {
    const now = i * 1000 / 60, t = now / 1000;
    const hand = t < 0.2 ? { x: 0.3, y: 0.2, open: 1 } : t < 0.4 ? { x: 0.3, y: 0.2, open: 0 }
      : t < 1.2 ? { ...want, open: 0 } : { ...want, open: 1 };
    const ev = L.update(now, hand, p);
    if (ev) events.push(ev.type);
  }
  assert(events.join() === "grabbed,placed", events.join());
  const g = L.geometry(p);
  near(g.inDeg, 30, 0.2, "30° from the normal");
  assert(g.above && g.side === -1, "above, on the left");
  // Kept out of the material when it isn't allowed (a mirror).
  const M = new LaserPointer();
  M.update(0, { x: M.x, y: M.y, open: 1 }, p); M.update(16, { x: M.x, y: M.y, open: 0 }, p); M.update(33, { x: M.x, y: M.y, open: 0 }, p);
  for (let i = 3; i < 60; i++) M.update(i * 16.7, { x: 0.3, y: 0.9, open: 0 }, { ...p, below: false });
  assert(M.y < M.target.y, "stays above a mirror");
});
