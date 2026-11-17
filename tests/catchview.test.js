import { test, assert, near } from "./harness.js";
import { CatchBall } from "../core/gesture.js";
import { pointerHand, fitDropsG, summarizeDrops, pickMystery, LIFT_MS } from "../lab/catchview.js";

/* Drive a CatchBall with a pointer: events = [[ms, change]] applied in order,
 * frames every 1000/60 ms, as the app's loop does. */
function play(events, until) {
  const ball = new CatchBall(), p = { g: 9.81, h: 2, aspect: 4 / 3 };
  const pt = { inside: false, down: false, x: 0.5, y: 0.35, upAt: -Infinity };
  const out = [];
  let hand = null, k = 0;
  for (let i = 0; i * 1000 / 60 <= until; i++) {
    const now = i * 1000 / 60;
    while (k < events.length && events[k][0] <= now) {
      const ch = events[k++][1];
      if (ch.down === false && pt.down) pt.upAt = now;
      Object.assign(pt, ch);
    }
    hand = pointerHand(pt, hand, now);
    const ev = ball.update(now, hand, p) || ball.tick(now, p);
    if (ev) out.push({ now, ...ev });
  }
  return { out, ball };
}

test("touch: a finger with no hover grabs, lifting it drops the ball at once", () => {
  // Finger lands on the ball, slides up, lifts; nothing hovered first.
  const { out } = play([
    [100, { down: true, x: 0.5, y: 0.35 }],
    [400, { y: 0.1 }],
    [800, { down: false }]
  ], 2000);
  const types = out.map((e) => e.type).join();
  assert(types === "grabbed,released,landed", types);
  assert(out[0].now < 100 + 60, "grabs within a few frames of the touch");
  assert(out[1].how === "open" && out[1].now < 800 + LIFT_MS, "lifting = opening the hand, not losing it");
});

test("touch: a second touch grabs again; mouse hover-then-press still works", () => {
  const { out } = play([
    [100, { down: true }], [300, { down: false }],            // grab, drop from 0.35
    [1500, { down: true, x: 0.5, y: 1 }], [1700, { y: 0.4 }], // pick it up from the floor
    [2000, { down: false }]
  ], 3200);
  assert(out.filter((e) => e.type === "grabbed").length === 2, out.map((e) => e.type).join());
  const mouse = play([[0, { inside: true }], [200, { down: true }], [500, { down: false }]], 1500).out;
  assert(mouse.map((e) => e.type).join() === "grabbed,released,landed", mouse.map((e) => e.type).join());
});

test("pointerHand: nothing when away, open on hover", () => {
  assert(pointerHand({ inside: false, down: false, upAt: -Infinity }, null, 0) === null, "away");
  assert(pointerHand({ inside: true, down: false, x: 0.2, y: 0.3 }, null, 0).open === 1, "hover");
});

test("fitDropsG and summarizeDrops: exact drops give g back", () => {
  const g = 3.71;
  const trials = [0.4, 1.0, 1.7].map((h) => { const t = Math.sqrt(2 * h / g); return { h, t, g: 2 * h / (t * t) }; });
  near(fitDropsG(trials), g, 1e-9, "fit");
  const s = summarizeDrops(trials);
  assert(s.n === 3 && Math.abs(s.spread - 1.3) < 1e-9 && Math.abs(s.gMean - g) < 1e-9, JSON.stringify(s));
  assert(isNaN(fitDropsG([])), "no data");
  for (let i = 0, prev = null; i < 50; i++) { const m = pickMystery(prev); assert(m !== prev, "never repeats"); prev = m; }
});
