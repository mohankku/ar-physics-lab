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
core/ar-core.js     AR engine: camera, color tracking, ball rendering, fall physics
lab/lab.html        lab markup (an HTML fragment)
lab/lab.js          page wiring: reads controls, drives the core, shows results
lab/lab.css         lab styles
styles/base.css     theme styles the standalone page needs
tests/              unit tests for the core
```

`core/ar-core.js` knows nothing about `lab.html`: callers pass in video and canvas
elements plus plain numbers, and get plain results back. It loads as `window.ARCore`
in the browser (and as a CommonJS module in Node). The main pieces:

| Piece | What it does |
| --- | --- |
| `ARCore.Camera` | One live camera at a time; `start(video)`, `stopAll()`, `onChange(fn)`, `snapshot()` |
| `ARCore.ColorTracker` | Finds a colored or skin blob in video frames (sticky lock, motion gate, blue-screen filter) |
| `ARCore.FreeFall` | Virtual ball falling from rest (Simulate mode) |
| `ARCore.HandBall` | Ball held by a tracked hand, released at the drop line (Hand-hold mode) |
| `ARCore.analyzeFall` | Tracked pixel points → gravity fit, or a reason it failed (Auto-track mode) |
| `ARCore.physics` | Kinematics and least-squares fits |
| `ARCore.render` | Canvas drawing: realistic balls, overlays, fit plot |

`lab/lab.js` is the only file that knows element ids. `loader.js` loads
`core/ar-core.js` before `lab/lab.js`.

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

Open <http://localhost:8000/tests/> with the local server running, or run
`node --test tests/` if you have Node.
