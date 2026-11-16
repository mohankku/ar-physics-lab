/**
 * Pendulum analysis: tracked bob positions → period, damping and g.
 *
 * The period comes from the times the bob passes through the middle of
 * its swing, where it moves fastest and so is timed most sharply. A straight
 * line through crossing time vs. crossing number gives the half period and
 * its standard error, and a missed or false crossing barely matters.
 * g = 4π²L/T₀², where T₀ is the small-swing period: the measured period is
 * corrected for amplitude with the exact elliptic-integral factor.
 * The pixel scale only enters that small correction, so g depends almost
 * entirely on the measured length and the camera's clock.
 * @module core/pendulum
 */
import { mean, median, fitLine, robustFit } from "./physics.js";
import { cleanSamples, frameRate } from "./analysis.js";

/**
 * @typedef {{t: number, x: number, y: number}} SwingPoint
 *   t in s; x, y frame fractions (0 = left / top)
 * @typedef {Object} PendulumOptions
 * @property {number} lengthM        pivot to the bob's center, m
 * @property {number} [aspect=4/3]   video width / height
 * @property {number} [frameHeightM] meters per frame height; enables the
 *   amplitude correction (without it the period is used as-is)
 *
 * @typedef {Object} PendulumAnalysis
 * @property {true} ok
 * @property {number} T          measured period, s
 * @property {number} TStdErr    1σ
 * @property {number} periods    full periods spanned by the crossings used
 * @property {number} g          m/s², amplitude-corrected when possible
 * @property {number} gStdErr    1σ from timing only (add your length error)
 * @property {number} factor     T / T₀ applied (1 when amplitude unknown)
 * @property {boolean} ampKnown  amplitude correction applied
 * @property {number|null} amplitudeDeg  first swing's angle, if known
 * @property {number|null} tau   amplitude decay time (s); null if no damping seen
 * @property {number|null} Q     quality factor π·τ/T
 * @property {{t: number, k: number, dir: number}[]} crossings  used (t from start)
 * @property {{t: number, a: number}[]} amplitudes  per half swing, frame heights
 * @property {{t: number, s: number}[]} series  displacement along the swing,
 *   frame heights from the center, t from the first sample
 * @property {{a: number, b: number, dir0: number, lnA: number, lnSlope: number}} model
 *   crossing k at t = a + b·k; s = dir0·A(t)·sin(π(t − a)/b), A = e^(lnA + lnSlope·t)
 * @property {{x: number, y: number, angle: number}} center  rest point (frame
 *   fractions) and swing direction (rad, 0 = horizontal)
 * @property {number} fps
 * @property {number} rejected  crossings ignored as off-beat
 * @property {number} duplicates
 */

const MIN_POINTS = 20;
const MIN_CROSSINGS = 4;  // 1.5 periods
const MIN_AMP = 0.01;     // frame heights
const BAND = 0.2;         // hysteresis: ±20% of the amplitude around center

/**
 * Period of a swing of amplitude theta (rad) relative to a tiny swing:
 * T/T₀ = π / (2·K(sin θ/2)) inverted, i.e. 1 / AGM(1, cos(θ/2)). Exact.
 */
export function periodFactor(theta) {
  let a = 1, b = Math.cos(theta / 2);
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15; i++) {
    const m = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = m;
  }
  return 1 / a;
}

/** Center-crossing times (line fit through the band), each with its direction.
 *  No crossing is placed inside a gap in tracking (longer than maxGap s). */
function findCrossings(series, c, h, maxGap) {
  const out = [];
  let side = 0, last = -1;
  for (let i = 0; i < series.length; i++) {
    if (i > 0 && series[i].t - series[i - 1].t > maxGap) side = 0; // lost track
    const d = series[i].s - c;
    const sd = d > h ? 1 : d < -h ? -1 : 0;
    if (sd === 0) continue;
    if (side !== 0 && sd !== side) {
      const t1 = series[last].t, t2 = series[i].t;
      const line = fitLine(series.slice(last, i + 1).map((p) => ({ t: p.t, v: p.s - c })));
      let tc = line && line.b !== 0 ? -line.a / line.b : (t1 + t2) / 2;
      tc = Math.min(t2, Math.max(t1, tc));
      out.push({ t: tc, dir: sd });
    }
    side = sd;
    last = i;
  }
  return out;
}

/** Time-weighted mean of s over [t1, t2], skipping gaps in tracking. */
function meanOver(series, t1, t2, maxGap) {
  let area = 0, span = 0;
  for (let i = 1; i < series.length; i++) {
    const p = series[i - 1], q = series[i];
    if (q.t <= t1 || p.t >= t2 || q.t - p.t > maxGap) continue;
    const dt = q.t - p.t;
    area += (p.s + q.s) / 2 * dt;
    span += dt;
  }
  return span > 0 ? area / span : NaN;
}

function quantile(xs, q) {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/**
 * @param {SwingPoint[]} samples
 * @param {PendulumOptions} opts
 * @returns {PendulumAnalysis|import("./analysis.js").FallFailure}
 */
export function analyzePendulum(samples, opts) {
  const L = opts && opts.lengthM;
  if (!(L > 0) || !isFinite(L)) throw new RangeError("analyzePendulum: lengthM must be a positive number");
  const aspect = opts.aspect > 0 ? opts.aspect : 4 / 3;
  const H = opts.frameHeightM > 0 && isFinite(opts.frameHeightM) ? opts.frameHeightM : null;
  const fail = (error, detail) => ({ ok: false, error, detail });

  const { points: pts, duplicates } = cleanSamples(samples, ["t", "x", "y"]);
  if (pts.length < MIN_POINTS) {
    return fail(`Only ${pts.length} tracked points — need ${MIN_POINTS}+. Let it swing longer, or check the ball color.`,
      `only ${pts.length} tracked points (need ${MIN_POINTS}+)`);
  }

  // Swing direction: principal axis of the bob's positions (frame-height units).
  const t0 = pts[0].t;
  const u = pts.map((p) => p.x * aspect), v = pts.map((p) => p.y);
  const mu = mean(u), mv = mean(v);
  let cuu = 0, cvv = 0, cuv = 0;
  for (let i = 0; i < pts.length; i++) {
    cuu += (u[i] - mu) ** 2; cvv += (v[i] - mv) ** 2; cuv += (u[i] - mu) * (v[i] - mv);
  }
  const angle = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const raw = pts.map((p, i) => ({ t: p.t - t0, s: (u[i] - mu) * ca + (v[i] - mv) * sa }));

  const ss = raw.map((p) => p.s);
  const amp = (quantile(ss, 0.95) - quantile(ss, 0.05)) / 2;
  if (!(amp > MIN_AMP)) {
    return fail("The ball is barely swinging — pull it about a hand's width aside and let go.",
      `swing amplitude only ${(amp * 100).toFixed(1)}% of the frame`);
  }
  const h = Math.max(BAND * amp, 0.003);
  const dts = [];
  for (let i = 1; i < raw.length; i++) dts.push(raw[i].t - raw[i - 1].t);
  const maxGap = 3 * median(dts);

  // Center: median first, then the mean over whole periods, then crossings again.
  let c = median(ss);
  let cross = findCrossings(raw, c, h, maxGap);
  if (cross.length >= 3) {
    const last = cross.length - 1 - ((cross.length - 1) % 2);
    const cm = meanOver(raw, cross[0].t, cross[last].t, maxGap);
    if (isFinite(cm)) { c = cm; cross = findCrossings(raw, c, h, maxGap); }
  }
  if (cross.length < MIN_CROSSINGS) {
    return fail(`Saw ${cross.length} pass(es) through the middle — need ${MIN_CROSSINGS}+. Let it swing for at least two full periods.`,
      `only ${cross.length} center crossings (need ${MIN_CROSSINGS}+)`);
  }

  // Number the crossings by half periods, so a missed one leaves a gap.
  // Half period from same-direction spacings: an off-center rest point makes
  // alternate half swings long and short, but every full period is equal.
  const fulls = [];
  for (let i = 2; i < cross.length; i++) {
    if (cross[i].dir === cross[i - 2].dir) fulls.push((cross[i].t - cross[i - 2].t) / 2);
  }
  const gaps = [];
  for (let i = 1; i < cross.length; i++) gaps.push(cross[i].t - cross[i - 1].t);
  const half0 = fulls.length ? median(fulls) : median(gaps);
  const numbered = [{ ...cross[0], k: 0 }];
  for (let i = 1; i < cross.length; i++) {
    const prev = numbered[numbered.length - 1];
    let step = Math.round((cross[i].t - prev.t) / half0);
    // Direction alternates every half swing: the step's parity must agree.
    if (step % 2 === 0 && cross[i].dir !== prev.dir) step += (cross[i].t - prev.t) / half0 > step ? 1 : -1;
    if (step % 2 === 1 && cross[i].dir === prev.dir) step += (cross[i].t - prev.t) / half0 > step ? 1 : -1;
    if (step >= 1) numbered.push({ ...cross[i], k: prev.k + step });
  }
  const robust = robustFit(numbered.map((n) => ({ t: n.k, v: n.t, n })), fitLine,
    (f, p) => Math.abs(p.v - (f.a + f.b * p.t)),
    { k: 4, floor: 0.002, minKeep: Math.max(MIN_CROSSINGS, Math.ceil(numbered.length * 0.7)) });
  if (!robust || robust.kept.length < MIN_CROSSINGS) {
    return fail("Couldn't find a steady rhythm in the swing — keep the camera still and the bob in view.",
      "crossing-time fit failed");
  }
  const line = robust.fit;
  const T = 2 * line.b, TStdErr = 2 * line.bStdErr;
  if (!(T > 0) || !isFinite(T)) {
    return fail("Period fit failed — try again with a longer swing.", `period fit gave T = ${T}`);
  }
  const used = robust.kept.map((p) => ({ t: p.n.t, k: p.n.k, dir: p.n.dir }));

  // Amplitude of each half swing between consecutive crossings.
  const amplitudes = [];
  for (let i = 1; i < used.length; i++) {
    if (used[i].k !== used[i - 1].k + 1) continue;
    let best = null;
    for (const p of raw) {
      if (p.t <= used[i - 1].t || p.t >= used[i].t) continue;
      const a = Math.abs(p.s - c);
      if (!best || a > best.a) best = { t: p.t, a };
    }
    if (best) amplitudes.push(best);
  }
  let lnA = Math.log(amp), lnSlope = 0, tau = null;
  if (amplitudes.length >= 3) {
    const env = fitLine(amplitudes.map((p) => ({ t: p.t, v: Math.log(p.a) })));
    if (env) {
      lnA = env.a;
      lnSlope = env.b;
      if (env.b < 0) tau = -1 / env.b;
      else lnSlope = 0;
    }
  } else if (amplitudes.length) {
    lnA = Math.log(mean(amplitudes.map((p) => p.a)));
  }

  // Amplitude correction: average the factor over the recorded half swings.
  let factor = 1, amplitudeDeg = null;
  if (H) {
    const thetas = (amplitudes.length ? amplitudes.map((p) => p.a) : [amp])
      .map((a) => Math.asin(Math.min(1, a * H / L)));
    factor = mean(thetas.map(periodFactor));
    amplitudeDeg = thetas[0] * 180 / Math.PI;
  }
  const T0 = T / factor;
  const g = 4 * Math.PI * Math.PI * L / (T0 * T0);
  const dir0 = used[0].dir * (used[0].k % 2 ? -1 : 1);
  return {
    ok: true, T, TStdErr,
    periods: (used[used.length - 1].k - used[0].k) / 2,
    g, gStdErr: 2 * g * TStdErr / T,
    factor, ampKnown: !!H, amplitudeDeg,
    tau, Q: tau ? Math.PI * tau / T : null,
    crossings: used, amplitudes,
    series: raw.map((p) => ({ t: p.t, s: p.s - c })),
    model: { a: line.a, b: line.b, dir0, lnA, lnSlope },
    center: { x: (mu + c * ca) / aspect, y: mv + c * sa, angle },
    fps: frameRate(pts),
    rejected: numbered.length - used.length,
    duplicates
  };
}

/** Fitted displacement (frame heights from center) at time t of a result. */
export function pendulumModel(res, t) {
  const m = res.model;
  return m.dir0 * Math.exp(m.lnA + m.lnSlope * t) * Math.sin(Math.PI * (t - m.a) / m.b);
}
