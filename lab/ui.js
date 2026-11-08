/* Shared page helpers: element lookup, status lines, saved settings, and
 * the lab's single camera. */
import * as AR from "../core/index.js";

var R = AR.render;

/* ---------- small page helpers ---------- */
function $(id) { return document.getElementById(id); }
function setStatus(el, msg, cls) {
  if (!el) return;
  el.textContent = msg;
  el.className = "phys-status" + (cls ? " " + cls : "");
}
function numberIn(id, min, max, fallback) {
  return Math.min(max, Math.max(min, parseFloat($(id).value) || fallback));
}
/* Planet preset select + "Custom…" number input → g in m/s². */
function readGravity(selectId, customId) {
  var preset = $(selectId);
  var g = preset.value === "custom" ? parseFloat($(customId).value) || 9.81 : parseFloat(preset.value);
  return g > 0 ? g : 9.81;
}
/* Space bar runs fn while pane is visible and focus isn't on a control. */
function onSpace(paneId, fn) {
  document.addEventListener("keydown", function(e) {
    if (e.code !== "Space" || $(paneId).hidden) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    fn();
  });
}
function selectSwatch(pane, sw) {
  pane.querySelectorAll(".swatch").forEach(function(o) { o.classList.toggle("selected", o === sw); });
}

/* ---------- saved settings (this browser only) ---------- */
function remember(key, value) {
  try { localStorage.setItem("physlab_" + key, value); } catch (e) {}
}
function recall(key) {
  try { return localStorage.getItem("physlab_" + key); } catch (e) { return null; }
}
/* pairs: [[elementId, storageKey], ...] */
function restoreSettings(pairs) {
  pairs.forEach(function(pair) {
    var v = recall(pair[1]);
    if (v !== null && v !== "" && $(pair[0])) $(pair[0]).value = v;
  });
}
function saveSettings(pairs) {
  pairs.forEach(function(pair) { remember(pair[1], $(pair[0]).value); });
}
/* Ball style from the select, falling back to the saved choice. */
function ballStyle(sel) {
  var s = R.isBallStyle(sel.value) ? sel.value : recall("ball");
  if (!R.isBallStyle(s)) s = "tennis";
  sel.value = s;
  return s;
}

/* ---------- camera ---------- */
/* The lab's one shared camera: a single live stream across all modes. */
var camera = new AR.Camera();

function openCamera(video, statusEl) {
  return camera.start(video).then(function() {
    setStatus(statusEl, "Camera on — video stays on this device.", "ok");
  }, function(err) {
    if (err && err.name === "AbortError") throw err; // a newer camera request took over
    var msg = "Camera blocked — simulation still works without it.";
    if (err && err.name === "NoCameraApi") msg = "Camera API not available in this browser.";
    else if (err && err.name === "NotFoundError") msg = "No camera found on this device.";
    else if (err && err.name === "NotAllowedError") msg = "Camera permission denied — simulation still works without it.";
    setStatus(statusEl, msg, "err");
    throw err;
  });
}
// Show the "camera off" hint on every stage except the live one.
camera.onChange(function(live) {
  document.querySelectorAll("#phys-lab .stage").forEach(function(st) {
    st.classList.toggle("cam-on", !!live && st.querySelector("video") === live);
  });
});

export {
  $, setStatus, numberIn, readGravity, onSpace, selectSwatch,
  remember, recall, restoreSettings, saveSettings, ballStyle, camera, openCamera
};
