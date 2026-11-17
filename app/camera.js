/* The app's one camera, shared by every experiment screen, plus the
 * letterboxed video frame the tracking experiments draw on. */
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

/* Size `frame` to the video's shape, as large as fits in `wrap`, centered,
 * so the canvas over it lines up with the camera image pixel for pixel. */
export function fitFrame(wrap, frame, video) {
  var W = wrap.clientWidth, H = wrap.clientHeight;
  var a = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
  var w = Math.min(W, H * a), h = w / a;
  frame.style.width = Math.round(w) + "px";
  frame.style.height = Math.round(h) + "px";
  frame.style.left = Math.round((W - w) / 2) + "px";
  frame.style.top = Math.round((H - h) / 2) + "px";
}
