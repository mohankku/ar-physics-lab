/**
 * AR Physics Lab core — the AR engine behind the experiments.
 *
 * Camera, frame timing, on-device color tracking, ball rendering and the
 * physics: free fall, projectiles and pendulums. It knows nothing about lab.html: callers pass in video
 * and canvas elements plus plain numbers, and get plain results back.
 * ES modules, no build step, no dependencies. Video never leaves the device.
 *
 *   import * as AR from "./core/index.js";
 *
 * @module core
 */
export const VERSION = "2.1.0";

export {
  REFERENCE_G, localGravity, fallTime, gravityFromDrop, mean, std, median, percentError,
  fitGravity, fitFreeFall, robustFitFreeFall, fitLine, robustFit
} from "./physics.js";
export { analyzeFall, cleanSamples, frameRate } from "./analysis.js";
export { analyzeProjectile, projectilePath } from "./projectile.js";
export { analyzePendulum, pendulumModel, periodFactor } from "./pendulum.js";
export { simulateFall, AIR_DENSITY, DRAG_COEFFICIENTS } from "./models.js";
export { MATERIALS, refract, criticalAngle, indexFrom, LaserPointer } from "./optics.js";
export {
  PLANETS, circularSpeed, escapeSpeed, keplerPeriod, orbitElements, defaultWarp, Satellite
} from "./orbit.js";
export {
  handOpenness, palmCenter, pinchOpenness, pinchPoint, GestureGate, fitHandVelocity, CatchBall, ThrowBall, SwingBall, RampBall, rampAccel, SURFACES
} from "./gesture.js";
export {
  resolveScale, scaleFromBallWidths, scaleFromPoints, clientToCamera, BALL_DIAMETERS
} from "./calibration.js";
export {
  ColorTracker, COLOR_PRESETS, colorPreset, colorDistSq, isSkinPixel, isBlueBackdrop,
  blobWidthInPixels, blobSizeInPixels
} from "./vision.js";
export { Camera, FrameClock, DEFAULT_CONSTRAINTS } from "./camera.js";
export { FreeFall, HandBall, SPIN } from "./sim.js";
export { FallTrigger, ThrowTrigger } from "./trigger.js";
export { fallPath, drawReplay, drawProjectileReplay, ReplayLoop } from "./replay.js";
export { FrameRing } from "./framebuffer.js";
export * as render from "./render.js";
