/* The worlds an experiment can run on. Earth's g is the real one where the
 * child is (see place.js); the mystery planet's is hidden until revealed. */
import { Place } from "./place.js";
import { pickMystery, planetName } from "../lab/catchview.js";

export var WORLDS = { "earth": "Earth", "1.62": "Moon", "3.71": "Mars", "24.79": "Jupiter", "mystery": "Mystery planet" };

/* A world choice with its own mystery planet. key: a WORLDS key. */
export function makeWorld(key) {
  var W = {
    key: WORLDS[key] ? key : "earth",
    mysteryG: pickMystery(null),
    revealed: false,
    mystery: function() { return W.key === "mystery"; },
    set: function(k) {
      W.key = WORLDS[k] ? k : "earth";
      if (W.mystery()) { W.mysteryG = pickMystery(W.mysteryG); W.revealed = false; }
    },
    g: function() {
      return W.mystery() ? W.mysteryG : W.key === "earth" ? Place.g() : parseFloat(W.key);
    },
    name: function() { return WORLDS[W.key]; },
    /* "Earth · g = 9.800 m/s² here" / "Moon · g = 1.62 m/s²" / "Mystery planet · g = ?" */
    label: function() {
      if (W.mystery()) return "Mystery planet · g = ?";
      var here = W.key === "earth" && Place.get();
      return W.name() + " · g = " + (W.key === "earth" ? Place.gText() : W.key) + " m/s²" + (here ? " here" : "");
    },
    /* Digits worth showing for a measured g on this world. */
    digits: function() { return W.key === "earth" && Place.get() ? 3 : 2; },
    /* The sentence comparing a result with the true value. */
    compare: function() {
      if (W.mystery()) return "";
      if (W.key === "earth") return Place.compareText();
      return " The real value on the " + (W.key === "1.62" ? "Moon" : W.name()) + " is " + W.key + " m/s².";
    },
    reveal: function() { W.revealed = true; },
    revealText: function() {
      return W.revealed ? "It's " + planetName(W.mysteryG) + ": g = " + W.mysteryG + " m/s²" : "Reveal the answer";
    }
  };
  return W;
}
