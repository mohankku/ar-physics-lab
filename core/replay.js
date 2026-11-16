/**
 * Replay a measured fall or throw over the video: tracked points, the
 * fitted path, and a ball at the measured g racing a ghost ball at 9.81 m/s².
 * @module core/replay
 */
import { REFERENCE_G } from "./physics.js";
import { drawBall, makeBall, ballRadius, drawArrow } from "./render.js";

/**
 * Frame-space view of a successful analyzeFall() result.
 * @param {import("./analysis.js").FallAnalysis} a
 * @param {number} [refG=REFERENCE_G] gravity for the ghost ball
 */
export function fallPath(a, refG = REFERENCE_G) {
  const { fit, origin, frameHeightM } = a;
  // Distance fallen (m) → frame fraction, anchored where the fit starts.
  const toFrame = (m) => origin.y + m / frameHeightM;
  return {
    span: a.span,
    x: a.x == null ? 0.5 : a.x,
    /** Ball y (frame fraction) on the fitted path at fit time τ (s). */
    measuredY: (tau) => toFrame(fit.y0 + fit.v0 * tau + 0.5 * fit.g * tau * tau),
    /** Same start and speed, but falling at refG. */
    referenceY: (tau) => toFrame(fit.y0 + fit.v0 * tau + 0.5 * refG * tau * tau),
    /** Tracked points in frame fractions, with their fit times. */
    points: a.points.map((p) => ({ t: p.t, y: toFrame(p.y) })),
    refG
  };
}

/**
 * Draw one replay frame at fit time tau (clamped to the fall).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{w: number, h: number, dpr: number}} dims
 * @param {ReturnType<typeof fallPath>} path
 * @param {number} tau
 * @param {{ghost?: boolean, ballStyle?: string, measuredG?: number,
 *   background?: CanvasImageSource|null}} [opts]  background: a recorded
 *   frame to show under the replay (when scrubbing)
 */
export function drawReplay(ctx, dims, path, tau, opts = {}) {
  const { w: W, h: H, dpr } = dims;
  const t = Math.min(path.span, Math.max(0, tau));
  const x = path.x * W;
  const r = ballRadius(dims) * 0.8;
  const gap = r * 2.6; // measured ball left of the path, ghost right
  ctx.clearRect(0, 0, W, H);
  if (opts.background) ctx.drawImage(opts.background, 0, 0, W, H);

  // Fitted path, drawn up to the current time.
  ctx.strokeStyle = "rgba(26,86,219,0.9)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const s = t * i / steps;
    const py = path.measuredY(s) * H;
    if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
  }
  ctx.stroke();

  // Tracked points seen so far.
  ctx.fillStyle = "rgba(229,72,77,0.9)";
  for (const p of path.points) {
    if (p.t > t + 1e-9) break;
    ctx.beginPath(); ctx.arc(x, p.y * H, 3 * dpr, 0, 2 * Math.PI); ctx.fill();
  }

  // Ghost at the reference g.
  if (opts.ghost !== false) {
    const gy = clampY(path.referenceY(t) * H, r, H);
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawBall(makeBall(opts.ballStyle), ctx, x + gap, gy, r);
    ctx.restore();
    label(ctx, dims, x + gap, gy - r - 6 * dpr, path.refG.toFixed(2));
  }
  const my = clampY(path.measuredY(t) * H, r, H);
  drawBall(makeBall(opts.ballStyle), ctx, x - gap, my, r);
  if (opts.measuredG) label(ctx, dims, x - gap, my - r - 6 * dpr, opts.measuredG.toFixed(2));
}

const ARROW_S = 0.15; // velocity arrows show the distance covered in this time

/**
 * Draw one projectile replay frame at time tau from launch: the fitted arc,
 * tracked points, the ball with its velocity components, and a ghost
 * launched the same way under the reference g.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{w: number, h: number, dpr: number}} dims
 * @param {ReturnType<typeof import("./projectile.js").projectilePath>} path
 * @param {number} tau
 * @param {{ghost?: boolean, ballStyle?: string, measuredG?: number,
 *   arrows?: boolean, background?: CanvasImageSource|null}} [opts]
 */
export function drawProjectileReplay(ctx, dims, path, tau, opts = {}) {
  const { w: W, h: H, dpr } = dims;
  const t = Math.min(path.span, Math.max(0, tau));
  const r = ballRadius(dims) * 0.8;
  ctx.clearRect(0, 0, W, H);
  if (opts.background) ctx.drawImage(opts.background, 0, 0, W, H);

  const arc = (yOf, upTo, style, dash) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = 2 * dpr;
    if (dash) ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const s = upTo * i / 60;
      const px = path.x(s) * W, py = yOf(s) * H;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  arc(path.measuredY, path.span, "rgba(26,86,219,0.35)", true); // whole flight, faint
  arc(path.measuredY, t, "rgba(26,86,219,0.9)", false);         // flown so far

  ctx.fillStyle = "rgba(229,72,77,0.9)";
  for (const p of path.points) {
    if (p.t > t + 1e-9) break;
    ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 3 * dpr, 0, 2 * Math.PI); ctx.fill();
  }

  const x = path.x(t) * W;
  if (opts.ghost !== false) {
    const gy = clampY(path.referenceY(t) * H, r, H);
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawBall(makeBall(opts.ballStyle), ctx, x, gy, r);
    ctx.restore();
    label(ctx, dims, x, gy + r + 14 * dpr, path.refG.toFixed(2));
  }
  const my = clampY(path.measuredY(t) * H, r, H);
  drawBall(makeBall(opts.ballStyle), ctx, x, my, r);
  if (opts.measuredG) label(ctx, dims, x, my - r - 6 * dpr, opts.measuredG.toFixed(2));

  if (opts.arrows !== false) {
    const v = path.velocity(t);
    const kx = W / path.frameWidthM * ARROW_S, ky = H / path.frameHeightM * ARROW_S;
    drawArrow(ctx, dims, x, my, v.vx * kx, 0, "#2dd4bf");
    drawArrow(ctx, dims, x, my, 0, v.vy * ky, "#fbbf24");
    label(ctx, dims, x + v.vx * kx, my - 6 * dpr, "vx " + Math.abs(v.vx).toFixed(1));
    label(ctx, dims, x - 22 * dpr * Math.sign(v.vx || 1), my + v.vy * ky, "vy " + Math.abs(v.vy).toFixed(1));
  }
}

function clampY(y, r, H) {
  return Math.min(H - r, Math.max(r, y));
}

function label(ctx, dims, x, y, text) {
  ctx.font = `600 ${11 * dims.dpr}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3 * dims.dpr;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
  ctx.textAlign = "start";
}

/**
 * Loops a replay on a canvas in slow motion until stopped.
 * Drawing goes through draw(tau) so the caller controls the canvas.
 */
export class ReplayLoop {
  /**
   * @param {number} span     seconds of fall
   * @param {(tau: number) => void} draw
   * @param {{slow?: number, pauseS?: number}} [opts] playback speed (0.25 =
   *   4× slower), and the hold on the final frame before looping
   */
  constructor(span, draw, opts = {}) {
    this.span = span;
    this.draw = draw;
    this.slow = opts.slow ?? 0.25;
    this.pauseS = opts.pauseS ?? 0.8;
    this._raf = 0;
    this._t0 = 0;
  }

  /** Fit time shown at wall-clock time `now` (ms since start). */
  tauAt(elapsedMs) {
    const play = this.span / this.slow, cycle = play + this.pauseS;
    const into = (elapsedMs / 1000) % cycle;
    return Math.min(this.span, into * this.slow);
  }

  start() {
    this.stop();
    this._t0 = performance.now();
    const frame = (now) => {
      this.draw(this.tauAt(now - this._t0));
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  get running() {
    return this._raf !== 0;
  }
}
