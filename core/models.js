/**
 * Engineering models for the workbench: simulate from known parameters.
 * Pure functions, no DOM. Units: SI (m, s, kg); y grows downward.
 * @module core/models
 */
import { fallTime } from "./physics.js";

/** Sea-level air density, kg/m³. */
export const AIR_DENSITY = 1.225;

/** Typical drag coefficients (turbulent flow, Re ~ 10⁴–10⁵). */
export const DRAG_COEFFICIENTS = Object.freeze({
  sphere: 0.47,
  "cube (face first)": 1.05,
  "flat plate (face first)": 1.17,
  "cylinder (side-on)": 1.2,
  "cylinder (end-on)": 0.82,
  "streamlined body": 0.04
});

/**
 * @typedef {Object} FallParams
 * @property {number} h        drop height, m (> 0)
 * @property {number} m        mass, kg (> 0)
 * @property {number} [g=9.81] m/s²
 * @property {number} [v0=0]   initial downward speed, m/s
 * @property {number} [cd=0]   drag coefficient (0 = no drag)
 * @property {number} [areaM2=0] frontal area, m²
 * @property {number} [rho=AIR_DENSITY] air density, kg/m³
 *
 * @typedef {Object} FallResult
 * @property {number[]} t   s
 * @property {number[]} y   distance fallen, m
 * @property {number[]} v   downward speed, m/s
 * @property {number[]} a   downward acceleration, m/s²
 * @property {number} landingTime   s
 * @property {number} impactSpeed   m/s
 * @property {number} impactEnergyJ ½·m·v² at impact
 * @property {number} terminalSpeed m/s (Infinity without drag)
 * @property {number} vacuumTime    landing time with no air, s
 * @property {number} vacuumImpact  impact speed with no air, m/s
 */

const MAX_POINTS = 1000;

/**
 * A falling object with quadratic air drag: m·dv/dt = m·g − ½·ρ·Cd·A·v·|v|.
 * RK4 with a step far below the fall time; the landing is interpolated to
 * the exact height, so the result doesn't depend on the step.
 * @param {FallParams} p
 * @returns {FallResult}
 */
export function simulateFall(p) {
  const g = p.g ?? 9.81, h = p.h, m = p.m, v0 = p.v0 ?? 0;
  const cd = p.cd ?? 0, area = p.areaM2 ?? 0, rho = p.rho ?? AIR_DENSITY;
  for (const [name, v] of [["h", h], ["m", m], ["g", g]]) {
    if (!(v > 0) || !isFinite(v)) throw new RangeError(`simulateFall: ${name} must be a positive number`);
  }
  if (!(cd >= 0 && area >= 0 && rho >= 0) || !isFinite(v0)) {
    throw new RangeError("simulateFall: drag inputs must be non-negative numbers");
  }
  const k = 0.5 * rho * cd * area / m; // drag deceleration per (m/s)²
  const acc = (v) => g - k * v * Math.abs(v);
  // Step from the slower of the vacuum fall and the terminal-speed fall.
  const vacuumTime = fallTime(h, g, Math.max(0, v0));
  const terminalSpeed = k > 0 ? Math.sqrt(g / k) : Infinity;
  const slowest = Math.max(vacuumTime, isFinite(terminalSpeed) ? h / terminalSpeed : 0);
  const dt = Math.max(1e-6, slowest / 20000);
  const every = Math.ceil(40000 / MAX_POINTS); // ~MAX_POINTS for typical falls

  const out = { t: [0], y: [0], v: [v0], a: [acc(v0)] };
  let t = 0, y = 0, v = v0, landingTime = NaN, impactSpeed = NaN;
  for (let i = 1; i < 5e6; i++) {
    const k1y = v, k1v = acc(v);
    const k2y = v + dt / 2 * k1v, k2v = acc(v + dt / 2 * k1v);
    const k3y = v + dt / 2 * k2v, k3v = acc(v + dt / 2 * k2v);
    const k4y = v + dt * k3v, k4v = acc(v + dt * k3v);
    const y2 = y + dt / 6 * (k1y + 2 * k2y + 2 * k3y + k4y);
    const v2 = v + dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
    if (y2 >= h) {
      const f = (h - y) / (y2 - y);
      landingTime = t + f * dt;
      impactSpeed = v + f * (v2 - v);
      out.t.push(landingTime); out.y.push(h); out.v.push(impactSpeed); out.a.push(acc(impactSpeed));
      break;
    }
    t += dt; y = y2; v = v2;
    if (i % every === 0) { out.t.push(t); out.y.push(y); out.v.push(v); out.a.push(acc(v)); }
  }
  if (!isFinite(landingTime)) throw new RangeError("simulateFall: the object never lands (moving upward?)");
  return {
    ...out, landingTime, impactSpeed,
    impactEnergyJ: 0.5 * m * impactSpeed * impactSpeed,
    terminalSpeed, vacuumTime,
    vacuumImpact: Math.sqrt(v0 * v0 + 2 * g * h)
  };
}
