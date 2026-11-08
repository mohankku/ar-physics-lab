import { test, assert, near, throws } from "./harness.js";
import { ColorTracker, colorPreset, COLOR_PRESETS, isSkinPixel, isBlueBackdrop } from "../core/vision.js";

const RED = [229, 72, 77];

/* White frame with colored rectangles: [x0, y0, x1, y1, [r,g,b]]. */
function frame(W, H, rects) {
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const [x0, y0, x1, y1, c] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
  }
  return d;
}

test("finds the true center of a colored blob", () => {
  const tr = new ColorTracker();
  const c = tr.locateInPixels(frame(160, 120, [[70, 50, 90, 70, RED]]), { target: colorPreset("red"), tol: 60 });
  near(c.x, 80 / 160, 1e-9, "x"); near(c.y, 60 / 120, 1e-9, "y");
  assert(c.n === 400, "blob size " + c.n);
});

test("prefers the largest blob, unless locked near another", () => {
  const tr = new ColorTracker();
  const px = frame(160, 120, [[10, 10, 20, 20, RED], [100, 60, 140, 100, RED]]);
  const opts = { target: colorPreset("red"), tol: 60 };
  assert(tr.locateInPixels(px, opts).n === 1600, "largest blob wins");
  opts.pref = { x: 15 / 160, y: 15 / 120 };
  assert(tr.locateInPixels(px, opts).n === 100, "lock keeps the smaller blob near pref");
});

test("ignores specks smaller than the minimum blob", () => {
  const tr = new ColorTracker();
  const px = frame(160, 120, [[5, 5, 8, 8, RED], [50, 50, 53, 53, RED]]); // 9 px each
  assert(tr.locateInPixels(px, { target: colorPreset("red"), tol: 60 }) === null, "no hit");
});

test("motion gate ignores a still blob and finds a moving one", () => {
  const tr = new ColorTracker();
  const opts = { target: colorPreset("red"), tol: 60, motion: true };
  const a = frame(160, 120, [[70, 50, 90, 70, RED]]);
  assert(tr.locateInPixels(a, opts) !== null, "first frame: no history, gate skipped");
  assert(tr.locateInPixels(a, opts) === null, "same frame again: nothing moved");
  const b = frame(160, 120, [[100, 50, 120, 70, RED]]);
  const c = tr.locateInPixels(b, opts);
  assert(c && c.x > 0.6, "moved blob found at its new spot");
  tr.reset();
  assert(tr.locateInPixels(b, opts) !== null, "reset forgets history");
});

test("skin mode and blue-backdrop filter", () => {
  const tr = new ColorTracker();
  const SKIN = [224, 172, 105], BLUE = [31, 111, 235];
  const px = frame(160, 120, [[20, 20, 40, 40, SKIN], [100, 60, 150, 110, BLUE]]);
  const skin = tr.locateInPixels(px, { skin: true });
  near(skin.x, 30 / 160, 1e-9, "skin x");
  const blue = tr.locateInPixels(px, { target: colorPreset("blue"), tol: 60 });
  assert(blue && blue.n === 2500, "blue found by color");
  assert(tr.locateInPixels(px, { target: colorPreset("blue"), tol: 60, ignoreBlue: true }) === null,
    "backdrop filter removes it");
});

test("pixel classifiers", () => {
  assert(isSkinPixel(224, 172, 105), "typical skin tone");
  assert(!isSkinPixel(31, 111, 235), "blue is not skin");
  assert(!isSkinPixel(10, 8, 6), "too dark");
  assert(isBlueBackdrop(31, 111, 235), "blue sheet");
  assert(!isBlueBackdrop(229, 72, 77), "red is not backdrop");
});

test("presets are copies, and frozen at the source", () => {
  const c = colorPreset("green");
  c.r = 0;
  assert(COLOR_PRESETS.green.r === 46, "preset unchanged");
  assert(colorPreset("nope").r === 229, "unknown name → red");
  assert(Object.isFrozen(COLOR_PRESETS.red), "frozen");
});

test("custom working size and input validation", () => {
  const tr = new ColorTracker({ width: 80, height: 60 });
  const c = tr.locateInPixels(frame(80, 60, [[0, 0, 10, 10, RED]]), { target: colorPreset("red"), tol: 60 });
  near(c.x, 5 / 80, 1e-9, "x");
  throws(() => tr.locateInPixels(new Uint8Array(10), {}), RangeError);
});

test("locate returns null for a video with no frame", () => {
  const tr = new ColorTracker();
  assert(tr.locate(null, {}) === null, "no video");
  assert(tr.locate({ readyState: 0, videoWidth: 0 }, {}) === null, "not ready");
});
