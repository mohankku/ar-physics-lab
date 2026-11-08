/**
 * On-device color tracking. Frames are downsampled to a small working size,
 * classified per pixel, and the best connected blob is returned.
 * @module core/vision
 */

/** Squared RGB distance. */
export function colorDistSq(r, g, b, tr, tg, tb) {
  const dr = r - tr, dg = g - tg, db = b - tb;
  return dr * dr + dg * dg + db * db;
}

/** Strongly blue-dominant pixel: part of a hung blue sheet, never the hand. */
export function isBlueBackdrop(r, g, b) {
  return b > 90 && (b - r) > 25 && (b - g) > 15;
}

/** Classic YCrCb skin rule — needs no calibration and copes with lighting. */
export function isSkinPixel(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 30) return false;
  const cr = (r - y) * 0.713 + 128;
  const cb = (b - y) * 0.564 + 128;
  return cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127;
}

/** @typedef {{r: number, g: number, b: number}} RGB */

/** @type {Readonly<Record<string, Readonly<RGB>>>} */
export const COLOR_PRESETS = Object.freeze({
  red:    Object.freeze({ r: 229, g: 72,  b: 77 }),
  green:  Object.freeze({ r: 46,  g: 160, b: 67 }),
  blue:   Object.freeze({ r: 31,  g: 111, b: 235 }),
  orange: Object.freeze({ r: 235, g: 130, b: 30 })
});

/** A copy of a named preset color (red when the name is unknown). */
export function colorPreset(name) {
  const c = COLOR_PRESETS[name] || COLOR_PRESETS.red;
  return { r: c.r, g: c.g, b: c.b };
}

/**
 * @typedef {Object} LocateOptions
 * @property {RGB} [target]     color to match (ignored when skin is set)
 * @property {number} [tol=80]  RGB distance tolerance
 * @property {boolean} [skin]   use the skin rule instead of target
 * @property {boolean} [motion] pixel must also have changed since the last frame
 * @property {boolean} [ignoreBlue] reject blue-backdrop pixels
 * @property {{x: number, y: number}|null} [pref] sticky lock: prefer a blob near here (0..1)
 * @property {number} [stickR=0.3] radius of the sticky lock (frame fraction)
 *
 * @typedef {{x: number, y: number, n: number}} Blob  centroid in 0..1 frame units, n pixels
 */

const MIN_BLOB = 12;      // pixels (working size) that count as a hit
const MOTION_DELTA = 14;  // luma change that counts as "moving"

/**
 * Finds a colored blob in video frames. Each tracker keeps its own previous
 * frame for the motion gate, so use one tracker per video feed.
 */
export class ColorTracker {
  /** @param {{width?: number, height?: number}} [opts] working size (default 160×120) */
  constructor(opts = {}) {
    this.width = opts.width || 160;
    this.height = opts.height || 120;
    const N = this.width * this.height;
    /** Last match mask (1 = matched), for a "tracker view" overlay. */
    this.mask = new Uint8Array(N);
    this._gray = new Uint8Array(N);
    this._prev = new Uint8Array(N);
    this._seen = new Int32Array(N);
    this._stack = new Int32Array(N);
    this._stamp = 0;
    this._hasPrev = false;
    this._ctx = null;
  }

  /** Forget motion history (call after the camera or scene changes). */
  reset() {
    this._hasPrev = false;
    this.mask.fill(0);
  }

  /**
   * Locate the target in the video's current frame.
   * @param {HTMLVideoElement} video
   * @param {LocateOptions} opts
   * @returns {Blob|null}
   */
  locate(video, opts) {
    const d = this._read(video);
    return d ? this.locateInPixels(d, opts) : null;
  }

  /**
   * Locate the target in RGBA pixels of the working size.
   * @param {ArrayLike<number>} rgba  width × height × 4 values
   * @param {LocateOptions} [opts]
   * @returns {Blob|null}
   */
  locateInPixels(rgba, opts = {}) {
    const W = this.width, H = this.height, N = W * H;
    if (!rgba || rgba.length < N * 4) {
      throw new RangeError(`locateInPixels: expected ${N * 4} RGBA values, got ${rgba ? rgba.length : 0}`);
    }
    const target = opts.target || COLOR_PRESETS.red;
    const tol = opts.tol > 0 ? opts.tol : 80;
    const tolSq = tol * tol;
    const skin = !!opts.skin, blue = !!opts.ignoreBlue;
    // No history yet: every pixel would look "moved", so skip the gate once.
    const motion = !!opts.motion && this._hasPrev;
    const { mask, _gray: gray, _prev: prev } = this;
    let n = 0;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      let ok = skin ? isSkinPixel(r, g, b)
                    : colorDistSq(r, g, b, target.r, target.g, target.b) <= tolSq;
      if (ok && blue && isBlueBackdrop(r, g, b)) ok = false;
      if (ok && motion && Math.abs(y - prev[p]) < MOTION_DELTA) ok = false;
      mask[p] = ok ? 1 : 0;
      if (ok) n++;
      gray[p] = y;
    }
    prev.set(gray);
    this._hasPrev = true;
    if (n < MIN_BLOB) return null;
    return this._bestBlob(opts.pref || null, opts.stickR > 0 ? opts.stickR : 0.3);
  }

  /**
   * Color at fractional frame coordinates (0..1).
   * @returns {RGB|null} null if the frame can't be read
   */
  sampleAt(video, fx, fy) {
    const d = this._read(video);
    if (!d) return null;
    const x = Math.floor(clamp(fx, 0, 0.999) * this.width);
    const y = Math.floor(clamp(fy, 0, 0.999) * this.height);
    const i = (y * this.width + x) * 4;
    return { r: d[i], g: d[i + 1], b: d[i + 2] };
  }

  /** Color under a pointer event (clientX/clientY) on the video element. */
  sampleAtPoint(video, clientX, clientY) {
    const r = video.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return this.sampleAt(video, (clientX - r.left) / r.width, (clientY - r.top) / r.height);
  }

  _read(video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return null; // no frame yet
    const ctx = this._context();
    if (!ctx) return null;
    try {
      ctx.drawImage(video, 0, 0, this.width, this.height);
      return ctx.getImageData(0, 0, this.width, this.height).data;
    } catch (e) {
      return null; // e.g. frame not decodable yet
    }
  }

  _context() {
    if (this._ctx) return this._ctx;
    const opts = { willReadFrequently: true };
    // OffscreenCanvas where it has a 2D context (Safari < 16.4 lacks one).
    if (typeof OffscreenCanvas !== "undefined") {
      try { this._ctx = new OffscreenCanvas(this.width, this.height).getContext("2d", opts); }
      catch (e) { this._ctx = null; }
    }
    if (!this._ctx && typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      this._ctx = canvas.getContext("2d", opts);
    }
    return this._ctx;
  }

  /* Largest 4-connected blob — but a blob near the sticky lock wins over a
   * bigger one elsewhere (a face is usually the largest skin blob; this keeps
   * the hand). */
  _bestBlob(pref, stickR) {
    const W = this.width, H = this.height, N = W * H;
    const mask = this.mask, seen = this._seen, stack = this._stack;
    const stamp = (this._stamp = (this._stamp + 1) | 0) || (this._stamp = 1);
    let best = 0, bestX = 0, bestY = 0;
    let near = 0, nearX = 0, nearY = 0;
    for (let p = 0; p < N; p++) {
      if (!mask[p] || seen[p] === stamp) continue;
      let top = 0;
      stack[top++] = p; seen[p] = stamp;
      let cx = 0, cy = 0, cn = 0;
      while (top > 0) {
        const q = stack[--top];
        const qx = q % W, qy = (q / W) | 0;
        cx += qx; cy += qy; cn++;
        if (qx > 0 && mask[q - 1] && seen[q - 1] !== stamp) { seen[q - 1] = stamp; stack[top++] = q - 1; }
        if (qx < W - 1 && mask[q + 1] && seen[q + 1] !== stamp) { seen[q + 1] = stamp; stack[top++] = q + 1; }
        if (qy > 0 && mask[q - W] && seen[q - W] !== stamp) { seen[q - W] = stamp; stack[top++] = q - W; }
        if (qy < H - 1 && mask[q + W] && seen[q + W] !== stamp) { seen[q + W] = stamp; stack[top++] = q + W; }
      }
      if (cn > best) { best = cn; bestX = cx / cn; bestY = cy / cn; }
      if (pref && cn >= MIN_BLOB) {
        const gx = cx / cn / W - pref.x, gy = cy / cn / H - pref.y;
        if (gx * gx + gy * gy < stickR * stickR && cn > near) {
          near = cn; nearX = cx / cn; nearY = cy / cn;
        }
      }
    }
    // Pixel centers sit at +0.5 in working-size units.
    if (near >= MIN_BLOB) return { x: (nearX + 0.5) / W, y: (nearY + 0.5) / H, n: near };
    if (best < MIN_BLOB) return null;
    return { x: (bestX + 0.5) / W, y: (bestY + 0.5) / H, n: best };
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
