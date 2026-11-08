/* AR Physics Lab — page wiring for Exp 01 (free-fall gravity).
 * Reads lab.html's controls, drives the engine in core/ and writes results
 * back to the page. Camera, tracking, rendering and physics live in the
 * core; this file is the only one that knows element ids. */
import * as AR from "../core/index.js";

var K = AR, R = AR.render;
var camera = new AR.Camera();

// Globals for the console and older callers.
window.ARCore = AR;
window.PhysLab = {
  fallTime: K.fallTime, gravityFromDrop: K.gravityFromDrop,
  mean: K.mean, std: K.std, fitGravity: K.fitGravity, fitFreeFall: K.fitFreeFall,
  colorDistSq: AR.colorDistSq
};

/* ---------- small page helpers ---------- */
function $(id) { return document.getElementById(id); }
function setStatus(el, msg, cls) {
  if (!el) return;
  el.textContent = msg;
  el.className = "phys-status" + (cls ? " " + cls : "");
}
function numberIn(id, min, max, fallback) {
  return Math.min(max, Math.max(min, parseFloat($(id).value) || fallback));
}
/* Planet preset select + "Custom…" number input → g in m/s². */
function readGravity(selectId, customId) {
  var preset = $(selectId);
  var g = preset.value === "custom" ? parseFloat($(customId).value) || 9.81 : parseFloat(preset.value);
  return g > 0 ? g : 9.81;
}
/* Space bar runs fn while pane is visible and focus isn't on a control. */
function onSpace(paneId, fn) {
  document.addEventListener("keydown", function(e) {
    if (e.code !== "Space" || $(paneId).hidden) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    fn();
  });
}
function selectSwatch(pane, sw) {
  pane.querySelectorAll(".swatch").forEach(function(o) { o.classList.toggle("selected", o === sw); });
}

/* ---------- saved settings (this browser only) ---------- */
function remember(key, value) {
  try { localStorage.setItem("physlab_" + key, value); } catch (e) {}
}
function recall(key) {
  try { return localStorage.getItem("physlab_" + key); } catch (e) { return null; }
}
/* pairs: [[elementId, storageKey], ...] */
function restoreSettings(pairs) {
  pairs.forEach(function(pair) {
    var v = recall(pair[1]);
    if (v !== null && v !== "" && $(pair[0])) $(pair[0]).value = v;
  });
}
function saveSettings(pairs) {
  pairs.forEach(function(pair) { remember(pair[1], $(pair[0]).value); });
}
/* Ball style from the select, falling back to the saved choice. */
function ballStyle(sel) {
  var s = R.isBallStyle(sel.value) ? sel.value : recall("ball");
  if (!R.isBallStyle(s)) s = "tennis";
  sel.value = s;
  return s;
}

/* ---------- camera ---------- */
function openCamera(video, statusEl) {
  return camera.start(video).then(function() {
    setStatus(statusEl, "Camera on — video stays on this device.", "ok");
  }, function(err) {
    if (err && err.name === "AbortError") throw err; // a newer camera request took over
    var msg = "Camera blocked — simulation still works without it.";
    if (err && err.name === "NoCameraApi") msg = "Camera API not available in this browser.";
    else if (err && err.name === "NotFoundError") msg = "No camera found on this device.";
    else if (err && err.name === "NotAllowedError") msg = "Camera permission denied — simulation still works without it.";
    setStatus(statusEl, msg, "err");
    throw err;
  });
}
// Show the "camera off" hint on every stage except the live one.
camera.onChange(function(live) {
  document.querySelectorAll("#phys-lab .stage").forEach(function(st) {
    st.classList.toggle("cam-on", !!live && st.querySelector("video") === live);
  });
});

/* ---------- mode tabs ---------- */
function initTabs() {
  var btns = Array.prototype.slice.call(document.querySelectorAll(".phys-mode-btn"));
  btns.forEach(function(btn) {
    btn.addEventListener("click", function() {
      var mode = btn.getAttribute("data-mode");
      btns.forEach(function(b) {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
        var pane = $(b.getAttribute("data-mode"));
        if (pane) pane.hidden = b !== btn;
      });
      if (mode === "mode-simulate") Sim.resize();
    });
  });
}

/* ---------- MODE 1: AR simulate ---------- */
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

/* ---------- MODE 2: measure g with a stopwatch ---------- */
var Measure = {
  trials: [],
  t0: 0, timing: false,
  load: function() {
    try { this.trials = JSON.parse(recall("trials") || "[]"); }
    catch (e) { this.trials = []; }
    if (!Array.isArray(this.trials)) this.trials = [];
    // Drop corrupt entries so one bad write can't break rendering.
    this.trials = this.trials.filter(function(tr) {
      return tr && isFinite(tr.h) && isFinite(tr.t) && isFinite(tr.g);
    });
  },
  save: function() { remember("trials", JSON.stringify(this.trials)); },
  toggle: function() {
    if (!this.timing) {
      this.timing = true;
      this.t0 = performance.now();
      $("btn-timer").innerHTML = '<i class="fa-solid fa-stop"></i> Stop (impact)';
      setStatus($("m-status"), "Timing… stop on impact. Spacebar works too.", "");
      return;
    }
    var t = (performance.now() - this.t0) / 1000;
    this.timing = false;
    $("btn-timer").innerHTML = '<i class="fa-solid fa-play"></i> Start (release)';
    if (!(t > 0.05 && t < 30)) {
      setStatus($("m-status"), "That reading looks off — try again.", "err");
      return;
    }
    var h = numberIn("m-height", 0.05, 50, 1);
    var g = K.gravityFromDrop(h, t);
    this.trials.push({ h: h, t: t, g: g });
    this.save(); this.render();
    setStatus($("m-status"), "Trial " + this.trials.length + ": t = " + t.toFixed(3) +
      " s → g = " + g.toFixed(2) + " m/s².", "ok");
  },
  clear: function() {
    this.trials = [];
    this.save(); this.render();
    setStatus($("m-status"), "Trials cleared.", "");
  },
  exportCSV: function() {
    if (!this.trials.length) {
      setStatus($("m-status"), "No trials to export yet.", "err");
      return;
    }
    var lines = ["trial,height_m,time_s,g_ms2"];
    this.trials.forEach(function(tr, i) {
      lines.push([i + 1, tr.h.toFixed(3), tr.t.toFixed(4), tr.g.toFixed(3)].join(","));
    });
    var blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gravity-trials.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    setStatus($("m-status"), "Exported " + this.trials.length + " trial(s) to gravity-trials.csv.", "ok");
  },
  render: function() {
    var tb = $("m-rows");
    tb.innerHTML = "";
    this.trials.forEach(function(tr, i) {
      var row = document.createElement("tr");
      row.innerHTML = "<td>" + (i + 1) + "</td><td>" + tr.h.toFixed(2) + "</td><td>" +
        tr.t.toFixed(3) + "</td><td>" + tr.g.toFixed(2) + "</td>" +
        '<td><button type="button" class="row-del" data-del="' + i +
        '" aria-label="Delete trial ' + (i + 1) + '">✕</button></td>';
      tb.appendChild(row);
    });
    var box = $("m-stats");
    if (!this.trials.length) {
      box.innerHTML = "No trials yet — drop a ball from a measured height and time the fall.";
      return;
    }
    var gs = this.trials.map(function(tr) { return tr.g; });
    var m = K.mean(gs), err = K.percentError(m);
    box.innerHTML = "Mean g = <strong>" + m.toFixed(2) + " m/s²</strong>" +
      (gs.length > 1 ? " ± " + K.std(gs).toFixed(2) : "") +
      " &nbsp;·&nbsp; median " + K.median(gs).toFixed(2) +
      " &nbsp;·&nbsp; error vs 9.81: <strong>" + (err >= 0 ? "+" : "") + err.toFixed(1) + "%</strong>" +
      " &nbsp;·&nbsp; n = " + gs.length;
  },
  init: function() {
    var self = this;
    this.load(); this.render();
    $("btn-timer").addEventListener("click", function() { self.toggle(); });
    $("btn-m-clear").addEventListener("click", function() { self.clear(); });
    $("btn-m-export").addEventListener("click", function() { self.exportCSV(); });
    $("m-rows").addEventListener("click", function(e) {
      var btn = e.target.closest ? e.target.closest("[data-del]") : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute("data-del"), 10);
      if (!(i >= 0 && i < self.trials.length)) return;
      self.trials.splice(i, 1);
      self.save(); self.render();
      setStatus($("m-status"), "Trial deleted.", "");
    });
    onSpace("mode-measure", function() { self.toggle(); });
  }
};

/* ---------- lab event log (feeds the assistant, never leaves device) ---------- */
var LabLog = {
  failures: [],
  lastFit: null,
  push: function(kind, detail) {
    this.failures.push({ kind: kind, detail: detail, at: new Date().toLocaleTimeString() });
    if (this.failures.length > 5) this.failures.shift();
  }
};

/* ---------- MODE 3: auto-track a real falling ball ---------- */
var Track = {
  tracker: new AR.ColorTracker(),
  target: AR.colorPreset("red"),
  recording: false, samples: [], raf: 0, clock: null,
  loop: function() {
    var self = this;
    if (!self.recording) return;
    self.raf = requestAnimationFrame(function() { self.loop(); });
    var frame = self.clock.next(performance.now());
    if (!frame) return; // no new camera frame since last time
    var c = self.tracker.locate($("track-video"), {
      target: self.target, tol: parseFloat($("track-tol").value) || 80
    });
    var cv = $("track-overlay");
    var dims = R.fitCanvas(cv);
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (c) {
      self.samples.push({ t: frame.time / 1000, y: c.y });
      R.drawTrackMarker(ctx, dims, c);
    }
    $("track-count").textContent = String(self.samples.length);
  },
  start: function() {
    var video = $("track-video");
    if (camera.liveVideo() !== video) {
      setStatus($("track-status"), "Open the camera first.", "err");
      return;
    }
    this.samples = [];
    this.recording = true;
    this.tracker.reset();
    this.clock = new AR.FrameClock(video);
    this.clock.start();
    $("btn-track-rec").innerHTML = '<i class="fa-solid fa-stop"></i> Stop & fit';
    setStatus($("track-status"), "Recording — drop the ball through the frame.", "");
    this.loop();
  },
  cancel: function() {
    this.recording = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.clock) this.clock.stop();
    $("btn-track-rec").innerHTML = '<i class="fa-solid fa-circle"></i> Record fall';
  },
  stop: function() {
    this.cancel();
    this.fit();
  },
  toggle: function() { if (this.recording) this.stop(); else this.start(); },
  fit: function() {
    var h = numberIn("track-height", 0.05, 50, 1);
    // Scale is in camera pixels; blank means the full frame spans h.
    var pxPerM = parseFloat($("track-scale").value);
    var frameH = $("track-video").videoHeight;
    var frameHeightM = pxPerM > 0 && frameH > 0 ? frameH / pxPerM : h;
    var res = AR.analyzeFall(this.samples, { frameHeightM: frameHeightM });
    if (!res.ok) {
      setStatus($("track-status"), res.error, "err");
      LabLog.push("auto-track", res.detail);
      return;
    }
    var fit = res.fit, err = K.percentError(fit.g);
    LabLog.lastFit = { g: fit.g, gStdErr: fit.gStdErr, rmse: fit.rmse, n: res.points.length,
      span: res.span, h: h, fps: res.fps, rejected: res.rejected };
    setStatus($("track-status"), "g ≈ " + fit.g.toFixed(2) + " ± " + fit.gStdErr.toFixed(2) +
      " m/s² from " + res.points.length + " points (" + res.span.toFixed(2) + " s at " +
      Math.round(res.fps) + " fps" + (res.rejected ? ", " + res.rejected + " outlier(s) ignored" : "") +
      ", v0 ≈ " + fit.v0.toFixed(2) + " m/s, RMSE " + (fit.rmse * 100).toFixed(1) + " cm, " +
      (err >= 0 ? "+" : "") + err.toFixed(1) + "% vs 9.81).", "ok");
    var cv = $("track-plot");
    R.drawFitPlot(cv.getContext("2d"), R.fitCanvas(cv), res.points, fit);
  },
  init: function() {
    var self = this;
    var pane = $("mode-track");
    pane.querySelectorAll(".swatch").forEach(function(sw) {
      sw.addEventListener("click", function() {
        selectSwatch(pane, sw);
        self.target = AR.colorPreset(sw.getAttribute("data-color"));
        setStatus($("track-status"), "Tracking " + sw.getAttribute("data-color") + " — or click the video to sample.", "");
      });
    });
    restoreSettings([["track-height", "track-h"]]);
    $("track-height").addEventListener("input", function() { remember("track-h", $("track-height").value); });
    $("btn-track-cam").addEventListener("click", function() {
      openCamera($("track-video"), $("track-status")).then(function() {
        R.fitCanvas($("track-overlay"));
      }, function() {});
    });
    camera.onChange(function(live) {
      if (self.recording && live !== $("track-video")) {
        self.cancel();
        setStatus($("track-status"), "Camera moved to another mode — recording stopped.", "err");
      }
    });
    $("track-video").addEventListener("click", function(e) {
      var video = $("track-video");
      if (!video.srcObject || !video.videoWidth) return;
      var c = self.tracker.sampleAtPoint(video, e.clientX, e.clientY);
      if (!c) { setStatus($("track-status"), "Could not sample that pixel.", "err"); return; }
      self.target = c;
      selectSwatch(pane, null);
      setStatus($("track-status"),
        "Sampled color rgb(" + c.r + "," + c.g + "," + c.b + ") — press Record fall.", "ok");
    });
    $("btn-track-rec").addEventListener("click", function() { self.toggle(); });
    $("btn-track-clear").addEventListener("click", function() {
      self.cancel();
      self.samples = [];
      $("track-count").textContent = "0";
      var cv = $("track-plot");
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      setStatus($("track-status"), "Cleared.", "");
    });
    onSpace("mode-track", function() { self.toggle(); });
  }
};

/* ---------- MODE 4: hand-held ball ---------- */
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

/* ---------- shared Ollama chat helper (local only) ---------- */
function ollamaChat(endpoint, model, messages) {
  return fetch(endpoint + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model, stream: false, messages: messages })
  }).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function(data) {
    return ((data && data.message && data.message.content) || "").trim();
  }).catch(function(err) {
    var msg = String((err && err.message) || err);
    if (msg.indexOf("Failed to fetch") !== -1 || msg.indexOf("NetworkError") !== -1) {
      msg = "Ollama not reachable — run `ollama serve` on this machine.";
    } else if (msg.indexOf("404") !== -1) {
      msg += " — pull the model first: `ollama pull " + model + "`";
    }
    throw new Error(msg);
  });
}

/* ---------- lab assistant: local LLM interprets, never measures ---------- */
var Assistant = {
  busy: false,
  endpoint: function() {
    return (($("hold-ollama") && $("hold-ollama").value) || "http://localhost:11434").trim().replace(/\/+$/, "");
  },
  model: function() {
    return (($("hold-model") && $("hold-model").value) || "gemma3:4b").trim();
  },
  // Text summary the model reasons over: trials, last fit, recent failures.
  contextText: function() {
    var lines = [];
    var tr = Measure.trials || [];
    if (tr.length) {
      var gs = tr.map(function(t) { return t.g; });
      lines.push("Stopwatch trials: n=" + tr.length +
        ", heights(m)=" + tr.map(function(t) { return t.h.toFixed(2); }).join(",") +
        ", times(s)=" + tr.map(function(t) { return t.t.toFixed(3); }).join(",") +
        ", g values=" + gs.map(function(g) { return g.toFixed(2); }).join(",") +
        ", mean g=" + K.mean(gs).toFixed(2) + " m/s^2.");
    } else {
      lines.push("Stopwatch trials: none yet.");
    }
    if (LabLog.lastFit) {
      var f = LabLog.lastFit;
      lines.push("Auto-track last fit: g=" + f.g.toFixed(2) + " ± " + f.gStdErr.toFixed(2) +
        " m/s^2 (1 sigma), camera " + Math.round(f.fps) + " fps, outliers ignored=" + f.rejected + ", RMSE=" +
        (f.rmse * 100).toFixed(1) + "cm, points=" + f.n + ", span=" +
        f.span.toFixed(2) + "s, drop height=" + f.h.toFixed(2) + "m.");
    } else {
      lines.push("Auto-track: no successful fit yet.");
    }
    if (LabLog.failures.length) {
      lines.push("Recent problems: " + LabLog.failures.map(function(x) {
        return x.kind + ": " + x.detail;
      }).join(" | "));
    }
    lines.push("Reference: true g is 9.81 m/s^2.");
    return lines.join("\n");
  },
  refreshContext: function() {
    var n = (Measure.trials || []).length;
    var f = LabLog.lastFit;
    $("lab-ctx").textContent = "Context: " + n + " stopwatch trial(s)" +
      (f ? ", last auto-track g=" + f.g.toFixed(2) + " m/s²" : ", no auto-track fit yet") +
      (LabLog.failures.length ? ", " + LabLog.failures.length + " recent problem(s)" : "") + ".";
  },
  say: function(text, cls) {
    $("ask-answer").textContent = text;
    setStatus($("ask-status"), cls === "err" ? "Assistant error." : "Assistant replied.", cls);
  },
  hasData: function() {
    return (Measure.trials || []).length > 0 || !!LabLog.lastFit || LabLog.failures.length > 0;
  },
  run: function(kind, userText, b64) {
    var self = this;
    if (self.busy) return;
    if ((kind === "diagnose" || kind === "results") && !self.hasData()) {
      self.say("Nothing to " + (kind === "diagnose" ? "diagnose" : "explain") +
        " yet — run a stopwatch trial or an auto-tracked fall first.", "err");
      return;
    }
    var prompt;
    var ctx = self.contextText();
    if (kind === "setup") {
      prompt = "You are a physics-lab assistant looking at a webcam frame of a free-fall " +
        "experiment setup (camera pointed at a room/wall where a ball will be dropped or held). " +
        "Rate the setup 1-5 and give at most 3 concrete fixes (lighting, background clutter, " +
        "camera framing, ball visibility). Under 120 words.";
    } else if (kind === "diagnose") {
      prompt = "You are a physics-lab assistant. Diagnose why the student's recent gravity " +
        "measurement(s) failed or look off, using ONLY this log — do not recompute anything, " +
        "interpret the given numbers. End with the single most useful next step. Under 150 words.\n" + ctx;
    } else if (kind === "results") {
      prompt = "You are a physics-lab assistant. Given these free-fall measurements, explain " +
        "the error versus 9.81 m/s^2, name the most likely error sources in order (human reaction " +
        "time ~0.15s, height mismeasurement, air drag, tracking noise), and suggest one concrete " +
        "next trial. Do not recompute — interpret the given numbers. Under 150 words.\n" + ctx;
    } else {
      prompt = "You are a physics-lab assistant helping with a ball-drop gravity experiment. " +
        "Current results:\n" + ctx + "\nStudent question: " + userText;
    }
    self.busy = true;
    setStatus($("ask-status"), "Assistant thinking…", "");
    var msg = { role: "user", content: prompt };
    if (b64) msg.images = [b64];
    ollamaChat(self.endpoint(), self.model(), [msg]).then(function(text) {
      self.busy = false;
      self.say(text || "(empty reply)");
    }).catch(function(err) {
      self.busy = false;
      self.say("Error: " + err.message, "err");
    });
  },
  init: function() {
    var self = this;
    var saved = recall("ollama");
    if (saved) $("hold-ollama").value = saved;
    $("hold-ollama").addEventListener("change", function() { remember("ollama", self.endpoint()); });
    self.refreshContext();
    setInterval(function() { self.refreshContext(); }, 3000);
    $("btn-ask-setup").addEventListener("click", function() {
      var b64 = camera.snapshot(512, 0.72);
      if (!b64) { self.say("Error: open any lab camera first (Simulate, Auto-track, or Hand-hold).", "err"); return; }
      self.run("setup", null, b64);
    });
    $("btn-ask-diagnose").addEventListener("click", function() { self.run("diagnose"); });
    $("btn-ask-results").addEventListener("click", function() { self.run("results"); });
    function send() {
      var q = $("ask-input").value.trim();
      if (!q || self.busy) return;
      self.run("ask", q);
    }
    $("btn-ask-send").addEventListener("click", send);
    $("ask-input").addEventListener("keydown", function(e) {
      if (e.key === "Enter") send();
    });
  }
};

/* ---------- boot ---------- */
/* The markup may be injected after load (see loader.js), so boot now if the
 * DOM is already parsed. */
function boot() {
  if (!$("phys-lab")) return;
  initTabs();
  Sim.init();
  Measure.init();
  Track.init();
  Hold.init();
  Assistant.init();
  window.addEventListener("beforeunload", function() { camera.stopAll(); });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
