/* Review after a fit: replay the motion in slow motion over the video, and
 * let the user step through the recorded frames with a slider. The mode
 * feeds it frames while recording and hands it the fit.
 *
 * makeReview("track", kind) wires track-review, track-scrub, track-scrub-t,
 * btn-track-play, track-overlay and track-ghost. kind says how to draw:
 *   {path(res) → replay path, draw(ctx, dims, path, tau, opts), g(res)} */
import * as AR from "../../core/index.js";
import { $ } from "../ui.js";

var R = AR.render;
var PRE_ROLL_S = 0.6; // frames kept from before the motion while armed

function makeReview(p, kind) {
var id = function(name) { return p + "-" + name; };
return {
  frames: new AR.FrameRing(),
  loop: null,     // ReplayLoop while playing
  path: null,     // replay path of the last fit
  res: null,      // last analysis result

  /* Store a camera frame. Before the drop only a short pre-roll is kept. */
  capture: function(video, t, recording) {
    if (!this.frames.supported) return;
    this.frames.push(video, t);
    if (!recording) this.frames.trimBefore(t - PRE_ROLL_S);
  },

  /* Show a successful fit: start the replay, enable the slider. */
  show: function(res) {
    var self = this;
    this.stop();
    this.res = res;
    this.path = kind.path(res);
    this.loop = new AR.ReplayLoop(res.span, function(tau) { self.draw(tau, null); });
    this.loop.start();
    this.frames.settle().then(function() {
      if (self.res !== res) return; // superseded
      var n = self.frames.frames.length;
      $(id("review")).hidden = n < 2;
      $(id("scrub")).max = String(Math.max(0, n - 1));
      $(id("scrub")).value = "0";
      $(id("scrub-t")).textContent = "slow-motion replay";
    });
  },

  /* Step to recorded frame i: real frame underneath, fit on top. */
  scrub: function(i) {
    var f = this.frames.frames[i];
    if (!f || !this.path) return;
    if (this.loop) this.loop.stop();
    var tau = f.time - this.res.origin.t;
    this.draw(tau, f.image);
    var ms = Math.round(tau * 1000);
    $(id("scrub-t")).textContent = "frame " + (i + 1) + "/" + this.frames.frames.length +
      " · t = " + (ms >= 0 ? "+" : "−") + Math.abs(ms) + " ms";
  },

  play: function() {
    if (!this.loop) return;
    this.loop.start();
    $(id("scrub-t")).textContent = "slow-motion replay";
  },

  draw: function(tau, background) {
    var cv = $(id("overlay"));
    kind.draw(cv.getContext("2d"), R.fitCanvas(cv), this.path, tau, {
      ghost: $(id("ghost")).checked, measuredG: kind.g(this.res), background: background
    });
  },

  /* Stop playback and clear the overlay; keep frames. */
  stop: function() {
    if (this.loop) this.loop.stop();
    this.loop = null;
    var cv = $(id("overlay"));
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* Forget everything (new recording, Clear, camera switched). */
  reset: function() {
    this.stop();
    this.frames.clear();
    this.path = null;
    this.res = null;
    $(id("review")).hidden = true;
  },

  init: function() {
    var self = this;
    $(id("scrub")).addEventListener("input", function() {
      self.scrub(parseInt($(id("scrub")).value, 10) || 0);
    });
    $("btn-" + p + "-play").addEventListener("click", function() { self.play(); });
  }
};
}

export { makeReview };
