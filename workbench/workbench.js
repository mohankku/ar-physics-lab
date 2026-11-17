/* Physics Workbench — simulate from your own parameters. Step 1: a falling
 * object with air drag (core simulateFall). Recomputes on every edit. */
import * as AR from "../core/index.js";

var R = AR.render;
function $(id) { return document.getElementById(id); }

var PRESETS = {
  steel:    { m: 0.0642, shape: "sphere", size: 2.5 },
  tennis:   { m: 0.058, shape: "sphere", size: 6.7 },
  pingpong: { m: 0.0027, shape: "sphere", size: 4.0 },
  box:      { m: 0.5, shape: "cube (face first)", size: 30 },
  sheet:    { m: 0.005, shape: "flat plate (face first)", size: 25 } // ~A4, 21×29.7 cm
};
var SHEET_AREA_CM2 = 21 * 29.7;

/* Frontal area from the size across: a circle for round shapes, else a square. */
function areaFromSize(shape, cm) {
  var round = shape === "sphere" || shape === "cylinder (end-on)";
  return round ? Math.PI * cm * cm / 4 : cm * cm;
}

function num(id) { return parseFloat($(id).value); }

function params() {
  return {
    h: num("wb-h"), m: num("wb-m"), v0: num("wb-v0") || 0,
    cd: num("wb-cd") || 0, areaM2: (num("wb-area") || 0) / 1e4,
    g: num("wb-g"), rho: isFinite(num("wb-rho")) ? num("wb-rho") : AR.AIR_DENSITY
  };
}

function fmt(v, d) { return isFinite(v) ? v.toFixed(d) : "—"; }
function pct(a, b) { var p = (a - b) / b * 100; return (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(1) + "%"; }

var last = null;

function run() {
  var p = params(), r;
  try {
    r = AR.simulateFall(p);
  } catch (err) {
    $("wb-status").textContent = "Check the inputs: height, mass and g must be positive, and drag values not negative.";
    $("wb-status").className = "phys-status err";
    ["wb-r-t", "wb-r-v", "wb-r-e", "wb-r-vt"].forEach(function(id) { $(id).textContent = "—"; });
    ["wb-r-t2", "wb-r-v2", "wb-r-e2", "wb-r-vt2"].forEach(function(id) { $(id).textContent = ""; });
    ["wb-plot-v", "wb-plot-y"].forEach(function(id) {
      var cv = $(id); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    });
    last = null;
    return;
  }
  last = { p: p, r: r };
  $("wb-status").textContent = "";
  $("wb-r-t").textContent = fmt(r.landingTime, 3) + " s";
  $("wb-r-t2").textContent = "vacuum " + fmt(r.vacuumTime, 3) + " s (" + pct(r.landingTime, r.vacuumTime) + ")";
  $("wb-r-v").textContent = fmt(r.impactSpeed, 2) + " m/s";
  $("wb-r-v2").textContent = fmt(r.impactSpeed * 3.6, 1) + " km/h · vacuum " + fmt(r.vacuumImpact, 2) +
    " m/s (" + pct(r.impactSpeed, r.vacuumImpact) + ")";
  $("wb-r-e").textContent = fmt(r.impactEnergyJ, r.impactEnergyJ < 1 ? 3 : 1) + " J";
  $("wb-r-e2").textContent = "equal to a " + fmt(r.impactEnergyJ / (p.m * p.g), 2) + " m vacuum drop";
  $("wb-r-vt").textContent = isFinite(r.terminalSpeed) ? fmt(r.terminalSpeed, 2) + " m/s" : "none";
  $("wb-r-vt2").textContent = isFinite(r.terminalSpeed)
    ? "reached " + fmt(r.impactSpeed / r.terminalSpeed * 100, 0) + "% of it at impact"
    : "no air drag";
  plot(r, p);
}

function plot(r, p) {
  var n = r.t.length, tEnd = r.t[n - 1];
  var vac = function(t) { return p.v0 + p.g * t; };
  var vacY = function(t) { return p.v0 * t + 0.5 * p.g * t * t; };
  var tVac = r.vacuumTime;
  // Speed: drag curve, vacuum line (to its own landing), terminal speed.
  var vMax = Math.max(r.impactSpeed, r.vacuumImpact) * 1.08;
  var vMin = Math.min(0, p.v0);
  chart("wb-plot-v", [0, tEnd], [vMin, vMax], ["t (s)", "speed (m/s)"], function(A, ctx, dims) {
    line(ctx, dims, [[A.X(0), A.Y(vac(0))], [A.X(Math.min(tEnd, tVac)), A.Y(vac(Math.min(tEnd, tVac)))]], "#94a3b8", true);
    if (isFinite(r.terminalSpeed) && r.terminalSpeed < vMax) {
      line(ctx, dims, [[A.X(0), A.Y(r.terminalSpeed)], [A.X(tEnd), A.Y(r.terminalSpeed)]], "#d97706", true);
    }
    line(ctx, dims, r.t.map(function(t, i) { return [A.X(t), A.Y(r.v[i])]; }), "#1a56db", false);
  });
  chart("wb-plot-y", [0, tEnd], [0, p.h * 1.05], ["t (s)", "fallen (m)"], function(A, ctx, dims) {
    var pts = [];
    for (var i = 0; i <= 60; i++) { var t = Math.min(tEnd, tVac) * i / 60; pts.push([A.X(t), A.Y(vacY(t))]); }
    line(ctx, dims, pts, "#94a3b8", true);
    line(ctx, dims, r.t.map(function(t, i) { return [A.X(t), A.Y(r.y[i])]; }), "#1a56db", false);
  });
}

function chart(id, xr, yr, labels, drawFn) {
  var cv = $(id), dims = R.fitCanvas(cv), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, dims.w, dims.h);
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var A = R.chartFrame(ctx, dims, { x: 0, y: 0, w: dims.w, h: dims.h }, xr, yr, labels,
    dark ? "226,232,240" : "0,0,0");
  drawFn(A, ctx, dims);
}

function line(ctx, dims, pts, color, dash) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dims.dpr;
  ctx.setLineDash(dash ? [6 * dims.dpr, 4 * dims.dpr] : []);
  ctx.beginPath();
  pts.forEach(function(p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
  ctx.stroke();
  ctx.setLineDash([]);
}

function exportCsv() {
  if (!last) return;
  var p = last.p, r = last.r;
  var rows = ["# Falling object with air drag — Physics Workbench",
    "# h=" + p.h + " m, m=" + p.m + " kg, v0=" + p.v0 + " m/s, Cd=" + p.cd + ", A=" + p.areaM2 +
      " m2, g=" + p.g + " m/s2, rho=" + p.rho + " kg/m3",
    "t_s,fallen_m,speed_m_s,accel_m_s2"];
  for (var i = 0; i < r.t.length; i++) {
    rows.push([r.t[i], r.y[i], r.v[i], r.a[i]].map(function(v) { return +v.toPrecision(8); }).join(","));
  }
  var blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fall-simulation.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

function applyPreset(key) {
  var pr = PRESETS[key];
  if (!pr) return;
  $("wb-m").value = String(pr.m);
  $("wb-shape").value = pr.shape;
  $("wb-cd").value = String(AR.DRAG_COEFFICIENTS[pr.shape]);
  $("wb-size").value = String(pr.size);
  $("wb-area").value = (key === "sheet" ? SHEET_AREA_CM2 : areaFromSize(pr.shape, pr.size)).toFixed(2);
}

function init() {
  var shape = $("wb-shape");
  Object.keys(AR.DRAG_COEFFICIENTS).forEach(function(name) {
    var o = document.createElement("option");
    o.value = name;
    o.textContent = name.charAt(0).toUpperCase() + name.slice(1) + " · Cd " + AR.DRAG_COEFFICIENTS[name];
    shape.appendChild(o);
  });
  var custom = document.createElement("option");
  custom.value = "custom"; custom.textContent = "Other (type Cd)";
  shape.appendChild(custom);
  applyPreset($("wb-preset").value);

  $("wb-preset").addEventListener("change", function() { applyPreset(this.value); run(); });
  shape.addEventListener("change", function() {
    var cd = AR.DRAG_COEFFICIENTS[shape.value];
    if (cd != null) $("wb-cd").value = String(cd);
    $("wb-area").value = areaFromSize(shape.value, num("wb-size") || 0).toFixed(2);
    $("wb-preset").value = "custom";
    run();
  });
  $("wb-size").addEventListener("input", function() {
    $("wb-area").value = areaFromSize(shape.value, num("wb-size") || 0).toFixed(2);
  });
  ["wb-m", "wb-cd", "wb-size", "wb-area"].forEach(function(id) {
    $(id).addEventListener("input", function() { $("wb-preset").value = "custom"; });
  });
  $("wb-cd").addEventListener("input", function() {
    var match = Object.keys(AR.DRAG_COEFFICIENTS).filter(function(k) {
      return Math.abs(AR.DRAG_COEFFICIENTS[k] - num("wb-cd")) < 1e-9;
    })[0];
    shape.value = match || "custom";
  });
  document.querySelectorAll("#workbench input, #workbench select").forEach(function(el) {
    el.addEventListener("input", run);
  });
  $("wb-export").addEventListener("click", exportCsv);
  window.addEventListener("resize", run);
  run();
}

init();
