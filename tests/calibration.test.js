import { test, assert, near, throws } from "./harness.js";
import {
  scaleFromBallWidths, scaleFromPoints, clientToCamera, resolveScale, BALL_DIAMETERS
} from "../core/calibration.js";

test("ball widths → px per meter, robust to a bad measurement", () => {
  const s = scaleFromBallWidths([33.4, 33.6, 33.5, 80, 33.5, NaN], 0.067);
  near(s.pxPerM, 33.5 / 0.067, 1e-9, "median width / diameter");
  assert(s.n === 5 && s.spread < 0.01, "n and spread");
  assert(scaleFromBallWidths([30, 31], 0.067) === null, "needs 3+ widths");
  throws(() => scaleFromBallWidths([30, 30, 30], 0), RangeError);
});

test("two points a known length apart → px per meter", () => {
  near(scaleFromPoints({ x: 100, y: 50 }, { x: 100, y: 450 }, 0.5), 800, 1e-9, "vertical");
  near(scaleFromPoints({ x: 0, y: 0 }, { x: 300, y: 400 }, 1), 500, 1e-9, "diagonal");
  throws(() => scaleFromPoints({ x: 1, y: 1 }, { x: 1, y: 2 }, 1), RangeError);
  throws(() => scaleFromPoints({ x: 0, y: 0 }, { x: 0, y: 100 }, -1), RangeError);
});

test("client coordinates map to camera pixels (object-fit: fill)", () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };
  const p = clientToCamera(rect, { videoWidth: 1280, videoHeight: 720 }, 210, 170);
  near(p.x, 640, 1e-9, "x"); near(p.y, 360, 1e-9, "y");
});

test("resolveScale uses the ball when it can", () => {
  const s = resolveScale({ mode: "ball", videoHeightPx: 480, dropHeightM: 1,
    ballWidthsPx: [20, 20, 20, 20], ballDiameterM: 0.067 });
  assert(s.source === "ball" && !s.note, "ball used");
  near(s.frameHeightM, 480 / (20 / 0.067), 1e-9, "frame height");
});

test("resolveScale falls back to frame = h with a reason", () => {
  const few = resolveScale({ mode: "ball", videoHeightPx: 480, dropHeightM: 1.5,
    ballWidthsPx: [20], ballDiameterM: 0.067 });
  assert(few.source === "frame" && few.frameHeightM === 1.5 && /size/.test(few.note), "few widths");
  const px = resolveScale({ mode: "pixels", videoHeightPx: 480, dropHeightM: 1, pxPerM: 0 });
  assert(px.source === "frame" && /px-per-meter/.test(px.note), "no px/m");
  const ok = resolveScale({ mode: "pixels", videoHeightPx: 480, dropHeightM: 1, pxPerM: 240 });
  near(ok.frameHeightM, 2, 1e-12, "pixels mode");
  const fr = resolveScale({ mode: "frame", videoHeightPx: 480, dropHeightM: 2 });
  assert(fr.source === "frame" && fr.note === undefined, "plain frame mode");
  throws(() => resolveScale({ mode: "frame" }), RangeError);
});

test("ball diameter presets are sane", () => {
  near(BALL_DIAMETERS.tennis, 0.067, 0);
  assert(Object.values(BALL_DIAMETERS).every((d) => d > 0.03 && d < 0.3), "range");
});
