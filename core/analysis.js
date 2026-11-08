/**
 * Auto-track analysis: tracked ball positions → a gravity measurement.
 * @module core/analysis
 */
import { robustFitFreeFall } from "./physics.js";

/**
 * @typedef {{t: number, y: number}} TrackPoint
 *   t: frame capture time in s (any origin); y: ball center, 0 = top of
 *   frame, 1 = bottom
 * @typedef {Object} FallAnalysis
 * @property {true} ok
 * @property {import("./physics.js").FreeFallFit} fit  in meters, t from fall start
 * @property {{t: number, y: number}[]} points  points used by the fit (m)
 * @property {number} span      seconds of fall the fit covers (after trimming)
 * @property {number} fps       measured camera frame rate
 * @property {number} rejected  outlier points dropped by the fit
 * @property {number} duplicates repeated frames dropped
 * @typedef {{ok: false, error: string, detail: string}} FallFailure
 *   error: shown to the user; detail: short log line
 */

const MIN_POINTS = 8;
const MIN_SPAN_S = 0.1;
const MIN_TRAVEL_M = 0.05;
const JITTER = 0.004;      // upward wobble (frame fraction) still counted as falling
const MAX_G = 60;

/**
 * @param {TrackPoint[]} samples
 * @param {{frameHeightM: number}} scale  meters covered by the full frame height
 * @returns {FallAnalysis|FallFailure}
 */
export function analyzeFall(samples, scale) {
  const frameHeightM = scale && scale.frameHeightM;
  if (!(frameHeightM > 0) || !isFinite(frameHeightM)) {
    throw new RangeError("analyzeFall: scale.frameHeightM must be a positive number");
  }
  const fail = (error, detail) => ({ ok: false, error, detail });

  // One point per camera frame, in time order, finite values only.
  const sorted = samples
    .filter((s) => s && isFinite(s.t) && isFinite(s.y))
    .slice()
    .sort((a, b) => a.t - b.t);
  const uniq = [];
  for (const s of sorted) {
    if (!uniq.length || s.t > uniq[uniq.length - 1].t + 1e-6) uniq.push(s);
  }
  const duplicates = sorted.length - uniq.length;

  // Keep the falling segment: never far above the last kept point.
  const pts = [];
  for (const s of uniq) {
    if (!pts.length || s.y >= pts[pts.length - 1].y - JITTER) pts.push(s);
  }
  if (pts.length < MIN_POINTS) {
    return fail(
      `Only ${pts.length} tracked points — need ${MIN_POINTS}+. Try a brighter ball, closer camera, or higher tolerance.`,
      `only ${pts.length} tracked points (need ${MIN_POINTS}+)`);
  }

  const t0 = pts[0].t, y0 = pts[0].y;
  let mks = pts.map((s) => ({ t: s.t - t0, y: (s.y - y0) * frameHeightM }));
  const span = mks[mks.length - 1].t;
  if (!(span > MIN_SPAN_S)) {
    return fail(`Fall lasted ${span.toFixed(2)} s — too short to fit.`,
      `fall lasted only ${span.toFixed(2)} s (need > ${MIN_SPAN_S} s)`);
  }
  const travel = mks[mks.length - 1].y - mks[0].y;
  if (!(travel > MIN_TRAVEL_M)) {
    return fail(`Ball moved only ${(travel * 100).toFixed(1)} cm — drop it through the frame, don't just hold it.`,
      `only ${(travel * 100).toFixed(1)} cm of motion detected`);
  }

  // Trim pre-drop loitering: start where sustained fall begins.
  let cut = 0;
  while (cut < mks.length - 4 && mks[cut].y < 0.03 * travel) cut++;
  if (cut > 0) {
    const rt = mks[cut].t, ry = mks[cut].y;
    mks = mks.slice(cut).map((s) => ({ t: s.t - rt, y: s.y - ry }));
  }

  const fallSpan = mks[mks.length - 1].t;
  const robust = robustFitFreeFall(mks);
  if (!robust || !(robust.fit.g > 0) || !(robust.fit.g < MAX_G)) {
    return fail("Fit failed — noisier data than expected. Retry with steadier light.",
      `least-squares fit failed on ${mks.length} points`);
  }
  const fps = (uniq.length - 1) / (uniq[uniq.length - 1].t - uniq[0].t);
  return {
    ok: true, fit: robust.fit, points: robust.kept, span: fallSpan,
    fps: isFinite(fps) ? fps : 0, rejected: robust.rejected, duplicates
  };
}
