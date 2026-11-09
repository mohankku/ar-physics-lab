/* Lab event log: recent failures and the last auto-track fit. Feeds the
 * assistant; never leaves the device. */
export var LabLog = {
  failures: [],
  lastFit: null,
  push: function(kind, detail) {
    this.failures.push({ kind: kind, detail: detail, at: new Date().toLocaleTimeString() });
    if (this.failures.length > 5) this.failures.shift();
  }
};
