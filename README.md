# AR Physics Lab

In-browser physics experiments that use your camera. A virtual ball falls over the live
camera feed, and real drops can be timed or auto-tracked to measure gravity. All video
is processed locally in the browser. Vanilla JS, no build step.

Live: <https://mohankku.github.io/ar-physics-lab/> · also embedded at
<https://mohankku.github.io/physics>.

## Files

| File | What it is |
| --- | --- |
| `lab.html` | The lab's markup (an HTML fragment) |
| `physics.js` | Experiment logic; pure helpers are on `window.PhysLab` |
| `physics.css` | Lab styles |
| `loader.js` | Injects `lab.html`, `physics.css` and `physics.js` into a `[data-phys-lab]` element |
| `index.html`, `base.css` | Standalone page and the theme styles it needs |

## Embedding

```html
<div data-phys-lab></div>
<script src="https://mohankku.github.io/ar-physics-lab/loader.js" defer></script>
```

The host page should provide Font Awesome 6 and the `.pub-btn` / `.topic-pill` styles
(see `base.css`).

## Running locally

Any static server works, e.g. `python3 -m http.server` then open
<http://localhost:8000>. The camera needs `localhost` or HTTPS.
