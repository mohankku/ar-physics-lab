import { test, assert, near, throws, rng, gaussian } from "./harness.js";
import { analyzeFall } from "../core/analysis.js";

const FRAME_M = 1.5; // full frame height in meters

/* A ball dropped from rest, seen by a camera at `fps`, y in frame fractions. */
function recording({ fps = 30, frames = 18, loiter = 0, start = 1234.5, noise = 0, seed = 1 } = {}) {
  const rand = rng(seed), out = [];
  let t = start;
  for (let i = 0; i < loiter; i++, t += 1 / fps) out.push({ t, y: 0.1 });
  for (let i = 0; i < frames; i++, t += 1 / fps) {
    const ft = i / fps;
    out.push({ t, y: 0.1 + (0.5 * 9.81 * ft * ft) / FRAME_M + gaussian(rand, noise) });
  }
  return out;
}

test("measures g from a clean recording", () => {
  const res = analyzeFall(recording(), { frameHeightM: FRAME_M });
  assert(res.ok, res.error);
  near(res.fit.g, 9.81, 1e-6, "g");
  near(res.fps, 30, 1e-6, "fps");
});

test("repeated frames (60 Hz loop over a 30 fps camera) are dropped", () => {
  const rec = recording();
  const doubled = [];
  for (const s of rec) doubled.push(s, { t: s.t, y: s.y });
  const res = analyzeFall(doubled, { frameHeightM: FRAME_M });
  assert(res.ok, res.error);
  assert(res.duplicates === rec.length, "duplicates " + res.duplicates);
  near(res.fit.g, 9.81, 1e-6, "g");
});

test("trims frames before the drop", () => {
  const res = analyzeFall(recording({ loiter: 15 }), { frameHeightM: FRAME_M });
  assert(res.ok, res.error);
  near(res.fit.g, 9.81, 0.3, "g");
});

test("survives a false detection mid-fall", () => {
  const rec = recording({ frames: 20 });
  rec[12] = { t: rec[12].t, y: rec[12].y + 0.2 };
  const res = analyzeFall(rec, { frameHeightM: FRAME_M });
  assert(res.ok, res.error);
  assert(res.rejected >= 1, "rejected the bad point");
  near(res.fit.g, 9.81, 0.05, "g");
});

test("reports a plausible uncertainty on noisy data", () => {
  const res = analyzeFall(recording({ noise: 0.002, seed: 9 }), { frameHeightM: FRAME_M });
  assert(res.ok, res.error);
  assert(res.fit.gStdErr > 0 && res.fit.gStdErr < 1.5, "σ " + res.fit.gStdErr);
  assert(Math.abs(res.fit.g - 9.81) < 4 * res.fit.gStdErr, "g within 4σ");
});

test("order of samples doesn't matter", () => {
  const rec = recording().reverse();
  near(analyzeFall(rec, { frameHeightM: FRAME_M }).fit.g, 9.81, 1e-6, "g");
});

test("explains bad recordings", () => {
  const few = analyzeFall(recording({ frames: 5 }), { frameHeightM: FRAME_M });
  assert(!few.ok && /need 8\+/.test(few.error) && few.detail, "too few points");
  const still = [];
  for (let i = 0; i < 20; i++) still.push({ t: i / 30, y: 0.4 });
  const r = analyzeFall(still, { frameHeightM: FRAME_M });
  assert(!r.ok && /moved only/.test(r.error), "no motion: " + r.error);
  const quick = recording({ fps: 240, frames: 20 }); // 0.08 s
  assert(/too short/.test(analyzeFall(quick, { frameHeightM: FRAME_M }).error), "too short");
});

test("ignores non-finite samples", () => {
  const rec = recording();
  rec.splice(4, 0, { t: NaN, y: 0.3 }, { t: 1, y: Infinity }, null);
  assert(analyzeFall(rec, { frameHeightM: FRAME_M }).ok, "still fits");
});

test("rejects a missing or bad scale", () => {
  throws(() => analyzeFall(recording(), {}), RangeError);
  throws(() => analyzeFall(recording(), { frameHeightM: -1 }), RangeError);
});
