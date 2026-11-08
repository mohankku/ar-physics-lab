/* AR Physics Lab loader.
 * Usage: <div data-phys-lab></div> <script src=".../loader.js" defer></script>
 * Fetches lab/lab.html into the container, then adds lab/lab.css, the AR
 * engine (core/ar-core.js) and the page wiring (lab/lab.js), all resolved
 * relative to this script. Keep this file at the repo root: other sites
 * embed it by URL. */
(function() {
  "use strict";
  var me = document.currentScript;
  var base = me ? me.src.replace(/[^\/]*$/, "") : "./";

  var CSS = "lab/lab.css";
  var HTML = "lab/lab.html";
  var SCRIPTS = ["core/ar-core.js", "lab/lab.js"]; // run in this order

  function start() {
    var root = document.querySelector("[data-phys-lab]");
    if (!root) return;

    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = base + CSS;
    document.head.appendChild(css);

    fetch(base + HTML)
      .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function(html) {
        root.innerHTML = html;
        SCRIPTS.forEach(function(src) {
          var js = document.createElement("script");
          js.src = base + src;
          js.async = false; // injected scripts run in insertion order
          document.body.appendChild(js);
        });
      })
      .catch(function(err) {
        root.textContent = "Could not load the AR Physics Lab (" + err.message + "). Try reloading.";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
