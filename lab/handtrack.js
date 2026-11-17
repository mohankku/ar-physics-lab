/* Hand tracking with Google MediaPipe Hands (tasks-vision), loaded only
 * when a mode first asks for it: ~18 MB the first time (engine + model),
 * cached by the browser afterwards. Video frames are analyzed on this
 * device; only the library and model files are downloaded. */

var VERSION = "0.10.14";
var CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VERSION;
var MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

var loading = null;

/* Resolves with a HandLandmarker (GPU where available, else CPU). */
function loadHandTracker() {
  if (loading) return loading;
  loading = import(CDN + "/vision_bundle.mjs").then(function(vision) {
    return vision.FilesetResolver.forVisionTasks(CDN + "/wasm").then(function(files) {
      var make = function(delegate) {
        return vision.HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      };
      return make("GPU").catch(function() { return make("CPU"); });
    });
  });
  loading.catch(function() { loading = null; }); // allow a retry (e.g. back online)
  return loading;
}

/* Wraps a landmarker: one detection per call, with strictly increasing
 * timestamps as MediaPipe requires. Returns the 21 landmarks or null. */
function HandTracker(landmarker) {
  this.landmarker = landmarker;
  this._last = 0;
}
HandTracker.prototype.detect = function(video, nowMs) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  var ts = Math.max(nowMs, this._last + 1);
  this._last = ts;
  var res = this.landmarker.detectForVideo(video, ts);
  return res && res.landmarks && res.landmarks.length ? res.landmarks[0] : null;
};

export { loadHandTracker, HandTracker };
