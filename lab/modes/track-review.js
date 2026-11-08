/* Auto-track review: after a fit, replay the fall in slow motion over the
 * video, and let the user step through the recorded frames with a slider.
 * Track (track.js) feeds it frames while recording and hands it the fit. */
import * as AR from "../../core/index.js";
import { $ } from "../ui.js";

var R = AR.render;
var PRE_ROLL_S = 0.6; // frames kept from before the drop while armed

var TrackReview = {
  frames: new AR.FrameRing(),
  loop: null,     // ReplayLoop while playing
  path: null,     // fallPath of the last fit
  res: null,      // last analyzeFall result

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
    this.path = AR.fallPath(res);
    this.loop = new AR.ReplayLoop(res.span, function(tau) { self.draw(tau, null); });
    this.loop.start();
    this.frames.settle().then(function() {
      if (self.res !== res) return; // superseded
      var n = self.frames.frames.length;
      $("track-review").hidden = n < 2;
      $("track-scrub").max = String(Math.max(0, n - 1));
      $("track-scrub").value = "0";
      $("track-scrub-t").textContent = "slow-motion replay";
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
    $("track-scrub-t").textContent = "frame " + (i + 1) + "/" + this.frames.frames.length +
      " · t = " + (ms >= 0 ? "+" : "−") + Math.abs(ms) + " ms";
  },

  play: function() {
    if (!this.loop) return;
    this.loop.start();
    $("track-scrub-t").textContent = "slow-motion replay";
  },

  draw: function(tau, background) {
    var cv = $("track-overlay");
    AR.drawReplay(cv.getContext("2d"), R.fitCanvas(cv), this.path, tau, {
      ghost: $("track-ghost").checked, measuredG: this.res.fit.g, background: background
    });
  },

  /* Stop playback and clear the overlay; keep frames. */
  stop: function() {
    if (this.loop) this.loop.stop();
    this.loop = null;
    var cv = $("track-overlay");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },

  /* Forget everything (new recording, Clear, camera switched). */
  reset: function() {
    this.stop();
    this.frames.clear();
    this.path = null;
    this.res = null;
    $("track-review").hidden = true;
  },

  init: function() {
    var self = this;
    $("track-scrub").addEventListener("input", function() {
      self.scrub(parseInt($("track-scrub").value, 10) || 0);
    });
    $("btn-track-play").addEventListener("click", function() { self.play(); });
  }
};

export { TrackReview };
