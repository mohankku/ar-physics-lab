/**
 * Hands-free recording for auto-track: watches tracked positions, starts
 * when a resting ball begins to fall, stops when the fall is over.
 * @module core/trigger
 */
import { median } from "./physics.js";

/**
 * @typedef {{t: number, y: number, x: number, blob: object|null}} TriggerSample
 *   t in seconds; x, y in frame fractions (0..1, y down)
 *
 * @typedef {{type: "ready"}
 *   | {type: "started"}
 *   | {type: "stopped", reason: "left-frame"|"bounced"|"lost"|"timeout"}} TriggerEvent
 *   ready: the ball has been still long enough to arm
 */

const DEFAULTS = {
  preRollS: 0.4,     // keep this much from before the drop (helps the fit's start)
  restS: 0.25,       // ball must sit still this long before a drop counts
  restSpread: 0.015, // "still": positions within this frame fraction
  startDrop: 0.03,   // fall starts once the ball is this far below rest
  bottom: 0.96,      // ball center this low = leaving the frame
  bounce: 0.04,      // rising this far from the lowest point = bounced or caught
  lostS: 0.2,        // not seen this long mid-fall = gone (left frame, hidden)
  maxS: 3            // never record longer than this
};

/** States: "waiting" (no still ball yet) → "ready" → "recording" → "done". */
export class FallTrigger {
  /** @param {Partial<typeof DEFAULTS>} [opts] */
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.reset();
  }

  /** Start over: waiting for a still ball. */
  reset() {
    this.state = "waiting";
    /** @type {TriggerSample[]} */
    this._pre = [];
    /** @type {TriggerSample[]} */
    this._rec = [];
    this._rest = null;
    this._lowest = 0;
    this._lastSeen = 0;
    this._startT = 0;
    this.stopReason = null;
  }

  /** Recorded samples: pre-roll + the fall. Only detections, in time order. */
  samples() {
    return this._rec.slice();
  }

  /** Resting position (frame fraction) the drop started from, or null. */
  get restY() {
    return this._rest;
  }

  /**
   * Feed one camera frame.
   * @param {number} t   frame time in seconds
   * @param {{x: number, y: number}|null} blob  tracked ball, or null if not seen
   * @returns {TriggerEvent|null}
   */
  push(t, blob) {
    const o = this.opts;
    if (this.state === "done") return null;
    const s = blob ? { t, x: blob.x, y: blob.y, blob } : null;

    if (this.state !== "recording") {
      // Keep a short history to judge stillness and to serve as pre-roll.
      if (s) this._pre.push(s);
      const keep = Math.max(o.preRollS, o.restS);
      while (this._pre.length && this._pre[0].t < t - keep) this._pre.shift();
      const rest = this._restingY(t);
      if (rest !== null) {
        this._rest = rest;
        if (this.state === "waiting") {
          this.state = "ready";
          return { type: "ready" };
        }
      }
      if (this.state === "ready" && s && this._rest !== null && this._falling(s)) {
        this.state = "recording";
        this._startT = t;
        this._lastSeen = t;
        this._lowest = s.y;
        this._rec = this._pre.filter((p) => p.t >= t - o.preRollS);
        return { type: "started" };
      }
      if (this.state === "ready" && !s && t - this._lastPreT() > o.restS) {
        // Ball vanished without falling (picked up, hidden): wait again.
        this.state = "waiting";
        this._rest = null;
      }
      return null;
    }

    // Recording.
    if (s) {
      this._rec.push(s);
      this._lastSeen = t;
      this._lowest = Math.max(this._lowest, s.y);
      if (s.y >= o.bottom) return this._stop("left-frame");
      if (this._lowest - s.y > o.bounce) {
        this._rec.pop(); // the rising point isn't free fall
        return this._stop("bounced");
      }
    } else if (t - this._lastSeen > o.lostS) {
      return this._stop("lost");
    }
    if (t - this._startT > o.maxS) return this._stop("timeout");
    return null;
  }

  _stop(reason) {
    this.state = "done";
    this.stopReason = reason;
    return { type: "stopped", reason };
  }

  _lastPreT() {
    return this._pre.length ? this._pre[this._pre.length - 1].t : -Infinity;
  }

  // Median y of the recent still stretch, or null if the ball isn't still.
  _restingY(t) {
    const o = this.opts;
    const win = this._pre.filter((p) => p.t >= t - o.restS);
    if (win.length < 4 || win[win.length - 1].t - win[0].t < o.restS * 0.7) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of win) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    if (hi - lo > o.restSpread) return null;
    return median(win.map((p) => p.y));
  }

  // Two frames in a row below rest, the newer one lower: a real fall, not jitter.
  _falling(s) {
    const o = this.opts;
    if (s.y < this._rest + o.startDrop) return false;
    const prev = this._pre[this._pre.length - 2];
    return !!prev && prev.y > this._rest + o.startDrop / 3 && s.y > prev.y;
  }
}
