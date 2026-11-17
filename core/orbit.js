/**
 * Orbits: a satellite you flick around a real planet. Newton's law of
 * gravity (pull ∝ 1/r²) is integrated step by step (RK4); Kepler's laws come
 * out of it: ellipses with the planet at a focus, equal areas in equal
 * times, and T² ∝ a³. Time is sped up (p.warp) so an orbit takes seconds.
 * Pure: no DOM; callers pass times in ms.
 *
 * Coordinates: the planet's center is at frame fraction p.center; physics
 * in meters, x right and y UP from the planet's center. p.H: meters spanned
 * by the frame height.
 * @module core/orbit
 */
import { GestureGate, fitHandVelocity } from "./gesture.js";

/** Real planets: GM (m³/s²) and radius (m). */
export const PLANETS = Object.freeze({
  earth:   Object.freeze({ name: "Earth",   GM: 3.986004418e14, R: 6.371e6 }),
  moon:    Object.freeze({ name: "the Moon", GM: 4.9048695e12,  R: 1.7374e6 }),
  mars:    Object.freeze({ name: "Mars",    GM: 4.282837e13,    R: 3.3895e6 }),
  jupiter: Object.freeze({ name: "Jupiter", GM: 1.26686534e17,  R: 6.9911e7 })
});

/** Speed for a circular orbit at distance r from the center (m/s). */
export function circularSpeed(GM, r) { return Math.sqrt(GM / r); }
/** Speed to escape for good from distance r (m/s): √2 × the circular speed. */
export function escapeSpeed(GM, r) { return Math.sqrt(2 * GM / r); }
/** Kepler's third law: the period of an orbit with semi-major axis a (s). */
export function keplerPeriod(GM, a) { return 2 * Math.PI * Math.sqrt(a * a * a / GM); }

/**
 * The orbit a body at position r (m) with velocity v (m/s) will follow.
 * @returns {{E: number, h: number, a: number, e: number, rp: number, ra: number,
 *   T: number, bound: boolean}}  E: energy per kg; h: angular momentum per
 *   kg; a: semi-major axis; e: eccentricity (0 = circle); rp/ra: nearest
 *   and farthest distance (ra = Infinity when not bound); T: period
 */
export function orbitElements(GM, r, v) {
  const rr = Math.hypot(r.x, r.y), v2 = v.x * v.x + v.y * v.y;
  const E = v2 / 2 - GM / rr, h = r.x * v.y - r.y * v.x;
  const e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (GM * GM)));
  const bound = E < 0;
  const a = bound ? -GM / (2 * E) : Infinity;
  const p = h * h / GM;                         // semi-latus rectum
  return { E, h, a, e, rp: p / (1 + e), ra: bound && e < 1 ? p / (1 - e) : Infinity,
    T: bound ? keplerPeriod(GM, a) : Infinity, bound };
}

/** How fast the warped clock runs, so an orbit 3.5 radii out takes ~6 s. */
export function defaultWarp(planet) { return keplerPeriod(planet.GM, 3.5 * planet.R) / 6; }

const FOLLOW_S = 0.04, LOST_MS = 350;

/**
 * A satellite: rests in space until a fist closes on it, follows the hand,
 * and when the hand opens it keeps the hand's on-screen velocity and flies
 * under the planet's gravity. States: "resting" | "held" | "flying" |
 * "crashed" | "escaped". Position in frame fractions (x, y); physics state
 * in meters (pos, vel; y up).
 */
export class Satellite {
  /** @param {{catchR?: number, grabAnywhere?: boolean}} [opts]
   *   grabAnywhere: a fist anywhere picks it up (it glides into the hand),
   *   so a small satellite needn't be aimed at */
  constructor(opts = {}) {
    this.catchR = opts.catchR ?? 0.12;
    this.grabAnywhere = !!opts.grabAnywhere;
    this.gate = new GestureGate(opts);
    this.reset({ x: 0.5, y: 0.2 });
  }

  reset(at) {
    this.state = "resting";
    this.x = at.x; this.y = at.y;
    this.pos = null; this.vel = null;
    this.t = 0;                 // physics time since launch (s)
    this.swept = 0;             // angle swept around the planet since launch (rad)
    this.orbits = 0;            // full orbits completed
    this.orbitTimes = [];       // physics time of each completed orbit
    this.trail = [];            // [{t, x, y}] frame fractions
    this.elements = null;
    this._hist = [];
    this._openV = null;
    this._wall = null;
    this._lastUpdate = null;
    this._lostAt = 0;
    this.gate.reset();
  }

  /* Frame fractions ↔ meters from the planet's center (y up). */
  toM(q, p) {
    const aspect = p.aspect || 4 / 3;
    return { x: (q.x - p.center.x) * p.H * aspect, y: (p.center.y - q.y) * p.H };
  }
  toFrame(m, p) {
    const aspect = p.aspect || 4 / 3;
    return { x: p.center.x + m.x / (p.H * aspect), y: p.center.y - m.y / p.H };
  }
  /** Distance from the planet's center (m). */
  r(p) { const m = this.pos || this.toM(this, p); return Math.hypot(m.x, m.y); }
  speed() { return this.vel ? Math.hypot(this.vel.x, this.vel.y) : 0; }

  near(hand, p) {
    if (this.grabAnywhere) return true;
    const aspect = p.aspect || 4 / 3;
    return Math.hypot((hand.x - this.x) * aspect, hand.y - this.y) <= this.catchR;
  }

  /**
   * Feed one hand reading (or null).
   * @param {{planet: {GM: number, R: number}, H: number, center: {x: number, y: number},
   *   warp: number, slow?: number, aspect?: number}} p
   * @returns {{type: "grabbed"} | {type: "launched", speed: number, vCirc: number, vEsc: number,
   *   altitude: number, elements: object} | null}  speeds m/s, altitude m above the surface
   */
  update(now, hand, p) {
    const dt = this._lastUpdate == null ? 0 : Math.min(0.1, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;
    const gesture = hand ? this.gate.push(hand.open) : null;
    if (this.state === "held") {
      if (hand) {
        this._lostAt = now;
        const last = this._hist[this._hist.length - 1];
        if (hand.open >= this.gate.openAbove) {
          if (!this._openV && last) this._openV = fitHandVelocity(this._hist, last.t);
        } else {
          this._openV = null;
        }
        this._hist.push({ t: hand.t != null && hand.t <= now ? hand.t : now, x: hand.x, y: hand.y });
        while (this._hist.length > 2 && now - this._hist[0].t > 400) this._hist.shift();
        const k = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_S) : 1;
        this.x += k * (hand.x - this.x); this.y += k * (hand.y - this.y);
        // Not inside the planet.
        const m = this.toM(this, p), rr = Math.hypot(m.x, m.y), min = p.planet.R * 1.05;
        if (rr < min) { const f = min / Math.max(1, rr); const q = this.toFrame({ x: m.x * f, y: m.y * f }, p); this.x = q.x; this.y = q.y; }
        if (gesture === "release") return this.launch(now, p, this._openV || fitHandVelocity(this._hist, now));
      } else if (now - this._lostAt > LOST_MS) {
        return this.launch(now, p, { x: 0, y: 0 });
      }
      return null;
    }
    if (gesture === "grab" && hand && (this.state !== "flying" || !this.grabAnywhere ||
        Math.hypot((hand.x - this.x) * (p.aspect || 4 / 3), hand.y - this.y) <= this.catchR) && this.near(hand, p)) {
      this.state = "held";
      this._hist = []; this._openV = null; this._lostAt = now;
      this.trail = [];
      return { type: "grabbed" };
    }
    return null;
  }

  /**
   * Set off from where it is with velocity v in frame fractions per wall
   * second (y down): the hand's on-screen velocity, so what you see is
   * what it does.
   */
  launch(now, p, v) {
    const aspect = p.aspect || 4 / 3, slow = p.slow > 0 ? p.slow : 1;
    // Frame fractions per wall second → meters per physics second.
    const k = 1 / (p.warp * slow);
    this.pos = this.toM(this, p);
    this.vel = { x: v.x * p.H * aspect * k, y: -v.y * p.H * k };
    this.state = "flying";
    this.t = 0; this.swept = 0; this.orbits = 0; this.orbitTimes = [];
    this._wall = now;
    this.trail = [{ t: 0, x: this.x, y: this.y }];
    this.elements = orbitElements(p.planet.GM, this.pos, this.vel);
    const r = Math.hypot(this.pos.x, this.pos.y);
    return { type: "launched", speed: this.speed(), vCirc: circularSpeed(p.planet.GM, r),
      vEsc: escapeSpeed(p.planet.GM, r), altitude: r - p.planet.R, elements: this.elements };
  }

  /**
   * Advance the flight to wall time `now`. Call every animation frame.
   * @returns {{type: "orbit", n: number, T: number, Tkepler: number, a: number, e: number} |
   *   {type: "crashed", t: number, speed: number} | {type: "escaped", t: number, speed: number} | null}
   *   orbit: each full trip around (T measured; Tkepler from Kepler's third law)
   */
  tick(now, p) {
    if (this.state !== "flying") return null;
    const slow = p.slow > 0 ? p.slow : 1;
    const target = this.t + Math.max(0, Math.min(0.1, (now - this._wall) / 1000)) * p.warp * slow;
    this._wall = now;
    const GM = p.planet.GM, R = p.planet.R;
    const acc = (q) => { const r2 = q.x * q.x + q.y * q.y, r = Math.sqrt(r2), f = -GM / (r2 * r); return { x: f * q.x, y: f * q.y }; };
    let ev = null;
    while (this.t < target - 1e-9) {
      const r = Math.hypot(this.pos.x, this.pos.y), v = Math.max(1, this.speed());
      const h = Math.min(target - this.t, 0.002 * r / v, 60);   // small steps close in, where it's fast
      const p0 = this.pos, v0 = this.vel;
      const a1 = acc(p0);
      const p2 = { x: p0.x + v0.x * h / 2, y: p0.y + v0.y * h / 2 }, v2 = { x: v0.x + a1.x * h / 2, y: v0.y + a1.y * h / 2 };
      const a2 = acc(p2);
      const p3 = { x: p0.x + v2.x * h / 2, y: p0.y + v2.y * h / 2 }, v3 = { x: v0.x + a2.x * h / 2, y: v0.y + a2.y * h / 2 };
      const a3 = acc(p3);
      const p4 = { x: p0.x + v3.x * h, y: p0.y + v3.y * h }, v4 = { x: v0.x + a3.x * h, y: v0.y + a3.y * h };
      const a4 = acc(p4);
      const np = { x: p0.x + h / 6 * (v0.x + 2 * v2.x + 2 * v3.x + v4.x), y: p0.y + h / 6 * (v0.y + 2 * v2.y + 2 * v3.y + v4.y) };
      const nv = { x: v0.x + h / 6 * (a1.x + 2 * a2.x + 2 * a3.x + a4.x), y: v0.y + h / 6 * (a1.y + 2 * a2.y + 2 * a3.y + a4.y) };
      // Angle swept this step (unwrapped), for counting orbits.
      let d = Math.atan2(np.y, np.x) - Math.atan2(p0.y, p0.x);
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      const before = Math.floor(Math.abs(this.swept) / (2 * Math.PI));
      this.swept += d;
      const after = Math.floor(Math.abs(this.swept) / (2 * Math.PI));
      if (after > before) {
        // Interpolate the moment it came all the way round.
        const over = Math.abs(this.swept) - after * 2 * Math.PI, f = 1 - over / Math.max(1e-12, Math.abs(d));
        const tOrbit = this.t + f * h;
        const prevT = this.orbitTimes.length ? this.orbitTimes[this.orbitTimes.length - 1] : 0;
        this.orbitTimes.push(tOrbit);
        this.orbits = after;
        const el = this.elements;
        ev = { type: "orbit", n: after, T: tOrbit - prevT, Tkepler: el.T, a: el.a, e: el.e };
      }
      this.pos = np; this.vel = nv; this.t += h;
      if (Math.hypot(np.x, np.y) <= R) {
        this.state = "crashed";
        const q = this.toFrame(np, p); this.x = q.x; this.y = q.y;
        return { type: "crashed", t: this.t, speed: Math.hypot(nv.x, nv.y) };
      }
      // Gone for good: unbound and far beyond the picture.
      if (!this.elements.bound && Math.hypot(np.x, np.y) > 2.5 * p.H) {
        this.state = "escaped";
        return { type: "escaped", t: this.t, speed: Math.hypot(nv.x, nv.y) };
      }
    }
    const q = this.toFrame(this.pos, p);
    this.x = q.x; this.y = q.y;
    this.trail.push({ t: this.t, x: q.x, y: q.y });
    // Keep about one orbit of trail.
    const keep = this.elements.bound ? this.elements.T * 1.02 : Infinity;
    while (this.trail.length > 2 && this.t - this.trail[0].t > keep) this.trail.shift();
    return ev;
  }
}
