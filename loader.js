/* AR Physics Lab loader.
 * Usage: <div data-phys-lab></div> <script src=".../loader.js" defer></script>
 * Fetches lab/lab.html into the container, then adds lab/lab.css and the
 * page entry lab/main.js (an ES module that imports the AR engine from
 * core/), all resolved relative to this script. Keep this file at the repo
 * root: other sites embed it by URL. */
(function() {
  "use strict";
  var me = document.currentScript;
  var base = me ? me.src.replace(/[^\/]*$/, "") : "./";

  var CSS = "lab/lab.css";
  var HTML = "lab/lab.html";
  var MODULE = "lab/main.js";

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
        var js = document.createElement("script");
        js.type = "module";
        js.src = base + MODULE;
        js.onerror = function() {
          root.insertAdjacentText("afterbegin", "Could not load the lab's scripts. Try reloading.");
        };
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
