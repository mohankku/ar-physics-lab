/* Shared test helpers. Under Node, `test` is node:test; in the browser it
 * queues tests for runAll() (see tests/index.html). */

const isNode = typeof window === "undefined";
const queue = [];

export const test = isNode
  ? (await import("node:test")).test
  : (name, fn) => { queue.push({ name, fn }); };

/** Browser only: run queued tests in order; returns {pass, fail, results}. */
export async function runAll() {
  const results = [];
  for (const { name, fn } of queue) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e && e.stack ? e.stack : String(e) }); }
  }
  const fail = results.filter((r) => !r.ok).length;
  return { pass: results.length - fail, fail, results };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

export function near(actual, expected, tol, what = "value") {
  assert(Math.abs(actual - expected) <= tol,
    `${what}: expected ${expected} ± ${tol}, got ${actual}`);
}

export async function rejects(promise, name) {
  try { await promise; } catch (e) {
    assert(!name || e.name === name, `expected ${name}, got ${e.name}: ${e.message}`);
    return e;
  }
  throw new Error(`expected rejection${name ? " with " + name : ""}`);
}

export function throws(fn, Type) {
  try { fn(); } catch (e) {
    assert(!Type || e instanceof Type, `expected ${Type && Type.name}, got ${e}`);
    return e;
  }
  throw new Error("expected an exception");
}

/** Deterministic pseudo-random numbers in [0, 1). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Roughly normal noise (sum of uniforms), mean 0, given sigma. */
export function gaussian(rand, sigma) {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rand();
  return (s - 3) * sigma * Math.SQRT2;
}
