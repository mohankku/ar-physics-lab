/**
 * Camera access and frame timing.
 * @module core/camera
 */

/** Default constraints: rear camera, modest size, high frame rate (more
 * points per fall). All "ideal", so any camera still works. */
export const DEFAULT_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 60 }
  }
});

/**
 * One live camera at a time: opening one releases the others, so phones
 * never hold two streams (battery + device limits). Safe against racing
 * opens: only the newest request keeps its stream.
 */
export class Camera {
  /**
   * @param {{mediaDevices?: MediaDevices, constraints?: MediaStreamConstraints}} [opts]
   *   mediaDevices defaults to navigator.mediaDevices (inject for tests)
   */
  constructor(opts = {}) {
    this._devices = opts.mediaDevices ||
      (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
    this._constraints = opts.constraints || DEFAULT_CONSTRAINTS;
    /** @type {{video: HTMLVideoElement, stream: MediaStream}|null} */
    this._live = null;
    this._request = 0;
    this._listeners = new Set();
  }

  available() {
    return !!(this._devices && this._devices.getUserMedia);
  }

  /**
   * Open the camera on `video`. Resolves once frames are playing.
   * Rejects with the browser's error — err.name is "NotAllowedError" when
   * denied, "NotFoundError" with no camera, "NoCameraApi" without the API,
   * "AbortError" when a newer start() superseded this one.
   * @param {HTMLVideoElement} video
   * @returns {Promise<MediaStream>}
   */
  async start(video) {
    if (!this.available()) throw namedError("NoCameraApi", "Camera API not available");
    const id = ++this._request;
    const stream = await this._devices.getUserMedia(this._constraints);
    if (id !== this._request) { // a newer request won the race
      stopStream(stream);
      throw namedError("AbortError", "Superseded by a newer camera request");
    }
    // Release only after success: a denied request never kills a working camera.
    this._release();
    this._live = { video, stream };
    video.srcObject = stream;
    // Camera unplugged, permission revoked, or OS took it: treat as stopped.
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (this._live && this._live.stream === stream) this.stopAll();
      });
    }
    try {
      await video.play();
    } catch (err) {
      if (this._live && this._live.stream === stream) { this._release(); this._emit(null); }
      throw err;
    }
    if (!this._live || this._live.stream !== stream) {
      throw namedError("AbortError", "Camera stopped while starting");
    }
    this._emit(video);
    return stream;
  }

  /** Stop the live camera, if any. */
  stopAll() {
    this._request++; // cancels any start() still waiting for permission
    const had = !!this._live;
    this._release();
    if (had) this._emit(null);
  }

  /** @returns {HTMLVideoElement|null} the element showing the live camera */
  liveVideo() {
    return this._live ? this._live.video : null;
  }

  /**
   * fn(video|null) runs whenever the live camera moves or stops.
   * @returns {() => void} unsubscribe
   */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * The live frame as base64 JPEG (no data: prefix), longest side ≤ maxSide.
   * @returns {string|null} null when no camera is live
   */
  snapshot(maxSide = 512, quality = 0.72) {
    const v = this.liveVideo();
    if (!v || !v.videoWidth || typeof document === "undefined") return null;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality).split(",", 2)[1];
  }

  _release() {
    const cur = this._live;
    this._live = null;
    if (!cur) return;
    stopStream(cur.stream);
    if (cur.video.srcObject === cur.stream) cur.video.srcObject = null;
  }

  _emit(video) {
    for (const fn of this._listeners) {
      try { fn(video); } catch (e) { reportError(e); }
    }
  }
}

/**
 * Tells you when a video has a new camera frame, and when it was captured.
 * Uses requestVideoFrameCallback where available, so each camera frame is
 * processed once with its real timestamp — a 60 Hz animation loop over a
 * 30 fps camera would otherwise see every frame twice with different times.
 * Falls back to "every call is a new frame, stamped now".
 */
export class FrameClock {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video;
    this.supported = !!(video && typeof video.requestVideoFrameCallback === "function");
    this._handle = 0;
    this._running = false;
    this._pending = null;
    this._base = null; // which timestamp field this feed provides
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._pending = null;
    if (this.supported) this._arm();
  }

  stop() {
    this._running = false;
    this._pending = null;
    if (this.supported && this._handle && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this._handle);
    }
    this._handle = 0;
  }

  /**
   * The newest frame not yet returned, or null if none arrived.
   * @param {number} [now] performance.now(), used by the fallback
   * @returns {{time: number}|null} time in ms on a clock that is consistent
   *   for this feed (not necessarily performance.now)
   */
  next(now) {
    if (!this._running) return null;
    if (!this.supported) return { time: now ?? performanceNow() };
    const f = this._pending;
    this._pending = null;
    return f;
  }

  _arm() {
    this._handle = this.video.requestVideoFrameCallback((now, meta) => {
      if (!this._running) return;
      this._pending = { time: this._stamp(now, meta || {}) };
      this._arm();
    });
  }

  // Prefer the capture time, then the media time, then presentation time;
  // stick with the first one seen so times stay comparable.
  _stamp(now, meta) {
    if (!this._base) {
      this._base = isFinite(meta.captureTime) ? "capture"
        : isFinite(meta.mediaTime) ? "media" : "now";
    }
    if (this._base === "capture" && isFinite(meta.captureTime)) return meta.captureTime;
    if (this._base === "media" && isFinite(meta.mediaTime)) return meta.mediaTime * 1000;
    return isFinite(meta.expectedDisplayTime) ? meta.expectedDisplayTime : now;
  }
}

function stopStream(stream) {
  for (const t of stream.getTracks()) t.stop();
}

function namedError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

function performanceNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function reportError(e) {
  if (typeof console !== "undefined") console.error(e);
}
