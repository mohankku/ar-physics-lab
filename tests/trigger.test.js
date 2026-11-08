import { test, assert, near, rng, gaussian } from "./harness.js";
import { FallTrigger } from "../core/trigger.js";

const FPS = 30, G_FRAC = 9.81 / 2; // g in frame heights/s² when the frame is 2 m tall

/* Ball held at y=0.2, released at `dropAt` s, falls; null where not seen. */
function feed(trig, { dropAt = 1, until = 3, floorY = 2, jitter = 0, seed = 1, hide = () => false } = {}) {
  const rand = rng(seed), events = [];
  for (let i = 0; i * (1 / FPS) <= until; i++) {
    const t = i / FPS;
    const ft = Math.max(0, t - dropAt);
    const y = Math.min(floorY, 0.2 + 0.5 * G_FRAC * ft * ft) + gaussian(rand, jitter);
    const ev = trig.push(t, hide(t, y) ? null : { x: 0.5, y });
    if (ev) events.push({ t, ...ev });
  }
  return events;
}

test("arms on a still ball, starts on the drop, stops leaving the frame", () => {
  const trig = new FallTrigger();
  const ev = feed(trig, { jitter: 0.002 });
  assert(ev[0].type === "ready" && ev[0].t < 0.5, "ready once still");
  const start = ev.find((e) => e.type === "started");
  assert(start && start.t > 1 && start.t < 1.15, "starts just after release, t=" + (start && start.t));
  const stop = ev.find((e) => e.type === "stopped");
  assert(stop && stop.reason === "left-frame", "stopped: " + (stop && stop.reason));
  near(trig.restY, 0.2, 0.005, "rest position");
  const s = trig.samples();
  assert(s[0].t < 1 && s[0].t >= 1 - 0.4 - 1e-9, "pre-roll kept from before the drop");
  assert(s[s.length - 1].y >= 0.96, "includes the last point in frame");
});

test("ignores jitter and a ball that never falls", () => {
  const trig = new FallTrigger();
  const ev = feed(trig, { dropAt: 99, until: 3, jitter: 0.004 });
  assert(!ev.some((e) => e.type === "started"), "no false start");
  assert(trig.state === "ready", "still armed");
});

test("needs a still ball before it can start", () => {
  const trig = new FallTrigger();
  // Ball already falling when first seen: never rested, never starts.
  const ev = feed(trig, { dropAt: 0, until: 1 });
  assert(!ev.some((e) => e.type === "started"), "no start without rest");
});

test("stops when the ball bounces", () => {
  const trig = new FallTrigger();
  const events = [];
  for (let i = 0; i < 90; i++) {
    const t = i / FPS, ft = Math.max(0, t - 1);
    let y = 0.2 + 0.5 * G_FRAC * ft * ft;
    if (y > 0.8) y = 0.8 - (y - 0.8); // floor at 0.8: comes back up
    const ev = trig.push(t, { x: 0.5, y });
    if (ev) events.push(ev);
    if (trig.state === "done") break;
  }
  assert(trig.stopReason === "bounced", "reason " + trig.stopReason);
  const s = trig.samples();
  for (let i = 1; i < s.length; i++) assert(s[i].y >= s[i - 1].y - 1e-9, "only the falling part kept");
});

test("stops when the ball is lost mid-fall", () => {
  const trig = new FallTrigger();
  feed(trig, { hide: (t) => t > 1.3 });
  assert(trig.stopReason === "lost", "reason " + trig.stopReason);
});

test("goes back to waiting if the ball disappears while ready", () => {
  const trig = new FallTrigger();
  feed(trig, { dropAt: 99, until: 1 });
  assert(trig.state === "ready", "ready");
  for (let i = 0; i < 20; i++) trig.push(1 + i / FPS, null);
  assert(trig.state === "waiting", "waiting again");
});

test("times out a recording that never ends", () => {
  const trig = new FallTrigger({ maxS: 0.5 });
  // Slow slide: starts like a fall, then creeps downward forever.
  for (let i = 0; i < 300 && trig.state !== "done"; i++) {
    const t = i / FPS, ft = Math.max(0, t - 1);
    trig.push(t, { x: 0.5, y: 0.2 + Math.min(0.06, ft * 0.6) + Math.max(0, ft - 0.1) * 0.05 });
  }
  assert(trig.stopReason === "timeout", "reason " + trig.stopReason);
});

test("reset clears everything", () => {
  const trig = new FallTrigger();
  feed(trig);
  trig.reset();
  assert(trig.state === "waiting" && trig.samples().length === 0 && trig.restY === null, "fresh");
});
