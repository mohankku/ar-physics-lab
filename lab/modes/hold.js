/* Mode 4 — hold a virtual ball in your tracked hand, then release it. */
import * as AR from "../../core/index.js";

var K = AR, R = AR.render;
import { $, setStatus, numberIn, readGravity, onSpace, selectSwatch, remember, recall, restoreSettings, saveSettings, ballStyle, camera, openCamera } from "../ui.js";

var HOLD_SETTINGS = [["hold-gravity", "hold-g"], ["hold-g-custom", "hold-gc"],
                     ["hold-height", "hold-h"], ["hold-linepos", "hold-linepos"]];
var Hold = {
  hb: new AR.HandBall(),
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  useSkin: true, // matches the pre-selected Skin swatch in the markup
  raf: 0, live: false, clock: null,
  params: function() {
    return {
      g: readGravity("hold-gravity", "hold-g-custom"),
      h: numberIn("hold-height", 0.2, 50, 2),
      tol: parseFloat($("hold-tol").value) || 80,
      motion: $("hold-motion").checked,
      // Release line (fraction of frame height): lift the ball above it to drop.
      dropLine: $("hold-line").checked ? numberIn("hold-linepos", 5, 90, 20) / 100 : null
    };
  },
  loop: function(now) {
    var self = this;
    if (!self.live) return;
    self.raf = requestAnimationFrame(function(n) { self.loop(n); });
    var hb = self.hb;
    if ($("mode-hold").hidden) {
      // Idle while hidden, and stay calm so a jump can't fake a throw.
      hb.calm(now);
      return;
    }
    var p = self.params();
    var video = $("hold-video");
    // Track the hand once per camera frame; animate the fall every frame.
    if (self.clock.next(now)) {
      var ev = hb.track(now, p, function(motion, pref) {
        return self.tracker.locate(video, {
          target: self.target, tol: p.tol, skin: self.useSkin,
          motion: motion, ignoreBlue: $("hold-blue").checked, pref: pref
        });
      });
      if (ev) self.report(ev);
    }
    var landed = hb.tick(now);
    if (landed) self.report(landed);
    var cv = $("hold-overlay");
    R.drawHandScene(cv.getContext("2d"), R.fitCanvas(cv), hb, {
      h: p.h, dropLine: p.dropLine, tracker: $("hold-mask").checked ? self.tracker : null
    });
    $("ro-h-y").textContent = hb.fix ? hb.yM.toFixed(2) + " m" : "—";
    $("ro-h-v").textContent = hb.fix ? hb.speed().toFixed(1) + " f/s" : "—";
    $("ro-h-t").textContent = hb.t.toFixed(3) + " s";
    var g = hb.falling || hb.landed ? hb.g : p.g;
    $("ro-h-theory").textContent = hb.fix || hb.falling || hb.landed ?
      K.fallTime(Math.max(0.01, hb.dropHeight()), g).toFixed(3) + " s" : "—";
  },
  /* Turn a HandBall event into a status line. */
  report: function(ev) {
    var st = $("hold-status");
    if (ev.type === "landed") {
      var fromRest = this.hb.v0 > 0 ? " (thrown at " + this.hb.v0.toFixed(1) + " m/s)" : "";
      setStatus(st, "Landed in " + ev.t.toFixed(3) + " s from " + ev.h0.toFixed(2) + " m" + fromRest +
        " — from rest it would take " + K.fallTime(ev.h0, this.hb.g).toFixed(3) + " s. Press Hold again to pick it up.", "ok");
    } else if (ev.type === "lost") {
      setStatus(st, "Hand lost — move it back into view.", "");
    } else if (ev.type === "released") {
      setStatus(st, ev.how === "drag" && ev.v0 > 0.5
        ? "Thrown downward at " + ev.v0.toFixed(1) + " m/s from " + ev.h0.toFixed(2) + " m!"
        : "Released from " + ev.h0.toFixed(2) + " m!", "");
    } else if (ev.type === "refused") {
      setStatus(st, ev.reason === "landed"
        ? "Ball is on the ground — press Hold again to pick it up."
        : "No hand found — wave your hand into view first.", "err");
    }
  },
  release: function() {
    var p = this.params();
    var ev = this.hb.drop(performance.now(), p.g, 0, "button", p.h);
    if (ev) this.report(ev);
  },
  pickUp: function() {
    var had = this.hb.pickUp();
    setStatus($("hold-status"), had ? "Holding — move your hand, then Release." : "Move your hand into view.", "");
  },
  stopLoop: function() {
    this.live = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    var cv = $("hold-overlay");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },
  setColorMode: function(skin, target) {
    this.useSkin = skin;
    if (target) this.target = target;
    $("hold-tol").disabled = skin;
    this.hb.forgetLock(); // re-acquire under the new mode
  },
  init: function() {
    var self = this;
    var pane = $("mode-hold");
    self.hb.ball = R.makeBall(ballStyle($("hold-ball")));
    $("hold-ball").addEventListener("change", function() {
      self.hb.ball = R.makeBall(ballStyle($("hold-ball")));
      remember("ball", self.hb.ball.style);
    });
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        var name = sw.getAttribute("data-color");
        if (name === "skin") {
          self.setColorMode(true);
          setStatus($("hold-status"), "Skin mode — no click needed. Keep the hand moving.", "ok");
        } else {
          self.setColorMode(false, AR.colorPreset(name));
          setStatus($("hold-status"), "Tracking " + name + " — or click your hand in the video.", "");
        }
      });
    });
    $("btn-hold-cam").addEventListener("click", function() {
      openCamera($("hold-video"), $("hold-status")).then(function() {
        R.fitCanvas($("hold-overlay"));
        if (!self.live) {
          self.live = true;
          self.tracker.reset();
          self.clock = new AR.FrameClock($("hold-video"));
          self.clock.start();
          self.hb.start(performance.now());
          self.raf = requestAnimationFrame(function(n) { self.loop(n); });
        }
        self.pickUp();
      }, function() {});
    });
    // Another mode took the camera: stop tracking a dead feed.
    camera.onChange(function(live) {
      if (self.live && live !== $("hold-video")) self.stopLoop();
    });
    $("hold-video").addEventListener("click", function(e) {
      var video = $("hold-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { setStatus($("hold-status"), "Could not sample that pixel.", "err"); return; }
      self.setColorMode(false, c);
      selectSwatch(pane, null);
      setStatus($("hold-status"),
        "Sampled rgb(" + c.r + "," + c.g + "," + c.b + ") — move your hand, the ball follows.", "ok");
    });
    $("btn-hold-drop").addEventListener("click", function() { self.release(); });
    $("btn-hold-reset").addEventListener("click", function() { self.pickUp(); });
    restoreSettings(HOLD_SETTINGS);
    $("hold-g-custom").disabled = $("hold-gravity").value !== "custom";
    HOLD_SETTINGS.forEach(function(pair) {
      $(pair[0]).addEventListener("input", function() {
        $("hold-g-custom").disabled = $("hold-gravity").value !== "custom";
        saveSettings(HOLD_SETTINGS);
      });
    });
    onSpace("mode-hold", function() { self.release(); });
  }
};

export { Hold };
