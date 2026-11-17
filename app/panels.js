/* Results and Settings panels for an experiment screen. On narrow screens
 * both slide up as sheets over a scrim; on tablets and laptops Results is a
 * column beside the camera (remembered open/closed) and Settings slides in
 * from the right. Markup: section.exp > aside.panel.results,
 * aside.panel.settings, .scrim, [data-open="results|settings"], [data-close]. */
import { store } from "./util.js";

var WIDE = "(min-width: 960px) and (min-height: 521px)";

export function makePanels(screen, key, onResults) {
  var results = screen.querySelector(".panel.results");
  var settings = screen.querySelector(".panel.settings");
  var scrim = screen.querySelector(".scrim");
  var wide = function() { return matchMedia(WIDE).matches; };

  var P = {
    open: function(which) {
      if (which === "results" && wide()) {
        screen.classList.add("results-open");
        store.set(key + "-results", true);
      } else {
        P.closeSheets();
        (which === "results" ? results : settings).classList.add("open");
        scrim.hidden = false;
      }
      if (which === "results" && onResults) requestAnimationFrame(onResults);
    },
    close: function(panel) {
      if (panel === results && wide()) {
        screen.classList.remove("results-open");
        store.set(key + "-results", false);
      } else {
        panel.classList.remove("open");
        scrim.hidden = true;
      }
    },
    closeSheets: function() {
      results.classList.remove("open");
      settings.classList.remove("open");
      scrim.hidden = true;
    },
    /* Is the results panel visible (so its graph can be drawn)? */
    resultsVisible: function() { return results.getBoundingClientRect().width > 0 && (wide() ? screen.classList.contains("results-open") : results.classList.contains("open")); }
  };

  screen.querySelectorAll("[data-open]").forEach(function(btn) {
    btn.addEventListener("click", function() { P.open(btn.getAttribute("data-open")); });
  });
  screen.querySelectorAll("[data-close]").forEach(function(btn) {
    btn.addEventListener("click", function() { P.close(btn.closest(".panel")); });
  });
  scrim.addEventListener("click", P.closeSheets);
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && !screen.hidden) P.closeSheets();
  });
  if (store.get(key + "-results", true)) screen.classList.add("results-open");
  return P;
}
