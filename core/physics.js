/**
 * Kinematics and least-squares fits for free fall. Pure functions, no DOM.
 * Units: meters, seconds, m/s². "y" grows downward (distance fallen).
 * @module core/physics
 */

/** Standard gravity used as the reference for % error. */
export const REFERENCE_G = 9.81;

/**
 * Time to fall a height h, starting with downward speed v0.
 * @param {number} h height in m (>= 0)
 * @param {number} g gravity in m/s² (> 0)
 * @param {number} [v0=0] initial downward speed in m/s
 */
export function fallTime(h, g, v0 = 0) {
  return (Math.sqrt(v0 * v0 + 2 * g * h) - v0) / g;
}

/** g from a drop of height h (m) from rest taking t seconds. */
export function gravityFromDrop(h, t) {
  return 2 * h / (t * t);
}

export function mean(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1); 0 for fewer than two values. */
export function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Signed % error of g against REFERENCE_G. */
export function percentError(g) {
  return (g - REFERENCE_G) / REFERENCE_G * 100;
}

/**
 * @typedef {{t: number, y: number}} Sample  time (s) and distance fallen (m)
 * @typedef {{g: number, y0: number, rmse: number}} GravityFit
 * @typedef {{g: number, v0: number, y0: number, rmse: number, gStdErr: number, n: number}} FreeFallFit
 */

/**
 * Fit y = y0 + (g/2)·t² (drop from rest).
 * @param {Sample[]} samples
 * @returns {GravityFit|null} null when underdetermined
 */
export function fitGravity(samples) {
  const n = samples.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = s.t * s.t;
    sx += x; sy += s.y; sxx += x * x; sxy += x * s.y;
  }
  const den = n * sxx - sx * sx;
  if (!(den > 0)) return null;
  const b = (n * sxy - sx * sy) / den; // g/2
  const y0 = (sy - b * sx) / n;
  let se = 0;
  for (const s of samples) se += (s.y - (y0 + b * s.t * s.t)) ** 2;
  return { g: 2 * b, y0, rmse: Math.sqrt(se / n) };
}

/**
 * Fit y = y0 + v0·t + (g/2)·t². Tolerates a ball first seen mid-fall.
 * Time is centered before solving, which keeps the normal equations well
 * conditioned for long recordings. gStdErr is the 1σ standard error of g.
 * @param {Sample[]} samples
 * @returns {FreeFallFit|null} null when underdetermined
 */
export function fitFreeFall(samples) {
  const n = samples.length;
  if (n < 4) return null;
  const tc = mean(samples.map((s) => s.t));
  let S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  for (const s of samples) {
    const u = s.t - tc, u2 = u * u;
    S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2;
    Y0 += s.y; Y1 += u * s.y; Y2 += u2 * s.y;
  }
  const M = [[n, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const D = det3(M);
  if (!(Math.abs(D) > 1e-12 * Math.max(1, n * S2 * S4))) return null;
  const V = [Y0, Y1, Y2];
  const a = det3(withColumn(M, 0, V)) / D;
  const b = det3(withColumn(M, 1, V)) / D;
  const c = det3(withColumn(M, 2, V)) / D;
  // Back to uncentered time: y = a + b(t−tc) + c(t−tc)².
  const v0 = b - 2 * c * tc;
  const y0 = a - b * tc + c * tc * tc;
  let sse = 0;
  for (const s of samples) {
    const u = s.t - tc;
    sse += (s.y - (a + b * u + c * u * u)) ** 2;
  }
  // Var(c) = σ² · (MᵀM)⁻¹[2][2]; that entry is the (2,2) cofactor over D.
  const sigma2 = n > 3 ? sse / (n - 3) : 0;
  const inv22 = (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / D;
  const gStdErr = 2 * Math.sqrt(Math.max(0, sigma2 * inv22));
  return { g: 2 * c, v0, y0, rmse: Math.sqrt(sse / n), gStdErr, n };
}

/**
 * fitFreeFall that ignores outliers (false detections, motion blur).
 * Points whose residual exceeds k robust sigmas (from the median absolute
 * residual) are dropped and the fit repeated until nothing changes.
 * @param {Sample[]} samples
 * @param {{k?: number, floor?: number, maxIter?: number, minKeep?: number}} [opts]
 *   floor: smallest sigma in m, so clean data isn't over-trimmed
 * @returns {{fit: FreeFallFit, kept: Sample[], rejected: number}|null}
 */
export function robustFitFreeFall(samples, opts = {}) {
  const k = opts.k ?? 3.5;
  const floor = opts.floor ?? 0.003;
  const maxIter = opts.maxIter ?? 4;
  const minKeep = Math.max(4, opts.minKeep ?? Math.ceil(samples.length * 0.6));
  let kept = samples;
  let fit = fitFreeFall(kept);
  for (let it = 0; fit && it < maxIter; it++) {
    const model = (t) => fit.y0 + fit.v0 * t + fit.g / 2 * t * t;
    // Judge every original point against the current model, so a point
    // wrongly dropped early can come back.
    const res = samples.map((s) => Math.abs(s.y - model(s.t)));
    const sigma = Math.max(floor, 1.4826 * median(res));
    const next = samples.filter((s, i) => res[i] <= k * sigma);
    if (next.length < minKeep || next.length === kept.length) break;
    const refit = fitFreeFall(next);
    if (!refit) break;
    kept = next;
    fit = refit;
  }
  return fit ? { fit, kept, rejected: samples.length - kept.length } : null;
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
         m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
         m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function withColumn(m, j, v) {
  return m.map((row, r) => row.map((x, c) => (c === j ? v[r] : x)));
}
