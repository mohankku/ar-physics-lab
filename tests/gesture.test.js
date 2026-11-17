import { test, assert, near } from "./harness.js";
import { handOpenness, palmCenter, GestureGate, CatchBall, ThrowBall, SwingBall } from "../core/gesture.js";
import { periodFactor } from "../core/pendulum.js";

/* A synthetic right hand, fingers up, palm at (cx, cy) frame fractions.
 * curl 0 = straight fingers, 1 = tight fist. */
function hand(cx = 0.5, cy = 0.6, curl = 0, size = 0.1) {
  const lm = new Array(21);
  lm[0] = { x: cx, y: cy + size }; // wrist below the palm
  for (let i = 1; i <= 4; i++) lm[i] = { x: cx - size * (0.6 + 0.1 * i), y: cy + size * (0.6 - 0.2 * i) }; // thumb
  const xs = [-0.45, -0.15, 0.15, 0.45];
  xs.forEach((dx, f) => {
    const base = 5 + 4 * f, mx = cx + dx * size, my = cy;
    lm[base] = { x: mx, y: my };                       // MCP (knuckle)
    // Straight: segments go up. Curled: they fold back down toward the palm.
    const seg = size * 0.45;
    const ang = curl * Math.PI * 0.9;                  // 0 = up, π = folded down
    let x = mx, y = my, a = 0;
    for (let j = 1; j <= 3; j++) {
      a += ang / 1.5;
      x += Math.sin(a) * seg * 0.3;
      y -= Math.cos(a) * seg;
      lm[base + j] = { x, y };
    }
  });
  return lm;
}

test("handOpenness: open palm ≈ 1, fist ≈ 0, any size or place", () => {
  for (const [cx, cy, size] of [[0.5, 0.6, 0.1], [0.2, 0.3, 0.05], [0.8, 0.7, 0.2]]) {
    assert(handOpenness(hand(cx, cy, 0, size)) > 0.9, "open " + handOpenness(hand(cx, cy, 0, size)));
    assert(handOpenness(hand(cx, cy, 1, size)) < 0.1, "fist " + handOpenness(hand(cx, cy, 1, size)));
  }
  const half = handOpenness(hand(0.5, 0.6, 0.3)); // fingers bent part-way
  assert(half > 0.1 && half < 0.9, "half-closed is in between: " + half);
  assert(isNaN(handOpenness([])), "no landmarks");
});

test("palmCenter sits on the palm, not the fingertips", () => {
  const c = palmCenter(hand(0.4, 0.5, 0, 0.1));
  near(c.x, 0.4, 0.01, "x");
  assert(c.y > 0.5 && c.y < 0.53, "between knuckles and wrist: " + c.y);
});

test("GestureGate: needs a clear, steady change; first sight is silent", () => {
  const g = new GestureGate({ frames: 2 });
  assert(g.push(0.1) === null && g.closed, "appearing closed doesn't grab");
  assert(g.push(0.9) === null, "one open frame isn't enough");
  assert(g.push(0.9) === "release", "two open frames release");
  assert(g.push(0.5) === null && g.push(0.5) === null && !g.closed, "in-between holds the state");
  assert(g.push(0.2) === null && g.push(0.9) === null, "a flicker resets the count");
  assert(g.push(0.2) === null && g.push(0.2) === "grab", "steady close grabs");
});

/* Drive a CatchBall: frames every 1000/fps ms, hand from handAt(t), and
 * openness from openAt(t) (1 open, 0 closed, null = no hand). */
function run(ball, p, { until, fps = 30, at = () => ({ x: 0.5, y: 0.35 }), openAt }) {
  const events = [];
  for (let i = 0; i / fps <= until; i++) {
    const now = i * 1000 / fps, o = openAt(now / 1000);
    const pos = at(now / 1000);
    const ev = ball.update(now, o == null ? null : { x: pos.x, y: pos.y, open: o }, p);
    if (ev) events.push({ now, ...ev });
    const ev2 = ball.tick(now, p);
    if (ev2) events.push({ now, ...ev2 });
  }
  return events;
}

const P = { g: 9.81, h: 2, aspect: 4 / 3 };

test("CatchBall: grab, carry up, open to drop, lands at √(2h/g)", () => {
  const ball = new CatchBall();
  const ev = run(ball, P, {
    until: 3, fps: 60,
    at: (t) => ({ x: 0.5, y: t < 1 ? 0.35 : Math.max(0.1, 0.35 - (t - 1) * 0.5) }), // lift to y = 0.1
    openAt: (t) => (t < 0.3 ? 1 : t < 1.6 ? 0 : 1)                                  // close, then open
  });
  const types = ev.map((e) => e.type);
  assert(types.join() === "grabbed,released,landed", types.join());
  const rel = ev[1], land = ev[2];
  near(rel.h0, 0.9 * 2, 0.02, "dropped from 1.8 m (y = 0.1 of a 2 m view)");
  near(land.exactT, Math.sqrt(2 * rel.h0 / 9.81), 1e-9, "exact fall time");
  assert(land.t >= land.exactT && land.t < land.exactT + 1 / 60 + 1e-9, "timed to the next frame");
  assert(ball.state === "resting" && ball.y === 1, "on the floor");
});

test("CatchBall: a far-away fist doesn't grab; hand lost while holding drops it", () => {
  const far = new CatchBall();
  const ev = run(far, P, { until: 1, at: () => ({ x: 0.9, y: 0.9 }), openAt: (t) => (t < 0.3 ? 1 : 0) });
  assert(!ev.length && far.state === "resting", "out of reach");
  const ball = new CatchBall();
  const ev2 = run(ball, P, { until: 2, openAt: (t) => (t < 0.3 ? 1 : t < 1 ? 0 : null) });
  const rel = ev2.find((e) => e.type === "released");
  assert(rel && rel.how === "lost" && rel.now / 1000 > 1.3, "drops ~0.35 s after the hand vanishes");
});

test("CatchBall: catch it mid-air by closing the hand on it", () => {
  const ball = new CatchBall();
  // Hold at y = 0.2, release at 1 s (slow motion); the open hand waits at
  // y = 0.4 and closes at 2 s, when the ball (~0.35) is within reach.
  const ev = run(ball, { ...P, slow: 0.25 }, {
    until: 3, fps: 60,
    at: (t) => ({ x: 0.5, y: t < 0.5 ? 0.35 : t < 1.1 ? 0.2 : 0.4 }),
    openAt: (t) => (t < 0.3 ? 1 : t < 1 ? 0 : t < 2 ? 1 : 0)
  });
  const caught = ev.find((e) => e.type === "caught");
  assert(caught, "caught: " + ev.map((e) => e.type).join());
  assert(!ev.some((e) => e.type === "landed"), "never landed");
  near(caught.fallenM, 0.5 * 9.81 * caught.t * caught.t, 1e-6, "fell ½gt² before the catch");
  assert(ball.state === "held", "back in the hand");
});

test("CatchBall: slow motion stretches wall time, not physics time", () => {
  const fast = new CatchBall(), slow = new CatchBall();
  const plan = { until: 6, fps: 60, openAt: (t) => (t < 0.3 ? 1 : t < 1 ? 0 : 1) };
  const a = run(fast, P, plan).find((e) => e.type === "landed");
  const b = run(slow, { ...P, slow: 0.25 }, plan).find((e) => e.type === "landed");
  near(a.exactT, b.exactT, 1e-9, "same physics");
  assert(b.now - a.now > 3 * (a.exactT * 1000) * 0.9, "4× longer on the clock");
  assert(b.t - b.exactT <= 0.25 / 60 + 1e-9, "timed to within a quarter frame of physics time");
});

/* A hand that grabs the ThrowBall at rest, holds still, then moves at
 * (vx, vy) m/s (vy up) from tMove and opens at tOpen (s). */
function throwRun(ball, p, { vx, vy, tMove = 0.5, tOpen = 0.8, until = 4, fps = 60, lost = false }) {
  const aspect = p.aspect, x0 = ball.x, y0 = ball.y;
  return run(ball, p, {
    until, fps,
    at: (t) => {
      const s = Math.max(0, t - tMove);
      return { x: x0 + vx * s / (p.h * aspect), y: y0 - vy * s / p.h };
    },
    openAt: (t) => (t < 0.2 ? 1 : t < tOpen ? 0 : lost ? null : 1)
  });
}

test("ThrowBall: thrown with the hand's velocity, lands where a projectile should", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3 };
  const ball = new ThrowBall();
  const ev = throwRun(ball, p, { vx: 1.5, vy: 2.5 });
  const types = ev.map((e) => e.type).join();
  assert(types === "grabbed,thrown,landed", types);
  const th = ev[1], land = ev[2];
  near(th.vx, 1.5, 0.02, "vx from the hand");
  near(th.vy, 2.5, 0.02, "vy from the hand");
  near(th.angleDeg, Math.atan2(2.5, 1.5) * 180 / Math.PI, 0.5, "angle");
  // Exact flight from the release height h0 to the floor.
  const T = (th.vy + Math.sqrt(th.vy * th.vy + 2 * 9.81 * th.h0)) / 9.81;
  near(land.t, T, 1e-9, "flight time");
  near(land.range, Math.abs(th.vx) * T, 1e-9, "distance");
  near(land.apex, th.vy * th.vy / (2 * 9.81), 1e-9, "top of the arc");
  assert(ball.state === "resting" && ball.y === 1, "on the floor");
});

test("ThrowBall: out through the side; vanished hand just drops it; slow motion", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3 };
  const side = new ThrowBall();
  const ev = throwRun(side, p, { vx: 6, vy: 4 });
  const gone = ev.find((e) => e.type === "gone");
  assert(gone && side.state === "gone" && side.x >= 0.999, "left through the right edge");
  const lost = new ThrowBall();
  const ev2 = throwRun(lost, p, { vx: 2, vy: 1, tMove: 99, lost: true });
  const th = ev2.find((e) => e.type === "thrown");
  assert(th && th.how === "lost" && th.speed === 0, "no velocity when the hand vanished");
  const a = throwRun(new ThrowBall(), p, { vx: 1, vy: 2 }).find((e) => e.type === "landed");
  const b = throwRun(new ThrowBall(), { ...p, slow: 0.25 }, { vx: 1, vy: 2, until: 8 }).find((e) => e.type === "landed");
  near(a.t, b.t, 1e-6, "same physics in slow motion");
  near(a.range, b.range, 1e-6, "same distance");
});

test("ThrowBall: caught mid-air by closing the hand on it", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3, slow: 0.25 };
  const ball = new ThrowBall();
  const x0 = ball.x, y0 = ball.y;
  // Toss it gently straight up (1 m/s, released at y ≈ 0.45), keep the open
  // hand there, and close it while the ball is near the top (slow motion).
  const yr = y0 - 0.3 / p.h;
  const ev = run(ball, p, {
    until: 4, fps: 60,
    at: (t) => (t < 0.5 ? { x: x0, y: y0 } : t < 0.8 ? { x: x0, y: y0 - (t - 0.5) / p.h } : { x: x0, y: yr }),
    openAt: (t) => (t < 0.2 ? 1 : t < 0.8 ? 0 : t < 1.0 ? 1 : 0)
  });
  const types = ev.map((e) => e.type);
  assert(types.includes("thrown") && types.includes("caught") && !types.includes("landed"), types.join());
  assert(ball.state === "held", "back in the hand");
});

test("ThrowBall: speed is the hand's as it starts to open, even if it then stops", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3 };
  const ball = new ThrowBall();
  const x0 = ball.x, y0 = ball.y;
  // Moves at (2, 2) m/s from 0.5 s, stops dead at 0.8 s, and opens at 0.8 s.
  const ev = run(ball, p, {
    until: 3, fps: 30,
    at: (t) => {
      const s = Math.min(0.3, Math.max(0, t - 0.5));
      return { x: x0 + 2 * s / (p.h * p.aspect), y: y0 - 2 * s / p.h };
    },
    openAt: (t) => (t < 0.2 ? 1 : t < 0.8 ? 0 : 1)
  });
  const th = ev.find((e) => e.type === "thrown");
  near(th.vx, 2, 0.05, "vx");
  near(th.vy, 2, 0.05, "vy");
});

/* Grab the pendulum ball, pull it to `deg`, let go at 1 s, then swing for `until` s. */
function swingRun(ball, p, deg, until, fps = 60) {
  const a = deg * Math.PI / 180, aspect = p.aspect;
  const rest = ball.pos(p);
  const pulled = { x: ball.pivot.x + p.L * Math.sin(a) / (p.h * aspect), y: ball.pivot.y + p.L * Math.cos(a) / p.h };
  const events = [];
  let last = null;
  for (let i = 0; i / fps <= until; i++) {
    const now = i * 1000 / fps, t = now / 1000;
    const hand = t < 0.2 ? { ...rest, open: 1 } : t < 0.5 ? { ...rest, open: 0 } : t < 1 ? { ...pulled, open: 0 }
      : t < 1.3 ? { ...pulled, open: 1 } : null;
    const ev = ball.update(now, hand, p) || ball.tick(now, p);
    if (ev) { events.push({ now, ...ev }); last = ev; }
  }
  return events;
}

test("SwingBall: pulled aside and let go, it swings with the true pendulum period", () => {
  for (const [deg, L] of [[10, 0.8], [30, 1.2], [60, 0.5]]) {
    const p = { g: 9.81, h: 2, L, aspect: 4 / 3, Q: Infinity };   // no air: the pure pendulum
    const ball = new SwingBall();
    const ev = swingRun(ball, p, deg, 14);
    const rel = ev.find((e) => e.type === "released");
    assert(ev[0].type === "grabbed" && rel, ev.map((e) => e.type).join());
    near(rel.angleDeg, deg, 0.5, "let go at the pulled angle");
    const T = 2 * Math.PI * Math.sqrt(L / 9.81) * periodFactor(rel.angleDeg * Math.PI / 180);
    assert(ball.swings >= 5, "timed swings: " + ball.swings);
    near(ball.period / T, 1, 0.001, deg + "° on " + L + " m: period " + ball.period.toFixed(5) + " vs " + T.toFixed(5));
  }
});

test("SwingBall: slow motion keeps physics time; grabbing stops the timing", () => {
  const p = { g: 9.81, h: 2, L: 0.8, aspect: 4 / 3 };
  const a = new SwingBall(), b = new SwingBall();
  swingRun(a, p, 15, 8);
  swingRun(b, { ...p, slow: 0.25 }, 15, 26);
  near(a.period, b.period, 1e-4, "same period in slow motion");
  const c = new SwingBall();
  swingRun(c, p, 15, 6);
  assert(c.swings > 0, "swinging");
  c.update(7000, { ...c.pos(p), open: 1 }, p);
  c.update(7016, { ...c.pos(p), open: 0 }, p);
  const g = c.update(7033, { ...c.pos(p), open: 0 }, p);
  assert(g && g.type === "grabbed" && c.state === "held" && c.swings === 0, "grabbed: timing starts over");
});

test("SwingBall: air slows it down until it stops; with no air it keeps going", () => {
  const p = { g: 9.81, h: 2, L: 0.8, aspect: 4 / 3, Q: 50 };
  const ball = new SwingBall();
  const ev = swingRun(ball, p, 15, 30);
  // After n swings the size is 15° · e^(−πn/Q).
  const n = ball.swings, deg = ball.amplitude(p) * 180 / Math.PI;
  assert(n >= 12, "swings: " + n);
  const expect = 15 * Math.exp(-Math.PI * (ball.tau / ball.period) / 50);
  near(deg / expect, 1, 0.05, "shrinks as e^(−πn/Q): " + deg.toFixed(2) + "° vs " + expect.toFixed(2) + "°");
  // Keep going until it stops.
  let stopped = null;
  for (let now = 30000; now < 200000 && !stopped; now += 1000 / 60) {
    const e = ball.tick(now, p);
    if (e && e.type === "stopped") stopped = e;
  }
  assert(stopped, "came to rest");
  assert(stopped.t > 60 && stopped.t < 140, "after about a minute or two: " + stopped.t.toFixed(0) + " s");
  assert(ball.theta === 0 && ball.omega === 0 && ball.tick(300000, p) === null, "and stays still");
  const free = new SwingBall();
  swingRun(free, { ...p, Q: Infinity }, 15, 60);
  near(free.amplitude(p) * 180 / Math.PI, 15, 0.3, "no air: still swinging at full size");
});

test("Bounces: each bounce reaches e² of the height before, then it settles", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3, e: 0.75 };
  const ball = new CatchBall();
  const ev = run(ball, p, {
    until: 8, fps: 60,
    at: (t) => ({ x: 0.5, y: t < 1 ? 0.35 : 0.1 }),               // lift to 1.8 m
    openAt: (t) => (t < 0.3 ? 1 : t < 1.6 ? 0 : 1)
  });
  const land = ev.find((e) => e.type === "landed");
  near(land.bounceHeight, 0.75 * 0.75 * land.h0, 1e-9, "first bounce: e² of the drop");
  const hops = ev.filter((e) => e.type === "bounce").map((e) => e.height);
  assert(hops.length >= 3, "several bounces: " + hops.length);
  near(hops[0] / land.bounceHeight, 0.5625, 1e-9, "each bounce e² of the last");
  near(hops[1] / hops[0], 0.5625, 1e-9, "and again");
  assert(ev[ev.length - 1].type === "settled" && ball.state === "resting" && ball.y === 1, "settles on the floor");
  // A bowling ball (e = 0) just lands; the timing of the fall is the same.
  const dead = new CatchBall();
  const ev2 = run(dead, { ...p, e: 0 }, { until: 4, fps: 60, at: (t) => ({ x: 0.5, y: t < 1 ? 0.35 : 0.1 }), openAt: (t) => (t < 0.3 ? 1 : t < 1.6 ? 0 : 1) });
  const land2 = ev2.find((e) => e.type === "landed");
  assert(land2.bounceHeight === 0 && dead.state === "resting", "no bounce");
  near(land2.exactT, land.exactT, 1e-12, "same fall time");
});

test("Bounces: a thrown ball bounces on along the floor; you can grab it mid-bounce", () => {
  const p = { g: 9.81, h: 2, aspect: 4 / 3, e: 0.8 };
  const ball = new ThrowBall();
  const ev = throwRun(ball, p, { vx: 0.6, vy: 2, until: 2.2 });
  const land = ev.find((e) => e.type === "landed");
  assert(land && land.bounceHeight > 0.3, "bounces up: " + (land && land.bounceHeight));
  assert(ball.state === "bouncing" && ball.x > land.x, "still bouncing, further along");
  // Close a hand on it while it's in the air.
  const at = { x: ball.x, y: ball.y };
  let grabbed = null;
  for (let i = 0, now = 2300; i < 6 && !grabbed; i++, now += 1000 / 60) {
    const e = ball.update(now, { x: ball.x, y: ball.y, open: i < 2 ? 1 : 0 }, p);
    if (e && e.type === "grabbed") grabbed = e;
    else ball.tick(now, p);
  }
  assert(grabbed && ball.state === "held", "grabbed mid-bounce, from " + JSON.stringify(at));
});
