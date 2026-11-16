/* Tiny synthesized sound effects (Web Audio, no files). Browsers only allow
 * audio after a user gesture, so call unlock() from a click handler. */

var ctx = null;

function unlock() {
  try {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { ctx = null; }
}

/* One tone: frequency glide f0 → f1 over `dur` s, quick attack, decay. */
function tone(f0, f1, dur, gain, type) {
  if (!ctx || ctx.state !== "running") return;
  var t = ctx.currentTime;
  var osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

var Sounds = {
  enabled: true,
  unlock: unlock,
  grab: function() { if (this.enabled) tone(520, 780, 0.09, 0.18, "triangle"); },
  catchAir: function() {
    if (!this.enabled) return;
    tone(660, 990, 0.08, 0.18, "triangle");
    setTimeout(function() { tone(880, 1320, 0.1, 0.16, "triangle"); }, 70);
  },
  release: function() { if (this.enabled) tone(420, 300, 0.07, 0.08, "sine"); },
  land: function() {
    if (!this.enabled) return;
    tone(180, 60, 0.22, 0.4, "sine");
    tone(90, 40, 0.18, 0.25, "square");
  }
};

export { Sounds };
