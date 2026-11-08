/**
 * Turning camera pixels into meters. The scale is the biggest error left in
 * auto-track, so there are three ways to set it, best first:
 *   "ball"   — known ball diameter + its measured width in the video
 *   "pixels" — px per meter, typed in or set by tapping two points
 *   "frame"  — assume the full frame height equals the drop height
 * @module core/calibration
 */
import { median } from "./physics.js";

/** Common ball diameters in meters. */
export const BALL_DIAMETERS = Object.freeze({
  tennis: 0.067,
  "ping-pong": 0.040,
  golf: 0.0427,
  baseball: 0.074,
  "soccer (size 5)": 0.22,
  basketball: 0.24
});

const MIN_WIDTHS = 3;

/**
 * Scale from repeated width measurements of a ball of known diameter.
 * @param {number[]} widthsPx  ball widths in camera px (non-finite ignored)
 * @param {number} diameterM
 * @returns {{pxPerM: number, widthPx: number, n: number, spread: number}|null}
 *   spread: relative scatter of the widths (robust); null with < 3 widths
 */
export function scaleFromBallWidths(widthsPx, diameterM) {
  if (!(diameterM > 0)) throw new RangeError("scaleFromBallWidths: diameter must be positive");
  const w = widthsPx.filter((x) => isFinite(x) && x > 0);
  if (w.length < MIN_WIDTHS) return null;
  const mid = median(w);
  const spread = 1.4826 * median(w.map((x) => Math.abs(x - mid))) / mid;
  return { pxPerM: mid / diameterM, widthPx: mid, n: w.length, spread };
}

/**
 * Scale from two points a known distance apart.
 * @param {{x: number, y: number}} a  camera px
 * @param {{x: number, y: number}} b  camera px
 * @param {number} lengthM
 */
export function scaleFromPoints(a, b, lengthM) {
  if (!(lengthM > 0)) throw new RangeError("scaleFromPoints: length must be positive");
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(d >= 2)) throw new RangeError("scaleFromPoints: points are too close together");
  return d / lengthM;
}

/**
 * Pointer position → camera pixel, for a video drawn with object-fit: fill.
 * @param {{left: number, top: number, width: number, height: number}} rect  video's client rect
 * @param {{videoWidth: number, videoHeight: number}} video
 */
export function clientToCamera(rect, video, clientX, clientY) {
  return {
    x: (clientX - rect.left) / rect.width * video.videoWidth,
    y: (clientY - rect.top) / rect.height * video.videoHeight
  };
}

/**
 * @typedef {Object} ScaleInput
 * @property {"frame"|"ball"|"pixels"} mode
 * @property {number} videoHeightPx   camera frame height
 * @property {number} [dropHeightM]   for "frame" (and as the fallback)
 * @property {number[]} [ballWidthsPx] for "ball"
 * @property {number} [ballDiameterM]  for "ball"
 * @property {number} [pxPerM]         for "pixels"
 *
 * @typedef {Object} Scale
 * @property {number} frameHeightM  meters spanned by the full frame height
 * @property {"frame"|"ball"|"pixels"} source  method actually used
 * @property {string} label   short description for the results line
 * @property {string} [note]  why the requested method wasn't used
 */

/**
 * Decide the frame height in meters. Falls back to "frame" (with a note)
 * when the requested method lacks data.
 * @param {ScaleInput} o
 * @returns {Scale}
 */
export function resolveScale(o) {
  const H = o.videoHeightPx;
  const fallback = (note) => {
    if (!(o.dropHeightM > 0)) throw new RangeError("resolveScale: dropHeightM needed for the fallback");
    return { frameHeightM: o.dropHeightM, source: "frame",
      label: "scale: frame = " + o.dropHeightM + " m", note };
  };
  if (o.mode === "ball") {
    if (!(H > 0)) return fallback("camera size unknown");
    if (!(o.ballDiameterM > 0)) return fallback("enter the ball diameter");
    const s = scaleFromBallWidths(o.ballWidthsPx || [], o.ballDiameterM);
    if (!s) return fallback("couldn't measure the ball's size");
    return { frameHeightM: H / s.pxPerM, source: "ball",
      label: `scale: ball ${(o.ballDiameterM * 100).toFixed(1)} cm = ${s.widthPx.toFixed(1)} px` +
        (s.spread > 0.08 ? " (size varied — check focus and lighting)" : "") };
  }
  if (o.mode === "pixels") {
    if (!(o.pxPerM > 0)) return fallback("no px-per-meter scale set");
    if (!(H > 0)) return fallback("camera size unknown");
    return { frameHeightM: H / o.pxPerM, source: "pixels",
      label: `scale: ${Math.round(o.pxPerM)} px/m` };
  }
  return fallback();
}
