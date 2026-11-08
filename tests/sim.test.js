import { test, assert, near, throws } from "./harness.js";
import { FreeFall, HandBall } from "../core/sim.js";
import { fallTime } from "../core/physics.js";

test("FreeFall lands at exactly the theoretical time, at any step size", () => {
  for (const dt of [1 / 240, 1 / 60, 1 / 24, 0.05]) {
    const f = new FreeFall(9.81, 2);
    let steps = 0;
    while (!f.step(dt) && steps < 1e5) steps++;
    near(f.t, fallTime(2, 9.81), 1e-12, "t at dt=" + dt);
    assert(f.y === 2 && f.landed, "on the ground");
    near(f.v, 9.81 * f.t, 1e-12, "v");
  }
});

test("FreeFall position is exact mid-fall, and step after landing is a no-op", () => {
  const f = new FreeFall(1.62, 3);
  f.step(0.4);
  near(f.y, 0.5 * 1.62 * 0.16, 1e-12, "y");
  while (!f.step(0.1));
  const t = f.t;
  assert(f.step(1) && f.t === t, "stays landed");
});

test("FreeFall trail, spin and validation", () => {
  const f = new FreeFall(9.81, 2);
  f.ball = { style: "tennis", angle: 0 };
  for (let i = 0; i < 1000; i++) f.step(0.001, true);
  assert(f.trail.length === 120, "trail capped");
  near(f.ball.angle, 6, 1e-9, "spins SPIN radians over the full drop");
  throws(() => f.reset(0, 2), RangeError);
  throws(() => new FreeFall(9.81, -1), RangeError);
});

/* Drive a HandBall with a scripted hand. */
function rig(p = {}) {
  const hb = new HandBall();
  const P = { g: 9.81, h: 2, motion: false, dropLine: 0.2, ...p };
  const hand = { x: 0.5, y: 0.6, visible: true };
  let now = 1000;
  hb.start(now);
  const detect = () => (hand.visible ? { x: hand.x, y: hand.y } : null);
  const frame = (ms = 1000 / 30) => {
    now += ms;
    const ev = hb.track(now, P, detect);
    return ev || hb.tick(now);
  };
  return { hb, P, hand, frame, now: () => now };
}

test("HandBall follows the hand, releases above the line, lands at the exact time", () => {
  const { hb, hand, frame } = rig();
  let ev = null;
  for (let i = 0; i < 40; i++) ev = frame(); // hold still > calm period
  assert(ev === null && hb.fix && !hb.falling, "holding");
  near(hb.yM, 2 * (1 - 0.6), 0.01, "ball follows hand height");
  hand.y = 0.1;
  for (let i = 0; i < 30 && !(ev && ev.type === "released"); i++) ev = frame();
  assert(ev && ev.type === "released" && hb.falling, "released");
  const { h0, v0 } = ev;
  for (let i = 0; i < 500 && !(ev && ev.type === "landed"); i++) ev = frame();
  assert(ev && ev.type === "landed" && hb.landed && hb.yM === 0, "landed");
  near(ev.t, fallTime(h0, 9.81, v0), 1e-12, "exact landing time");
  assert(hb.drop(0, 9.81).reason === "landed", "can't drop a landed ball");
});

test("HandBall smoothing behaves the same at 30 and 60 fps", () => {
  const settle = (fps) => {
    const { hb, hand, frame } = rig({ dropLine: null });
    for (let i = 0; i < 10; i++) frame(1000 / fps);
    hand.y = 0.9;
    const steps = Math.round(0.1 * fps); // 100 ms after the hand moves
    for (let i = 0; i < steps; i++) frame(1000 / fps);
    return hb.sy;
  };
  near(settle(30), settle(60), 0.01, "position after 100 ms");
});

test("HandBall ignores the drop line right after acquiring the hand", () => {
  const { hb, hand, frame } = rig();
  hand.y = 0.1; // already above the line when first seen
  for (let i = 0; i < 10; i++) frame(); // 330 ms < 600 ms calm
  assert(!hb.falling, "no instant drop on lock");
});

test("HandBall coasts through a short dropout, then reports a lost hand", () => {
  const { hb, hand, frame } = rig({ dropLine: null });
  for (let i = 0; i < 5; i++) frame();
  hand.visible = false;
  assert(frame(50) === null && hb.fix, "short dropout: coasting");
  let ev = null;
  for (let i = 0; i < 10 && !ev; i++) ev = frame();
  assert(ev && ev.type === "lost" && !hb.fix, "lost");
  assert(hb.drop(0, 9.81).reason === "no-hand", "no hand to drop from");
});

test("HandBall motion gate retry keeps a still hand locked", () => {
  const hb = new HandBall();
  const P = { g: 9.81, h: 2, motion: true, dropLine: null };
  let now = 0;
  hb.start(now);
  const detect = (motion) => (motion ? null : { x: 0.5, y: 0.5 }); // only found when gate is off
  hb.track(now += 33, { ...P, motion: false }, () => ({ x: 0.5, y: 0.5 })); // initial lock
  for (let i = 0; i < 30; i++) hb.track(now += 33, P, detect);
  assert(hb.fix && hb.steady, "still hand stays locked with the motion gate on");
  assert(hb.speed() < 0.01, "a statue can't throw (speed " + hb.speed() + ")");
});

test("HandBall pickUp, button drop and validation", () => {
  const { hb, P, frame, now } = rig({ dropLine: null });
  for (let i = 0; i < 5; i++) frame();
  const ev = hb.drop(now(), P.g, 0, "button", P.h);
  assert(ev.type === "released" && ev.how === "button", "released");
  assert(hb.drop(now(), P.g) === null, "already falling");
  assert(hb.pickUp() === true && !hb.falling && !hb.fix, "picked up, lock reset");
  throws(() => { hb.fix = true; hb.drop(now(), 0); }, RangeError);
});
