import { test, assert, near } from "./harness.js";
import { PLANETS, circularSpeed, escapeSpeed, keplerPeriod, orbitElements, defaultWarp, Satellite } from "../core/orbit.js";

const E = PLANETS.earth;
/* A frame setup: Earth in the middle, 9 radii tall, an orbit in ~6 s. */
function setup(extra) {
  return { planet: E, H: 9 * E.R, center: { x: 0.5, y: 0.5 }, warp: defaultWarp(E), aspect: 4 / 3, ...extra };
}
/* Launch from r (m, straight above the planet) moving sideways at v (m/s). */
function launchAt(sat, p, r, v) {
  const q = sat.toFrame({ x: 0, y: r }, p);
  sat.reset(q);
  // Velocity in frame fractions per wall second (what a hand would give).
  sat.launch(0, p, { x: v * p.warp / (p.H * p.aspect), y: 0 });
  return sat;
}
function fly(sat, p, seconds, fps = 60) {
  const events = [];
  for (let i = 1; i <= seconds * fps && sat.state === "flying"; i++) {
    const ev = sat.tick(i * 1000 / fps, p);
    if (ev) events.push(ev);
  }
  return events;
}

test("orbit speeds: Earth's real numbers", () => {
  near(circularSpeed(E.GM, E.R) / 1000, 7.91, 0.01, "orbit just above the ground: 7.9 km/s");
  near(escapeSpeed(E.GM, E.R) / 1000, 11.19, 0.01, "escape speed: 11.2 km/s");
  near(escapeSpeed(PLANETS.moon.GM, PLANETS.moon.R) / 1000, 2.38, 0.01, "the Moon: 2.4 km/s");
  near(keplerPeriod(E.GM, 384400e3) / 86400, 27.4, 0.1, "the Moon's orbit: about 27 days");
});

test("Newton's gravity, step by step, gives Kepler's third law", () => {
  const p = setup();
  for (const [r, k] of [[3 * E.R, 1], [3 * E.R, 1.2], [2 * E.R, 0.9]]) {
    const sat = launchAt(new Satellite(), p, r, k * circularSpeed(E.GM, r));
    const ev = fly(sat, p, 25).filter((e) => e.type === "orbit");
    assert(ev.length >= 2, "orbits: " + ev.length + " (" + sat.state + ")");
    near(ev[1].T / ev[1].Tkepler, 1, 1e-4, "T² ∝ a³ at " + k + "× circular speed");
  }
});

test("Kepler's first and second laws: ellipses, faster close in, equal areas", () => {
  const p = setup();
  const r0 = 3 * E.R, sat = launchAt(new Satellite(), p, r0, 1.2 * circularSpeed(E.GM, r0));
  const el = sat.elements;
  near(el.e, 1.44 - 1, 1e-9, "eccentricity from the launch");
  near(el.rp, r0, 1e-6 * r0, "launched sideways: that's its nearest point");
  let rMin = Infinity, rMax = 0, vAtMin = 0, vAtMax = 0, hMin = Infinity, hMax = -Infinity;
  for (let i = 1; i <= 60 * 15 && sat.state === "flying"; i++) {
    sat.tick(i * 1000 / 60, p);
    const r = Math.hypot(sat.pos.x, sat.pos.y), v = sat.speed(), h = sat.pos.x * sat.vel.y - sat.pos.y * sat.vel.x;
    if (r < rMin) { rMin = r; vAtMin = v; }
    if (r > rMax) { rMax = r; vAtMax = v; }
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
  }
  near(rMax / el.ra, 1, 1e-3, "reaches the far point of its ellipse");
  near(vAtMin / vAtMax, rMax / rMin, 2e-3, "speed × distance is the same at both ends");
  near((hMax - hMin) / Math.abs(hMax), 0, 1e-6, "equal areas in equal times (r × v constant)");
});

test("escape speed: a hair under stays, a hair over leaves; too slow crashes", () => {
  const p = setup(), r0 = 2 * E.R;
  const under = launchAt(new Satellite(), p, r0, 0.97 * escapeSpeed(E.GM, r0));
  assert(under.elements.bound, "97% of escape speed: still bound");
  const over = launchAt(new Satellite(), p, r0, 1.03 * escapeSpeed(E.GM, r0));
  assert(!over.elements.bound, "103%: free");
  const ev = fly(over, p, 60);
  assert(over.state === "escaped" && ev.some((e) => e.type === "escaped"), "flies away: " + over.state);
  const slow = launchAt(new Satellite(), p, r0, 0.3 * circularSpeed(E.GM, r0));
  fly(slow, p, 10);
  assert(slow.state === "crashed", "too slow: crashes, " + slow.state);
});

test("Satellite: grab it, flick it; it leaves at the hand's on-screen speed", () => {
  const p = setup();
  const sat = new Satellite();
  sat.reset({ x: 0.5, y: 0.2 });
  let launched = null;
  for (let i = 0; i < 80 && !launched; i++) {
    const now = i * 1000 / 60, t = now / 1000;
    const x = 0.5 + Math.max(0, t - 0.5) * 0.2;              // moving right at 0.2 frames/s from 0.5 s
    const ev = sat.update(now, { x, y: 0.2, open: t < 0.2 ? 1 : t < 0.9 ? 0 : 1 }, p);
    if (ev && ev.type === "launched") launched = ev;
  }
  assert(launched, "launched");
  near(launched.speed, 0.2 * p.H * p.aspect / p.warp, 0.02 * launched.speed, "speed from the flick");
  near(sat.vel.y, 0, 1, "sideways");
});

test("Satellite (grabAnywhere): a fist anywhere picks it up; it glides into the hand", () => {
  const p = setup();
  const sat = new Satellite({ grabAnywhere: true });
  sat.reset({ x: 0.5, y: 0.2 });
  const far = { x: 0.85, y: 0.8 };
  const types = [];
  for (let i = 0; i < 40; i++) {
    const ev = sat.update(i * 1000 / 60, { ...far, open: i < 5 ? 1 : 0 }, p);
    if (ev) types.push(ev.type);
  }
  assert(types.join() === "grabbed", types.join());
  assert(Math.hypot(sat.x - far.x, sat.y - far.y) < 0.01, "now in the hand");
  // Plain mode still needs the hand on it.
  const plain = new Satellite();
  plain.reset({ x: 0.5, y: 0.2 });
  for (let i = 0; i < 20; i++) plain.update(i * 1000 / 60, { ...far, open: i < 5 ? 1 : 0 }, p);
  assert(plain.state === "resting", "not grabbed from afar");
});
