import { test, assert } from "./harness.js";
import { FrameRing } from "../core/framebuffer.js";

/* Fake createImageBitmap: records sizes, optional per-call delay, close() tracking. */
function fakes(delays = []) {
  const made = [];
  let call = 0;
  const create = (video, opts) => {
    const d = delays[call++] || 0;
    const img = { w: opts.resizeWidth, h: opts.resizeHeight, closed: false, close() { this.closed = true; } };
    made.push(img);
    return new Promise((r) => setTimeout(() => r(img), d));
  };
  return { create, made };
}
const video = { videoWidth: 640, videoHeight: 480 };

test("stores downscaled frames in time order", async () => {
  const { create, made } = fakes([20, 0, 5]); // first snapshot resolves last
  const ring = new FrameRing({ createImageBitmap: create, width: 160 });
  await Promise.all([ring.push(video, 1), ring.push(video, 2), ring.push(video, 3)]);
  assert(ring.frames.map((f) => f.time).join() === "1,2,3", "sorted despite out-of-order resolve");
  assert(made[0].w === 160 && made[0].h === 120, "aspect kept");
});

test("drops and closes the oldest frames past capacity", async () => {
  const { create, made } = fakes();
  const ring = new FrameRing({ createImageBitmap: create, capacity: 3 });
  for (let i = 0; i < 5; i++) await ring.push(video, i);
  assert(ring.frames.length === 3 && ring.frames[0].time === 2, "kept newest 3");
  assert(made[0].closed && made[1].closed && !made[2].closed, "evicted frames freed");
});

test("nearest picks the closest frame", async () => {
  const { create } = fakes();
  const ring = new FrameRing({ createImageBitmap: create });
  for (const t of [0, 0.033, 0.066, 0.1]) await ring.push(video, t);
  assert(ring.nearest(0.05).time === 0.066, "0.05 → 0.066");
  assert(ring.nearest(0.04).time === 0.033, "0.04 → 0.033");
  assert(ring.nearest(-1).time === 0 && ring.nearest(9).time === 0.1, "clamped to ends");
  assert(new FrameRing({ createImageBitmap: create }).nearest(0) === null, "empty");
});

test("trimBefore and clear free memory; late snapshots after clear are dropped", async () => {
  const { create, made } = fakes([0, 0, 30]);
  const ring = new FrameRing({ createImageBitmap: create });
  await ring.push(video, 1); await ring.push(video, 2);
  ring.trimBefore(1.5);
  assert(ring.frames.length === 1 && made[0].closed, "trimmed");
  const late = ring.push(video, 3);
  ring.clear();
  await late;
  assert(ring.frames.length === 0 && made[1].closed && made[2].closed, "all freed");
});

test("unsupported browsers and unready video are skipped quietly", async () => {
  const ring = new FrameRing({ createImageBitmap: null });
  ring._create = null;
  assert(!ring.supported, "unsupported");
  await ring.push(video, 1);
  const ok = new FrameRing({ createImageBitmap: fakes().create });
  await ok.push({ videoWidth: 0 }, 1);
  assert(ring.frames.length === 0 && ok.frames.length === 0, "nothing stored");
});
