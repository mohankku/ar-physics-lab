/* The app's one camera, shared by every experiment screen. */
import * as AR from "../core/index.js";

var cam = null, camBack = null;

function constraints(back) {
  return {
    audio: false,
    video: {
      facingMode: { ideal: back ? "environment" : "user" },
      width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }
    }
  };
}

/* Open the camera on `video` (front, or back when `back`). Only one stream
 * is live at a time: opening on a new screen releases the old one. */
export function startCamera(video, back) {
  if (cam && camBack !== !!back) { cam.stopAll(); cam = null; }
  if (!cam) { cam = new AR.Camera({ constraints: constraints(back) }); camBack = !!back; }
  return cam.start(video);
}
export function stopCamera() { if (cam) cam.stopAll(); }
export function liveVideo() { return cam ? cam.liveVideo() : null; }

/* A child-friendly sentence for a camera or loading error. */
export function cameraError(err) {
  var name = err && err.name;
  if (name === "NotAllowedError") return "The camera is blocked. Allow it in the browser settings, then try again.";
  if (name === "NotFoundError") return "No camera found on this device.";
  if (name === "NoCameraApi") return "This browser can't use the camera (it needs https or localhost).";
  if (name === "NotReadableError") return "Another app is using the camera. Close it and try again.";
  return "The camera couldn't start (" + ((err && err.message) || err) + ").";
}
