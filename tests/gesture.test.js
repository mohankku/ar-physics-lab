import { test, assert, near } from "./harness.js";
import { handOpenness, palmCenter, GestureGate, CatchBall } from "../core/gesture.js";

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
