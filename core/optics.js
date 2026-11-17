/**
 * Light at a flat surface: reflection, refraction (Snell's law), how much
 * of the light bounces off (Fresnel), and total internal reflection. Plus a
 * laser pointer moved by hand gestures. Pure: no DOM; callers pass times.
 * Angles are measured from the normal (the line straight through the
 * surface), in degrees.
 * @module core/optics
 */
import { GestureGate } from "./gesture.js";

/** Refractive indices: how much a material slows light (air = 1). */
export const MATERIALS = Object.freeze({
  water: 1.33, glass: 1.5, diamond: 2.42,
  // Mystery picks: the child measures n and looks it up.
  ice: 1.31, alcohol: 1.36, oil: 1.47, amber: 1.55, sapphire: 1.77
});

/**
 * Light going from a material with index n1 into one with n2.
 * @param {number} n1
 * @param {number} n2
 * @param {number} inDeg  angle of incidence, 0..90
 * @returns {{outDeg: number|null, R: number, trapped: boolean}}
 *   outDeg: the bent ray's angle (null when it can't get out);
 *   R: share of the light reflected (0..1), unpolarized Fresnel;
 *   trapped: total internal reflection
 */
export function refract(n1, n2, inDeg) {
  const i = Math.max(0, Math.min(90, inDeg)) * Math.PI / 180;
  const s = n1 / n2 * Math.sin(i);
  if (s >= 1) return { outDeg: null, R: 1, trapped: true };
  const t = Math.asin(s), ci = Math.cos(i), ct = Math.cos(t);
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return { outDeg: t * 180 / Math.PI, R: Math.min(1, (rs * rs + rp * rp) / 2), trapped: false };
}

/** The angle past which light can't leave n1 for n2 (deg), or null if n1 ≤ n2. */
export function criticalAngle(n1, n2) {
  return n1 > n2 ? Math.asin(n2 / n1) * 180 / Math.PI : null;
}

/**
 * n of a material from one reading. fromAir: the laser was in the air,
 * shining in (n = sin in / sin out); otherwise it shone out of the
 * material into the air (n = sin out / sin in).
 */
export function indexFrom(inDeg, outDeg, fromAir) {
  const si = Math.sin(inDeg * Math.PI / 180), so = Math.sin(outDeg * Math.PI / 180);
  return fromAir ? si / so : so / si;
}

const FOLLOW_S = 0.04;

/**
 * A laser pointer you move by hand. It always aims at a fixed point on the
 * surface (target), so where you hold it sets the angle. Fist on it to
 * pick it up, open hand to put it down ("placed": a reading).
 * States: "placed" | "held". Positions: frame fractions.
 */
export class LaserPointer {
  /** @param {{catchR?: number, target?: {x: number, y: number}, at?: {x: number, y: number}}} [opts] */
  constructor(opts = {}) {
    this.catchR = opts.catchR ?? 0.15;
    this.target = opts.target || { x: 0.5, y: 0.55 };
    this.gate = new GestureGate(opts);
    this.reset(opts.at);
  }

  reset(at) {
    this.state = "placed";
    const a = at || { x: 0.22, y: 0.2 };
    this.x = a.x; this.y = a.y;
    this._lastUpdate = null;
    this._lostAt = 0;
    this.gate.reset();
  }

  near(hand, p) {
    const aspect = p.aspect || 4 / 3;
    return Math.hypot((hand.x - this.x) * aspect, hand.y - this.y) <= this.catchR;
  }

  /**
   * Where the laser is relative to the surface.
   * @returns {{inDeg: number, above: boolean, side: number}} side: −1 left of the target, +1 right
   */
  geometry(p) {
    const aspect = p.aspect || 4 / 3;
    const dx = (this.target.x - this.x) * aspect, dy = this.target.y - this.y;
    return {
      inDeg: Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI,
      above: dy > 0,
      side: dx >= 0 ? -1 : 1
    };
  }

  /**
   * Feed one hand reading (or null).
   * @param {{aspect?: number, below?: boolean}} p  below: may it go under the surface?
   * @returns {{type: "grabbed"} | {type: "placed"} | null}
   */
  update(now, hand, p) {
    const dt = this._lastUpdate == null ? 0 : Math.min(0.1, (now - this._lastUpdate) / 1000);
    this._lastUpdate = now;
    const gesture = hand ? this.gate.push(hand.open) : null;
    if (this.state === "held") {
      if (hand) {
        this._lostAt = now;
        const aspect = p.aspect || 4 / 3, T = this.target;
        let x = Math.min(0.97, Math.max(0.03, hand.x)), y = Math.min(0.97, Math.max(0.03, hand.y));
        // Not on top of the target, and not too close to the surface line.
        if (p.below === false) y = Math.min(y, T.y - 0.04);
        else if (Math.abs(y - T.y) < 0.03) y = T.y + (y < T.y ? -0.03 : 0.03);
        const d = Math.hypot((x - T.x) * aspect, y - T.y);
        if (d < 0.12) { const k = 0.12 / Math.max(1e-6, d); x = T.x + (x - T.x) * k; y = T.y + (y - T.y) * k; }
        const a = dt > 0 ? 1 - Math.exp(-dt / FOLLOW_S) : 1;
        this.x += a * (x - this.x); this.y += a * (y - this.y);
        if (gesture === "release") { this.state = "placed"; return { type: "placed" }; }
      } else if (now - this._lostAt > 350) {
        this.state = "placed";
        return { type: "placed" };
      }
      return null;
    }
    if (gesture === "grab" && hand && this.near(hand, p)) {
      this.state = "held";
      this._lostAt = now;
      return { type: "grabbed" };
    }
    return null;
  }
}
