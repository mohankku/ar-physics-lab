/* AR Physics Lab — page entry for Exp 01 (free-fall gravity).
 * Wires lab.html's controls to the AR engine in core/. Each mode lives in
 * lab/modes/; shared helpers are in lab/ui.js. Loaded by ../loader.js. */
import * as AR from "../core/index.js";
import { $, camera } from "./ui.js";
import { Sim } from "./modes/simulate.js";
import { Measure } from "./modes/measure.js";
import { Track } from "./modes/track.js";
import { Hold } from "./modes/hold.js";
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
      if (mode === "mode-simulate") Sim.resize();
    });
  });
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
  Assistant.init();
  window.addEventListener("beforeunload", function() { camera.stopAll(); });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
