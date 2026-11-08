/* Mode 1 — AR simulate: a virtual ball falls over the live camera feed. */
import * as AR from "../../core/index.js";

var K = AR, R = AR.render;
import { $, setStatus, numberIn, readGravity, onSpace, selectSwatch, remember, recall, restoreSettings, saveSettings, ballStyle, camera, openCamera } from "../ui.js";

var SIM_SETTINGS = [["sim-gravity", "sim-g"], ["sim-g-custom", "sim-gc"], ["sim-height", "sim-h"]];
var Sim = {
  fall: new AR.FreeFall(),
  raf: 0, running: false, last: 0,
  params: function() {
    return {
      g: readGravity("sim-gravity", "sim-g-custom"),
      h: numberIn("sim-height", 0.2, 50, 2),
      slow: parseFloat($("sim-slow").value) || 1,
      trail: $("sim-trail").checked
    };
  },
  resize: function() {
    var cv = $("sim-overlay");
    if (cv && !cv.closest(".phys-mode").hidden) R.fitCanvas(cv);
  },
  drop: function() {
    var self = this;
    var start = this.params();
    this.cancel();
    this.fall.reset(start.g, start.h); // g and h are fixed for this drop
    this.running = true;
    this.last = performance.now();
    setStatus($("sim-status"), "Ball falling…", "");
    var step = function(now) {
      var p = self.params(); // slow motion and trail may change mid-fall
      // Cap the step so a backgrounded tab resumes instead of jumping to the end.
      var dt = Math.min(0.05, (now - self.last) / 1000) * p.slow;
      self.last = now;
      var landed = self.fall.step(dt, p.trail);
      self.draw(p);
      self.readout();
      if (landed) {
        self.running = false;
        setStatus($("sim-status"), "Landed in " + self.fall.t.toFixed(3) +
          " s (theory " + self.fall.landingTime.toFixed(3) + " s).", "ok");
        return;
      }
      self.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  cancel: function() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  },
  reset: function() {
    this.cancel();
    var p = this.params();
    this.fall.reset(p.g, p.h);
    this.draw(p); this.readout();
    setStatus($("sim-status"), "Ready — press Drop.", "");
  },
  draw: function(p) {
    var cv = $("sim-overlay");
    var dims = R.fitCanvas(cv);
    R.drawFallScene(cv.getContext("2d"), dims, this.fall, { trail: p.trail });
  },
  readout: function() {
    var f = this.fall;
    $("ro-t").textContent = f.t.toFixed(3) + " s";
    $("ro-y").textContent = f.y.toFixed(2) + " m";
    $("ro-v").textContent = f.v.toFixed(2) + " m/s";
    $("ro-theory").textContent = f.landingTime.toFixed(3) + " s";
  },
  init: function() {
    var self = this;
    this.fall.ball = R.makeBall(ballStyle($("sim-ball")));
    $("sim-ball").addEventListener("change", function() {
      self.fall.ball = R.makeBall(ballStyle($("sim-ball")));
      remember("ball", self.fall.ball.style);
      if (!self.running) self.reset();
    });
    $("btn-sim-drop").addEventListener("click", function() { self.drop(); });
    $("btn-sim-reset").addEventListener("click", function() { self.reset(); });
    onSpace("mode-simulate", function() { self.drop(); });
    $("btn-sim-cam").addEventListener("click", function() {
      openCamera($("sim-video"), $("sim-status")).then(function() { self.resize(); self.reset(); }, function() {});
    });
    restoreSettings(SIM_SETTINGS);
    $("sim-g-custom").disabled = $("sim-gravity").value !== "custom";
    ["sim-gravity", "sim-g-custom", "sim-height", "sim-slow", "sim-trail"].forEach(function(id) {
      $(id).addEventListener("input", function() {
        $("sim-g-custom").disabled = $("sim-gravity").value !== "custom";
        saveSettings(SIM_SETTINGS);
        if (!self.running) self.reset();
      });
    });
    window.addEventListener("resize", function() { self.resize(); });
    this.resize(); this.reset();
  }
};

export { Sim };
