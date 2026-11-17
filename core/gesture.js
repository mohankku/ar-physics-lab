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
 * @typedef {{x: number, y: number, open: number, t?: number}} HandInput
 *   palm center (frame fractions), handOpenness score, and optionally the
 *   time (ms) the hand was there, when it's known better than `now`
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
const MIN_BOUNCE = 0.3; // m/s: a ball leaving the floor slower than this stays down
const SKID = 0.85;      // share of its sideways speed a ball keeps at each bounce

/*
 * Bouncing, shared by CatchBall and ThrowBall. At each floor hit the ball
 * keeps the share p.e of its speed (coefficient of restitution: tennis
 * ≈ 0.75, basketball ≈ 0.83; 0 = no bounce), so each bounce reaches e²
 * of the height before. The ball keeps moving sideways (a little slower
 * each bounce) and can leave through a side. State "bouncing".
 */
function startBounce(ball, wallMs, vDown, vx, p) {
  const e = p.e > 0 ? Math.min(0.95, p.e) : 0;
  const up = e * vDown;
  if (up < MIN_BOUNCE) return 0;
  ball.state = "bouncing";
  ball._bWall = wallMs;      // wall time of the last floor hit
  ball._bUp = up;            // speed leaving the floor (m/s)
  ball._bVx = vx * SKID;     // sideways speed (m/s)
  ball._bX = ball.x;
  ball.bounces = 1;
  return up;
}
/* Advance a bouncing ball. Events: "bounce" (a floor hit; height = how high
 * it goes next), "settled" (stopped bouncing), "gone" (out through a side). */
function tickBounce(ball, now, p) {
  const aspect = p.aspect || 4 / 3, e = p.e > 0 ? Math.min(0.95, p.e) : 0;
  let ev = null;
  for (;;) {
    const tau = Math.max(0, (now - ball._bWall) / 1000 * ball._slow);
    const hop = 2 * ball._bUp / p.g;
    if (tau < hop) {
      ball.x = ball._bX + ball._bVx * tau / (p.h * aspect);
      ball.y = 1 - (ball._bUp * tau - 0.5 * p.g * tau * tau) / p.h;
      if (ball.x < 0 || ball.x > 1) { ball.state = "gone"; return { type: "gone", bouncing: true }; }
      return ev;
    }
    // Back on the floor.
    ball._bX += ball._bVx * hop / (p.h * aspect);
    ball._bWall += hop / ball._slow * 1000;
    const up = ball._bUp * e;
    if (up < MIN_BOUNCE) {
      ball.state = "resting";
      ball.x = Math.min(1, Math.max(0, ball._bX)); ball.y = 1;
      return { type: "settled", bounces: ball.bounces };
    }
    ball._bUp = up; ball._bVx *= SKID; ball.bounces++;
    ev = { type: "bounce", n: ball.bounces, speed: up, height: up * up / (2 * p.g) };
  }
}

/**
 * A virtual ball: rests until a hand closes on it, follows the closed hand,
 * falls from rest when the hand opens (or vanishes), and can be caught
 * mid-air by closing the hand on it again; it bounces on the floor (p.e).
 * States: "resting" | "held" | "falling" | "bouncing".
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
      if (this.state === "bouncing") this.tick(now, p);
      if (this.state === "resting" || this.state === "bouncing") {
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
   * Advance a fall (and its bounces) to wall time `now`. Call every frame.
   * @returns {CatchEvent|null} "landed" on the frame it reaches the floor
   *   (with bounceHeight: how high it bounces back, m, 0 for none); then
   *   "bounce" / "settled" while it bounces (p.e > 0)
   */
  tick(now, p) {
    if (this.state === "bouncing") return tickBounce(this, now, p);
    if (this.state !== "falling") return null;
    const tau = Math.max(0, (now - this._t0) / 1000 * this._slow);
    const exactT = Math.sqrt(2 * Math.max(0, 1 - this._y0) * p.h / p.g);
    if (tau >= exactT) {
      this.y = 1;
      this.t = tau; // timed by this frame, as a video would
      this.state = "resting";
      const up = startBounce(this, this._t0 + exactT / this._slow * 1000, p.g * exactT, 0, p);
      if (up) tickBounce(this, now, p);
      return { type: "landed", t: tau, exactT, h0: this.h0, bounceHeight: up * up / (2 * p.g) };
    }
    this.t = tau;
    this.y = this._y0 + 0.5 * p.g * tau * tau / p.h;
    return null;
  }
}

const THROW_WINDOW_MS = 110; // hand velocity at release: fit over this much history
const MAX_THROW = 15;        // m/s: faster is a tracking glitch, not a throw

/**
 * A virtual ball you throw: rests until a fist closes on it, follows the
 * closed hand, and when the hand opens it flies off with the hand's
 * velocity (a straight-line fit over the last ~0.1 s), as a projectile
 * under gravity. It lands on the floor (the bottom of the picture), leaves
 * through a side, or is caught mid-air by closing the hand on it; on the
 * floor it bounces (p.e) and rolls on. States: "resting" | "held" |
 * "flying" | "bouncing" | "gone". Positions are frame fractions
 * (y down); velocities are m/s with vy up. Pure: callers pass times in ms.
 */
export class ThrowBall {
  /** @param {{catchR?: number}} [opts] catchR: grab reach, in frame heights */
  constructor(opts = {}) {
    this.catchR = opts.catchR ?? 0.15;
    this.gate = new GestureGate(opts);
    this.reset();
  }

  reset(x = 0.3, y = 0.6) {
    this.state = "resting";
    this.x = x; this.y = y;
    this.t = 0;                 // physics time into the current flight (s)
    this.vx = 0; this.vy = 0;   // launch velocity (m/s, vy up)
    this._x0 = x; this._y0 = y;
    this._t0 = 0;
    this._slow = 1;
    this._hist = [];
    this._openV = null;
    this._lastSeen = -Infinity;
    this._lastUpdate = null;
    this.gate.reset();
  }

  heightM(p) { return Math.max(0, (1 - this.y) * p.h); }
  near(hand, p) {
    const aspect = p.aspect || 4 / 3;
    return Math.hypot((hand.x - this.x) * aspect, hand.y - this.y) <= this.catchR;
  }

  /**
   * Feed one hand reading (or null). Same contract as CatchBall.update.
   * @returns {{type: "grabbed"} | {type: "thrown", vx: number, vy: number, speed: number,
   *   angleDeg: number, h0: number, how: "open"|"lost"} | {type: "caught", t: number} | null}
   */
  update(now, hand, p) {
    const dt = this._lastUpdate == null ? 0 : Math.min(0.1, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;
    const gesture = hand ? this.gate.push(hand.open) : null;
    if (hand) this._lastSeen = now;

    if (this.state === "held") {
      if (hand) {
        // The throw's velocity is the hand's as it starts to open: by the
        // time the opening is certain (a frame or two), it has slowed.
        const last = this._hist[this._hist.length - 1];
        if (hand.open >= this.gate.openAbove) {
          if (!this._openV && last) this._openV = this.handVelocity(last.t, p);
        } else {
          this._openV = null;
        }
        // hand.t: when the hand was really there (a pointer event), if known.
        this._hist.push({ t: hand.t != null && hand.t <= now ? hand.t : now, x: hand.x, y: hand.y });
        while (this._hist.length > 2 && now - this._hist[0].t > 3 * THROW_WINDOW_MS) this._hist.shift();
        const a = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_S) : 1;
        this.x += a * (hand.x - this.x);
        this.y += a * (Math.min(1, hand.y) - this.y);
        if (gesture === "release") return this._throw(now, p, "open", this._openV);
      } else if (now - this._lastSeen > LOST_MS) {
        this._hist = [];          // a vanished hand throws nothing: the ball just drops
        return this._throw(now, p, "lost");
      }
      return null;
    }
    if (gesture === "grab" && hand && this.near(hand, p)) {
      if (this.state === "flying") {
        this.tick(now, p);
        if (this.state === "flying") {
          this.state = "held";
          this._hist = [];
          return { type: "caught", t: this.t };
        }
      }
      if (this.state === "bouncing") this.tick(now, p);
      if (this.state === "resting" || this.state === "bouncing") {
        this.state = "held";
        this._hist = [];
        return { type: "grabbed" };
      }
    }
    return null;
  }

  /** Hand velocity (m/s, vy up) over the last THROW_WINDOW_MS before `now`. */
  handVelocity(now, p) {
    const aspect = p.aspect || 4 / 3;
    const pts = this._hist.filter((q) => q.t >= now - THROW_WINDOW_MS);
    if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < 20) return { vx: 0, vy: 0 };
    let st = 0, sx = 0, sy = 0;
    for (const q of pts) { st += q.t; sx += q.x; sy += q.y; }
    const n = pts.length, mt = st / n, mx = sx / n, my = sy / n;
    let stt = 0, stx = 0, sty = 0;
    for (const q of pts) { const d = q.t - mt; stt += d * d; stx += d * (q.x - mx); sty += d * (q.y - my); }
    let vx = stx / stt * 1000 * p.h * aspect, vy = -sty / stt * 1000 * p.h;
    const s = Math.hypot(vx, vy);
    if (s > MAX_THROW) { vx *= MAX_THROW / s; vy *= MAX_THROW / s; }
    return { vx, vy };
  }

  _throw(now, p, how, atOpen) {
    const v = atOpen || this.handVelocity(now, p);
    this._openV = null;
    this.state = "flying";
    this.vx = v.vx; this.vy = v.vy;
    this._x0 = this.x; this._y0 = this.y;
    this._t0 = now;
    this._slow = p.slow > 0 ? p.slow : 1;
    this.t = 0;
    this.h0 = this.heightM(p);
    const speed = Math.hypot(v.vx, v.vy);
    return { type: "thrown", vx: v.vx, vy: v.vy, speed,
      angleDeg: speed > 0 ? Math.atan2(v.vy, Math.abs(v.vx)) * 180 / Math.PI : 0, h0: this.h0, how };
  }

  /** Position (frame fractions) at physics time tau into the flight. */
  at(tau, p) {
    const aspect = p.aspect || 4 / 3;
    return {
      x: this._x0 + this.vx * tau / (p.h * aspect),
      y: this._y0 - (this.vy * tau - 0.5 * p.g * tau * tau) / p.h
    };
  }

  /** When the flight ends: on the floor, or out through a side. */
  _end(p) {
    const aspect = p.aspect || 4 / 3, g = p.g;
    const drop = (1 - this._y0) * p.h;
    const land = (this.vy + Math.sqrt(this.vy * this.vy + 2 * g * drop)) / g;
    let side = Infinity;
    if (this.vx > 0) side = (1 - this._x0) * p.h * aspect / this.vx;
    else if (this.vx < 0) side = -this._x0 * p.h * aspect / this.vx;
    return side < land ? { t: side, how: "gone" } : { t: land, how: "landed" };
  }

  /**
   * Advance a flight to wall time `now`. Call every animation frame.
   * @returns {{type: "landed"|"gone", t: number, range: number, apex: number,
   *   vx: number, vy: number, speed: number, angleDeg: number, h0: number}|null}
   *   range: horizontal distance flown (m); apex: highest point above the
   *   launch (m, 0 when thrown downward); t: exact flight time (s)
   */
  tick(now, p) {
    if (this.state === "bouncing") return tickBounce(this, now, p);
    if (this.state !== "flying") return null;
    const tau = Math.max(0, (now - this._t0) / 1000 * this._slow);
    const end = this._end(p);
    if (tau < end.t) {
      this.t = tau;
      const q = this.at(tau, p);
      this.x = q.x; this.y = q.y;
      return null;
    }
    const q = this.at(end.t, p);
    this.t = end.t;
    const speed = Math.hypot(this.vx, this.vy);
    const tTop = this.vy > 0 ? Math.min(this.vy / p.g, end.t) : 0; // the top, or where it left
    const ev = {
      type: end.how, t: end.t, range: Math.abs(this.vx) * end.t,
      apex: this.vy * tTop - 0.5 * p.g * tTop * tTop,
      vx: this.vx, vy: this.vy, speed, angleDeg: speed > 0 ? Math.atan2(this.vy, Math.abs(this.vx)) * 180 / Math.PI : 0,
      h0: this.h0
    };
    if (end.how === "landed") {
      this.state = "resting";
      this.x = Math.min(1, Math.max(0, q.x)); this.y = 1;
      ev.x = this.x;      // where it landed (it may bounce on from there)
      const up = startBounce(this, this._t0 + end.t / this._slow * 1000, p.g * end.t - this.vy, this.vx, p);
      ev.bounceHeight = up * up / (2 * p.g);
      if (up) tickBounce(this, now, p);
    } else {
      this.state = "gone";
      this.x = q.x; this.y = q.y;
    }
    return ev;
  }
}

const SWING_Q = 50;           // air + the knot rubbing: a tennis ball's swing halves in ~12 swings
const SWING_STEP = 0.001;     // RK4 step, s of physics time
const REST_DEG = 0.3;         // a swing smaller than this has come to rest
const MAX_PULL = 85 * Math.PI / 180;

/**
 * A virtual pendulum: a ball on a string of length L from a fixed pivot.
 * Grab the ball with a fist and pull it aside (it stays on the circle the
 * string allows); open the hand and it swings freely, following the full
 * nonlinear pendulum equation (RK4), slowed by air (quality factor p.Q:
 * the swing shrinks by e^(−π/Q) each time) until it comes to rest. Each pass
 * through the middle is timed exactly (interpolated between steps), so
 * the period can be measured as on a real pendulum.
 * Pivot and positions are frame fractions (y down); L in meters.
 * States: "hanging" (swinging or still) | "held".
 */
export class SwingBall {
  /** @param {{catchR?: number, pivot?: {x: number, y: number}}} [opts] */
  constructor(opts = {}) {
    this.catchR = opts.catchR ?? 0.15;
    this.pivot = opts.pivot || { x: 0.5, y: 0.05 };
    this.gate = new GestureGate(opts);
    this.reset();
  }

  reset() {
    this.state = "hanging";
    this.theta = 0; this.omega = 0;     // rad, rad/s (positive = to the right)
    this.tau = 0;                       // physics time of the swing (s)
    this.crossings = [];                // physics times of passes through the middle
    this.releaseDeg = 0;
    this.resting = true;                // not swinging (still, or held)
    this._wall = null;
    this._lastUpdate = null;
    this._lastSeen = -Infinity;
    this.gate.reset();
  }

  /** Ball position (frame fractions) for the current angle. */
  pos(p) {
    const aspect = p.aspect || 4 / 3;
    return {
      x: this.pivot.x + p.L * Math.sin(this.theta) / (p.h * aspect),
      y: this.pivot.y + p.L * Math.cos(this.theta) / p.h
    };
  }
  near(hand, p) {
    const aspect = p.aspect || 4 / 3, b = this.pos(p);
    return Math.hypot((hand.x - b.x) * aspect, hand.y - b.y) <= this.catchR;
  }
  /** Full swings timed so far (there and back = 2 passes through the middle). */
  get swings() { return Math.max(0, Math.floor((this.crossings.length - 1) / 2)); }
  /** How far it swings now (rad), from its energy: cos θmax = cos θ − ω²L/(2g). */
  amplitude(p) {
    const c = Math.cos(this.theta) - this.omega * this.omega * p.L / (2 * p.g);
    return Math.acos(Math.max(-1, Math.min(1, c)));
  }
  /** Average period over the timed swings (s), or NaN. */
  get period() {
    const c = this.crossings, n = this.swings;
    return n > 0 ? (c[2 * n] - c[0]) / n : NaN;
  }

  /**
   * Feed one hand reading (or null).
   * @param {{g: number, h: number, L: number, slow?: number, aspect?: number, Q?: number}} p
   *   Q: how little air slows it (default 50; Infinity = no air)
   * @returns {{type: "grabbed"} | {type: "released", angleDeg: number, how: "open"|"lost"} | null}
   */
  update(now, hand, p) {
    const dt = this._lastUpdate == null ? 0 : Math.min(0.1, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;
    const gesture = hand ? this.gate.push(hand.open) : null;
    if (hand) this._lastSeen = now;
    if (this.state === "held") {
      if (hand) {
        // The ball goes where the string lets it: along the hand's direction from the pivot.
        const aspect = p.aspect || 4 / 3;
        const dx = (hand.x - this.pivot.x) * p.h * aspect, dy = (hand.y - this.pivot.y) * p.h;
        const target = Math.max(-MAX_PULL, Math.min(MAX_PULL, Math.atan2(dx, Math.max(1e-6, dy))));
        const a = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_S) : 1;
        this.theta += a * (target - this.theta);
        if (gesture === "release") return this._release(now, "open");
      } else if (now - this._lastSeen > LOST_MS) {
        return this._release(now, "lost");
      }
      return null;
    }
    if (gesture === "grab" && hand && this.near(hand, p)) {
      this.tick(now, p);
      this.state = "held";
      this.omega = 0;
      this.crossings = [];
      this.resting = true;
      return { type: "grabbed" };
    }
    return null;
  }

  _release(now, how) {
    this.state = "hanging";
    this.omega = 0;
    this.tau = 0;
    this._wall = now;
    this.crossings = [];
    this.releaseDeg = this.theta * 180 / Math.PI;
    this.resting = Math.abs(this.releaseDeg) < REST_DEG;
    return { type: "released", angleDeg: this.releaseDeg, how };
  }

  /**
   * Advance the swing to wall time `now`. Call every animation frame.
   * @returns {{type: "pass", swings: number, period: number} |
   *   {type: "stopped", swings: number, t: number} | null}
   *   pass: on each pass through the middle (period: average so far, NaN
   *   before 1 swing); stopped: once, when the swing has died away (t: s
   *   of swinging)
   */
  tick(now, p) {
    if (this.state !== "hanging" || this.resting || this._wall == null) { this._wall = now; return null; }
    const slow = p.slow > 0 ? p.slow : 1;
    const target = this.tau + Math.max(0, Math.min(0.1, (now - this._wall) / 1000)) * slow;
    this._wall = now;
    const Q = p.Q > 0 ? p.Q : SWING_Q;
    const w2 = p.g / p.L, gamma = isFinite(Q) ? Math.sqrt(w2) / Q : 0;
    const acc = (th, om) => -w2 * Math.sin(th) - gamma * om;
    let passed = false;
    while (this.tau < target - 1e-12) {
      const h = Math.min(SWING_STEP, target - this.tau), th = this.theta, om = this.omega;
      const k1a = om, k1w = acc(th, om);
      const k2a = om + h / 2 * k1w, k2w = acc(th + h / 2 * k1a, om + h / 2 * k1w);
      const k3a = om + h / 2 * k2w, k3w = acc(th + h / 2 * k2a, om + h / 2 * k2w);
      const k4a = om + h * k3w, k4w = acc(th + h * k3a, om + h * k3w);
      const th2 = th + h / 6 * (k1a + 2 * k2a + 2 * k3a + k4a);
      const om2 = om + h / 6 * (k1w + 2 * k2w + 2 * k3w + k4w);
      if (th !== 0 && th2 !== 0 && (th < 0) !== (th2 < 0)) {
        // Through the middle: interpolate the moment (cubic Hermite would be
        // overkill at 1 ms steps; linear is good to microseconds).
        this.crossings.push(this.tau + h * th / (th - th2));
        passed = true;
      }
      this.theta = th2; this.omega = om2; this.tau += h;
    }
    if (this.amplitude(p) < REST_DEG * Math.PI / 180) {
      this.theta = 0; this.omega = 0; this.resting = true;
      return { type: "stopped", swings: this.swings, t: this.tau };
    }
    return passed ? { type: "pass", swings: this.swings, period: this.period } : null;
  }
}
