import { test, assert, near, rejects } from "./harness.js";
import { Camera, FrameClock } from "../core/camera.js";

/* Fakes for getUserMedia, MediaStream and <video>. */
function fakeTrack() {
  const listeners = {};
  return {
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); }
  };
}
function fakeStream() {
  const track = fakeTrack();
  return { track, getTracks: () => [track] };
}
function fakeVideo(playOk = true) {
  return { srcObject: null, play: () => (playOk ? Promise.resolve() : Promise.reject(new Error("play"))) };
}
/* getUserMedia whose calls resolve/reject only when the test says so. */
function controlledDevices() {
  const calls = [];
  return {
    calls,
    getUserMedia() {
      return new Promise((resolve, reject) => calls.push({ resolve, reject, stream: fakeStream() }));
    }
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("start attaches the stream and reports the live video", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const seen = [];
  cam.onChange((v) => seen.push(v));
  const v = fakeVideo();
  const p = cam.start(v);
  dev.calls[0].resolve(dev.calls[0].stream);
  await p;
  assert(v.srcObject === dev.calls[0].stream, "attached");
  assert(cam.liveVideo() === v && seen[0] === v, "live + notified");
});

test("opening a second camera stops the first", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const a = fakeVideo(), b = fakeVideo();
  let p = cam.start(a); dev.calls[0].resolve(dev.calls[0].stream); await p;
  p = cam.start(b); dev.calls[1].resolve(dev.calls[1].stream); await p;
  assert(dev.calls[0].stream.track.stopped, "first stream stopped");
  assert(a.srcObject === null && b.srcObject === dev.calls[1].stream, "moved to b");
  assert(cam.liveVideo() === b, "b is live");
});

test("racing opens: only the newest keeps its stream", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const a = fakeVideo(), b = fakeVideo();
  const pa = cam.start(a), pb = cam.start(b);
  dev.calls[1].resolve(dev.calls[1].stream); // newer one answers first
  await pb;
  dev.calls[0].resolve(dev.calls[0].stream);
  await rejects(pa, "AbortError");
  assert(dev.calls[0].stream.track.stopped, "stale stream stopped, not leaked");
  assert(!dev.calls[1].stream.track.stopped && cam.liveVideo() === b, "newest kept");
});

test("a denied request leaves the working camera alone", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const a = fakeVideo();
  let p = cam.start(a); dev.calls[0].resolve(dev.calls[0].stream); await p;
  p = cam.start(fakeVideo());
  const denied = new Error("no"); denied.name = "NotAllowedError";
  dev.calls[1].reject(denied);
  await rejects(p, "NotAllowedError");
  assert(!dev.calls[0].stream.track.stopped && cam.liveVideo() === a, "still live");
});

test("a track ending (camera unplugged) stops and notifies", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const seen = [];
  cam.onChange((v) => seen.push(v));
  const v = fakeVideo();
  const p = cam.start(v); dev.calls[0].resolve(dev.calls[0].stream); await p;
  dev.calls[0].stream.track.fire("ended");
  assert(cam.liveVideo() === null && v.srcObject === null, "released");
  assert(seen[seen.length - 1] === null, "notified with null");
});

test("play() failure releases the stream", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const p = cam.start(fakeVideo(false));
  dev.calls[0].resolve(dev.calls[0].stream);
  await rejects(p);
  assert(dev.calls[0].stream.track.stopped && cam.liveVideo() === null, "released");
});

test("stopAll during a permission prompt cancels that request", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const p = cam.start(fakeVideo());
  cam.stopAll();
  dev.calls[0].resolve(dev.calls[0].stream);
  await rejects(p, "AbortError");
  assert(dev.calls[0].stream.track.stopped, "late stream stopped");
});

test("no camera API rejects with NoCameraApi", async () => {
  await rejects(new Camera({ mediaDevices: {} }).start(fakeVideo()), "NoCameraApi");
});

test("listener errors don't break the camera; unsubscribe works", async () => {
  const dev = controlledDevices();
  const cam = new Camera({ mediaDevices: dev });
  const origError = console.error;
  console.error = () => {};
  let calls = 0;
  cam.onChange(() => { throw new Error("listener bug"); });
  const off = cam.onChange(() => calls++);
  off();
  try {
    const p = cam.start(fakeVideo()); dev.calls[0].resolve(dev.calls[0].stream); await p;
  } finally { console.error = origError; }
  assert(calls === 0, "unsubscribed");
});

/* ---------- FrameClock ---------- */
function rvfcVideo() {
  let cb = null, id = 0;
  return {
    requestVideoFrameCallback(fn) { cb = fn; return ++id; },
    cancelVideoFrameCallback() { cb = null; },
    present(now, meta) { const f = cb; cb = null; if (f) f(now, meta); }
  };
}

test("FrameClock returns each camera frame once, with its capture time", () => {
  const v = rvfcVideo();
  const clock = new FrameClock(v);
  clock.start();
  assert(clock.next() === null, "nothing yet");
  v.present(100, { mediaTime: 1.0, captureTime: 5000 });
  near(clock.next().time, 5000, 0, "capture time preferred");
  assert(clock.next() === null, "same frame not returned twice");
  v.present(133, { mediaTime: 1.033, captureTime: 5033 });
  near(clock.next().time, 5033, 0, "next frame");
  clock.stop();
  v.present(166, { captureTime: 5066 });
  assert(clock.next() === null, "stopped");
});

test("FrameClock falls back to media time, and to 'now' without rVFC", () => {
  const v = rvfcVideo();
  const clock = new FrameClock(v);
  clock.start();
  v.present(100, { mediaTime: 2.5 });
  near(clock.next().time, 2500, 1e-9, "media time in ms");
  const plain = new FrameClock({});
  plain.start();
  assert(!plain.supported && plain.next(42).time === 42, "fallback stamps now");
});
