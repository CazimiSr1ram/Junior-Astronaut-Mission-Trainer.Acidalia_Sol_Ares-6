/* Shared-state habitat status and dedicated airlock. No construction or resource rates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HabitatSystems = api;
})(globalThis, function () {
  "use strict";
  const CYCLE_SECONDS = 5; // Compressed game time, NOT a NASA operating procedure.
  function atmosphere(state, cabin = {}) {
    const pressure = cabin.pressurized === true || cabin.cabin === "pressurized" && !cabin.hatchOpen
      ? "Safe" : ["repressurizing", "depressurizing"].includes(cabin.cabin) ? "Low" : "Critical";
    const powered = state.resources.power > 0 && (cabin.lifeSupport === true || cabin.powerOn === true);
    const oxygen = state.resources.oxygen;
    const co2 = cabin.co2Status || "pending";
    const temperature = Number.isFinite(cabin.temperatureC) ? `${cabin.temperatureC} °C (simulation)` : "Pending — not simulated";
    const safe = pressure === "Safe" && oxygen > 20 && powered
      && !["high", "critical", "failed"].includes(co2) && cabin.temperatureStatus !== "critical";
    return { pressure, oxygen, co2, temperature, powered, safe,
      rows: [["Cabin pressure", `${pressure} (simulation)`], ["Oxygen supply", `${oxygen.toFixed(1)}% of game supply — not air composition`],
        ["CO₂ removal", co2 === "pending" ? "Pending — no CO₂ model" : co2], ["Temperature", temperature],
        ["Available electricity", `${state.resources.power.toFixed(1)}%`], ["Life support", powered ? "Powered (simulation)" : "Needs power / repair"]],
      details: "Pressure is a simplified safe/low/critical state. Oxygen % is a resource gauge, not oxygen concentration or partial pressure. CO₂ and temperature are pending unless supplied by their subsystem. Safety checks use implemented signals only; this is not a real airlock procedure.",
    };
  }
  function create(state) {
    const habitat = () => state.systems.habitat;
    function chamber() {
      const h = habitat();
      if (!h?.constructed) return null;
      return h.airlock ||= { outerOpen: false, innerOpen: false, pressure: "low", verified: false, remaining: 0, target: null, side: "outside" };
    }
    const result = (ok, message) => ({ ok, lines: [{ speaker: "Habitat guide", text: message }] });
    function act(action, env = {}) {
      const a = chamber();
      if (!a) return result(false, "Build the habitat first. Construction is not available yet.");
      if (state.missionComplete) return result(false, "This mission has ended.");
      if (a.remaining > 0) return result(false, "Wait for the airlock to finish changing pressure.");
      const safe = atmosphere(state, habitat()).safe;
      switch (action) {
        case "approachInside":
          if (a.side === "chamber" || !env.insideHabitat) return result(false, "Use the door from inside the habitat.");
          a.side = "habitat"; break;
        case "openOuter":
          if (a.innerOpen || a.pressure !== "low" || !env.suitSafe) return result(false, "Close the inner door, let the air out, and check your suit first.");
          a.outerOpen = true; a.verified = false; break;
        case "closeOuter": a.outerOpen = false; break;
        case "fill":
          if (a.outerOpen || a.innerOpen || !safe) return result(false, "Seal both doors and restore habitat life support first.");
          a.target = "safe"; a.remaining = CYCLE_SECONDS; a.verified = false; break;
        case "verify":
          if (a.outerOpen || a.pressure !== "safe" || !safe) return result(false, "Wait for safe pressure and check habitat life support.");
          a.verified = true; break;
        case "openInner":
          if (a.outerOpen || a.pressure !== "safe" || !a.verified || !safe) return result(false, "Seal the outer door, refill the airlock, then check the air.");
          a.innerOpen = true; break;
        case "closeInner": a.innerOpen = false; break;
        case "vent":
          if (a.outerOpen || a.innerOpen || !env.suitSafe) return result(false, "Seal both doors and check every suit system before letting air out.");
          a.target = "low"; a.remaining = CYCLE_SECONDS; a.verified = false; break;
        case "enter":
          if (!(a.side === "outside" && a.outerOpen && env.suitSafe || a.side === "habitat" && a.innerOpen && safe)) return result(false, "Open the door on your side safely first.");
          a.side = "chamber"; break;
        case "toHabitat":
          if (a.side !== "chamber" || !a.innerOpen || !safe || !a.verified) return result(false, "Check the air and open the inner door first.");
          a.side = "habitat"; a.innerOpen = false; break;
        case "toMars":
          if (a.side !== "chamber" || !a.outerOpen || !env.suitSafe) return result(false, "Check your suit and open the outer door first.");
          a.side = "outside"; a.outerOpen = false; break;
        default: return result(false, "Choose one of the airlock steps.");
      }
      return result(true, a.remaining ? "Changing airlock pressure. Both doors stay sealed." : "Step complete. Follow the next safe step.");
    }
    function tick(seconds) {
      const a = chamber();
      if (!a?.remaining || !Number.isFinite(seconds) || seconds <= 0) return;
      if (!atmosphere(state, habitat()).powered || state.missionComplete) {
        a.remaining = 0; a.pressure = "low"; a.verified = false; a.target = null; return;
      }
      a.remaining = Math.max(0, a.remaining - seconds);
      if (!a.remaining) { a.pressure = a.target; a.target = null; }
    }
    return { act, tick, chamber, get status() { return atmosphere(state, habitat()); } };
  }
  return { create, atmosphere, CYCLE_SECONDS };
});
