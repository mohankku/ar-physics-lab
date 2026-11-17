/* Test bench: the real lab, with a simulated camera.
 *
 * getUserMedia is replaced by a canvas stream that draws a red ball doing
 * a drop, a throw or a pendulum swing with known physics. Every lab mode
 * works unchanged on it, so you can try the whole flow without a ball, and
 * "Run checks" drives the page end to end and grades what the lab measures
 * against the truth. "Use my real camera" (or ?camera=real) passes Open
 * camera through to the real webcam instead. Must load before
 * ../../loader.js (the lab grabs the camera API when it boots). */
import { makeScene, defaultParams, HOLD_S } from "./scene.js";
import { LabLog } from "../../lab/lablog.js";

var CW = 640, CH = 480;

/* ---------- simulated camera ---------- */
var canvas = document.createElement("canvas");
canvas.width = CW; canvas.height = CH;
canvas.className = "bench-preview";
var ctx = canvas.getContext("2d");
var tracks = [];

function fakeGetUserMedia(constraints) {
  if (state.real) {
    var req = realGetUserMedia ? realGetUserMedia(constraints)
      : Promise.reject(Object.assign(new Error("This page has no camera API"), { name: "NoCameraApi" }));
    return req.then(function(stream) {
      showCameraError(null);
      return stream;
    }, function(err) {
      showCameraError(err);
      throw err;
    });
  }
  var stream = canvas.captureStream(0);
  var track = stream.getVideoTracks()[0];
  if (!track || typeof track.requestFrame !== "function") {
    stream = canvas.captureStream(state.fps); // browser paces frames itself
    track = null;
  }
  if (track) tracks.push(track);
  draw(performance.now());
  return Promise.resolve(stream);
}
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
}
var realGetUserMedia = navigator.mediaDevices.getUserMedia
  ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
navigator.mediaDevices.getUserMedia = fakeGetUserMedia;

/* ---------- scene state ---------- */
var state = {
  kind: "hold", params: defaultParams(), scene: null, goAt: null,
  fps: 30, noise: true, blur: true, lastDraw: 0, runningChecks: false,
  real: /[?&]camera=real\b/.test(location.search)  // pass Open camera to the webcam
};
function rebuild() {
  state.scene = makeScene(state.kind, state.params);
  state.goAt = null;
  showTruth();
}
function go() {
  state.scene = makeScene(state.kind, state.params); // fresh pendulum integrator
  state.goAt = performance.now();
}

function gauss() { // ~N(0, 1)
  var s = 0;
  for (var i = 0; i < 6; i++) s += Math.random();
  return (s - 3) * Math.SQRT2;
}

function ball(x, y, r, alpha) {
  var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#ec5f64");
  g.addColorStop(1, "#c8383e");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
  ctx.globalAlpha = 1;
}

function draw(now) {
  var p = state.params, k = CH / p.frameH;
  // Wall, with soft light from the top-left, and a floor strip.
  var wall = ctx.createLinearGradient(0, 0, CW, CH);
  wall.addColorStop(0, "#f4f5f2");
  wall.addColorStop(1, "#dcdfdc");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = "#b9b4aa";
  ctx.fillRect(0, CH * 0.97, CW, CH * 0.03);
  var t = state.goAt == null ? 0 : (now - state.goAt) / 1000;
  // Faint 25 cm grid, a meter ruler, and a live label: shows at a glance
  // that this is the simulated feed, that it's updating, and its scale.
  ctx.strokeStyle = "rgba(60,70,80,0.12)";
  ctx.lineWidth = 1;
  for (var m = 0.25; m * k < CW; m += 0.25) {
    ctx.beginPath(); ctx.moveTo(m * k, 0); ctx.lineTo(m * k, CH); ctx.stroke();
    if (m * k < CH) { ctx.beginPath(); ctx.moveTo(0, m * k); ctx.lineTo(CW, m * k); ctx.stroke(); }
  }
  ctx.fillStyle = "rgba(40,48,56,0.75)";
  ctx.font = "12px system-ui, sans-serif";
  for (var mm = 0.5; mm * k < CH - 10; mm += 0.5) ctx.fillText(mm.toFixed(1) + " m", 4, mm * k - 3);
  state.frames = (state.frames || 0) + 1;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText("SIMULATED CAMERA · " + state.kind + " · frame " + state.frames +
    (state.goAt == null ? " · press Go" : " · t = " + t.toFixed(2) + " s"), 60, 20);
  var r = p.d / 2 * k;
  var jx = state.noise ? 0.5 * gauss() : 0, jy = state.noise ? 0.5 * gauss() : 0;
  // Motion blur: the shutter stays open ~8 ms, so draw the path across it.
  var steps = state.blur && state.goAt != null ? 5 : 1, E = 0.008;
  for (var i = steps - 1; i >= 0; i--) { // oldest first: the pendulum only steps forward
    var pose = state.scene.at(Math.max(0, t - E * i / Math.max(1, steps - 1)));
    if (i === 0 && pose.pivot) {
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(pose.pivot.x * k - 60, pose.pivot.y * k - 8, 120, 8);
      ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pose.pivot.x * k, pose.pivot.y * k);
      ctx.lineTo(pose.x * k + jx, pose.y * k + jy);
      ctx.stroke();
    }
    if (pose.visible) ball(pose.x * k + jx, pose.y * k + jy, r, steps > 1 ? 0.45 : 1);
  }
  // Once the ball has left the frame for a while, bring it back to the start,
  // so the feed is never just an empty wall.
  if (state.goAt != null && !pose.visible) {
    if (state.goneSince == null) state.goneSince = now;
    else if (now - state.goneSince > 1500) { state.goneSince = null; rebuild(); }
  } else {
    state.goneSince = null;
  }
  tracks = tracks.filter(function(tr) { return tr.readyState === "live"; });
  tracks.forEach(function(tr) { tr.requestFrame(); });
}

function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  if (now - state.lastDraw < 1000 / state.fps - 3) return;
  state.lastDraw = now;
  draw(performance.now()); // the frame is stamped now, so place the ball for now
}

/* ---------- panel ---------- */
var FIELDS = [
  // [id, label, get(params), set(params, v), step, group]
  ["g", "g (m/s²)", function(p) { return p.g; }, function(p, v) { p.g = v; }, 0.01, "all"],
  ["frameH", "Frame height (m)", function(p) { return p.frameH; }, function(p, v) { p.frameH = v; }, 0.05, "all"],
  ["d", "Ball diameter (cm)", function(p) { return p.d * 100; }, function(p, v) { p.d = v / 100; }, 0.1, "all"],
  ["speed", "Speed (m/s)", function(p) { return p.throw.speed; }, function(p, v) { p.throw.speed = v; }, 0.1, "throw"],
  ["angle", "Angle (°)", function(p) { return p.throw.angleDeg; }, function(p, v) { p.throw.angleDeg = v; }, 1, "throw"],
  ["push", "Hand push (ms)", function(p) { return p.throw.pushS * 1000; }, function(p, v) { p.throw.pushS = v / 1000; }, 10, "throw"],
  ["dip", "Wind-up dip (cm)", function(p) { return p.throw.dip * 100; }, function(p, v) { p.throw.dip = v / 100; }, 1, "throw"],
  ["string", "String (cm, to ball top)", function(p) { return p.pend.stringM * 100; }, function(p, v) { p.pend.stringM = v / 100; }, 1, "pendulum"],
  ["amp", "Amplitude (°)", function(p) { return p.pend.ampDeg; }, function(p, v) { p.pend.ampDeg = v; }, 1, "pendulum"],
  ["q", "Damping Q", function(p) { return p.pend.Q; }, function(p, v) { p.pend.Q = v; }, 10, "pendulum"]
];

var panel;
function q(sel) { return panel.querySelector(sel); }

function buildPanel() {
  panel = document.createElement("aside");
  panel.className = "bench";
  panel.setAttribute("aria-label", "Test bench");
  panel.innerHTML =
    '<div class="bench-head"><strong><i class="fa-solid fa-vial"></i> Test bench</strong>' +
    '<button type="button" class="bench-fold" aria-expanded="true" title="Hide or show">–</button></div>' +
    '<div class="bench-body">' +
    '<label class="bench-real"><input type="checkbox" data-k="real"> Use my real camera</label>' +
    '<p class="bench-note" data-out="mode-note"></p>' +
    '<p class="bench-error" data-out="cam-error" role="alert" hidden></p>' +
    '<div class="bench-sim"><div class="bench-preview-wrap"></div>' +
    '<div class="bench-grid">' +
    '<label>Scene<select data-k="kind"><option value="hold">Ball held still</option><option value="drop">Drop (Exp 01)</option>' +
    '<option value="throw">Throw (Exp 02)</option><option value="pendulum">Pendulum (Exp 03)</option></select></label>' +
    '<label data-group="throw">Direction<select data-k="dir"><option value="1">→ right</option><option value="-1">← left</option></select></label>' +
    FIELDS.map(function(f) {
      return '<label data-group="' + f[5] + '">' + f[1] + '<input type="number" step="' + f[4] + '" data-k="' + f[0] + '"></label>';
    }).join("") +
    '<label>Camera fps<select data-k="fps"><option value="30">30</option><option value="60">60</option></select></label>' +
    '<label class="bench-check"><input type="checkbox" data-k="noise"> Sensor jitter</label>' +
    '<label class="bench-check"><input type="checkbox" data-k="blur"> Motion blur</label>' +
    '</div>' +
    '<div class="bench-btns"><button type="button" class="pub-btn" data-act="go"><i class="fa-solid fa-play"></i> Go</button>' +
    '<button type="button" class="pub-btn" data-act="reset"><i class="fa-solid fa-rotate-left"></i> Reset</button></div>' +
    '<div class="bench-box" data-out="truth"></div></div>' +
    '<div class="bench-btns"><button type="button" class="pub-btn" data-act="checks"><i class="fa-solid fa-list-check"></i> Run checks</button></div>' +
    '<div class="bench-box" data-out="lab"></div>' +
    '<div class="bench-box" data-out="checks" hidden></div>' +
    '</div>';
  document.body.appendChild(panel);
  q(".bench-preview-wrap").appendChild(canvas);
  writePanel();
  panel.addEventListener("input", onPanelInput);
  panel.addEventListener("change", onPanelInput);
  q('[data-act="go"]').addEventListener("click", go);
  q('[data-act="reset"]').addEventListener("click", rebuild);
  q('[data-act="checks"]').addEventListener("click", runChecks);
  q(".bench-fold").addEventListener("click", function() {
    var body = q(".bench-body"), open = body.hidden;
    body.hidden = !open;
    this.textContent = open ? "–" : "+";
    this.setAttribute("aria-expanded", String(open));
  });
}

function writePanel() {
  var p = state.params;
  q('[data-k="real"]').checked = state.real;
  q(".bench-sim").hidden = state.real;
  q('[data-out="mode-note"]').innerHTML = state.real
    ? "<em>Open camera</em> uses your webcam. Do the experiment for real; " +
      "<em>Lab measured</em> below shows the results. Untick to go back to the simulation."
    : "Every <em>Open camera</em> button in the lab shows this simulated scene instead of your camera.";
  q('[data-k="kind"]').value = state.kind;
  q('[data-k="dir"]').value = String(p.throw.dir);
  q('[data-k="fps"]').value = String(state.fps);
  q('[data-k="noise"]').checked = state.noise;
  q('[data-k="blur"]').checked = state.blur;
  FIELDS.forEach(function(f) {
    q('[data-k="' + f[0] + '"]').value = String(+f[2](p).toFixed(4));
  });
  showGroups();
}

function showGroups() {
  panel.querySelectorAll("[data-group]").forEach(function(el) {
    var g = el.getAttribute("data-group");
    el.hidden = !(g === "all" || g === state.kind);
  });
}

function onPanelInput(e) {
  var k = e.target.getAttribute("data-k");
  if (!k) return;
  if (k === "real") {
    if (e.type === "change") setReal(e.target.checked);
    return;
  }
  if (k === "kind") { state.kind = e.target.value; showGroups(); }
  else if (k === "dir") state.params.throw.dir = parseInt(e.target.value, 10);
  else if (k === "fps") state.fps = parseInt(e.target.value, 10);
  else if (k === "noise" || k === "blur") state[k] = e.target.checked;
  else {
    var f = FIELDS.filter(function(x) { return x[0] === k; })[0];
    var v = parseFloat(e.target.value);
    if (!f || !(v >= 0)) return;
    f[3](state.params, v);
  }
  if (e.type === "change" || k === "kind") rebuild();
}

var CAMERA_HELP = {
  NotAllowedError: "Permission denied. Allow the camera for localhost in the browser's site settings, " +
    "and check macOS System Settings → Privacy & Security → Camera for this browser.",
  NotReadableError: "The camera is busy or blocked by the system. Quit apps using it " +
    "(Zoom, FaceTime, Photo Booth…) and check macOS camera permission for this browser.",
  NotFoundError: "No camera found.",
  OverconstrainedError: "The camera can't provide the requested format.",
  NoCameraApi: "This browser exposes no camera API here (needs localhost or HTTPS)."
};
/* Show (or clear, with null) why the real camera didn't open. */
function showCameraError(err) {
  if (!panel) return;
  var el = q('[data-out="cam-error"]');
  if (!err) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = "Real camera failed: " + (err.name || "Error") + ". " +
    (CAMERA_HELP[err.name] || err.message || "");
}

/* Switch between the simulated and the real camera. If a lab camera is
 * open, reopen it through the same button so the switch shows at once. */
async function setReal(on) {
  if (state.real === on) return;
  state.real = on;
  writePanel();
  showCameraError(null);
  var ui = await import("../../lab/ui.js"); // the lab's own instance
  var live = ui.camera.liveVideo();
  var prefix = live && live.id.replace(/-video$/, "");
  var btn = prefix && document.getElementById("btn-" + prefix + "-cam");
  // Close the current feed first: the lab keeps a working camera when a new
  // request fails, which would leave the old feed up with no sign of why.
  ui.camera.stopAll();
  if (btn) btn.click();
}

function setKind(kind) {
  state.kind = kind;
  q('[data-k="kind"]').value = kind;
  showGroups();
  rebuild();
}

/* ---------- truth and lab readouts ---------- */
function fmt(v, d) { return v == null || !isFinite(v) ? "—" : v.toFixed(d); }

function truthRows() {
  var t = state.scene.truth, p = state.params;
  if (state.kind === "drop") {
    return [["g", fmt(t.g, 2) + " m/s²"], ["drop to frame bottom", fmt(t.dropM, 2) + " m"],
      ["lab setting", "Auto-track · ball size " + fmt(p.d * 100, 1) + " cm"]];
  }
  if (state.kind === "throw") {
    return [["g", fmt(t.g, 2) + " m/s²"], ["launch speed", fmt(t.speed, 2) + " m/s"],
      ["launch angle", fmt(t.angleDeg, 1) + "°"], ["vx (constant)", fmt(Math.abs(t.vx), 2) + " m/s"],
      ["peak height", fmt(t.apexM * 100, 0) + " cm"], ["range", fmt(t.rangeM, 2) + " m"],
      ["lab setting", "Exp 02 · ball size " + fmt(p.d * 100, 1) + " cm"]];
  }
  if (state.kind === "pendulum") {
    return [["g", fmt(t.g, 3) + " m/s²"], ["L (pivot to center)", fmt(t.L * 100, 1) + " cm"],
      ["period at " + fmt(t.ampDeg, 0) + "°", fmt(t.T, 4) + " s"], ["tiny-swing period T₀", fmt(t.T0, 4) + " s"],
      ["Q", fmt(t.Q, 0)],
      ["lab setting", "Exp 03 · string " + fmt(p.pend.stringM * 100, 1) + " cm, ball " + fmt(p.d * 100, 1) + " cm"]];
  }
  return [["", "A still ball: use it to try color sampling and Arm."]];
}

function table(title, rows) {
  return "<strong>" + title + "</strong><table>" + rows.map(function(r) {
    return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>";
  }).join("") + "</table>";
}

function showTruth() {
  if (panel) q('[data-out="truth"]').innerHTML = table("Truth (what the lab should find)", truthRows());
}

function diff(lab, truth) {
  if (!isFinite(lab) || !isFinite(truth) || !truth) return "";
  var d = (lab - truth) / Math.abs(truth) * 100;
  return ' <span class="bench-diff">(' + (d >= 0 ? "+" : "") + d.toFixed(1) + "%)</span>";
}

function showLab() {
  var t = state.scene.truth, rows = [];
  var same = function(kind) { return state.kind === kind; };
  if (LabLog.lastFit) rows.push(["drop g", fmt(LabLog.lastFit.g, 2) + (same("drop") ? diff(LabLog.lastFit.g, t.g) : "")]);
  var pr = LabLog.projectile;
  if (pr) {
    rows.push(["throw g", fmt(pr.g, 2) + (same("throw") ? diff(pr.g, t.g) : "")]);
    rows.push(["throw speed · angle", fmt(pr.speed, 2) + " m/s · " + fmt(pr.angleDeg, 1) + "°"]);
    rows.push(["throw vx", fmt(Math.abs(pr.vx), 2) + (same("throw") ? diff(Math.abs(pr.vx), Math.abs(t.vx)) : "")]);
  }
  var pe = LabLog.pendulum;
  if (pe) {
    rows.push(["pendulum g", fmt(pe.g, 3) + (same("pendulum") ? diff(pe.g, t.g) : "")]);
    rows.push(["pendulum T", fmt(pe.T, 4) + " s" + (same("pendulum") ? diff(pe.T, t.T) : "")]);
  }
  var last = LabLog.failures[LabLog.failures.length - 1];
  if (last) rows.push(["last failure", last.kind + ": " + last.detail]);
  q('[data-out="lab"]').innerHTML = table("Lab measured", rows.length ? rows : [["", "Nothing yet."]]);
}

/* ---------- end-to-end checks ---------- */
function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
async function waitFor(fn, ms, what) {
  var t0 = performance.now();
  while (performance.now() - t0 < ms) {
    var v = fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error("timed out waiting for " + what);
}
function setField(id, value) {
  var el = $(id);
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function setChecked(id, on) {
  if ($(id).checked !== on) $(id).click();
}
async function openCamera(prefix) {
  $(prefix + "-stage").scrollIntoView({ behavior: "smooth", block: "center" });
  $("btn-" + prefix + "-cam").click();
  await waitFor(function() {
    var v = $(prefix + "-video");
    return v.srcObject && v.readyState >= 2 && v.videoWidth;
  }, 5000, "the camera");
  await sleep(500);
}
/* Resolves with the lab's next result for `key`, or rejects on a failure. */
function nextResult(key, ms) {
  var before = LabLog[key], fail0 = LabLog.failures[LabLog.failures.length - 1];
  return waitFor(function() {
    var f = LabLog.failures[LabLog.failures.length - 1];
    if (f !== fail0) throw new Error(f.kind + ": " + f.detail);
    return LabLog[key] !== before && LabLog[key];
  }, ms, "a result");
}

function openExperiment(id) {
  document.querySelector('.phys-exp-card[data-exp="' + id + '"]').click();
}

var DRIVERS = {
  drop: async function(p) {
    openExperiment("exp-01");
    document.querySelector('.phys-mode-btn[data-mode="mode-track"]').click();
    setChecked("track-auto", true);
    setField("track-scale-mode", "ball");
    setField("track-ball-d", (p.d * 100).toFixed(1));
    $("btn-track-clear").click();
    await openCamera("track");
    var result = nextResult("lastFit", 12000);
    $("btn-track-rec").click(); // Arm
    await sleep(600);
    go();
    return result;
  },
  throw: async function(p) {
    openExperiment("exp-02");
    setChecked("proj-auto", true);
    setField("proj-scale-mode", "ball");
    setField("proj-ball-d", (p.d * 100).toFixed(1));
    $("btn-proj-clear").click();
    await openCamera("proj");
    var result = nextResult("projectile", 12000);
    $("btn-proj-rec").click(); // Arm
    await sleep(600);
    go();
    return result;
  },
  pendulum: async function(p) {
    openExperiment("exp-03");
    setField("pend-length", (p.pend.stringM * 100).toFixed(1));
    setField("pend-ball-d", (p.d * 100).toFixed(1));
    setField("pend-swings", "6");
    $("btn-pend-clear").click();
    await openCamera("pend");
    go();
    await sleep((HOLD_S + 0.5) * 1000); // let go, then start timing, as a person would
    var result = nextResult("pendulum", 40000);
    $("btn-pend-rec").click(); // Start
    return result;
  }
};

/* [quantity, lab value, truth, tolerance, "rel" (fraction) | "abs"] */
function grade(kind, res, t) {
  // Drop and throw g ride on the pixel scale: a tennis ball is only ~21 px
  // wide in a 1.5 m, 480 px frame, so ±0.5 px of edge is ±2.5% in g.
  // The pendulum barely uses the scale, so it is held to 1%.
  if (kind === "drop") return [["g (m/s²)", res.g, t.g, 0.05, "rel"]];
  if (kind === "throw") {
    return [["g (m/s²)", res.g, t.g, 0.05, "rel"], ["vx (m/s)", Math.abs(res.vx), Math.abs(t.vx), 0.05, "rel"],
      ["speed (m/s)", res.speed, t.speed, 0.08, "rel"], ["angle (°)", res.angleDeg, t.angleDeg, 4, "abs"]];
  }
  return [["g (m/s²)", res.g, t.g, 0.01, "rel"], ["T (s)", res.T, t.T, 0.005, "rel"]];
}

var CHECKS = [
  { name: "Drop, g = 9.81", kind: "drop", set: function(p) { p.g = 9.81; } },
  { name: "Drop on a smaller planet, g = 6", kind: "drop", set: function(p) { p.g = 6; } },
  { name: "Throw → at 60°, 3.5 m/s", kind: "throw",
    set: function(p) { p.g = 9.81; Object.assign(p.throw, { dir: 1, angleDeg: 60, speed: 3.5, dip: 0 }); } },
  { name: "Throw ← at 45° after a wind-up dip", kind: "throw",
    set: function(p) { p.g = 9.81; Object.assign(p.throw, { dir: -1, angleDeg: 45, speed: 3.2, dip: 0.06 }); } },
  { name: "Pendulum, 80 cm, 12° swing", kind: "pendulum",
    set: function(p) { p.g = 9.81; Object.assign(p.pend, { stringM: 0.8, ampDeg: 12 }); } },
  { name: "Pendulum, wide 25° swing", kind: "pendulum",
    set: function(p) { p.g = 9.81; Object.assign(p.pend, { stringM: 0.8, ampDeg: 25 }); } }
];

async function runChecks() {
  if (state.runningChecks) return;
  state.runningChecks = true;
  var btn = q('[data-act="checks"]'), out = q('[data-out="checks"]');
  btn.disabled = true;
  out.hidden = false;
  if (state.real) {
    state.real = false; // the checks grade against the simulation's known physics
    writePanel();
  }
  var lines = [], passed = 0;
  var render = function(current) {
    out.innerHTML = "<strong>Checks" + (current ? " — running: " + current : " — " + passed + "/" +
      CHECKS.length + " passed") + "</strong>" + lines.join("");
  };
  for (var i = 0; i < CHECKS.length; i++) {
    var c = CHECKS[i];
    render(c.name);
    c.set(state.params);
    setKind(c.kind);
    writePanel();
    var truth = state.scene.truth, html, ok;
    try {
      var res = await DRIVERS[c.kind](state.params);
      var rows = grade(c.kind, res, truth);
      ok = rows.every(function(r) {
        return Math.abs(r[1] - r[2]) <= (r[4] === "rel" ? r[3] * Math.abs(r[2]) : r[3]);
      });
      html = "<table>" + rows.map(function(r) {
        var good = Math.abs(r[1] - r[2]) <= (r[4] === "rel" ? r[3] * Math.abs(r[2]) : r[3]);
        return '<tr class="' + (good ? "ok" : "bad") + '"><td>' + r[0] + "</td><td>" + fmt(r[1], 3) +
          " vs " + fmt(r[2], 3) + "</td><td>±" + (r[4] === "rel" ? r[3] * 100 + "%" : r[3]) + "</td></tr>";
      }).join("") + "</table>";
    } catch (err) {
      ok = false;
      html = '<p class="bad">' + String(err && err.message || err) + "</p>";
    }
    if (ok) passed++;
    lines.push('<div class="bench-check-result"><span class="' + (ok ? "ok" : "bad") + '">' +
      (ok ? "✓ " : "✗ ") + c.name + "</span>" + html + "</div>");
    await sleep(800);
  }
  render(null);
  document.title = (passed === CHECKS.length ? "PASS " : "FAIL ") + passed + "/" + CHECKS.length + " · Test bench";
  btn.disabled = false;
  state.runningChecks = false;
}

/* ---------- boot ---------- */
function boot() {
  buildPanel();
  rebuild();
  setInterval(showLab, 500);
  requestAnimationFrame(frameLoop);
  if (/[?&]run=1\b/.test(location.search)) {
    // Wait for the lab to boot (the loader fetches its markup), then run.
    waitFor(function() { return $("btn-pend-rec"); }, 10000, "the lab").then(function() {
      setTimeout(runChecks, 500);
    });
  }
}
state.scene = makeScene(state.kind, state.params);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
