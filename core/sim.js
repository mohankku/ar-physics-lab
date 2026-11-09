/**
 * The virtual balls: a simulated drop, and a ball held by a tracked hand.
 * Motion uses closed-form kinematics, so position and landing time are exact
 * at any frame rate (no integration drift, no overshoot frame).
 * @module core/sim
 */
import { fallTime } from "./physics.js";

/** Seam rotation per fraction of the drop height travelled. */
export const SPIN = 6;

/** @typedef {{style: string, angle: number}} Ball */

/** Virtual ball dropped from rest. y is distance fallen (m, downward). */
export class FreeFall {
  /** @param {number} [g=9.81] @param {number} [h=2] */
  constructor(g = 9.81, h = 2) {
    /** @type {Ball|null} */
    this.ball = null;
    this.reset(g, h);
  }

  /** Back to the top, with gravity g (m/s²) and drop height h (m) for the next drop. */
  reset(g = this.g, h = this.h) {
    if (!(g > 0) || !(h > 0)) throw new RangeError("FreeFall: g and h must be positive");
    this.g = g;
    this.h = h;
    this.t = 0; this.y = 0; this.v = 0;
    this.landed = false;
    /** @type {number[]} recent y values for a motion trail */
    this.trail = [];
  }

  /** Exact time this drop takes. */
  get landingTime() {
    return fallTime(this.h, this.g);
  }

  /**
   * Advance simulated time by dt seconds.
   * @param {number} dt seconds (≥ 0; scale it for slow motion)
   * @param {boolean} [keepTrail]
   * @returns {boolean} true once the ball has landed
   */
  step(dt, keepTrail = false) {
    if (this.landed) return true;
    const tLand = this.landingTime;
    const prevY = this.y;
    this.t = Math.min(tLand, this.t + Math.max(0, dt));
    this.landed = this.t >= tLand;
    this.y = this.landed ? this.h : 0.5 * this.g * this.t * this.t;
    this.v = this.g * this.t;
    if (this.ball) this.ball.angle += (this.y - prevY) / this.h * SPIN;
    if (keepTrail) {
      this.trail.push(this.y);
      if (this.trail.length > 120) this.trail.shift();
    }
    return this.landed;
  }
}

/* Hand smoothing time constants (s). At 60 fps these equal the original
 * per-frame factors 0.45 (position) and 0.35 (velocity); as time constants
 * they behave the same at any frame rate. */
const TAU_POS = 0.028;
const TAU_VEL = 0.039;
const CALM_MS = 600;   // ignore the drop line this long after a fresh lock
const COAST_MS = 150;  // dead-reckon through tracking dropouts this short

/**
 * @typedef {Object} HoldParams
 * @property {number} g         gravity (m/s²)
 * @property {number} h         ceiling: meters covered by the full frame height
 * @property {boolean} [motion] ask the detector for moving pixels only
 * @property {number|null} [dropLine] frame fraction (0..1); lifting above it releases
 *
 * @typedef {{type: "landed", t: number, h0: number}
 *   | {type: "lost"}
 *   | {type: "released", v0: number, h0: number, how: string}
 *   | {type: "refused", reason: "landed"|"no-hand"}} HoldEvent
 *
 * @callback Detect
 * @param {boolean} motion  moving pixels only
 * @param {{x: number, y: number}|null} pref  last lock, to prefer nearby blobs
 * @returns {{x: number, y: number}|null} hand centroid, 0..1 frame units
 */

/**
 * Virtual ball held by a tracked hand, then released into free fall.
 * Call track() once per new camera frame and tick() once per animation
 * frame. Times (`now`) are performance.now() milliseconds.
 *
 * sx, sy: smoothed hand position (0..1). yM: ball height above the floor (m).
 */
export class HandBall {
  constructor() {
    /** @type {Ball|null} */
    this.ball = null;
    this.sx = 0.5; this.sy = 0.3;
    this.fix = false;     // hand position is known
    this.steady = false;  // lock has held for at least one frame
    this.falling = false;
    this.landed = false;
    this.t = 0; this.yM = 0; this.v = 0;
    this.h0 = 0; this.v0 = 0; this.g = 9.81; this.ceiling = 2;
    this.hvx = 0; this.hvy = 0; // smoothed hand velocity (frames/s)
    this._resync = false; this._prevYM = 0;
    this._calmUntil = 0; this._lastSeen = 0; this._lastTrack = 0; this._releasedAt = 0;
  }

  /** Begin tracking (camera just opened). */
  start(now) {
    this._lastTrack = now;
  }

  /** Pause guard (e.g. while hidden): a position jump can't fake a throw. */
  calm(now) {
    this._calmUntil = now + CALM_MS;
    this.hvx = 0; this.hvy = 0;
  }

  /** Drop the hand lock, so the next frame re-acquires from scratch. */
  forgetLock() {
    this.fix = false;
  }

  /** Hand speed in frame heights per second. */
  speed() {
    return Math.hypot(this.hvx, this.hvy);
  }

  /** Height the current, or next, drop starts from (m). */
  dropHeight() {
    return this.falling || this.landed ? this.h0 : this.yM;
  }

  /**
   * Feed one new camera frame while holding.
   * @param {number} now
   * @param {HoldParams} p
   * @param {Detect} detect
   * @returns {HoldEvent|null}
   */
  track(now, p, detect) {
    if (this.falling || this.landed) return null;
    const dt = clamp((now - this._lastTrack) / 1000, 0.005, 0.1);
    this._lastTrack = now;
    const was = this.steady;
    const psx = this.sx, psy = this.sy;
    const pref = this.fix ? { x: this.sx, y: this.sy } : null;
    let ev = null;
    let c = detect(!!p.motion, pref);
    if (!c && p.motion && was) {
      // A still hand, not a gone hand: retry without the motion gate so a
      // pause keeps the lock (new locks still need motion). Zero the velocity
      // so a statue can't throw.
      c = detect(false, pref);
      if (c) { this.hvx = 0; this.hvy = 0; }
    }
    if (c) {
      this._lastSeen = now;
      const a = 1 - Math.exp(-dt / TAU_POS);
      this.sx += a * (c.x - this.sx);
      this.sy += a * (c.y - this.sy);
      this.fix = true;
      const k = 1 - Math.exp(-dt / TAU_VEL);
      this.hvx += k * ((this.sx - psx) / dt - this.hvx);
      this.hvy += k * ((this.sy - psy) / dt - this.hvy);
      if (!was) this.calm(now); // fresh lock: ignore the jump that acquired it
      this.steady = true;
    } else if (this.steady && now - this._lastSeen < COAST_MS) {
      // Coast through brief dropouts (motion blur, blink frames).
      this.sx = clamp(this.sx + this.hvx * dt, 0, 1);
      this.sy = clamp(this.sy + this.hvy * dt, 0, 1);
    } else {
      if (this.steady || this.fix) ev = { type: "lost" };
      this.steady = false;
      this.fix = false;
    }

    this.yM = p.h * (1 - this.sy);
    if (this._resync || !this.fix) {
      this._resync = false; // re-pickup: sync, don't spin-burst
    } else if (this.ball) {
      this.ball.angle += Math.abs(this.yM - this._prevYM) / p.h * SPIN;
    }
    this._prevYM = this.yM;

    if (this.steady && p.dropLine != null && now > this._calmUntil && this.sy < p.dropLine) {
      // Crossing speed becomes throw velocity (frames/s × m per frame);
      // moving up, or slowly, drops from rest.
      ev = this.drop(now, p.g, Math.max(0, p.h * this.hvy), "drag", p.h);
    }
    return ev;
  }

  /**
   * Advance the fall to `now`. Call every animation frame.
   * @returns {HoldEvent|null} a "landed" event on the frame it lands
   */
  tick(now) {
    if (!this.falling) return null;
    const tLand = fallTime(this.h0, this.g, this.v0);
    const t = Math.min(tLand, Math.max(0, (now - this._releasedAt) / 1000));
    const prevY = this.yM;
    this.t = t;
    this.v = this.v0 + this.g * t;
    this.yM = Math.max(0, this.h0 - this.v0 * t - 0.5 * this.g * t * t);
    if (this.ball) this.ball.angle += (prevY - this.yM) / this.ceiling * SPIN;
    if (t >= tLand) {
      this.yM = 0;
      this.falling = false;
      this.landed = true;
      return { type: "landed", t: tLand, h0: this.h0 };
    }
    return null;
  }

  /**
   * Release the ball.
   * @param {number} now
   * @param {number} g    gravity for this fall (m/s²)
   * @param {number} [v0=0] downward speed (m/s)
   * @param {string} [how="button"]
   * @param {number} [ceiling] frame height in m, for spin (defaults to drop height)
   * @returns {HoldEvent|null} null when already falling
   */
  drop(now, g, v0 = 0, how = "button", ceiling) {
    if (this.falling) return null;
    if (this.landed) return { type: "refused", reason: "landed" };
    if (!this.fix) return { type: "refused", reason: "no-hand" };
    if (!(g > 0)) throw new RangeError("HandBall.drop: g must be positive");
    this.g = g;
    this.h0 = Math.max(0.05, this.yM);
    this.v0 = Math.max(0, v0 || 0);
    this.ceiling = ceiling > 0 ? ceiling : Math.max(this.h0, 0.05);
    this.yM = this.h0;
    this.t = 0; this.v = this.v0;
    this.falling = true;
    this._releasedAt = now;
    return { type: "released", v0: this.v0, h0: this.h0, how };
  }

  /**
   * Back to holding.
   * @returns {boolean} true if the hand was locked before
   */
  pickUp() {
    const had = this.fix;
    this.falling = false;
    this.landed = false;
    this._resync = true;
    this.fix = false; // force a fresh lock so a stale spot is never trusted
    this.steady = false;
    this.t = 0; this.v = 0;
    return had;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
