/**
 * Hand gestures and a virtual ball you catch and release with them.
 * Works on hand landmarks (21 points per hand, MediaPipe Hands layout,
 * normalized 0..1 frame coordinates), so it doesn't depend on the tracker.
 * Pure: no DOM, no clock — callers pass times in ms.
 * @module core/gesture
 */

/** @typedef {{x: number, y: number, z?: number}} Landmark */

// MediaPipe Hands indices: wrist 0; per finger MCP, PIP, DIP, TIP.
const WRIST = 0;
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]; // index..pinky
const PALM = [0, 5, 9, 13, 17];
const CURLED = 1.2;   // fingertip-to-wrist / knuckle-to-wrist: a curled finger
const STRAIGHT = 1.8; // … and a straight one

/**
 * How open a hand is, 0 (fist) to 1 (open palm). Each finger compares how
 * far its tip is from the wrist with how far its knuckle is, so it doesn't
 * matter how big the hand looks or which way it's turned. Thumb ignored.
 * @param {Landmark[]} lm  21 landmarks
 * @param {number} [aspect=1]  frame width / height (x is a fraction of width)
 */
export function handOpenness(lm, aspect = 1) {
  if (!lm || lm.length < 21) return NaN;
  const d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
  let sum = 0;
  for (const [mcp, , , tip] of FINGERS) {
    const r = d(WRIST, tip) / Math.max(1e-9, d(WRIST, mcp));
    sum += Math.min(1, Math.max(0, (r - CURLED) / (STRAIGHT - CURLED)));
  }
  return sum / FINGERS.length;
}

/** Palm center (frame fractions): wrist and the four knuckles. */
export function palmCenter(lm) {
  let x = 0, y = 0;
  for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}

/**
 * Turns an openness score into "grab" / "release" events, with hysteresis
 * (the score must clearly cross) and a short debounce (for `frames` frames
 * in a row), so a half-closed or flickering hand doesn't fire. A hand that
 * first appears already closed or open sets the state silently: only a
 * change counts as a gesture.
 */
export class GestureGate {
  /** @param {{closeBelow?: number, openAbove?: number, frames?: number}} [opts] */
  constructor(opts = {}) {
    this.closeBelow = opts.closeBelow ?? 0.35;
    this.openAbove = opts.openAbove ?? 0.6;
    this.frames = opts.frames ?? 2;
    this.reset();
  }

  reset() {
    /** @type {"open"|"closed"|null} */
    this.state = null;
    this._pending = null;
    this._count = 0;
  }

  get closed() { return this.state === "closed"; }

  /**
   * @param {number} score  handOpenness
   * @returns {"grab"|"release"|null}
   */
  push(score) {
    const want = score <= this.closeBelow ? "closed" : score >= this.openAbove ? "open" : null;
    if (this.state === null) { this.state = want; return null; }
    if (!want || want === this.state) { this._pending = null; this._count = 0; return null; }
    if (this._pending === want) this._count++;
    else { this._pending = want; this._count = 1; }
    if (this._count < this.frames) return null;
    this.state = want;
    this._pending = null;
    this._count = 0;
    return want === "closed" ? "grab" : "release";
  }
}

/**
 * @typedef {{x: number, y: number, open: number}} HandInput
 *   palm center (frame fractions) and handOpenness score
 * @typedef {Object} CatchParams
 * @property {number} g      gravity, m/s²
 * @property {number} h      meters spanned by the frame height (floor = frame bottom)
 * @property {number} [slow=1] playback speed while falling (0.25 = 4× slower)
 * @property {number} [aspect=4/3] frame width / height
 * @typedef {{type: "grabbed"} | {type: "released", h0: number, how: "open"|"lost"}
 *   | {type: "caught", t: number, fallenM: number}
 *   | {type: "landed", t: number, exactT: number, h0: number}} CatchEvent
 *   landed.t: the fall time as timed by animation frames (what a video
 *   would measure); exactT: the true fall time
 */

const FOLLOW_S = 0.04;  // ball follows the palm with this time constant
const LOST_MS = 350;    // hand gone this long while holding = ball drops

/**
 * A virtual ball: rests until a hand closes on it, follows the closed hand,
 * falls from rest when the hand opens (or vanishes), and can be caught
 * mid-air by closing the hand on it again. States: "resting" | "held" | "falling".
 */
export class CatchBall {
  /** @param {{catchR?: number}} [opts] catchR: grab reach, in frame heights */
  constructor(opts = {}) {
    this.catchR = opts.catchR ?? 0.15;
    this.gate = new GestureGate(opts);
    this.reset();
  }

  /** Put the ball at (x, y) frame fractions, resting. */
  reset(x = 0.5, y = 0.35) {
    this.state = "resting";
    this.x = x; this.y = y;
    this.t = 0;          // physics time into the current fall (s)
    this.h0 = 0;         // drop height of the current fall (m)
    this._y0 = y;
    this._t0 = 0;        // wall time of release (ms)
    this._slow = 1;
    this._lastSeen = -Infinity;
    this._lastUpdate = null;
    this.gate.reset();
  }

  /** Height of the ball above the floor (m). */
  heightM(p) { return Math.max(0, (1 - this.y) * p.h); }

  /** Is the hand close enough to take the ball? */
  near(hand, p) {
    const aspect = p.aspect || 4 / 3;
    return Math.hypot((hand.x - this.x) * aspect, hand.y - this.y) <= this.catchR;
  }

  /**
   * Feed one hand-tracking result (or null when no hand is seen).
   * @param {number} now  ms
   * @param {HandInput|null} hand
   * @param {CatchParams} p
   * @returns {CatchEvent|null}
   */
  update(now, hand, p) {
    const dt = this._lastUpdate == null ? 0 : Math.min(0.1, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;
    const gesture = hand ? this.gate.push(hand.open) : null;
    if (hand) this._lastSeen = now;

    if (this.state === "held") {
      if (hand) {
        const a = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_S) : 1;
        this.x += a * (hand.x - this.x);
        this.y += a * (Math.min(1, hand.y) - this.y);
        if (gesture === "release") return this._release(now, p, "open");
      } else if (now - this._lastSeen > LOST_MS) {
        return this._release(now, p, "lost");
      }
      return null;
    }
    if (gesture === "grab" && hand && this.near(hand, p)) {
      if (this.state === "falling") {
        this.tick(now, p); // position at the moment of the catch
        if (this.state === "falling") {
          this.state = "held";
          return { type: "caught", t: this.t, fallenM: (this.y - this._y0) * p.h };
        }
      }
      if (this.state === "resting") {
        this.state = "held";
        return { type: "grabbed" };
      }
    }
    return null;
  }

  _release(now, p, how) {
    this.state = "falling";
    this._y0 = this.y;
    this._t0 = now;
    this._slow = p.slow > 0 ? p.slow : 1;
    this.t = 0;
    this.h0 = this.heightM(p);
    return { type: "released", h0: this.h0, how };
  }

  /**
   * Advance a fall to wall time `now`. Call every animation frame.
   * @returns {CatchEvent|null} "landed" on the frame it reaches the floor
   */
  tick(now, p) {
    if (this.state !== "falling") return null;
    const tau = Math.max(0, (now - this._t0) / 1000 * this._slow);
    const exactT = Math.sqrt(2 * Math.max(0, 1 - this._y0) * p.h / p.g);
    if (tau >= exactT) {
      this.y = 1;
      this.t = tau; // timed by this frame, as a video would
      this.state = "resting";
      return { type: "landed", t: tau, exactT, h0: this.h0 };
    }
    this.t = tau;
    this.y = this._y0 + 0.5 * p.g * tau * tau / p.h;
    return null;
  }
}
