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

  function copyInitialState() {
    return {
      sol: INITIAL_STATE.sol,
      maxSol: INITIAL_STATE.maxSol,
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

  function createMissionState() {
    return copyInitialState();
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
    createMissionState,
    triggerEmergency,
    resolveEmergency,
  };
});
