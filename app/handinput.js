/* The child's hand, for every experiment screen: from the camera (MediaPipe
 * hand tracking) or from a finger / the mouse (press and hold = fist).
 * The camera fills the stage (object-fit: cover), so landmarks are mapped
 * from video coordinates to stage fractions, flipped when mirrored.
 *
 *   var input = makeHandInput({wrap, video, canvas}, {mirror: fn, back: fn, status: fn})
 *   input.startCamera() / input.startTouch() → Promise; input.stop()
 *   each animation frame: var r = input.read(now)  → {hand, fresh}
 *     hand: {x, y, open (0 fist..1 open), lm (21 points) | null} or null
 *     fresh: a new reading (camera frame or pointer state) to feed the ball */
import * as AR from "../core/index.js";
import { loadHandTracker, HandTracker } from "../lab/handtrack.js";
import { pointerHand } from "../lab/catchview.js";
import { startCamera, stopCamera, cameraError } from "./camera.js";

var NO_HAND_HINT_MS = 2500;

export function makeHandInput(els, opts) {
  var H = {
    source: null,        // "camera" | "touch" while running
    tracker: null, clock: null,
    hand: null,
    pointer: { inside: false, down: false, x: 0.5, y: 0.5, upAt: -Infinity },
    lastHandAt: 0, hinted: false,

    /* Camera + hand tracker. Rejects with a sentence to show the child. */
    startCamera: function() {
      var cam = startCamera(els.video, opts.back()).catch(function(e) { throw { camera: true, err: e }; });
      return Promise.all([loadHandTracker(), cam]).then(function(r) {
        H.tracker = new HandTracker(r[0]);
        H.begin("camera");
      }, function(err) {
        if (err && err.camera && err.err && err.err.name === "AbortError") throw { aborted: true };
        stopCamera();
        throw new Error((err && err.camera ? cameraError(err.err) : "The hand tracker couldn't load (check the internet).") +
          " You can use your finger or the mouse instead.");
      });
    },
    startTouch: function() {
      stopCamera();
      H.begin("touch");
      return Promise.resolve();
    },
    begin: function(source) {
      H.stop();
      H.source = source;
      els.wrap.classList.toggle("touch-play", source === "touch");
      H.hand = null;
      H.lastHandAt = performance.now();
      H.hinted = false;
      if (source === "camera") {
        H.clock = new AR.FrameClock(els.video);
        H.clock.start();
      }
    },
    stop: function() {
      if (H.clock) H.clock.stop();
      H.clock = null;
      H.source = null;
      els.wrap.classList.remove("touch-play", "pressing");
    },
    /* Camera off too (leaving the screen). */
    close: function() { H.stop(); stopCamera(); },

    read: function(now) {
      var fresh = false;
      if (H.source === "camera") {
        if (H.clock && H.clock.next(now)) { H.hand = H.detect(now); fresh = true; }
      } else if (H.source === "touch") {
        H.hand = pointerHand(H.pointer, H.hand, now);
        fresh = true;
      }
      if (fresh && H.source === "camera") {
        if (H.hand) {
          H.lastHandAt = now;
          if (H.hinted) { H.hinted = false; if (opts.handBack) opts.handBack(); }
        } else if (!H.hinted && now - H.lastHandAt > NO_HAND_HINT_MS && (!opts.quiet || !opts.quiet())) {
          H.hinted = true;
          opts.status("I can't see a hand. Step back so your hand is in the picture.", "err");
        }
      }
      return { hand: H.hand, fresh: fresh };
    },

    /* Landmarks → stage fractions: the video covers the stage (cropped on
     * two sides) and is flipped when mirrored. */
    detect: function(now) {
      var video = els.video, lm = null;
      try { lm = H.tracker.detect(video, now); } catch (e) { lm = null; }
      if (!lm) return null;
      var SW = els.wrap.clientWidth, SH = els.wrap.clientHeight;
      var VW = video.videoWidth, VH = video.videoHeight;
      var k = Math.max(SW / VW, SH / VH), dw = VW * k, dh = VH * k;
      var ox = (dw - SW) / 2, oy = (dh - SH) / 2, flip = opts.mirror();
      var shown = lm.map(function(q) {
        var x = flip ? 1 - q.x : q.x;
        return { x: (x * dw - ox) / SW, y: (q.y * dh - oy) / SH };
      });
      var c = AR.palmCenter(shown);
      return { x: c.x, y: c.y, open: AR.handOpenness(lm, VW / VH), lm: shown };
    }
  };

  // Finger / mouse on the stage.
  var cv = els.canvas, P = H.pointer;
  var place = function(e) {
    var r = cv.getBoundingClientRect();
    P.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    P.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    P.t = performance.now();
  };
  cv.addEventListener("pointermove", function(e) {
    if (H.source !== "touch") return;
    P.inside = true; place(e);
  });
  cv.addEventListener("pointerdown", function(e) {
    if (H.source !== "touch") return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    P.inside = true; P.down = true; place(e);
    els.wrap.classList.add("pressing");
  });
  var up = function(e) {
    if (H.source !== "touch") return;
    if (P.down) P.upAt = performance.now();
    P.down = false;
    els.wrap.classList.remove("pressing");
    if (e.pointerType !== "mouse") P.inside = false; // a lifted finger is gone
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("pointerleave", function() { if (!P.down) P.inside = false; });
  return H;
}
