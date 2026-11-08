/* AR Physics Lab loader.
 * Usage: <div data-phys-lab></div> <script src=".../loader.js" defer></script>
 * Fetches lab.html into the container, then adds physics.css and physics.js
 * from the same folder as this script. */
(function() {
  "use strict";
  var me = document.currentScript;
  var base = me ? me.src.replace(/[^\/]*$/, "") : "./";

  function start() {
    var root = document.querySelector("[data-phys-lab]");
    if (!root) return;

    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = base + "physics.css";
    document.head.appendChild(css);

    fetch(base + "lab.html")
      .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function(html) {
        root.innerHTML = html;
        var js = document.createElement("script");
        js.src = base + "physics.js";
        document.body.appendChild(js);
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
