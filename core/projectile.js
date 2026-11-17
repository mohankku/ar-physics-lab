/**
 * Projectile analysis: tracked positions of a thrown ball → g, launch
 * velocity and angle, plus a check that horizontal motion is uniform.
 *
 * Horizontal and vertical motion are fitted separately, as the physics
 * says they are independent:
 *   x = x0 + vx·t            (no horizontal force)
 *   y = y0 + vy·t + ½·g·t²   (y down, so an upward throw has vy < 0)
 * A recording also holds the throw itself (the hand still pushing) and the
 * landing or catch. Neither is free flight, so the fit starts on the middle
 * of the recording, which is safely in the air, and grows outward while
 * neighboring points still match.
 * @module core/projectile
 */
import { fitFreeFall, fitLine, robustFit, median, REFERENCE_G } from "./physics.js";
import { cleanSamples, frameRate } from "./analysis.js";

/**
 * @typedef {{t: number, x: number, y: number}} ThrowPoint
 *   t in s (any origin); x, y frame fractions (0 = left / top)
 * @typedef {{frameHeightM: number, aspect: number}} ThrowScale
 *   meters spanned by the frame height; aspect = video width / height
 *   (square camera pixels assumed)
 *
 * @typedef {Object} ProjectileAnalysis
 * @property {true} ok
 * @property {number} g        vertical acceleration, m/s²
 * @property {number} gStdErr  1σ
 * @property {number} vx       horizontal speed, m/s (signed: + = rightward)
 * @property {number} vxStdErr 1σ
 * @property {number} vy       upward launch speed, m/s (negative = thrown down)
 * @property {number} speed    launch speed, m/s
 * @property {number} angleDeg launch angle above horizontal
 * @property {number} ax       horizontal acceleration (should be ≈ 0), m/s²
 * @property {number} axStdErr 1σ
 * @property {number} apexM    rise above the launch point, m (0 if thrown down)
 * @property {number|null} rangeM  horizontal distance back to launch height
 * @property {number} rmse     2-D fit residual, m
 * @property {number} span     seconds of free flight fitted
 * @property {{t: number, x: number, y: number}[]} points  fitted points:
 *   t from launch, x/y in meters from the frame's top-left
 * @property {{t: number, x: number, y: number}} origin  launch: input time (s)
 *   and position in meters from the frame's top-left
 * @property {number} frameHeightM
 * @property {number} frameWidthM
 * @property {number} fps
 * @property {number} rejected  outliers dropped inside the flight
 * @property {number} trimmed   points outside the flight (hand, landing)
 * @property {number} duplicates
 */

const MIN_POINTS = 8;
const MIN_SPAN_S = 0.1;
const MIN_TRAVEL_M = 0.05;
const STILL_M = 0.02;     // closer than this to the first/last point = not yet moving
const FLOOR_M = 0.005;    // tracking noise floor for the fits' sigma
const GROW_K = 4;         // extend the flight while residuals stay within this × sigma
const MAX_G = 60;

/** Fit both axes; null when either is underdetermined. */
function fitBoth(pts) {
  const fy = fitFreeFall(pts.map((p) => ({ t: p.t, y: p.y })));
  const fx = fitLine(pts.map((p) => ({ t: p.t, v: p.x })));
  return fy && fx ? { fy, fx } : null;
}

/** Distance (m) from point s to the fitted path at s.t. */
function residual(f, s) {
  const { fx, fy } = f;
  return Math.hypot(s.x - (fx.a + fx.b * s.t),
    s.y - (fy.y0 + fy.v0 * s.t + fy.g / 2 * s.t * s.t));
}

function robustSigma(f, pts) {
  return Math.max(FLOOR_M, 1.4826 * median(pts.map((p) => residual(f, p))));
}

/**
 * @param {ThrowPoint[]} samples
 * @param {ThrowScale} scale
 * @returns {ProjectileAnalysis|import("./analysis.js").FallFailure}
 */
export function analyzeProjectile(samples, scale) {
  const H = scale && scale.frameHeightM, aspect = scale && scale.aspect;
  if (!(H > 0) || !isFinite(H)) {
    throw new RangeError("analyzeProjectile: scale.frameHeightM must be a positive number");
  }
  if (!(aspect > 0) || !isFinite(aspect)) {
    throw new RangeError("analyzeProjectile: scale.aspect must be a positive number");
  }
  const W = H * aspect;
  const fail = (error, detail) => ({ ok: false, error, detail });

  const { points: uniq, duplicates } = cleanSamples(samples, ["t", "x", "y"]);
  if (uniq.length < MIN_POINTS) {
    return fail(`Only ${uniq.length} tracked points — need ${MIN_POINTS}+. Try a brighter ball, closer camera, or higher tolerance.`,
      `only ${uniq.length} tracked points (need ${MIN_POINTS}+)`);
  }
  const t0 = uniq[0].t;
  const all = uniq.map((s) => ({ t: s.t - t0, x: s.x * W, y: s.y * H }));

  // Drop the still ball before the throw and after a catch.
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let a = 0, b = all.length - 1;
  while (a < b && dist(all[a], all[0]) < STILL_M) a++;
  while (b > a && dist(all[b], all[all.length - 1]) < STILL_M) b--;
  if (a > 0) a--; // the last still point is where the motion began
  if (b < all.length - 1) b++;
  const seg = all.slice(a, b + 1);
  let travel = 0;
  for (const p of seg) travel = Math.max(travel, dist(p, seg[0]));
  if (!(travel > MIN_TRAVEL_M)) {
    return fail(`Ball moved only ${(travel * 100).toFixed(1)} cm — throw it across the frame.`,
      `only ${(travel * 100).toFixed(1)} cm of motion detected`);
  }
  if (seg.length < MIN_POINTS) {
    return fail(`Only ${seg.length} points in flight — need ${MIN_POINTS}+. Throw higher, or step the camera back.`,
      `only ${seg.length} moving points (need ${MIN_POINTS}+)`);
  }

  // Seed on the middle half, then grow toward both ends.
  let lo = 0, hi = seg.length;
  if (seg.length >= 12) { lo = Math.floor(seg.length / 4); hi = Math.ceil(seg.length * 3 / 4); }
  const seed = robustFit(seg.slice(lo, hi), fitBoth, residual, { floor: FLOOR_M });
  if (!seed) {
    return fail("Fit failed — the path doesn't look like a throw. Retry with steadier light.",
      `seed fit failed on ${hi - lo} points`);
  }
  let f = seed.fit;
  const sigma = robustSigma(f, seed.kept);
  for (let grew = true; grew;) {
    grew = false;
    if (lo > 0 && residual(f, seg[lo - 1]) <= GROW_K * sigma) { lo--; grew = true; }
    if (hi < seg.length && residual(f, seg[hi]) <= GROW_K * sigma) { hi++; grew = true; }
    if (grew) f = fitBoth(seg.slice(lo, hi)) || f;
  }
  const flight = seg.slice(lo, hi);
  const robust = robustFit(flight, fitBoth, residual, { floor: FLOOR_M });
  if (!robust || robust.kept.length < MIN_POINTS) {
    return fail("Too few points follow one smooth arc — keep the whole throw in view, against a plain background.",
      `only ${robust ? robust.kept.length : 0} points on the arc (need ${MIN_POINTS}+)`);
  }

  // Re-time from the first point in flight, so v0 is the launch velocity.
  const tl = robust.kept[0].t;
  const pts = robust.kept.map((p) => ({ t: p.t - tl, x: p.x, y: p.y }));
  const span = pts[pts.length - 1].t;
  if (!(span > MIN_SPAN_S)) {
    return fail(`Flight lasted ${span.toFixed(2)} s — too short to fit. Throw higher.`,
      `flight lasted only ${span.toFixed(2)} s (need > ${MIN_SPAN_S} s)`);
  }
  const fit = fitBoth(pts);
  const g = fit && fit.fy.g;
  if (!fit || !(g > 0) || !(g < MAX_G)) {
    return fail("Fit failed — the arc doesn't curve downward. Is the camera upright?",
      `fit gave g = ${fit ? fit.fy.g.toFixed(2) : "?"} m/s²`);
  }
  const xAccel = fitFreeFall(pts.map((p) => ({ t: p.t, y: p.x })));
  const vx = fit.fx.b, vy = -fit.fy.v0;
  const sse = pts.reduce((s, p) => s + residual(fit, p) ** 2, 0);
  return {
    ok: true,
    g, gStdErr: fit.fy.gStdErr,
    vx, vxStdErr: fit.fx.bStdErr,
    vy,
    speed: Math.hypot(vx, vy),
    angleDeg: Math.atan2(vy, Math.abs(vx)) * 180 / Math.PI,
    ax: xAccel ? xAccel.g : 0, axStdErr: xAccel ? xAccel.gStdErr : 0,
    apexM: vy > 0 ? vy * vy / (2 * g) : 0,
    rangeM: vy > 0 ? Math.abs(vx) * 2 * vy / g : null,
    rmse: Math.sqrt(sse / pts.length),
    span, points: pts,
    origin: { t: t0 + tl, x: fit.fx.a, y: fit.fy.y0 },
    frameHeightM: H, frameWidthM: W,
    fps: frameRate(uniq),
    rejected: robust.rejected,
    trimmed: seg.length - flight.length,
    duplicates
  };
}

/**
 * Frame-space view of a successful analyzeProjectile() result, for replay.
 * All positions are frame fractions; tau is seconds from launch.
 * @param {ProjectileAnalysis} a
 * @param {number} [refG=REFERENCE_G] gravity for the ghost ball
 */
export function projectilePath(a, refG = REFERENCE_G) {
  const { origin: o, frameHeightM: H, frameWidthM: W } = a;
  const yAt = (g, tau) => (o.y - a.vy * tau + 0.5 * g * tau * tau) / H;
  return {
    span: a.span,
    x: (tau) => (o.x + a.vx * tau) / W,
    measuredY: (tau) => yAt(a.g, tau),
    referenceY: (tau) => yAt(refG, tau),
    /** Velocity at tau in m/s: vx, and vy downward (y grows down). */
    velocity: (tau) => ({ vx: a.vx, vy: -a.vy + a.g * tau }),
    points: a.points.map((p) => ({ t: p.t, x: p.x / W, y: p.y / H })),
    frameHeightM: H, frameWidthM: W,
    refG
  };
}
