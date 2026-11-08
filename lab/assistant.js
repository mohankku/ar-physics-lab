/* Lab assistant: a local LLM interprets results; it never measures. */
import * as AR from "../core/index.js";
import { $, setStatus, recall, remember, camera } from "./ui.js";
import { LabLog } from "./lablog.js";
import { Measure } from "./modes/measure.js";
import { ollamaChat } from "./ollama.js";

var K = AR;

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
        f.span.toFixed(2) + "s, frame height=" + f.h.toFixed(2) + "m, " + (f.scale || "") + ".");
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

export { Assistant };
