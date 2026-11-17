/* Physics Lab app: screens, routing (#/ and #/catch), install, offline.
 * One experiment screen at a time; leaving it turns the camera off. */
import { $ } from "./util.js";
import { Catch } from "./catch.js";

var SCREENS = {
  "": { el: "screen-home", title: "Physics Lab" },
  "catch": { el: "screen-catch", title: "Catch & drop · Physics Lab", exp: Catch }
};
var current = null;

function route() {
  var name = (location.hash.replace(/^#\/?/, "") || "").split("/")[0];
  var next = SCREENS[name] ? name : "";
  if (next === current) return;
  var prev = current !== null ? SCREENS[current] : null;
  if (prev && prev.exp) prev.exp.leave();
  Object.keys(SCREENS).forEach(function(k) { $(SCREENS[k].el).hidden = k !== next; });
  document.title = SCREENS[next].title;
  current = next;
  if (SCREENS[next].exp) SCREENS[next].exp.enter();
  window.scrollTo(0, 0);
}

/* "Install app" where the browser offers it (Chrome, Edge, Android). On
 * iPad/iPhone it's Share → Add to Home Screen; no prompt to catch. */
function initInstall() {
  var deferred = null, btn = $("btn-install");
  window.addEventListener("beforeinstallprompt", function(e) {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", function() {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function() { deferred = null; btn.hidden = true; });
  });
  window.addEventListener("appinstalled", function() { btn.hidden = true; });
}

/* Offline support: caches the app and the hand tracker after first use. */
function initOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch(function() {});
}

Catch.init();
initInstall();
initOffline();
window.addEventListener("hashchange", route);
route();
