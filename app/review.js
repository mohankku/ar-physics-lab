/* After a fit: replay the motion in slow motion over the video, and let the
 * child step through the real recorded frames with a slider.
 * els: {canvas, row (slider row), slider, label, play (button)}
 * kind: {path(res), draw(ctx, dims, path, tau, opts), g(res)} */
import * as AR from "../core/index.js";

var R = AR.render;
var PRE_ROLL_S = 0.6; // frames kept from before the motion while waiting

export function makeReview(els, kind) {
  var self = {
    frames: new AR.FrameRing(),
    loop: null, path: null, res: null, ghost: true,

    /* Store a camera frame; while not recording keep only a short pre-roll. */
    capture: function(video, t, recording) {
      if (!self.frames.supported) return;
      self.frames.push(video, t);
      if (!recording) self.frames.trimBefore(t - PRE_ROLL_S);
    },
    show: function(res) {
      self.stop();
      self.res = res;
      self.path = kind.path(res);
      self.loop = new AR.ReplayLoop(res.span, function(tau) { self.draw(tau, null); });
      self.loop.start();
      els.row.hidden = false;
      els.slider.max = "0";
      els.label.textContent = "Slow-motion replay";
      self.frames.settle().then(function() {
        if (self.res !== res) return;
        var n = self.frames.frames.length;
        els.slider.max = String(Math.max(0, n - 1));
        els.slider.value = "0";
        els.slider.disabled = n < 2;
      });
    },
    scrub: function(i) {
      var f = self.frames.frames[i];
      if (!f || !self.path) return;
      if (self.loop) self.loop.stop();
      var tau = f.time - self.res.origin.t;
      self.draw(tau, f.image);
      var ms = Math.round(tau * 1000);
      els.label.textContent = "Frame " + (i + 1) + " of " + self.frames.frames.length +
        " · " + (ms >= 0 ? "+" : "−") + Math.abs(ms) + " ms";
    },
    play: function() {
      if (!self.loop) return;
      self.loop.start();
      els.label.textContent = "Slow-motion replay";
    },
    draw: function(tau, background) {
      var cv = els.canvas;
      kind.draw(cv.getContext("2d"), R.fitCanvas(cv), self.path, tau, {
        ghost: self.ghost, measuredG: kind.g(self.res), background: background
      });
    },
    get showing() { return !!self.res; },
    stop: function() {
      if (self.loop) self.loop.stop();
      self.loop = null;
    },
    reset: function() {
      self.stop();
      self.frames.clear();
      self.path = null;
      self.res = null;
      els.row.hidden = true;
    }
  };
  els.slider.addEventListener("input", function() { self.scrub(parseInt(els.slider.value, 10) || 0); });
  els.play.addEventListener("click", function() { self.play(); });
  return self;
}
