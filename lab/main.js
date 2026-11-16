/* AR Physics Lab — page entry: Exp 01 (free fall), Exp 02 (projectile),
 * Exp 03 (pendulum). Wires lab.html's controls to the AR engine in core/.
 * Each mode lives in lab/modes/; shared helpers are in lab/ui.js. Loaded by
 * ../loader.js. */
import * as AR from "../core/index.js";
import { $, camera, setActivePane, remember, recall } from "./ui.js";
import { Sim } from "./modes/simulate.js";
import { Measure } from "./modes/measure.js";
import { Track } from "./modes/track.js";
import { Hold } from "./modes/hold.js";
import { Projectile } from "./modes/projectile.js";
import { Pendulum } from "./modes/pendulum.js";
import { Assistant } from "./assistant.js";

// Globals for the console and older callers.
window.ARCore = AR;
window.PhysLab = {
  fallTime: AR.fallTime, gravityFromDrop: AR.gravityFromDrop,
  mean: AR.mean, std: AR.std, fitGravity: AR.fitGravity, fitFreeFall: AR.fitFreeFall,
  colorDistSq: AR.colorDistSq
};

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
      setActivePane(mode);
      if (mode === "mode-simulate") { Sim.resize(); if (!Sim.running) Sim.reset(); }
    });
  });
}

/* ---------- experiment picker: one experiment on the page at a time ---------- */
function visiblePane(section) {
  var panes = section.querySelectorAll(".phys-mode");
  for (var i = 0; i < panes.length; i++) if (!panes[i].hidden) return panes[i];
  return null;
}
function showExperiment(id, scroll) {
  var section = $(id);
  if (!section || !section.classList.contains("phys-exp")) return false;
  var changed = section.hidden;
  document.querySelectorAll("#phys-lab .phys-exp").forEach(function(s) { s.hidden = s !== section; });
  document.querySelectorAll("#phys-lab .phys-exp-card[data-exp]").forEach(function(c) {
    var on = c.getAttribute("data-exp") === id;
    c.classList.toggle("active", on);
    c.setAttribute("aria-pressed", on ? "true" : "false");
  });
  // Leaving an experiment releases the camera, so nothing keeps tracking out of sight.
  if (changed && camera.liveVideo()) camera.stopAll();
  var pane = visiblePane(section);
  if (pane) setActivePane(pane.id);
  if (id === "exp-01" && !$("mode-simulate").hidden) { Sim.resize(); if (!Sim.running) Sim.reset(); }
  remember("exp", id);
  if (scroll) section.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
function initExperiments() {
  document.querySelectorAll("#phys-lab .phys-exp-card[data-exp]").forEach(function(card) {
    card.addEventListener("click", function() { showExperiment(card.getAttribute("data-exp"), true); });
  });
  var fromHash = location.hash && location.hash.slice(1);
  if (!(fromHash && showExperiment(fromHash, false))) showExperiment(recall("exp") || "exp-01", false);
  window.addEventListener("hashchange", function() { showExperiment(location.hash.slice(1), true); });
}

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
  Projectile.init();
  Pendulum.init();
  Assistant.init();
  initExperiments();
  window.addEventListener("beforeunload", function() { camera.stopAll(); });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
