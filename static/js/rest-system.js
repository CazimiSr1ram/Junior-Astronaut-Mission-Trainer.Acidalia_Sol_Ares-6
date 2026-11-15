/* Rest sessions share the mission clock and resources; no independent time or inventory. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RestSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CONFIG = Object.freeze({ daySeconds: 3, nightSpeed: 60, stepSeconds: 0.25 });

  function unavailable(state, model, place) {
    if (state.missionComplete) return "This mission has ended.";
    if (!place?.inside) return "Go inside a safe cabin to rest.";
    if (!place.completed) return "This habitat needs construction before its bed is ready.";
    if (!place.pressurized) return "Close the hatch and refill the cabin with air first.";
    if (!place.accessible || place.obstructed) return "Move to the clear floor beside the bed first.";
    if (!place.lifeSupport || state.resources.power <= 0 || state.resources.oxygen <= 0) {
      return "Restore cabin power and life support before resting.";
    }
    if (model.getActiveAlerts(state).some((alert) => ["critical", "codeBlack"].includes(alert.level))
      || ["oxygen", "water", "food", "power"].some((key) => state.resources[key] <= model.RESOURCE_CRITICAL_THRESHOLD)) {
      return "Your crew needs help now! Check the critical alert before resting.";
    }
    return null;
  }

  function create(state, model, clock, hooks = {}, config = CONFIG) {
    let session = null;
    const now = () => (state.sol - 1) * model.SOL_CYCLE.totalSeconds + state.elapsedSeconds;
    function stop(message) {
      if (!session) return null;
      const result = { night: session.night, seconds: now() - session.start, sol: state.sol, message };
      model.setCrewAsleep(state, session.crewId, false);
      session = null;
      hooks.onWake?.(result);
      return result;
    }
    function begin(bedId, crewId = "player") {
      if (session) return { ok: false, message: "Already resting." };
      if (!clock.started) return { ok: false, message: "Your Mars mission has not started." };
      const message = unavailable(state, model, hooks.place(bedId));
      if (message) return { ok: false, message };
      const phase = model.getMissionClock(state);
      const night = phase.phase === "night";
      // Day rest never crosses into night, even when started just before dusk.
      const duration = night ? phase.phaseTimeRemaining : Math.min(config.daySeconds, Math.max(0, phase.phaseTimeRemaining - 0.001));
      model.setCrewAsleep(state, crewId, true);
      session = { bedId, crewId, night, start: now(), end: now() + duration };
      hooks.onSleep?.(session);
      return { ok: true, night };
    }
    function tick(realSeconds) {
      if (!session || !Number.isFinite(realSeconds) || realSeconds <= 0) return;
      try {
        let budget = Math.min(realSeconds, 0.25);
        if (session.night && model.areAllCrewAsleep(state)) budget *= config.nightSpeed;
        while (session && budget > 0) {
          const reason = unavailable(state, model, hooks.place(session.bedId));
          if (reason) return stop(reason);
          const remaining = session.end - now();
          if (remaining < 1e-8) return stop(session.night ? `Good morning! Sol ${state.sol}` : "Rest complete. Ready to explore!");
          const step = Math.min(config.stepSeconds, budget, remaining);
          const before = now();
          clock.advanceRestTime(step, { onEvent: hooks.onEvent });
          const elapsed = now() - before;
          hooks.onElapsed?.(elapsed);
          budget -= step;
          if (state.missionComplete) return stop("Wake up! Your mission has ended.");
          const changed = unavailable(state, model, hooks.place(session.bedId));
          if (changed) return stop(changed);
          if (now() >= session.end - 1e-8) return stop(session.night ? `Good morning! Sol ${state.sol}` : "Rest complete. Ready to explore!");
          if (elapsed <= 0) return stop("Rest stopped. Please check the mission clock.");
          // A connection/active-state change must never allow a non-unanimous fast-forward.
          if (session.night && !model.areAllCrewAsleep(state)) break;
        }
      } catch (error) {
        stop("Rest stopped safely. Please check mission status.");
        throw error;
      }
    }
    return { begin, tick, cancel: () => stop("Rest cancelled."),
      reason: (bedId) => unavailable(state, model, hooks.place(bedId)),
      get active() { return session !== null; } };
  }
  return Object.freeze({ CONFIG, unavailable, create });
});
