/* Simulated-camera scenes for the test bench: where the ball is at time t,
 * and the true physics the lab should measure. Pure — no DOM — so the
 * unit tests can check that the truth and the motion agree.
 *
 * Units: meters and seconds; x from the frame's left, y down from its top.
 * t is seconds since Go; the ball holds still for HOLD_S first, so the
 * lab's auto-start triggers see a resting ball, as with a real hand. */
import { periodFactor } from "../../core/pendulum.js";

export const HOLD_S = 1.2;

/**
 * @typedef {Object} SceneParams
 * @property {number} g            m/s²
 * @property {number} frameH       meters spanned by the frame height
 * @property {number} aspect       frame width / height
 * @property {number} d            ball diameter, m
 * @property {{speed: number, angleDeg: number, dir: number, pushS: number, dip: number}} throw
 *   dir +1 = rightward; pushS: how long the hand accelerates the ball;
 *   dip: wind-up dip depth (m) before the push, 0 for none
 * @property {{stringM: number, ampDeg: number, Q: number}} pend
 *   stringM: pivot to the top of the ball; Q: quality factor (damping)
 *
 * @typedef {{x: number, y: number, visible: boolean, pivot?: {x: number, y: number}}} Pose
 */

/** @returns {{kind: string, truth: Object, at: (t: number) => Pose}} */
export function makeScene(kind, p) {
  if (kind === "drop") return dropScene(p);
  if (kind === "throw") return throwScene(p);
  if (kind === "pendulum") return pendulumScene(p);
  return holdScene(p);
}

function inFrame(p, x, y) {
  const r = p.d / 2, W = p.frameH * p.aspect;
  return x > -r && x < W + r && y > -r && y < p.frameH + r;
}

function holdScene(p) {
  const pose = { x: p.frameH * p.aspect / 2, y: p.frameH / 2, visible: true };
  return { kind: "hold", truth: {}, at: () => pose };
}

function dropScene(p) {
  const x = p.frameH * p.aspect / 2, y0 = p.frameH * 0.18;
  return {
    kind: "drop",
    truth: { g: p.g, dropM: p.frameH - y0 },
    at(t) {
      const s = Math.max(0, t - HOLD_S);
      const y = y0 + 0.5 * p.g * s * s;
      return { x, y, visible: inFrame(p, x, y) };
    }
  };
}

function throwScene(p) {
  const W = p.frameH * p.aspect, th = p.throw;
  const a = th.angleDeg * Math.PI / 180, dir = th.dir < 0 ? -1 : 1;
  const vx = dir * th.speed * Math.cos(a), vyUp = th.speed * Math.sin(a);
  const x0 = dir > 0 ? W * 0.15 : W * 0.85, y0 = p.frameH * 0.72;
  const dipS = th.dip > 0 ? 0.25 : 0;
  const tPush = HOLD_S + dipS, tRel = tPush + th.pushS;
  // Constant hand acceleration from rest up to the release velocity.
  const rx = x0 + 0.5 * vx * th.pushS, ry = y0 - 0.5 * vyUp * th.pushS;
  return {
    kind: "throw",
    truth: {
      g: p.g, speed: th.speed, angleDeg: th.angleDeg, vx,
      apexM: vyUp * vyUp / (2 * p.g),
      rangeM: th.speed * th.speed * Math.sin(2 * a) / p.g,
      releaseS: tRel
    },
    at(t) {
      let x = x0, y = y0;
      if (t >= tRel) {
        const s = t - tRel;
        x = rx + vx * s;
        y = ry - vyUp * s + 0.5 * p.g * s * s;
      } else if (t >= tPush) {
        const s = t - tPush, k = 0.5 * s * s / th.pushS;
        x = x0 + vx * k;
        y = y0 - vyUp * k;
      } else if (t >= HOLD_S && dipS) {
        y = y0 + th.dip * Math.sin(Math.PI * (t - HOLD_S) / dipS);
      }
      return { x, y, visible: inFrame(p, x, y) };
    }
  };
}

function pendulumScene(p) {
  const pv = p.pend;
  const L = pv.stringM + p.d / 2;
  const pivot = { x: p.frameH * p.aspect / 2, y: p.frameH * 0.06 };
  const th0 = pv.ampDeg * Math.PI / 180;
  const w0 = Math.sqrt(p.g / L), gamma = w0 / pv.Q;
  const T0 = 2 * Math.PI / w0;
  // Nonlinear, damped: θ'' = −(g/L)·sin θ − γ·θ'. RK4, stepped forward on demand.
  let st = { t: 0, th: th0, om: 0 };
  const acc = (th, om) => -(p.g / L) * Math.sin(th) - gamma * om;
  const H = 0.0005;
  function advance(to) {
    if (to < st.t) st = { t: 0, th: th0, om: 0 };
    while (st.t < to) {
      const h = Math.min(H, to - st.t), { th, om } = st;
      const k1a = om, k1w = acc(th, om);
      const k2a = om + h / 2 * k1w, k2w = acc(th + h / 2 * k1a, om + h / 2 * k1w);
      const k3a = om + h / 2 * k2w, k3w = acc(th + h / 2 * k2a, om + h / 2 * k2w);
      const k4a = om + h * k3w, k4w = acc(th + h * k3a, om + h * k3w);
      st = {
        t: st.t + h,
        th: th + h / 6 * (k1a + 2 * k2a + 2 * k3a + k4a),
        om: om + h / 6 * (k1w + 2 * k2w + 2 * k3w + k4w)
      };
    }
    return st.th;
  }
  return {
    kind: "pendulum",
    truth: { g: p.g, L, T0, T: T0 * periodFactor(th0), ampDeg: pv.ampDeg, Q: pv.Q },
    at(t) {
      const th = advance(Math.max(0, t - HOLD_S));
      const x = pivot.x + L * Math.sin(th), y = pivot.y + L * Math.cos(th);
      return { x, y, visible: inFrame(p, x, y), pivot };
    }
  };
}

/** Defaults the bench starts from. */
export function defaultParams() {
  return {
    g: 9.81, frameH: 1.5, aspect: 4 / 3, d: 0.067,
    throw: { speed: 3.5, angleDeg: 60, dir: 1, pushS: 0.15, dip: 0 },
    pend: { stringM: 0.8, ampDeg: 12, Q: 150 }
  };
}
