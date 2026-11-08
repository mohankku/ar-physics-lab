/* AR Physics Lab — core AR engine.
 * Camera, on-device color tracking, ball rendering and the free-fall physics
 * behind each experiment. It knows nothing about lab.html: callers pass in
 * video/canvas elements and plain numbers, and get plain results back.
 * Loads as window.ARCore in the browser and as a CommonJS module in Node,
 * so the math and tracking can be tested without a page. */
(function(root) {
"use strict";

var REFERENCE_G = 9.81;

/* ================= kinematics ================= */

function fallTime(h, g) { return Math.sqrt(2 * h / g); }
function gravityFromDrop(h, t) { return 2 * h / (t * t); }
function mean(xs) { return xs.reduce(function(a, b) { return a + b; }, 0) / xs.length; }
function std(xs) {
  if (xs.length < 2) return 0;
  var m = mean(xs);
  var v = xs.reduce(function(a, x) { return a + (x - m) * (x - m); }, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
function median(xs) {
  var s = xs.slice().sort(function(a, b) { return a - b; });
  var n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
/* Signed % error of a measured g against Earth's 9.81. */
function percentError(g) { return (g - REFERENCE_G) / REFERENCE_G * 100; }

/* Least-squares fit of y = y0 + (g/2) * t^2 over samples [{t, y}].
 * Returns {g, y0, rmse} or null when underdetermined. */
function fitGravity(samples) {
  var n = samples.length;
  if (n < 3) return null;
  var sx = 0, sy = 0, sxx = 0, sxy = 0;
  var i, x;
  for (i = 0; i < n; i++) {
    x = samples[i].t * samples[i].t;
    sx += x; sy += samples[i].y; sxx += x * x; sxy += x * samples[i].y;
  }
  var den = n * sxx - sx * sx;
  if (!(den > 0)) return null;
  var b = (n * sxy - sx * sy) / den; // b = g/2
  var y0 = (sy - b * sx) / n;
  var se = 0;
  for (i = 0; i < n; i++) {
    x = samples[i].t * samples[i].t;
    se += Math.pow(samples[i].y - (y0 + b * x), 2);
  }
  return { g: 2 * b, y0: y0, rmse: Math.sqrt(se / n) };
}

/* Least-squares fit of y = y0 + v0*t + (g/2)*t^2: tolerates pre-drop
 * loitering frames and first detection mid-fall. Returns {g, v0, y0, rmse}. */
function fitFreeFall(samples) {
  var n = samples.length;
  if (n < 4) return null;
  var St = 0, St2 = 0, St3 = 0, St4 = 0, Sy = 0, Sty = 0, St2y = 0;
  var i, t;
  for (i = 0; i < n; i++) {
    t = samples[i].t;
    var t2 = t * t;
    St += t; St2 += t2; St3 += t2 * t; St4 += t2 * t2;
    Sy += samples[i].y; Sty += t * samples[i].y; St2y += t2 * samples[i].y;
  }
  function det3(m) {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
           m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
           m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }
  var M = [[n, St, St2], [St, St2, St3], [St2, St3, St4]];
  var D = det3(M);
  if (!(Math.abs(D) > 1e-12)) return null;
  var Vy = [Sy, Sty, St2y];
  function col(m, j, v) {
    return m.map(function(row, r) {
      return row.map(function(x, c) { return c === j ? v[r] : x; });
    });
  }
  var a = det3(col(M, 0, Vy)) / D;
  var b = det3(col(M, 1, Vy)) / D;
  var c = det3(col(M, 2, Vy)) / D;
  var se = 0;
  for (i = 0; i < n; i++) {
    t = samples[i].t;
    se += Math.pow(samples[i].y - (a + b * t + c * t * t), 2);
  }
  return { g: 2 * c, v0: b, y0: a, rmse: Math.sqrt(se / n) };
}

/* Turn raw tracked points [{t, yPx}] into a gravity fit.
 * Returns {ok: true, fit, points, span} or {ok: false, error, detail}:
 * `error` is shown to the user, `detail` is a short log line. */
function analyzeFall(samples, pxPerM) {
  // Keep the falling segment: y increasing (2 px jitter allowed).
  var pts = samples.filter(function(s, i) {
    return i === 0 || s.yPx >= samples[i - 1].yPx - 2;
  });
  if (pts.length < 8) {
    return { ok: false,
      error: "Only " + pts.length + " tracked points — need 8+. Try a brighter ball, closer camera, or higher tolerance.",
      detail: "only " + pts.length + " tracked points (need 8+)" };
  }
  var t0 = pts[0].t, y0px = pts[0].yPx;
  var mks = pts.map(function(s) { return { t: s.t - t0, y: (s.yPx - y0px) / pxPerM }; });
  var span = mks[mks.length - 1].t;
  if (!(span > 0.1)) {
    return { ok: false,
      error: "Fall lasted " + span.toFixed(2) + " s — too short to fit.",
      detail: "fall lasted only " + span.toFixed(2) + " s (need > 0.1 s)" };
  }
  var rise = mks[mks.length - 1].y - mks[0].y;
  if (!(rise > 0.05)) {
    return { ok: false,
      error: "Ball moved only " + (rise * 100).toFixed(1) + " cm — drop it through the frame, don't just hold it.",
      detail: "only " + (rise * 100).toFixed(1) + " cm of motion detected" };
  }
  // Trim pre-drop loitering: re-anchor where sustained fall begins.
  var cut = 0;
  while (cut < mks.length - 4 && mks[cut].y < 0.03 * rise) cut++;
  if (cut > 0) {
    var rt0 = mks[cut].t, ry0 = mks[cut].y;
    mks = mks.slice(cut).map(function(s) { return { t: s.t - rt0, y: s.y - ry0 }; });
  }
  var fit = fitFreeFall(mks);
  if (!fit || !(fit.g > 0) || !(fit.g < 60)) {
    return { ok: false,
      error: "Fit failed — noisier data than expected. Retry with steadier light.",
      detail: "least-squares fit failed on " + mks.length + " points" };
  }
  return { ok: true, fit: fit, points: mks, span: span };
}

/* ================= pixel classifiers ================= */

function colorDistSq(pxR, pxG, pxB, tR, tG, tB) {
  var dr = pxR - tR, dg = pxG - tG, db = pxB - tB;
  return dr * dr + dg * dg + db * db;
}
/* Blue-screen backdrop test: strongly blue-dominant pixels belong to a hung
 * blue sheet, never to the hand. */
function isBlueBackdrop(r, g, b) {
  return b > 90 && (b - r) > 25 && (b - g) > 15;
}
/* Classic YCrCb skin rule — no calibration click needed, works across
 * lighting better than one sampled RGB point. */
function isSkinPixel(r, g, b) {
  var y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 30) return false;
  var cr = (r - y) * 0.713 + 128;
  var cb = (b - y) * 0.564 + 128;
  return cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127;
}
var COLOR_PRESETS = {
  red:    { r: 229, g: 72,  b: 77 },
  green:  { r: 46,  g: 160, b: 67 },
  blue:   { r: 31,  g: 111, b: 235 },
  orange: { r: 235, g: 130, b: 30 }
};
function colorPreset(name) {
  var c = COLOR_PRESETS[name] || COLOR_PRESETS.red;
  return { r: c.r, g: c.g, b: c.b };
}

/* ================= color tracker ================= */

var MIN_BLOB = 12;      // pixels (in the downsampled frame) to count as a hit
var MOTION_DELTA = 14;  // luma change that counts as "moving"

/* Finds a colored blob in video frames, on a small downsampled copy.
 * Each tracker keeps its own previous frame for the motion gate. */
function ColorTracker(width, height) {
  this.width = width || 160;
  this.height = height || 120;
  this.canvas = null; this.ctx = null;
  this.mask = null; // last match mask (1 = matched), for the "tracker view"
  this.gray = null; this.prev = null; this.seen = null; this.stack = null;
  this.stamp = 0;
}
ColorTracker.prototype._ensureCanvas = function() {
  if (this.canvas) return;
  this.canvas = document.createElement("canvas");
  this.canvas.width = this.width;
  this.canvas.height = this.height;
  this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
};
/* Locate the target in the current video frame. See locateInPixels. */
ColorTracker.prototype.locate = function(video, opts) {
  if (!video || video.readyState < 2) return null; // no frame yet, or camera stopped
  this._ensureCanvas();
  var d;
  try {
    this.ctx.drawImage(video, 0, 0, this.width, this.height);
    d = this.ctx.getImageData(0, 0, this.width, this.height).data;
  } catch (e) { return null; }
  return this.locateInPixels(d, opts);
};
/* Build the match mask from RGBA pixels (width*height*4) and return the
 * centroid {x, y, n} of the best blob in 0..1 frame units, or null.
 * opts: target {r,g,b}, tol, skin (use the skin rule instead of target),
 *       motion (pixel must also be moving), ignoreBlue (drop blue backdrop),
 *       pref {x,y} (sticky lock: prefer a blob near here), stickR. */
ColorTracker.prototype.locateInPixels = function(d, opts) {
  var W = this.width, H = this.height, N = W * H;
  if (!this.mask || this.mask.length !== N) {
    this.mask = new Uint8Array(N);
    this.gray = new Uint8Array(N);
    this.prev = new Uint8Array(N);
    this.seen = new Int32Array(N);
    this.stack = new Int32Array(N);
  }
  var target = opts.target || COLOR_PRESETS.red;
  var tol = opts.tol || 80;
  var tolSq = tol * tol;
  var skin = !!opts.skin, motion = !!opts.motion, blue = !!opts.ignoreBlue;
  var mask = this.mask, gray = this.gray, prev = this.prev;
  var n = 0, i, p, r, g, b;
  for (i = 0, p = 0; i < d.length && p < N; i += 4, p++) {
    r = d[i]; g = d[i + 1]; b = d[i + 2];
    var y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    var ok = skin ? isSkinPixel(r, g, b)
                  : colorDistSq(r, g, b, target.r, target.g, target.b) <= tolSq;
    if (ok && blue && isBlueBackdrop(r, g, b)) ok = false;
    if (ok && motion && Math.abs(y - prev[p]) < MOTION_DELTA) ok = false;
    mask[p] = ok ? 1 : 0;
    if (ok) n++;
    gray[p] = y;
  }
  prev.set(gray);
  if (n < MIN_BLOB) return null;
  return this._bestBlob(opts.pref || null, opts.stickR || 0.3);
};
/* Largest 4-connected blob in the mask — but a blob near the previous lock
 * wins over a bigger one elsewhere (a face is usually the largest skin blob
 * in frame; this keeps the hand). */
ColorTracker.prototype._bestBlob = function(pref, stickR) {
  var W = this.width, H = this.height, N = W * H;
  var mask = this.mask, seen = this.seen, stack = this.stack;
  var stamp = (this.stamp = (this.stamp + 1) | 0);
  var best = 0, bestX = 0, bestY = 0;
  var near = 0, nearX = 0, nearY = 0;
  for (var p = 0; p < N; p++) {
    if (!mask[p] || seen[p] === stamp) continue;
    var top = 0;
    stack[top++] = p; seen[p] = stamp;
    var cx = 0, cy = 0, cn = 0;
    while (top > 0) {
      var q = stack[--top];
      var qx = q % W, qy = (q / W) | 0;
      cx += qx; cy += qy; cn++;
      if (qx > 0)     { var a = q - 1;  if (mask[a] && seen[a] !== stamp)   { seen[a] = stamp;  stack[top++] = a; } }
      if (qx < W - 1) { var bb = q + 1; if (mask[bb] && seen[bb] !== stamp) { seen[bb] = stamp; stack[top++] = bb; } }
      if (qy > 0)     { var cc = q - W; if (mask[cc] && seen[cc] !== stamp) { seen[cc] = stamp; stack[top++] = cc; } }
      if (qy < H - 1) { var dd = q + W; if (mask[dd] && seen[dd] !== stamp) { seen[dd] = stamp; stack[top++] = dd; } }
    }
    if (cn > best) { best = cn; bestX = cx / cn; bestY = cy / cn; }
    if (pref && cn >= MIN_BLOB) {
      var gx = cx / cn / W - pref.x, gy = cy / cn / H - pref.y;
      if (gx * gx + gy * gy < stickR * stickR && cn > near) {
        near = cn; nearX = cx / cn; nearY = cy / cn;
      }
    }
  }
  if (near >= MIN_BLOB) return { x: nearX / W, y: nearY / H, n: near };
  if (best < MIN_BLOB) return null;
  return { x: bestX / W, y: bestY / H, n: best };
};
/* Color {r,g,b} at fractional frame coordinates (0..1). Throws if the frame
 * can't be read. */
ColorTracker.prototype.sampleAt = function(video, fx, fy) {
  this._ensureCanvas();
  this.ctx.drawImage(video, 0, 0, this.width, this.height);
  var d = this.ctx.getImageData(
    Math.floor(Math.min(0.99, Math.max(0, fx)) * this.width),
    Math.floor(Math.min(0.99, Math.max(0, fy)) * this.height), 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
};
/* Color under a click (clientX/clientY) on the video element. */
ColorTracker.prototype.sampleAtPoint = function(video, clientX, clientY) {
  var r = video.getBoundingClientRect();
  return this.sampleAt(video, (clientX - r.left) / r.width, (clientY - r.top) / r.height);
};

/* ================= camera ================= */

/* One live camera at a time: opening one releases the others, so phones
 * never hold two streams (battery + device limits). */
var Camera = {
  _live: null,       // {video, stream}
  _listeners: [],
  available: function() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices &&
      !!navigator.mediaDevices.getUserMedia;
  },
  /* Open the rear camera on `video`. Rejects with the browser's error
   * (err.name "NotAllowedError" when denied, "NoCameraApi" when missing). */
  start: function(video) {
    var self = this;
    if (!this.available()) {
      var e = new Error("Camera API not available");
      e.name = "NoCameraApi";
      return Promise.reject(e);
    }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function(stream) {
        // Release only after success: a denied request never kills a working camera.
        self._release();
        self._live = { video: video, stream: stream };
        video.srcObject = stream;
        return video.play().then(function() {
          self._emit(video);
          return stream;
        }, function(err) {
          self._release();
          self._emit(null);
          throw err;
        });
      });
  },
  stopAll: function() {
    this._release();
    this._emit(null);
  },
  /* The video element showing the live camera, or null. */
  liveVideo: function() { return this._live ? this._live.video : null; },
  /* fn(video|null) runs whenever the live camera moves or stops. */
  onChange: function(fn) { this._listeners.push(fn); },
  /* Current live frame as base64 JPEG (no data: prefix), longest side
   * <= maxSide, or null when no camera is live. */
  snapshot: function(maxSide, quality) {
    var v = this.liveVideo();
    if (!v || !v.videoWidth) return null;
    var scale = Math.min(1, (maxSide || 512) / Math.max(v.videoWidth, v.videoHeight));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    var ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality || 0.72).split(",", 2)[1];
  },
  _release: function() {
    var cur = this._live;
    this._live = null;
    if (!cur) return;
    cur.stream.getTracks().forEach(function(t) { t.stop(); });
    if (cur.video.srcObject === cur.stream) cur.video.srcObject = null;
  },
  _emit: function(video) {
    this._listeners.forEach(function(fn) { fn(video); });
  }
};

/* ================= rendering ================= */

/* Match a canvas's backing store to its CSS size × devicePixelRatio. */
function fitCanvas(cv) {
  var r = cv.getBoundingClientRect();
  var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  var w = Math.max(1, Math.round(r.width * dpr));
  var h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w: w, h: h, dpr: dpr };
}

var BALL_STYLES = {
  tennis:     { light: "#e9f27e", base: "#c4d000", dark: "#6d7800", seam: "#f5f5ec" },
  basketball: { light: "#f59a4e", base: "#dd671a", dark: "#7c3708", seam: "#2a1a10" },
  bowling:    { light: "#8494b3", base: "#2b3140", dark: "#080a0f", seam: "#04050a" },
  classic:    { light: "#ff8a7a", base: "#e5484d", dark: "#881b20", seam: null }
};
var SPIN = 6; // seam rotation per fraction of drop height travelled
function isBallStyle(s) { return Object.prototype.hasOwnProperty.call(BALL_STYLES, s); }
function makeBall(style) { return { style: isBallStyle(style) ? style : "tennis", angle: 0 }; }
function ballRadius(dims) { return Math.max(8 * dims.dpr, dims.w * 0.03); }

/* Soft ground shadow: tighter + darker as the ball nears the ground. */
function drawShadow(ctx, x, groundY, r, prox) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0," + (0.06 + 0.28 * prox).toFixed(3) + ")";
  ctx.beginPath();
  ctx.ellipse(x, groundY - 2, r * (1.7 - 0.7 * prox), Math.max(1, r * 0.22), 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
function drawBall(ball, ctx, x, y, r) {
  var P = BALL_STYLES[ball.style] || BALL_STYLES.tennis;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.clip();
  // Spherical shading: light from top-left, dark limb at the edge.
  var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.1, x, y, r * 1.3);
  g.addColorStop(0, P.light);
  g.addColorStop(0.55, P.base);
  g.addColorStop(1, P.dark);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  // Seams rotate as the ball spins.
  if (P.seam) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ball.angle);
    ctx.strokeStyle = P.seam;
    ctx.lineWidth = Math.max(1, r * 0.075);
    ctx.lineCap = "round";
    if (ball.style === "tennis") {
      ctx.beginPath(); ctx.arc(-r * 1.05, 0, r * 0.95, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 1.05, 0, r * 0.95, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      // Felt speckle (deterministic — no flicker between frames).
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (var i = 0; i < 50; i++) {
        var fx = (((i * 73) % 100) / 100) * 2 * r - r;
        var fy = (((i * 137) % 100) / 100) * 2 * r - r;
        if (fx * fx + fy * fy < r * r * 0.9) ctx.fillRect(fx, fy, 1.2, 1.2);
      }
    } else if (ball.style === "basketball") {
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 1.35, 0, r * 0.95, -0.7, 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 1.35, 0, r * 0.95, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
    } else if (ball.style === "bowling") {
      ctx.fillStyle = P.seam;
      [[-r * 0.25, -r * 0.3], [r * 0.22, -r * 0.34], [0, r * 0.02]].forEach(function(o) {
        ctx.beginPath(); ctx.arc(o[0], o[1], r * 0.11, 0, 2 * Math.PI); ctx.fill();
      });
    }
    ctx.restore();
  }
  // Specular highlight — fixed light source, does not rotate.
  ctx.save();
  ctx.translate(x - r * 0.36, y - r * 0.44); ctx.rotate(-0.5);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.26, r * 0.15, 0, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
  // Contact shading along the lower limb + crisp outline.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}

/* Simulate overlay: height ruler, ground, trail and the falling ball.
 * opts: {h (drop height, m), trail (bool)}. */
function drawFallScene(ctx, dims, fall, opts) {
  var W = dims.w, H = dims.h, h = opts.h;
  ctx.clearRect(0, 0, W, H);
  var pxPerM = H / h;
  // ruler ticks every h/4
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(1, dims.dpr);
  ctx.font = (11 * dims.dpr) + "px system-ui, sans-serif";
  for (var i = 0; i <= 4; i++) {
    var my = h * i / 4;
    var py = H - my * pxPerM;
    ctx.beginPath(); ctx.moveTo(8 * dims.dpr, py); ctx.lineTo(20 * dims.dpr, py); ctx.stroke();
    ctx.fillText(my.toFixed(2).replace(/\.?0+$/, "") + " m", 24 * dims.dpr, py + 4 * dims.dpr);
  }
  // ground line
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
  if (opts.trail) {
    ctx.fillStyle = "rgba(78,205,196,0.55)";
    fall.trail.forEach(function(ty) {
      ctx.beginPath();
      ctx.arc(W / 2, Math.min(H - 6 * dims.dpr, (ty / h) * H), 4 * dims.dpr, 0, 2 * Math.PI);
      ctx.fill();
    });
  }
  var r = ballRadius(dims);
  var by = Math.min(H - r, (fall.y / h) * H + r);
  drawShadow(ctx, W / 2, H, r, Math.min(1, fall.y / h));
  drawBall(fall.ball || makeBall(), ctx, W / 2, by, r);
}

/* Auto-track overlay: a ring on the tracked point {x, y} (0..1). */
function drawTrackMarker(ctx, dims, c) {
  ctx.strokeStyle = "#4ecd64";
  ctx.lineWidth = 2 * dims.dpr;
  ctx.beginPath();
  ctx.arc(c.x * dims.w, c.y * dims.h, 12 * dims.dpr, 0, 2 * Math.PI);
  ctx.stroke();
}

/* "Tracker view": paint the tracker's last match mask as green dots. */
function drawTrackerMask(ctx, dims, tracker) {
  if (!tracker.mask) return;
  var MW = tracker.width, MH = tracker.height;
  ctx.fillStyle = "rgba(0,255,102,0.45)";
  for (var my = 0; my < MH; my += 2) {
    for (var mx = 0; mx < MW; mx += 2) {
      if (tracker.mask[my * MW + mx]) {
        ctx.fillRect(mx / MW * dims.w, my / MH * dims.h, 2 * dims.dpr, 2 * dims.dpr);
      }
    }
  }
}

/* Dashed release line at `frac` of the frame height. */
function drawDropLine(ctx, dims, frac) {
  var ly = frac * dims.h;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = Math.max(1, dims.dpr);
  ctx.setLineDash([6 * dims.dpr, 5 * dims.dpr]);
  ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(dims.w, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = (11 * dims.dpr) + "px system-ui, sans-serif";
  ctx.fillText("lift to drop", 8 * dims.dpr, ly - 5 * dims.dpr);
}

/* Hand-hold overlay. x follows the hand, y follows the hand or the fall.
 * opts: {h (ceiling, m), dropLine (0..1 or null), tracker (show mask, or null)}. */
function drawHandScene(ctx, dims, hb, opts) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var ynorm = 1 - hb.yM / opts.h;
  var bx = hb.sx * dims.w;
  var by = Math.min(dims.h - 8 * dims.dpr, Math.max(8 * dims.dpr, ynorm * dims.h));
  var r = ballRadius(dims);
  if (opts.tracker) drawTrackerMask(ctx, dims, opts.tracker);
  if (opts.dropLine != null && !hb.falling && !hb.landed) drawDropLine(ctx, dims, opts.dropLine);
  if (hb.fix) {
    ctx.strokeStyle = hb.falling ? "#e5484d" : "#4ecd64";
    ctx.lineWidth = 2 * dims.dpr;
    ctx.beginPath();
    ctx.arc(bx, by, r + 6 * dims.dpr, 0, 2 * Math.PI);
    ctx.stroke();
  }
  drawBall(hb.ball || makeBall(), ctx, bx, by, r);
}

/* Small y-vs-t chart: measured points and the fitted parabola. */
function drawFitPlot(ctx, dims, points, fit) {
  ctx.clearRect(0, 0, dims.w, dims.h);
  var tMax = points[points.length - 1].t || 1;
  var yMax = 0;
  points.forEach(function(s) { yMax = Math.max(yMax, s.y); });
  yMax = Math.max(yMax, 0.01);
  function X(t) { return 30 * dims.dpr + (t / tMax) * (dims.w - 40 * dims.dpr); }
  function Y(y) { return dims.h - 14 * dims.dpr - (y / yMax) * (dims.h - 24 * dims.dpr); }
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = dims.dpr;
  ctx.beginPath(); ctx.moveTo(30 * dims.dpr, 4); ctx.lineTo(30 * dims.dpr, dims.h - 14 * dims.dpr);
  ctx.lineTo(dims.w - 6, dims.h - 14 * dims.dpr); ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = (10 * dims.dpr) + "px system-ui, sans-serif";
  ctx.fillText("t (s)", dims.w - 34 * dims.dpr, dims.h - 3 * dims.dpr);
  ctx.fillText("y (m)", 4 * dims.dpr, 10 * dims.dpr);
  ctx.strokeStyle = "#1a56db";
  ctx.lineWidth = 2 * dims.dpr;
  ctx.beginPath();
  for (var i = 0; i <= 40; i++) {
    var t = tMax * i / 40;
    var y = fit.y0 + (fit.v0 || 0) * t + (fit.g / 2) * t * t;
    if (i === 0) ctx.moveTo(X(t), Y(y)); else ctx.lineTo(X(t), Y(y));
  }
  ctx.stroke();
  ctx.fillStyle = "#e5484d";
  points.forEach(function(s) {
    ctx.beginPath(); ctx.arc(X(s.t), Y(s.y), 2.2 * dims.dpr, 0, 2 * Math.PI); ctx.fill();
  });
}

/* ================= simulations ================= */

/* Virtual ball falling from rest. y is distance fallen (m, downward). */
function FreeFall() {
  this.ball = null;
  this.reset();
}
FreeFall.prototype.reset = function() {
  this.t = 0; this.y = 0; this.v = 0; this.trail = [];
};
/* Advance by dt seconds. Returns true once the ball reaches height h. */
FreeFall.prototype.step = function(dt, g, h, keepTrail) {
  this.v += g * dt;
  this.y += this.v * dt;
  this.t += dt;
  if (this.ball) this.ball.angle += (this.v * dt) / h * SPIN;
  if (keepTrail) {
    this.trail.push(this.y);
    if (this.trail.length > 120) this.trail.shift();
  }
  if (this.y >= h) { this.y = h; return true; }
  return false;
};

/* Virtual ball held by a tracked hand, then released into free fall.
 * sx, sy: smoothed hand position (0..1 frame units). yM: ball height (m).
 * Time values (`now`) are performance.now() milliseconds. */
var CALM_MS = 600;   // ignore the drop line this long after a fresh lock
var COAST_MS = 150;  // dead-reckon through tracking dropouts this short
function HandBall() {
  this.ball = null;
  this.sx = 0.5; this.sy = 0.3;
  this.fix = false;     // hand position is known
  this.steady = false;  // lock has held for at least one frame
  this.falling = false; this.landed = false; this.justResumed = false;
  this.t = 0; this.yM = 0; this.v = 0; this.h0 = 0; this.prevYM = 0;
  this.hvx = 0; this.hvy = 0; // smoothed hand velocity (frames/s)
  this.calmUntil = 0; this.lastSeen = 0; this.last = 0;
}
HandBall.prototype.start = function(now) { this.last = now; };
/* Pause guard (e.g. while hidden): a position jump can't fake a throw. */
HandBall.prototype.calm = function(now) {
  this.calmUntil = now + CALM_MS;
  this.hvx = 0; this.hvy = 0;
};
/* Drop the hand lock, so the next frame re-acquires from scratch. */
HandBall.prototype.forgetLock = function() { this.fix = false; };
HandBall.prototype.speed = function() { return Math.sqrt(this.hvx * this.hvx + this.hvy * this.hvy); };
/* Height the current or next drop starts from. */
HandBall.prototype.dropHeight = function() {
  return (this.falling || this.landed) ? this.h0 : this.yM;
};
/* One frame. p: {g, h, motion (bool), dropLine (0..1 or null)}.
 * detect(motion, pref) returns the hand centroid {x, y} or null.
 * Returns an event (see drop) or {type: "landed"|"lost"}, or null. */
HandBall.prototype.update = function(now, p, detect) {
  var ev = null;
  if (this.falling) {
    var dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.v += p.g * dt;
    this.yM -= this.v * dt;
    this.t += dt;
    if (this.yM > p.h) { this.yM = p.h; this.v = 0; } // tossed above frame: stall at ceiling, then fall
    if (this.ball) this.ball.angle += (this.v * dt) / p.h * SPIN;
    if (this.yM <= 0) {
      this.yM = 0; this.falling = false; this.landed = true;
      ev = { type: "landed", t: this.t, h0: this.h0 };
    }
    return ev;
  }
  if (this.landed) return null;

  var dtN = Math.min(0.1, Math.max(0.005, (now - this.last) / 1000));
  this.last = now;
  var was = this.steady;
  var psx = this.sx, psy = this.sy;
  var pref = this.fix ? { x: this.sx, y: this.sy } : null;
  var c = detect(p.motion, pref);
  if (!c && p.motion && was) {
    // Still hand, not a gone hand: retry without the motion gate so a pause
    // keeps the lock (new locks still require motion). Zero the velocity so
    // a statue can't throw.
    c = detect(false, pref);
    if (c) { this.hvx = 0; this.hvy = 0; }
  }
  if (c) {
    this.lastSeen = now;
    // Exponential smoothing against frame-to-frame jitter.
    this.sx += 0.45 * (c.x - this.sx);
    this.sy += 0.45 * (c.y - this.sy);
    this.fix = true;
    // Smoothed hand velocity sets throw strength on release.
    this.hvx += 0.35 * ((this.sx - psx) / dtN - this.hvx);
    this.hvy += 0.35 * ((this.sy - psy) / dtN - this.hvy);
    if (!was) this.calm(now); // fresh lock: ignore the jump that acquired it
    this.steady = true;
  } else if (this.steady && (now - this.lastSeen) < COAST_MS) {
    // Coast through brief dropouts (motion blur, blink frames).
    this.sx = Math.min(1, Math.max(0, this.sx + this.hvx * dtN));
    this.sy = Math.min(1, Math.max(0, this.sy + this.hvy * dtN));
  } else {
    // Truly lost: disarm until the hand returns.
    if (this.steady || this.fix) ev = { type: "lost" };
    this.steady = false;
    this.fix = false;
  }
  if (this.steady && p.dropLine != null && now > this.calmUntil && this.sy < p.dropLine) {
    // Crossing speed becomes throw velocity; a slow crossing drops from rest.
    ev = this.drop(Math.max(0, p.h * this.hvy), "drag", now);
  }
  if (!this.falling) { // the line may have released mid-frame; then keep release state
    this.yM = p.h * (1 - this.sy);
    this.t = 0; this.v = 0;
    if (this.justResumed || !this.fix) {
      this.prevYM = this.yM; // re-pickup: sync, don't spin-burst
      this.justResumed = false;
    } else if (this.ball) {
      this.ball.angle += Math.abs(this.yM - this.prevYM) / p.h * SPIN;
      this.prevYM = this.yM;
    }
  } else {
    this.prevYM = this.yM;
  }
  return ev;
};
/* Release the ball with downward speed v0 (m/s). Returns
 * {type: "released", v0, h0, how}, {type: "refused", reason: "landed"|"no-hand"},
 * or null when already falling. */
HandBall.prototype.drop = function(v0, how, now) {
  if (this.falling) return null;
  if (this.landed) return { type: "refused", reason: "landed" };
  if (!this.fix) return { type: "refused", reason: "no-hand" };
  this.h0 = Math.max(0.05, this.yM);
  this.yM = this.h0;
  this.t = 0; this.v = v0 || 0;
  this.falling = true;
  this.last = now;
  return { type: "released", v0: this.v, h0: this.h0, how: how || "button" };
};
/* Back to holding. Returns true if the hand was locked before. */
HandBall.prototype.pickUp = function() {
  var had = this.fix;
  this.falling = false;
  this.landed = false;
  this.justResumed = true;
  this.fix = false; // force a fresh lock so a stale spot is never trusted
  this.steady = false;
  this.t = 0; this.v = 0;
  return had;
};

/* ================= export ================= */

var ARCore = {
  REFERENCE_G: REFERENCE_G,
  physics: {
    fallTime: fallTime, gravityFromDrop: gravityFromDrop,
    mean: mean, std: std, median: median, percentError: percentError,
    fitGravity: fitGravity, fitFreeFall: fitFreeFall
  },
  color: {
    colorDistSq: colorDistSq, isSkinPixel: isSkinPixel, isBlueBackdrop: isBlueBackdrop,
    PRESETS: COLOR_PRESETS, preset: colorPreset
  },
  render: {
    fitCanvas: fitCanvas, BALL_STYLES: BALL_STYLES, isBallStyle: isBallStyle, makeBall: makeBall,
    drawBall: drawBall, drawShadow: drawShadow, drawFallScene: drawFallScene,
    drawTrackMarker: drawTrackMarker, drawTrackerMask: drawTrackerMask,
    drawDropLine: drawDropLine, drawHandScene: drawHandScene, drawFitPlot: drawFitPlot
  },
  analyzeFall: analyzeFall,
  ColorTracker: ColorTracker,
  Camera: Camera,
  FreeFall: FreeFall,
  HandBall: HandBall
};

if (typeof module !== "undefined" && module.exports) module.exports = ARCore;
else root.ARCore = ARCore;

})(typeof self !== "undefined" ? self : this);
