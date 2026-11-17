/* Runs the unit tests in macOS's built-in JavaScriptCore shell (jsc), for
 * machines without Node. Use tests/run.sh rather than calling this directly.
 * The harness takes "window" to mean "browser": it then queues tests for
 * runAll() instead of loading node:test. */
globalThis.window = globalThis.window || {};
const FILES = ["physics", "analysis", "projectile", "pendulum", "models", "gesture", "catchview", "bench-scene", "vision",
  "sim", "trigger", "replay", "framebuffer", "calibration"];
const { runAll } = await import("./harness.js");
for (const f of FILES) await import(`./${f}.test.js`);
const { pass, fail, results } = await runAll();
for (const r of results) {
  print((r.ok ? "  ok   " : "  FAIL ") + r.name);
  if (!r.ok) print("         " + String(r.error).split("\n").slice(0, 3).join("\n         "));
}
print(`\n${pass} passed, ${fail} failed` + "  (camera tests need a browser: open tests/ on a local server)");
if (fail) throw new Error(`${fail} test(s) failed`);
