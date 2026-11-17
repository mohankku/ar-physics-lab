/* The scientists' laws behind each experiment: who found them, when, the
 * law in plain words, its formula, and what the child saw that shows it.
 * Naming the people helps kids remember the ideas. Rendered into
 * [data-laws="<exp>"] (a card in Results) and [data-law-line="<exp>"] (one
 * line on the start card). Keep the history accurate. */

export var LAWS = {
  catch: {
    line: "You'll discover Galileo's law of falling (1638).",
    laws: [
      { name: "Galileo's law of falling", who: "Galileo Galilei", where: "Italy", year: "1638",
        text: "Without air, everything falls the same way, heavy or light, speeding up all the time. The distance grows with the time squared.",
        formula: "h = ½·g·t²",
        seen: "Drops from different heights lined up on the straight t²-vs-h graph." },
      { name: "Newton's law of gravity", who: "Isaac Newton", where: "England", year: "1687",
        text: "g is the Earth's pull. It is a little weaker at the equator (the Earth bulges and spins) and up a mountain.",
        formula: "g = G·M / r²",
        seen: "Set your location: your g changes in the third decimal." }
    ]
  },
  throw: {
    line: "You'll discover Galileo's parabola (1638) and Newton's first law (1687).",
    laws: [
      { name: "Galileo's parabola", who: "Galileo Galilei", where: "Italy", year: "1638",
        text: "A thrown ball moves across and up-down at the same time, and the two motions don't mix. Its path is a parabola.",
        formula: "x = vx·t,  y = vy·t − ½·g·t²",
        seen: "The path graph is a parabola, and the two speed arrows change separately." },
      { name: "Newton's first law", who: "Isaac Newton", where: "England", year: "1687",
        text: "Something moving keeps moving the same way unless a force pushes it. Nothing pushes the ball sideways.",
        formula: "no force → speed stays the same",
        seen: "The 'across' arrow and the flat line on the speed graph never change." }
    ]
  },
  swing: {
    line: "You'll discover Galileo's pendulum (1602) and Huygens' law (1673).",
    laws: [
      { name: "Galileo's pendulum", who: "Galileo Galilei", where: "Italy", year: "about 1602",
        text: "A pendulum takes almost the same time for a big swing as for a small one. The story goes that he timed a swinging lamp in Pisa's cathedral with his pulse.",
        formula: "small or big pull → about the same T",
        seen: "Runs with the same string but different pulls have almost the same T." },
      { name: "Huygens' pendulum law", who: "Christiaan Huygens", where: "Netherlands", year: "1673",
        text: "The time for one swing depends only on the string's length and on g, not on the ball's weight. He used it to build accurate clocks.",
        formula: "T = 2π·√(L / g)",
        seen: "T² grows in a straight line with the length on the graph." }
    ]
  },
  ramp: {
    line: "You'll discover Galileo's law of odd numbers (1638) and Amontons' friction (1699).",
    laws: [
      { name: "Galileo's law of odd numbers", who: "Galileo Galilei", where: "Italy", year: "1638",
        text: "Galileo slowed falling down with ramps so he could time it. In equal times, the ball goes 1, 3, 5, 7… times as far: the distance grows with the time squared.",
        formula: "d = ½·a·t²,  a = g·sinθ (sliding)",
        seen: "The gaps between the dots go 1, 3, 5, 7…, and distance against t² is a straight line." },
      { name: "Amontons' laws of friction", who: "Guillaume Amontons", where: "France", year: "1699",
        text: "Friction grows with how hard two surfaces press together, and depends on the surfaces: ice hardly grips, carpet grips a lot.",
        formula: "friction = μ × push",
        seen: "Carpet held the ball on a gentle slope; on ice it slid instead of rolling." }
    ]
  },
  light: {
    line: "You'll discover the laws of reflection and refraction, from Euclid to Snell.",
    laws: [
      { name: "Law of reflection", who: "Euclid", where: "Greece", year: "about 300 BC",
        text: "Light bounces off a mirror at the same angle it arrives, measured from the normal.",
        formula: "angle in = angle out",
        seen: "With the mirror, the angle out always matched the angle in." },
      { name: "Law of refraction (Snell's law)", who: "Ibn Sahl (Baghdad, 984), then Willebrord Snell", where: "Netherlands", year: "1621",
        text: "Light bends when it goes into a material where it travels slower. n tells how much slower.",
        formula: "n₁·sin θ₁ = n₂·sin θ₂",
        seen: "Your readings sit on Snell's curve, and n = sin(in air) ÷ sin(in the material)." },
      { name: "Total internal reflection", who: "Johannes Kepler", where: "Germany", year: "1611",
        text: "Light trying to leave a dense material at too steep a slant can't get out: it all bounces back inside. Optical fibers carry the internet this way (Charles Kao, Nobel Prize 2009).",
        formula: "trapped when sin θ > 1 / n",
        seen: "From under the water, past 48.8°, the beam was trapped." }
    ]
  },
  orbit: {
    line: "You'll discover Kepler's three laws (1609 and 1619) and Newton's cannonball (1687).",
    laws: [
      { name: "Newton's law of gravity and his cannonball", who: "Isaac Newton", where: "England", year: "1687",
        text: "Every mass pulls on every other, more weakly the farther apart they are. Fire a cannonball fast enough sideways and it keeps falling around the Earth without ever landing: an orbit.",
        formula: "F = G·M·m / r²",
        seen: "Too slow and it crashed; fast enough sideways and it went all the way round." },
      { name: "Kepler's first law", who: "Johannes Kepler", where: "Germany", year: "1609",
        text: "Orbits are ellipses (stretched circles), with the planet at one of the two focus points, not in the middle.",
        formula: "orbit = ellipse, planet at a focus",
        seen: "The dashed ellipse, with the planet off-center at a focus." },
      { name: "Kepler's second law", who: "Johannes Kepler", where: "Germany", year: "1609",
        text: "A line from the planet to the satellite sweeps equal areas in equal times, so the satellite speeds up close in and slows down far out.",
        formula: "equal areas in equal times",
        seen: "The colored slices take the same time and have the same area." },
      { name: "Kepler's third law", who: "Johannes Kepler", where: "Germany", year: "1619",
        text: "Bigger orbits take longer, in a fixed way: the time squared grows with the size cubed.",
        formula: "T² ∝ a³",
        seen: "Your orbits sit on a straight line on the T²-vs-a³ graph." }
    ]
  }
};

/* Fill every [data-laws] and [data-law-line] in the page. */
export function renderLaws(root) {
  (root || document).querySelectorAll("[data-laws]").forEach(function(box) {
    var set = LAWS[box.getAttribute("data-laws")];
    if (!set) return;
    box.textContent = "";
    var h = document.createElement("h3");
    h.textContent = "📜 The laws behind it";
    box.appendChild(h);
    set.laws.forEach(function(law) {
      var card = document.createElement("div");
      card.className = "law";
      var title = document.createElement("b");
      title.textContent = law.name;
      var who = document.createElement("small");
      who.textContent = law.who + " · " + law.where + " · " + law.year;
      var text = document.createElement("p");
      text.textContent = law.text;
      var formula = document.createElement("code");
      formula.textContent = law.formula;
      var seen = document.createElement("p");
      seen.className = "seen";
      seen.textContent = "In this experiment: " + law.seen;
      [title, who, text, formula, seen].forEach(function(el) { card.appendChild(el); });
      box.appendChild(card);
    });
  });
  (root || document).querySelectorAll("[data-law-line]").forEach(function(el) {
    var set = LAWS[el.getAttribute("data-law-line")];
    if (set) el.textContent = "📜 " + set.line;
  });
}
