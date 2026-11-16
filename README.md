# AR Physics Lab

In-browser physics experiments that use your camera. All video is processed locally in
the browser. Vanilla JS, no build step.

- **Exp 01 — Dropping a ball.** Catch a virtual ball with a fist, open your hand to drop
  it, and work out g from the falls on a t²-vs-h graph (hand tracking with MediaPipe,
  mirrored like a mirror; or play with mouse/touch, press-and-hold = fist; a "mystery
  planet" hides g). Real drops can also be auto-tracked or timed with a stopwatch.
- **Exp 02 — Projectile motion.** Toss a ball across the frame: g, launch speed and
  angle from its arc, and a check that the sideways speed stays constant.
- **Exp 03 — Pendulum period.** Time a ball swinging on a string: period, damping, and
  g from `T = 2π√(L/g)`, corrected for the swing's size.

Two audiences: **schools**, where children run these experiments for real with a phone or
laptop camera (`index.html`, one experiment at a time, step by step); and **industry**,
where scientists and engineers simulate from their own measured parameters
(`workbench.html`, the Physics Workbench). The workbench so far simulates a falling object
with air drag (landing time, impact speed and energy, terminal speed, CSV export); importing
measured data to fit, measured-vs-simulated overlays and what-if sweeps come next.

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
  projectile.js       analyzeProjectile: a thrown ball's track → g, launch velocity, angle
  pendulum.js         analyzePendulum: a swinging bob's track → period, damping, g
  trigger.js          FallTrigger / ThrowTrigger: start on the drop or throw, stop when it ends
  calibration.js      pixels → meters: from ball size, two taps, or frame height
  replay.js           draw a measured fall or throw back over the video, beside a 9.81 ghost
  framebuffer.js      FrameRing: recent frames kept for stepping through a fall
  physics.js          kinematics, least-squares (quadratic, line) and outlier-robust fits
  sim.js              FreeFall (Simulate) and HandBall, exact closed-form motion
  gesture.js          hand openness from landmarks, grab/release gestures, CatchBall
  models.js           engineering models for the workbench: simulateFall (quadratic air drag)
  render.js           canvas drawing: realistic balls, overlays, result plots
lab/                the experiment page
  lab.html            markup (an HTML fragment)
  lab.css             styles
  main.js             entry: tabs and boot
  ui.js               shared helpers: status lines, saved settings, the camera
  handtrack.js        loads MediaPipe hand tracking on first use (~18 MB, then cached)
  sounds.js           small synthesized sound effects (Web Audio)
  modes/              one file per mode: catch, track, measure, simulate (Exp 01),
                        projectile (Exp 02), pendulum (Exp 03); shared by the tracking
                        modes: review.js (replay + frame slider), scale.js (calibration)
  assistant.js        local-LLM lab assistant (+ ollama.js, lablog.js)
workbench.html      Physics Workbench page (+ workbench/workbench.js)
styles/base.css     theme styles the standalone page needs
tests/              unit tests for the core
```

The core knows nothing about `lab.html`: callers pass in video and canvas elements
plus plain numbers, and get plain results back. `lab/lab.js` is the only file that
`lab/` is the only code that knows element ids. `loader.js` injects `lab/main.js` as a module, which imports the core.

Auto-track in practice: press **Arm**, hold the ball still, let go. Recording starts
and stops by itself, g is fitted, and the fall replays in slow motion over the video
with a 9.81 m/s² ghost ball; a slider steps through the recorded frames. The projectile
experiment works the same way with a throw, and its replay adds velocity arrows.

The pendulum: set it swinging, press **Start**, and it stops by itself after the
chosen number of swings.

How measurements stay accurate:

- **One sample per camera frame, with its capture time.** `FrameClock` uses
  `requestVideoFrameCallback`, so a 60 Hz page loop over a 30 fps camera doesn't
  record each frame twice. `analyzeFall` also drops any repeated timestamps.
- **Outlier-robust fit.** A false detection is dropped (residual > 3.5 robust σ)
  before fitting `y = y0 + v0·t + ½·g·t²`; the result includes g's standard error.
- **Scale from the ball itself.** With the ball's diameter known, its width is
  measured on a full-resolution crop of every falling frame (width, since motion
  blur only stretches it vertically), and the median sets pixels per meter. Or tap
  the two ends of a known length.
- **Throws: only the free flight is fitted.** The fit starts on the middle of the
  recording and grows outward while points stay on one arc, so frames where the hand
  is still pushing, and the catch or landing, drop out. x and y are fitted
  separately (`x` linear, `y` quadratic). The ball is sized across its motion (height
  for a sideways throw), because motion blur stretches it along the motion.
- **Pendulums: timed at the center.** Each pass through the middle is timed by a line
  fit through the frames around it, and a line through pass time vs. pass number gives
  the period with its standard error. Passes missed while the ball was hidden leave a
  gap in the numbering, not an error. The period is corrected for amplitude with the
  exact factor `1/AGM(1, cos θ/2)`.
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

**Unit tests (terminal, no server).** `./tests/run.sh` runs them with Node 20+ if
installed (same as `npm test`), otherwise with macOS's built-in JavaScriptCore. They
cover the fits, the drop, throw and pendulum analyses (the pendulum against an
RK4-integrated nonlinear swing), tracker, both simulations, both triggers, replay
mapping, frame buffer, calibration, and the test bench's scenes. The camera tests
need a browser: with the local server running, open <http://localhost:8000/tests/>
to run everything.

**Test bench (browser, no ball needed).** Open
<http://localhost:8000/tests/bench.html>. It's the real lab with the camera replaced
by a simulated scene: a red ball dropping, being thrown (with a hand push and an
optional wind-up dip), or swinging on a string as a real damped, nonlinear
pendulum. Sensor jitter and motion blur are optional. Every **Open camera** button
shows the scene, so the whole flow works as with a real camera: pick a scene, arm
the experiment, press **Go**. The panel shows the true values next to what the lab
measured. Tick **Use my real camera** (or open `bench.html?camera=real`) to switch the same page to your webcam; untick it to go back. **Run checks** (or open `bench.html?run=1`) drives the page by itself
through six cases (two drops, two throws, two pendulums) and grades each result. It
allows ±5% on the scale-dependent drop and throw g and ±1% on the pendulum; the
page title turns into `PASS 6/6` or `FAIL n/6`.
