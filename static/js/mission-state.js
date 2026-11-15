(function (root, factory) {
  const inNode = typeof module === "object" && module.exports;
  const config = inNode ? require("./emergency-config.js") : root.EmergencyConfig;
  const balance = inNode ? require("./balance-config.js") : root.BalanceConfig;
  if (!config || !balance) throw new Error("emergency-config.js and balance-config.js must be loaded before mission-state.js");
  const api = factory(config, balance);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.MissionModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (EmergencyConfig, BalanceConfig) {
  "use strict";

  // Emergency definitions and alert thresholds live in emergency-config.js.
  const EMERGENCY_CONFIG = EmergencyConfig.EMERGENCIES;
  const INITIAL_STATE = Object.freeze({
    sol: 1,
    maxSol: 90,
    elapsedSeconds: 0,
    missionComplete: false,
    crew: [{ id: "player", isAsleep: false, fatigue: 0 }],
    resources: {
      oxygen: 100,
      water: 100,
      food: 100,
      power: 100,
      batteryReserve: 40,
      oxygenReserve: 30,
      waterReserve: 30,
      crewHealth: 100,
      crewComfort: 100,
    },
    rates: {
      powerConsumption: 1,
      oxygenProduction: 1,
      oxygenConsumption: 1,
      waterRecycling: 1,
      waterConsumption: 1,
      missionProgress: 1,
      greenhouseProduction: 1,
      solarGeneration: 1,
    },
  });

  const SOL_CYCLE = Object.freeze({
    daySeconds: 60,
    nightSeconds: 30,
    totalSeconds: 90,
  });
  // Survival balance (gameplay tuning) lives in balance-config.js.
  const RESOURCE_CHANGE_PER_SOL = BalanceConfig.RESOURCE_CHANGE_PER_SOL;
  const LIFE_SUPPORT = BalanceConfig.LIFE_SUPPORT;
  // Largest simulated step, so depletion, health loss and failure are timed accurately.
  const MAX_TIME_STEP_SECONDS = 4.5;
  const RESOURCE_WARNING_THRESHOLD = EmergencyConfig.ALERT_THRESHOLDS.critical;
  const RESOURCE_CRITICAL_THRESHOLD = EmergencyConfig.ALERT_THRESHOLDS.codeBlack;
  const FATIGUE_PER_SOL_AWAKE = 12;
  const FATIGUE_RECOVERY_PER_SOL_ASLEEP = 36;

  function copyInitialState(crewIds) {
    return {
      sol: INITIAL_STATE.sol,
      maxSol: INITIAL_STATE.maxSol,
      elapsedSeconds: INITIAL_STATE.elapsedSeconds,
      missionComplete: INITIAL_STATE.missionComplete,
      crew: crewIds.map((id) => ({ id, isAsleep: false, fatigue: 0 })),
      resources: { ...INITIAL_STATE.resources },
      rates: { ...INITIAL_STATE.rates },
      // Rate changes per emergency; state.rates is the product of all of them.
      rateModifiers: {},
      // Conditional crew bonuses (e.g. Commander), applied once in recomputeRates().
      crewBonuses: {},
      // Set every frame by the game: astronaut unprotected in an unpressurised place.
      exposure: { unprotected: false },
      // Base equipment. A greenhouse failure (none is triggered yet) stops food production.
      systems: { greenhouse: { operational: true } },
      emergencies: {},
    };
  }

  // All tracked resources are percentages. Values above 100 were previously cut
  // back to 100 on the next time step anyway; clamping here keeps them valid.
  const RESOURCE_MIN = 0;
  const RESOURCE_MAX = 100;
  // Float tolerance used to snap the clock onto phase/sol boundaries.
  const TIME_EPSILON = 1e-9;
  // Guards against re-entrant time advancement (e.g. an event hook that tries
  // to advance time or resolve an emergency while a time jump is in progress).
  let timeAdvanceInProgress = false;

  function applyNumericChanges(target, changes) {
    Object.entries(changes || {}).forEach(([key, amount]) => {
      target[key] = Math.min(RESOURCE_MAX, Math.max(RESOURCE_MIN, (target[key] || 0) + amount));
    });
  }

  /** Recomputes effective rates: baseline x every active emergency's modifiers. */
  function hasUnresolvedEmergency(state) {
    return Object.values(state.emergencies || {}).some((emergency) => emergency.status !== "resolved");
  }

  /**
   * Recomputes effective rates from scratch: baseline x every rate source
   * (emergencies, class effects) x conditional crew bonuses. Rebuilding from
   * the baseline each time means a conditional bonus is applied exactly once,
   * however many emergencies overlap.
   */
  function recomputeRates(state) {
    const rates = { ...INITIAL_STATE.rates };
    Object.values(state.rateModifiers || {}).forEach((modifiers) => {
      Object.entries(modifiers).forEach(([key, value]) => {
        rates[key] = (rates[key] ?? 1) * Math.max(0, value);
      });
    });
    const emergencyConsumption = (state.crewBonuses || {}).emergencyConsumption;
    if (typeof emergencyConsumption === "number" && emergencyConsumption < 1 && hasUnresolvedEmergency(state)) {
      ["oxygenConsumption", "waterConsumption", "powerConsumption"].forEach((key) => {
        rates[key] *= Math.max(0, emergencyConsumption);
      });
    }
    state.rates = rates;
  }

  /** Sets the crew's conditional bonuses (one value per bonus, never accumulated). */
  function setCrewBonuses(state, bonuses) {
    state.crewBonuses = { ...(bonuses || {}) };
    recomputeRates(state);
  }

  function setEmergencyRates(state, emergencyId, changes) {
    if (!state.rateModifiers) state.rateModifiers = {};
    state.rateModifiers[emergencyId] = { ...(state.rateModifiers[emergencyId] || {}), ...(changes || {}) };
    recomputeRates(state);
  }

  /**
   * Sets (or with null, removes) a named, non-emergency rate source such as an
   * equipped class bonus. A source is replaced, never added twice.
   */
  function setRateSource(state, sourceId, rates) {
    if (!state.rateModifiers) state.rateModifiers = {};
    if (rates && Object.keys(rates).length) state.rateModifiers[sourceId] = { ...rates };
    else delete state.rateModifiers[sourceId];
    recomputeRates(state);
  }

  /** Ends an emergency: its rate effects are removed and it can never recur. */
  function endEmergency(state, emergencyId, reason) {
    const emergencyState = state.emergencies[emergencyId];
    if (state.rateModifiers) delete state.rateModifiers[emergencyId];
    // Mark resolved before recomputing so emergency-only bonuses switch off now.
    emergencyState.status = "resolved";
    emergencyState.endedBy = reason;
    emergencyState.endedAt = { sol: state.sol, elapsedSeconds: state.elapsedSeconds };
    recomputeRates(state);
  }

  function createMissionState(crewIds = ["player"]) {
    if (!Array.isArray(crewIds)
      || crewIds.length === 0
      || crewIds.some((id) => typeof id !== "string" || id.trim() === "")
      || new Set(crewIds).size !== crewIds.length) {
      throw new TypeError("Crew IDs must be a non-empty array of unique, non-empty strings.");
    }
    return copyInitialState(crewIds);
  }

  function setCrewMembers(state, crewIds) {
    if (!Array.isArray(crewIds)
      || crewIds.length === 0
      || crewIds.some((id) => typeof id !== "string" || id.trim() === "")
      || new Set(crewIds).size !== crewIds.length) {
      throw new TypeError("Crew IDs must be a non-empty array of unique, non-empty strings.");
    }
    const previousMembers = new Map(state.crew.map((member) => [member.id, member]));
    state.crew = crewIds.map((id) =>
      previousMembers.get(id) || { id, isAsleep: false, fatigue: 0 });
  }

  function setCrewAsleep(state, crewId, isAsleep) {
    if (typeof isAsleep !== "boolean") {
      throw new TypeError("Sleep status must be a boolean.");
    }
    const member = state.crew.find((crewMember) => crewMember.id === crewId);
    if (!member) {
      throw new Error(`Unknown crew member: ${crewId}`);
    }
    member.isAsleep = isAsleep;
    return member;
  }

  function areAllCrewAsleep(state) {
    const active = state.crew.filter((member) => member.connected !== false && member.active !== false);
    return active.length > 0 && active.every((member) => member.isAsleep);
  }

  function getAverageFatigue(state) {
    return state.crew.reduce((total, member) => total + member.fatigue, 0) / state.crew.length;
  }

  function getMissionClock(state) {
    if (state.missionComplete) {
      return {
        phase: "complete",
        phaseTimeRemaining: 0,
        solTimeRemaining: 0,
      };
    }

    const phase = state.elapsedSeconds < SOL_CYCLE.daySeconds ? "day" : "night";
    const phaseEnd = phase === "day" ? SOL_CYCLE.daySeconds : SOL_CYCLE.totalSeconds;
    return {
      phase,
      phaseTimeRemaining: phaseEnd - state.elapsedSeconds,
      solTimeRemaining: SOL_CYCLE.totalSeconds - state.elapsedSeconds,
    };
  }

  /** Net change per sol without solar power (percentage points). */
  function baseRatesPerSol(state) {
    return {
      oxygen:
        RESOURCE_CHANGE_PER_SOL.oxygenProduction * state.rates.oxygenProduction
        - RESOURCE_CHANGE_PER_SOL.oxygenConsumption * state.rates.oxygenConsumption,
      water:
        RESOURCE_CHANGE_PER_SOL.waterRecycling * state.rates.waterRecycling
        - RESOURCE_CHANGE_PER_SOL.waterConsumption * state.rates.waterConsumption,
      // Crew food use only; greenhouse output is added separately because it
      // depends on the greenhouse working and having power and water.
      food: -RESOURCE_CHANGE_PER_SOL.foodConsumption,
      power: -RESOURCE_CHANGE_PER_SOL.powerConsumption * state.rates.powerConsumption,
    };
  }

  /** Food the greenhouse adds per sol while it is producing (includes the Botanist bonus). */
  function greenhouseOutputPerSol(state) {
    return RESOURCE_CHANGE_PER_SOL.greenhouseProduction * state.rates.greenhouseProduction;
  }

  function isGreenhouseOperational(state) {
    return !(state.systems && state.systems.greenhouse && state.systems.greenhouse.operational === false);
  }

  /** Marks greenhouse equipment as working or failed (no event fails it yet). */
  function setGreenhouseOperational(state, operational) {
    if (!state.systems) state.systems = {};
    state.systems.greenhouse = { ...(state.systems.greenhouse || {}), operational: Boolean(operational) };
  }

  /** Current greenhouse status for display: producing only if working, powered and watered. */
  function getGreenhouseStatus(state) {
    const operational = isGreenhouseOperational(state);
    const powered = state.resources.power > 0;
    const watered = state.resources.water > 0;
    const producing = operational && powered && watered;
    return { operational, powered, watered, producing, outputPerSol: producing ? greenhouseOutputPerSol(state) : 0 };
  }

  // Share of a span (0..1) during which a resource is available, given its
  // value at the start and its change over the span. A resource at 0 that is
  // being replenished (e.g. solar power by day) counts as available.
  function availableShare(before, change) {
    if (before > 0) return change >= 0 || before + change > 0 ? 1 : before / -change;
    return change > 0 ? 1 : 0;
  }

  function solarPerSol(state) {
    return RESOURCE_CHANGE_PER_SOL.solarGeneration * (state.rates.solarGeneration ?? 1);
  }

  /** Average net change per sol for each simulated resource (solar averaged over the sol). */
  function getResourceRatesPerSol(state) {
    const rates = baseRatesPerSol(state);
    rates.power += solarPerSol(state);
    rates.food += getGreenhouseStatus(state).outputPerSol;
    return rates;
  }

  /**
   * Applies resource, fatigue and crew-health change for a span that does not
   * cross a phase boundary. Solar power only arrives during the day. While a
   * life-support resource is at 0%, crew health falls; otherwise it recovers.
   * Returns the life-support resource that caused the most health loss, if any.
   */
  function applyElapsedEffects(state, seconds, isDay) {
    const elapsedFraction = seconds / SOL_CYCLE.totalSeconds;
    const perSol = baseRatesPerSol(state);
    if (isDay) perSol.power += solarPerSol(state) * (SOL_CYCLE.totalSeconds / SOL_CYCLE.daySeconds);
    // Greenhouse food output: only while the greenhouse works and has both
    // power and water, for the exact share of this span they last.
    if (isGreenhouseOperational(state)) {
      const share = Math.min(
        availableShare(state.resources.power, perSol.power * elapsedFraction),
        availableShare(state.resources.water, perSol.water * elapsedFraction),
      );
      perSol.food += greenhouseOutputPerSol(state) * share;
    }
    let healthLoss = 0;
    let cause = null;
    let worstLoss = 0;
    Object.entries(perSol).forEach(([resource, changePerSol]) => {
      const before = state.resources[resource];
      const change = changePerSol * elapsedFraction;
      if (LIFE_SUPPORT.includes(resource) && change < 0 && before + change <= 0) {
        const zeroPortion = before <= 0 ? 1 : 1 - before / -change;
        const loss = BalanceConfig.HEALTH_LOSS_PER_SOL_AT_ZERO[resource] * elapsedFraction * zeroPortion;
        healthLoss += loss;
        if (loss > worstLoss) { worstLoss = loss; cause = resource; }
      }
      state.resources[resource] = Math.min(RESOURCE_MAX, Math.max(RESOURCE_MIN, before + change));
    });
    // Unprotected exposure to the Martian atmosphere (no sealed suit outside a pressurised cabin).
    if (state.exposure && state.exposure.unprotected) {
      const loss = BalanceConfig.EXPOSURE_HEALTH_LOSS_PER_SOL * elapsedFraction;
      healthLoss += loss;
      if (loss > worstLoss) { worstLoss = loss; cause = "exposure"; }
    }
    const health = state.resources.crewHealth;
    state.resources.crewHealth = healthLoss > 0
      ? Math.max(0, health - healthLoss)
      : Math.min(RESOURCE_MAX, health + BalanceConfig.HEALTH_RECOVERY_PER_SOL * elapsedFraction);
    if (cause) state.lastDeprivation = cause;
    state.crew.forEach((member) => {
      const fatigueChange = member.isAsleep
        ? -FATIGUE_RECOVERY_PER_SOL_ASLEEP
        : FATIGUE_PER_SOL_AWAKE;
      member.fatigue = Math.min(100, Math.max(0, member.fatigue + fatigueChange * elapsedFraction));
    });
    return cause;
  }

  /** Records whether the astronaut is currently unprotected in an unpressurised place. */
  function setExposure(state, unprotected) {
    state.exposure = { unprotected: Boolean(unprotected) };
  }

  /** Ends the mission in failure (time stops; nothing can advance past it). */
  function failMission(state, cause) {
    if (state.failure) return state.failure;
    state.missionComplete = true;
    state.failure = { cause, sol: state.sol, elapsedSeconds: state.elapsedSeconds };
    return state.failure;
  }

  /**
   * The single authoritative way mission time moves forward: normal play,
   * night skips and emergency repairs all come through here.
   *
   * Time is processed in segments that stop at every nightfall and sol
   * boundary, so per-phase logic and future events (Earth reports, greenhouse
   * growth, mission events) can run at the right moment. Optional
   * options.onEvent(event) receives { type: "nightfall" | "solStart" |
   * "missionComplete", sol, reason, simulated } at each boundary crossed.
   * Hooks may not advance time or resolve emergencies themselves.
   */
  function advanceMissionTime(state, seconds, options = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError("Elapsed time must be a non-negative finite number.");
    }
    if (state.missionComplete || seconds === 0) {
      return getMissionClock(state);
    }
    if (timeAdvanceInProgress) {
      throw new Error("Mission time is already advancing; time events cannot advance time recursively.");
    }

    const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
    const context = { reason: options.reason || "clock", simulated: options.simulated === true };
    const emit = (event) => { if (onEvent) onEvent({ ...event, ...context }); };

    timeAdvanceInProgress = true;
    try {
      let remaining = seconds;
      while (remaining > TIME_EPSILON && !state.missionComplete) {
        const boundary = state.elapsedSeconds < SOL_CYCLE.daySeconds
          ? SOL_CYCLE.daySeconds
          : SOL_CYCLE.totalSeconds;
        const now = missionSeconds(state);
        const nextEnd = nextTimedEmergencyEnd(state);
        const untilEnd = nextEnd ? nextEnd.endsAt - now : Infinity;
        const step = Math.min(remaining, boundary - state.elapsedSeconds, Math.max(0, untilEnd), MAX_TIME_STEP_SECONDS);
        const isDay = state.elapsedSeconds < SOL_CYCLE.daySeconds;
        const cause = applyElapsedEffects(state, step, isDay);
        state.elapsedSeconds += step;
        remaining -= step;
        if (state.resources.crewHealth <= 0) {
          failMission(state, cause || state.lastDeprivation || "crewHealth");
          emit({ type: "missionFailed", sol: state.sol, cause: state.failure.cause });
          break;
        }
        if (nextEnd && nextEnd.endsAt - missionSeconds(state) <= TIME_EPSILON) {
          endEmergency(state, nextEnd.id, "passed");
          emit({ type: "emergencyEnded", sol: state.sol, emergencyId: nextEnd.id });
        }
        if (boundary - state.elapsedSeconds > TIME_EPSILON) continue;

        state.elapsedSeconds = boundary;
        if (boundary === SOL_CYCLE.daySeconds) {
          emit({ type: "nightfall", sol: state.sol });
        } else if (state.sol >= state.maxSol) {
          state.elapsedSeconds = SOL_CYCLE.totalSeconds;
          state.missionComplete = true;
          emit({ type: "missionComplete", sol: state.sol });
        } else {
          state.sol += 1;
          state.elapsedSeconds = 0;
          // Morning: everyone wakes, so the next night is not skipped
          // automatically. Players choose to sleep again each night.
          state.crew.forEach((member) => { member.isAsleep = false; });
          emit({ type: "solStart", sol: state.sol });
        }
      }
    } finally {
      timeAdvanceInProgress = false;
      if (state.missionComplete) state.crew.forEach((member) => { member.isAsleep = false; });
    }

    return getMissionClock(state);
  }

  function missionSeconds(state) {
    return (state.sol - 1) * SOL_CYCLE.totalSeconds + state.elapsedSeconds;
  }

  function nextTimedEmergencyEnd(state) {
    let next = null;
    Object.entries(state.emergencies || {}).forEach(([id, emergencyState]) => {
      if (emergencyState.status === "resolved" || typeof emergencyState.endsAt !== "number") return;
      if (!next || emergencyState.endsAt < next.endsAt) next = { id, endsAt: emergencyState.endsAt };
    });
    return next;
  }

  function skipRemainingNight(state) {
    if (getMissionClock(state).phase !== "night") {
      return { skipped: false, reason: "It is not night." };
    }
    if (!areAllCrewAsleep(state)) {
      return { skipped: false, reason: "Every crew member must be asleep to skip the night." };
    }
    const secondsSkipped = getMissionClock(state).phaseTimeRemaining;
    advanceMissionTime(state, secondsSkipped);
    return { skipped: true, secondsSkipped };
  }

  function getResourceWarnings(state) {
    return Object.entries(state.resources)
      .filter(([resource, value]) =>
        ["oxygen", "water", "food", "power"].includes(resource)
        && value <= RESOURCE_WARNING_THRESHOLD)
      .map(([resource, value]) => ({
        resource,
        value,
        severity: value <= RESOURCE_CRITICAL_THRESHOLD ? "critical" : "warning",
      }));
  }

  function triggerEmergency(state, emergencyId) {
    const emergency = EMERGENCY_CONFIG[emergencyId];
    if (!emergency) {
      throw new Error(`Unknown emergency: ${emergencyId}`);
    }

    // Each emergency happens at most once per mission, so its choices (and any
    // resource transfers) can never be used twice.
    if (state.emergencies[emergencyId]) {
      return false;
    }

    const emergencyState = { status: "active", choice: null, choices: [], triggeredAt: { sol: state.sol, elapsedSeconds: state.elapsedSeconds } };
    if (emergency.durationSols) {
      emergencyState.endsAt = missionSeconds(state) + emergency.durationSols * SOL_CYCLE.totalSeconds;
    }
    state.emergencies[emergencyId] = emergencyState;
    applyNumericChanges(state.resources, emergency.onTrigger.resources);
    setEmergencyRates(state, emergencyId, emergency.onTrigger.rates);
    return true;
  }

  /** Choices the player may take now: any choice while active; only repairs once stabilised. */
  function getAvailableChoices(state, emergencyId) {
    const emergency = EMERGENCY_CONFIG[emergencyId];
    const emergencyState = state.emergencies[emergencyId];
    if (!emergency || !emergencyState) return [];
    if (emergencyState.status === "active") return Object.keys(emergency.choices);
    if (emergencyState.status === "stabilized") {
      return Object.entries(emergency.choices).filter(([, choice]) => choice.time).map(([id]) => id);
    }
    return [];
  }

  /**
   * Applies an emergency decision.
   *  - Repairs (`time`): the cost is paid up front, the system stays broken
   *    while that many sols are simulated through advanceMissionTime(), then
   *    the emergency ends and its rate effects are removed.
   *  - Other choices apply their costs and rate changes. Systems that stay
   *    broken (`persistsUntilRepaired`) and storms that have not passed become
   *    "stabilized": the problem continues and only a repair can follow.
   * If the mission ends during a repair, only the remaining time is simulated.
   * options.repairSpeed (e.g. 1.4 for an Engineer) shortens repair time.
   */
  function resolveEmergency(state, emergencyId, choiceId, options = {}) {
    const emergency = EMERGENCY_CONFIG[emergencyId];
    const choice = emergency && emergency.choices[choiceId];
    const emergencyState = state.emergencies[emergencyId];

    if (!emergency || !choice) {
      throw new Error("Unknown emergency choice");
    }
    if (!emergencyState || emergencyState.status === "resolved" || emergencyState.status === "repairing") {
      return { applied: false, reason: "Emergency is not active or was already resolved." };
    }
    if (!getAvailableChoices(state, emergencyId).includes(choiceId)) {
      return { applied: false, reason: "That response was already used; only a repair is still available." };
    }
    if (timeAdvanceInProgress) {
      return { applied: false, reason: "Emergencies cannot be resolved during a time jump." };
    }
    const repairSpeed = options.repairSpeed === undefined ? 1 : options.repairSpeed;
    if (!Number.isFinite(repairSpeed) || repairSpeed < 1 || repairSpeed > 3) {
      throw new RangeError("repairSpeed must be between 1 and 3.");
    }

    applyNumericChanges(state.resources, choice.resources);
    emergencyState.choice = choiceId;
    emergencyState.choices.push(choiceId);
    if (state.resources.crewHealth <= 0) failMission(state, "crewHealth");

    let secondsSimulated = 0;
    const startSeconds = missionSeconds(state);
    if (!choice.time) {
      setEmergencyRates(state, emergencyId, choice.rates);
      const ongoing = emergency.persistsUntilRepaired || typeof emergencyState.endsAt === "number";
      if (ongoing) emergencyState.status = "stabilized";
      else endEmergency(state, emergencyId, choiceId);
    } else {
      try {
        emergencyState.status = "repairing";
        advanceMissionTime(state, (choice.time * SOL_CYCLE.totalSeconds) / repairSpeed, {
          reason: `repair:${emergencyId}:${choiceId}`,
          simulated: true,
          onEvent: options.onEvent,
        });
      } finally {
        // Even if an event hook throws, finish the repair so the emergency
        // never stays stuck with the system broken.
        secondsSimulated = missionSeconds(state) - startSeconds;
        if (state.emergencies[emergencyId].status !== "resolved") endEmergency(state, emergencyId, choiceId);
      }
    }

    return {
      applied: true,
      result: choice.result,
      status: emergencyState.status,
      secondsSimulated,
      missionComplete: state.missionComplete,
    };
  }

  /** Predicts a choice's outcome by applying it to a copy of the state. */
  function previewEmergencyChoice(state, emergencyId, choiceId, options = {}) {
    const copy = JSON.parse(JSON.stringify(state));
    const outcome = resolveEmergency(copy, emergencyId, choiceId, options);
    return {
      ...outcome,
      before: { ...state.resources },
      after: { ...copy.resources },
      rates: { ...copy.rates },
      sol: copy.sol,
      elapsedSeconds: copy.elapsedSeconds,
    };
  }

  /** Alert level for a resource percentage: normal, critical or codeBlack. */
  function getAlertLevel(value) {
    if (value <= EmergencyConfig.ALERT_THRESHOLDS.codeBlack) return "codeBlack";
    if (value <= EmergencyConfig.ALERT_THRESHOLDS.critical) return "critical";
    return "normal";
  }

  /** Alert for an unresolved emergency, from the lowest resource it affects. */
  function getEmergencyAlert(state, emergencyId) {
    const emergency = EMERGENCY_CONFIG[emergencyId];
    const emergencyState = state.emergencies[emergencyId];
    if (!emergency || !emergencyState || emergencyState.status === "resolved") return null;
    const [resource, value] = emergency.affects
      .map((key) => [key, state.resources[key]])
      .sort((a, b) => a[1] - b[1])[0];
    const secondsLeft = typeof emergencyState.endsAt === "number" ? Math.max(0, emergencyState.endsAt - missionSeconds(state)) : null;
    return { emergencyId, level: getAlertLevel(value), resource, value, status: emergencyState.status, secondsLeft };
  }

  /** Unresolved emergencies, most severe first. */
  function getActiveAlerts(state) {
    const order = { codeBlack: 0, critical: 1, normal: 2 };
    return Object.keys(state.emergencies || {})
      .map((id) => getEmergencyAlert(state, id))
      .filter(Boolean)
      .sort((a, b) => order[a.level] - order[b.level] || a.value - b.value);
  }

  return {
    EMERGENCY_CONFIG,
    INITIAL_STATE,
    SOL_CYCLE,
    RESOURCE_WARNING_THRESHOLD,
    RESOURCE_CRITICAL_THRESHOLD,
    createMissionState,
    setCrewMembers,
    setCrewAsleep,
    areAllCrewAsleep,
    getAverageFatigue,
    getMissionClock,
    getResourceRatesPerSol,
    RESOURCE_CHANGE_PER_SOL,
    LIFE_SUPPORT,
    failMission,
    advanceMissionTime,
    skipRemainingNight,
    getResourceWarnings,
    triggerEmergency,
    resolveEmergency,
    getAvailableChoices,
    previewEmergencyChoice,
    getAlertLevel,
    getEmergencyAlert,
    getActiveAlerts,
    recomputeRates,
    setRateSource,
    setCrewBonuses,
    hasUnresolvedEmergency,
    setGreenhouseOperational,
    setExposure,
    getGreenhouseStatus,
    ALERT_LEVELS: EmergencyConfig.ALERT_LEVELS,
  };
});
