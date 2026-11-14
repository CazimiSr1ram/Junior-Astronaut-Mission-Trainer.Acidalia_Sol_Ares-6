(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.MissionModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EMERGENCY_CONFIG = Object.freeze({
    dustStorm: {
      title: "Martian Dust Storm",
      onTrigger: {
        rates: { powerConsumption: 1.6 },
      },
      choices: {
        emergencyBatteries: {
          label: "Emergency batteries",
          resources: { batteryReserve: -20, power: 15 },
          rates: { powerConsumption: 1 },
          result: "Battery reserves supported critical systems and stabilized power demand.",
        },
        reduceConsumption: {
          label: "Reduce consumption",
          resources: { crewComfort: -10 },
          rates: { powerConsumption: 0.7, oxygenProduction: 0.75 },
          result: "Energy demand fell, but oxygen production and crew comfort were reduced.",
        },
        normalOperations: {
          label: "Normal operations",
          resources: { power: -10 },
          rates: { powerConsumption: 1.6 },
          result: "Normal operations continued. Power demand remains unsustainably high.",
        },
      },
    },
    oxygenFailure: {
      title: "Oxygen Generator Failure",
      onTrigger: {
        rates: { oxygenProduction: 0 },
      },
      choices: {
        repairGenerator: {
          label: "Repair generator",
          resources: { power: -15 },
          time: 2,
          rates: { oxygenProduction: 1 },
          result: "The generator was repaired after two sols and oxygen production was restored.",
        },
        emergencyTanks: {
          label: "Emergency tanks",
          resources: { oxygenReserve: -20, oxygen: 20 },
          result: "Emergency oxygen was transferred into the usable supply; the generator remains offline.",
        },
        reduceActivity: {
          label: "Reduce activity",
          rates: { oxygenConsumption: 0.65, missionProgress: 0.6 },
          result: "Crew activity now uses less oxygen, but mission progress is slower.",
        },
      },
    },
    waterMalfunction: {
      title: "Water Recycling Malfunction",
      onTrigger: {
        rates: { waterRecycling: 0.4 },
      },
      choices: {
        repairRecycler: {
          label: "Repair recycler",
          resources: { power: -12 },
          time: 2,
          rates: { waterRecycling: 1 },
          result: "The recycler was repaired after two sols and full recycling efficiency was restored.",
        },
        emergencyReserve: {
          label: "Emergency reserve",
          resources: { waterReserve: -20, water: 20 },
          result: "Stored water was transferred into the usable supply; recycling remains impaired.",
        },
        rationWater: {
          label: "Ration water",
          resources: { crewHealth: -8 },
          rates: { waterConsumption: 0.6, greenhouseProduction: 0.7 },
          result: "Rationing lowered water use, but crew health and greenhouse production suffered.",
        },
      },
    },
  });

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
    },
  });

  const SOL_CYCLE = Object.freeze({
    daySeconds: 60,
    nightSeconds: 30,
    totalSeconds: 90,
  });
  const RESOURCE_CHANGE_PER_SOL = Object.freeze({
    oxygenProduction: 4,
    oxygenConsumption: 7,
    waterRecycling: 4,
    waterConsumption: 7,
    foodConsumption: 5,
    greenhouseProduction: 1,
    powerConsumption: 8,
  });
  const RESOURCE_WARNING_THRESHOLD = 20;
  const RESOURCE_CRITICAL_THRESHOLD = 10;
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
      emergencies: {},
    };
  }

  function applyNumericChanges(target, changes) {
    Object.entries(changes || {}).forEach(([key, amount]) => {
      target[key] = Math.max(0, (target[key] || 0) + amount);
    });
  }

  function applyRates(target, changes) {
    Object.entries(changes || {}).forEach(([key, value]) => {
      target[key] = Math.max(0, value);
    });
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
    return state.crew.length > 0 && state.crew.every((member) => member.isAsleep);
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

  function advanceMissionTime(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError("Elapsed time must be a non-negative finite number.");
    }
    if (state.missionComplete || seconds === 0) {
      return getMissionClock(state);
    }

    const remainingMissionTime =
      (state.maxSol - state.sol) * SOL_CYCLE.totalSeconds
      + SOL_CYCLE.totalSeconds - state.elapsedSeconds;
    const activeSeconds = Math.min(seconds, remainingMissionTime);
    const elapsedFraction = activeSeconds / SOL_CYCLE.totalSeconds;
    const resourceChanges = {
      oxygen:
        (RESOURCE_CHANGE_PER_SOL.oxygenProduction * state.rates.oxygenProduction
          - RESOURCE_CHANGE_PER_SOL.oxygenConsumption * state.rates.oxygenConsumption)
        * elapsedFraction,
      water:
        (RESOURCE_CHANGE_PER_SOL.waterRecycling * state.rates.waterRecycling
          - RESOURCE_CHANGE_PER_SOL.waterConsumption * state.rates.waterConsumption)
        * elapsedFraction,
      food:
        (RESOURCE_CHANGE_PER_SOL.greenhouseProduction * state.rates.greenhouseProduction
          - RESOURCE_CHANGE_PER_SOL.foodConsumption)
        * elapsedFraction,
      power: -RESOURCE_CHANGE_PER_SOL.powerConsumption * state.rates.powerConsumption * elapsedFraction,
    };

    Object.entries(resourceChanges).forEach(([resource, change]) => {
      state.resources[resource] = Math.min(100, Math.max(0, state.resources[resource] + change));
    });
    state.crew.forEach((member) => {
      const fatigueChange = member.isAsleep
        ? -FATIGUE_RECOVERY_PER_SOL_ASLEEP
        : FATIGUE_PER_SOL_AWAKE;
      member.fatigue = Math.min(100, Math.max(0, member.fatigue + fatigueChange * elapsedFraction));
    });

    state.elapsedSeconds += activeSeconds;
    while (state.elapsedSeconds >= SOL_CYCLE.totalSeconds && !state.missionComplete) {
      state.elapsedSeconds -= SOL_CYCLE.totalSeconds;
      if (state.sol >= state.maxSol) {
        state.elapsedSeconds = SOL_CYCLE.totalSeconds;
        state.missionComplete = true;
      } else {
        state.sol += 1;
      }
    }

    return getMissionClock(state);
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

    if (state.emergencies[emergencyId]) {
      return false;
    }

    state.emergencies[emergencyId] = { status: "active", choice: null };
    applyNumericChanges(state.resources, emergency.onTrigger.resources);
    applyRates(state.rates, emergency.onTrigger.rates);
    return true;
  }

  function resolveEmergency(state, emergencyId, choiceId) {
    const emergency = EMERGENCY_CONFIG[emergencyId];
    const choice = emergency && emergency.choices[choiceId];
    const emergencyState = state.emergencies[emergencyId];

    if (!emergency || !choice) {
      throw new Error("Unknown emergency choice");
    }
    if (!emergencyState || emergencyState.status !== "active") {
      return { applied: false, reason: "Emergency is not active or was already resolved." };
    }

    applyNumericChanges(state.resources, choice.resources);
    applyRates(state.rates, choice.rates);
    state.sol = Math.min(state.maxSol, state.sol + (choice.time || 0));
    emergencyState.status = "resolved";
    emergencyState.choice = choiceId;

    return { applied: true, result: choice.result };
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
    advanceMissionTime,
    skipRemainingNight,
    getResourceWarnings,
    triggerEmergency,
    resolveEmergency,
  };
});
