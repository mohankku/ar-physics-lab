/**
 * Keeps small copies of recent camera frames so a recorded fall can be
 * stepped through afterwards. Frames stay in memory on this device only.
 * @module core/framebuffer
 */

/**
 * @typedef {{time: number, image: ImageBitmap}} StoredFrame  time in seconds
 */

/**
 * Bounded store of downscaled frames, oldest dropped first.
 * Memory ≈ capacity × width × height × 4 bytes (defaults: ~26 MB).
 */
export class FrameRing {
  /**
   * @param {{capacity?: number, width?: number,
   *   createImageBitmap?: typeof createImageBitmap}} [opts]
   *   width: stored frame width in px (height follows the video's aspect)
   */
  constructor(opts = {}) {
    this.capacity = opts.capacity || 150;
    this.width = opts.width || 240;
    this._create = opts.createImageBitmap ||
      (typeof createImageBitmap === "function" ? createImageBitmap.bind(globalThis) : null);
    /** @type {StoredFrame[]} sorted by time */
    this.frames = [];
    this._pending = 0;
    this._generation = 0;
  }

  /** False where the browser can't snapshot video frames. */
  get supported() {
    return !!this._create;
  }

  /**
   * Store the video's current frame. Resolves when stored (or skipped).
   * @param {HTMLVideoElement} video
   * @param {number} time seconds, same clock as the tracked samples
   */
  async push(video, time) {
    if (!this._create || !video || !video.videoWidth) return;
    const gen = this._generation;
    const w = Math.min(this.width, video.videoWidth);
    const h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
    this._pending++;
    let image;
    try {
      image = await this._create(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" });
    } catch (e) {
      return; // frame not ready; skipping one is harmless
    } finally {
      this._pending--;
    }
    if (gen !== this._generation) { close(image); return; } // cleared meanwhile
    // Snapshots can resolve out of order: insert by time.
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].time > time) i--;
    this.frames.splice(i, 0, { time, image });
    while (this.frames.length > this.capacity) close(this.frames.shift().image);
  }

  /** Drop frames older than `time` (s). */
  trimBefore(time) {
    while (this.frames.length && this.frames[0].time < time) close(this.frames.shift().image);
  }

  /** Free every frame. */
  clear() {
    this._generation++;
    for (const f of this.frames) close(f.image);
    this.frames = [];
  }

  /** Frame closest to `time` (s), or null when empty. */
  nearest(time) {
    const f = this.frames;
    if (!f.length) return null;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid].time < time) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(f[lo - 1].time - time) <= Math.abs(f[lo].time - time)) lo--;
    return f[lo];
  }

  /** Resolves once in-flight snapshots have landed. */
  async settle() {
    while (this._pending > 0) await new Promise((r) => setTimeout(r, 5));
  }
}

function close(image) {
  if (image && typeof image.close === "function") image.close();
}
