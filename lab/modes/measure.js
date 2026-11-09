/* Mode 2 — measure g with a stopwatch. */
import * as AR from "../../core/index.js";

var K = AR, R = AR.render;
import { $, setStatus, numberIn, readGravity, onSpace, selectSwatch, remember, recall, restoreSettings, saveSettings, ballStyle, camera, openCamera } from "../ui.js";

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

export { Measure };
