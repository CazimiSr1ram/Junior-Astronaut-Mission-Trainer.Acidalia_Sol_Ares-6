/*
 * Mission clock runner: drives MissionModel time from real gameplay time.
 *
 * - Time starts only when start() is called (on arrival on Mars), never in the
 *   Johnson Space Center lobby or during the launch cutscene.
 * - A sol is MissionModel.SOL_CYCLE: 60 s day + 30 s night = 90 s.
 * - When every crew member is asleep at night, the rest of the night is skipped
 *   (resources and fatigue are still simulated by MissionModel).
 * - Developer controls (time scale, phase/sol skips, sleep toggle) exist only
 *   when created with { devTools: true }. They never touch shop currency.
 *
 * Exposes MissionClock in the browser and module.exports in Node for tests.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.MissionClock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Longest real-time step applied per tick; longer gaps (hidden tab, debugger)
  // are dropped so the mission never jumps forward unexpectedly.
  const MAX_TICK_SECONDS = 0.25;
  const DEV_TIME_SCALES = Object.freeze([1, 2, 5, 10, 30]);
  const MAX_DEV_SOL_SKIP = 10;

  function create(state, model, options = {}) {
    const devTools = options.devTools === true;
    let started = false;
    let paused = false;
    let timeScale = 1;
    let lastSkip = null;
    let realSecondsRunning = 0;

    function recordSkip(type, fromSol, fromElapsed, seconds, reason) {
      lastSkip = Object.freeze({
        type,
        fromSol,
        fromElapsedSeconds: fromElapsed,
        toSol: state.sol,
        toElapsedSeconds: state.elapsedSeconds,
        seconds,
        reason,
      });
      return lastSkip;
    }

    function applyNightSkip() {
      const clock = model.getMissionClock(state);
      if (clock.phase !== "night" || !model.areAllCrewAsleep(state)) return null;
      const fromSol = state.sol;
      const fromElapsed = state.elapsedSeconds;
      const result = model.skipRemainingNight(state);
      if (!result.skipped) return null;
      const count = state.crew.length;
      return recordSkip("night-skip", fromSol, fromElapsed, result.secondsSkipped,
        `All ${count} crew member${count === 1 ? "" : "s"} asleep at night`);
    }

    function start() {
      if (started) return false;
      started = true;
      return true;
    }

    function setPaused(nextPaused) {
      paused = Boolean(nextPaused);
    }

    /** Advance by real elapsed seconds (scaled by the dev time scale). */
    function tick(realSeconds) {
      if (!started || paused || state.missionComplete) return false;
      if (!Number.isFinite(realSeconds) || realSeconds <= 0) return false;
      const step = Math.min(realSeconds, MAX_TICK_SECONDS);
      realSecondsRunning += step;
      model.advanceMissionTime(state, step * timeScale);
      applyNightSkip();
      return true;
    }

    /** Record a sol jump made elsewhere (e.g. an emergency decision). */
    function recordExternalJump(fromSol, fromElapsed, reason) {
      if (state.sol === fromSol && state.elapsedSeconds === fromElapsed) return null;
      const seconds = (state.sol - fromSol) * model.SOL_CYCLE.totalSeconds + (state.elapsedSeconds - fromElapsed);
      return recordSkip("external", fromSol, fromElapsed, seconds, reason);
    }

    function snapshot() {
      const clock = model.getMissionClock(state);
      const { daySeconds, nightSeconds, totalSeconds } = model.SOL_CYCLE;
      return {
        started,
        paused,
        timeScale,
        devTools,
        missionComplete: state.missionComplete,
        sol: state.sol,
        maxSol: state.maxSol,
        phase: clock.phase,
        elapsedInSol: state.elapsedSeconds,
        secondsToNextPhase: clock.phaseTimeRemaining,
        solSeconds: totalSeconds,
        daySeconds,
        nightSeconds,
        realSecondsRunning,
        ratesPerSol: model.getResourceRatesPerSol(state),
        rateMultipliers: { ...state.rates },
        crewTotal: state.crew.length,
        crewAsleep: state.crew.filter((member) => member.isAsleep).length,
        lastSkip,
      };
    }

    // Rest owns the real-time pacing while ordinary ticks are paused. All
    // survival effects and boundary events still go through the shared model.
    function advanceActivityTime(seconds, hooks = {}) {
      if (!started || state.missionComplete) return false;
      model.advanceMissionTime(state, seconds, { ...hooks, reason: hooks.reason || "activity", simulated: true });
      return true;
    }
    function advanceRestTime(seconds, hooks = {}) {
      return advanceActivityTime(seconds, { ...hooks, reason: "rest" });
    }

    const api = { start, setPaused, tick, recordExternalJump, snapshot, advanceRestTime, advanceActivityTime,
      get started() { return started; }, get lastSkip() { return lastSkip; } };

    if (devTools) {
      Object.assign(api, {
        DEV_TIME_SCALES,
        setTimeScale(scale) {
          if (!DEV_TIME_SCALES.includes(scale)) throw new RangeError(`Unsupported time scale: ${scale}`);
          timeScale = scale;
          return timeScale;
        },
        skipToNextPhase() {
          if (!started || state.missionComplete) return null;
          const clock = model.getMissionClock(state);
          const fromSol = state.sol;
          const fromElapsed = state.elapsedSeconds;
          model.advanceMissionTime(state, clock.phaseTimeRemaining);
          return recordSkip("dev-phase", fromSol, fromElapsed, clock.phaseTimeRemaining,
            `Developer skip: end of ${clock.phase}`);
        },
        advanceSols(count) {
          if (!started || state.missionComplete) return null;
          if (!Number.isInteger(count) || count < 1 || count > MAX_DEV_SOL_SKIP) {
            throw new RangeError(`Sol skip must be an integer from 1 to ${MAX_DEV_SOL_SKIP}.`);
          }
          const fromSol = state.sol;
          const fromElapsed = state.elapsedSeconds;
          const seconds = count * model.SOL_CYCLE.totalSeconds;
          // advanceMissionTime simulates resource use and fatigue for the whole span.
          model.advanceMissionTime(state, seconds);
          return recordSkip("dev-sols", fromSol, fromElapsed, seconds, `Developer skip: ${count} sol${count === 1 ? "" : "s"}`);
        },
        setCrewAsleep(crewId, asleep) {
          model.setCrewAsleep(state, crewId, asleep);
          return applyNightSkip();
        },
      });
    }

    return Object.freeze(api);
  }

  return Object.freeze({ create, MAX_TICK_SECONDS, DEV_TIME_SCALES, MAX_DEV_SOL_SKIP });
});
