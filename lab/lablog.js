/* Lab event log: recent failures and the last fit of each experiment.
 * Feeds the assistant; never leaves the device. */
export var LabLog = {
  failures: [],
  lastFit: null,     // Exp 01 auto-track (free fall)
  projectile: null,  // Exp 02
  pendulum: null,    // Exp 03
  catchDrops: null,  // Exp 01 catch & drop: virtual drops table summary
  push: function(kind, detail) {
    this.failures.push({ kind: kind, detail: detail, at: new Date().toLocaleTimeString() });
    if (this.failures.length > 5) this.failures.shift();
  }
};
