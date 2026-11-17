/* A simulated camera for the app's browser tests: replaces getUserMedia in
 * the app's window with a canvas stream showing a red ball doing one of
 * the bench scenes (tests/bench/scene.js), with known physics. */
import { makeScene, defaultParams } from "./bench/scene.js";

var CW = 640, CH = 480;

/* win: the app's window; opts: {params, fps, manual (call cam.draw() for
 * each frame yourself)}. Returns {params, go(kind), show(kind), ballAt(),
 * draw(), frames}. */
export function installFakeCamera(win, opts) {
  opts = opts || {};
  var params = Object.assign(defaultParams(), opts.params || {});
  var doc = win.document;
  var canvas = doc.createElement("canvas");
  canvas.width = CW; canvas.height = CH;
  var ctx = canvas.getContext("2d");
  var track = null, scene = makeScene("hold", params), goAt = null, timer = 0;
  var cam = { params: params, frames: 0 };

  function draw() {
    var k = CH / params.frameH;
    ctx.fillStyle = "#eceee9";
    ctx.fillRect(0, 0, CW, CH);
    var t = goAt == null ? 0 : (win.performance.now() - goAt) / 1000;
    var pose = scene.at(t);
    if (pose.pivot) {
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(pose.pivot.x * k - 60, pose.pivot.y * k - 8, 120, 8);
      ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pose.pivot.x * k, pose.pivot.y * k); ctx.lineTo(pose.x * k, pose.y * k); ctx.stroke();
    }
    if (pose.visible) {
      ctx.fillStyle = "#e5484d";
      ctx.beginPath(); ctx.arc(pose.x * k, pose.y * k, params.d / 2 * k, 0, 2 * Math.PI); ctx.fill();
    }
    cam.frames++;
    if (track && track.requestFrame) track.requestFrame();
  }

  win.navigator.mediaDevices.getUserMedia = function() {
    var stream = canvas.captureStream(0);
    track = stream.getVideoTracks()[0];
    if (!track.requestFrame) { stream = canvas.captureStream(30); track = null; }
    draw();
    if (!timer && !opts.manual) timer = win.setInterval(draw, 1000 / (opts.fps || 30));
    return Promise.resolve(stream);
  };
  /* Start a scene: "throw" or "pendulum" (the ball rests for HOLD_S first). */
  cam.go = function(kind) {
    scene = makeScene(kind, params);
    goAt = win.performance.now();
    return scene.truth;
  };
  /* Where the ball is now, in frame fractions (for tapping it). */
  cam.ballAt = function() {
    var t = goAt == null ? 0 : (win.performance.now() - goAt) / 1000;
    var pose = scene.at(t), W = params.frameH * params.aspect;
    return { x: pose.x / W, y: pose.y / params.frameH };
  };
  cam.draw = draw;
  cam.show = function(kind) { scene = makeScene(kind, params); goAt = null; };
  return cam;
}
