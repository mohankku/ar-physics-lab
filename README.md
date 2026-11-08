# AR Physics Lab

In-browser physics experiments that use your camera. A virtual ball falls over the live
camera feed, and real drops can be timed or auto-tracked to measure gravity. All video
is processed locally in the browser. Vanilla JS, no build step.

Live: <https://mohankku.github.io/ar-physics-lab/> · also embedded at
<https://mohankku.github.io/physics>.

## Layout

```
index.html          standalone page
loader.js           embed entry point (public URL; keep at the root)
core/               AR engine (ES modules, no dependencies)
  index.js            public API — import * as AR from "./core/index.js"
  camera.js           Camera (one live stream, race-safe), FrameClock (per-frame capture times)
  vision.js           ColorTracker: color/skin blob tracking with sticky lock and motion gate
  analysis.js         analyzeFall: tracked points → g ± uncertainty, or why it failed
  physics.js          kinematics, least-squares and outlier-robust fits
  sim.js              FreeFall (Simulate) and HandBall (Hand-hold), exact closed-form motion
  render.js           canvas drawing: realistic balls, overlays, fit plot
lab/                the experiment page
  lab.html            markup (an HTML fragment)
  lab.css             styles
  main.js             entry: tabs and boot
  ui.js               shared helpers: status lines, saved settings, the camera
  modes/              one file per mode: simulate, measure, track, hold
  assistant.js        local-LLM lab assistant (+ ollama.js, lablog.js)
styles/base.css     theme styles the standalone page needs
tests/              unit tests for the core
```

The core knows nothing about `lab.html`: callers pass in video and canvas elements
plus plain numbers, and get plain results back. `lab/lab.js` is the only file that
`lab/` is the only code that knows element ids. `loader.js` injects `lab/main.js` as a module, which imports the core.

How measurements stay accurate:

- **One sample per camera frame, with its capture time.** `FrameClock` uses
  `requestVideoFrameCallback`, so a 60 Hz page loop over a 30 fps camera doesn't
  record each frame twice. `analyzeFall` also drops any repeated timestamps.
- **Outlier-robust fit.** A false detection is dropped (residual > 3.5 robust σ)
  before fitting `y = y0 + v0·t + ½·g·t²`; the result includes g's standard error.
- **Exact simulated motion.** Falls use closed-form kinematics, so landing times
  match `√(2h/g)` at any frame rate. Hand smoothing uses time constants rather than
  per-frame factors, so it behaves the same at 30 and 60 fps.

## Embedding

```html
<div data-phys-lab></div>
<script src="https://mohankku.github.io/ar-physics-lab/loader.js" defer></script>
```

The host page should provide Font Awesome 6 and the `.pub-btn` / `.topic-pill` styles
(see `styles/base.css`).

## Running locally

Any static server works, e.g. `python3 -m http.server` then open
<http://localhost:8000>. The camera needs `localhost` or HTTPS.

## Tests

With the local server running, open <http://localhost:8000/tests/>; or, with
Node 20+, run `npm test`. The tests cover the fits, analysis, tracker, camera
(with a fake `getUserMedia`), frame clock and both simulations.
