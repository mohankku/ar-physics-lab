/**
 * AR Physics Lab core — the AR engine behind the experiments.
 *
 * Camera, frame timing, on-device color tracking, ball rendering and the
 * free-fall physics. It knows nothing about lab.html: callers pass in video
 * and canvas elements plus plain numbers, and get plain results back.
 * ES modules, no build step, no dependencies. Video never leaves the device.
 *
 *   import * as AR from "./core/index.js";
 *
 * @module core
 */
export const VERSION = "2.0.0";

export {
  REFERENCE_G, fallTime, gravityFromDrop, mean, std, median, percentError,
  fitGravity, fitFreeFall, robustFitFreeFall
} from "./physics.js";
export { analyzeFall } from "./analysis.js";
export {
  ColorTracker, COLOR_PRESETS, colorPreset, colorDistSq, isSkinPixel, isBlueBackdrop
} from "./vision.js";
export { Camera, FrameClock, DEFAULT_CONSTRAINTS } from "./camera.js";
export { FreeFall, HandBall, SPIN } from "./sim.js";
export * as render from "./render.js";
