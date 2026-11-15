/*
 * Central emergency configuration: alert thresholds, emergency definitions and
 * the consequences of every choice.
 *
 * Choice costs, rate changes, repair times and result texts are the existing
 * project values (previously in mission-state.js) and are kept unchanged.
 * Briefing and risk texts only restate those game values; they add no new
 * scientific claims. Values marked "gameplay tuning" are game-balance numbers,
 * not scientific data, and should be reviewed by the project researcher.
 *
 * Exposes EmergencyConfig in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.EmergencyConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const freezeDeep = (value) => {
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object" && !Object.isFrozen(child)) freezeDeep(child);
    });
    return Object.freeze(value);
  };

  // Alert level of an emergency, from the lowest resource it affects (percent).
  // A value at or below a threshold raises the level. These reuse the project's
  // existing resource warning (20%) and critical (10%) thresholds.
  const ALERT_THRESHOLDS = { critical: 20, codeBlack: 10 };

  const ALERT_LEVELS = {
    normal: { label: "Normal", description: "System fault; resources are holding." },
    critical: { label: "Critical", description: `An affected resource is at or below ${ALERT_THRESHOLDS.critical}%.` },
    codeBlack: { label: "Code Black", description: `An affected resource is at or below ${ALERT_THRESHOLDS.codeBlack}%.` },
  };

  const CODE_BLACK_NOTE = "Code Black is a fictional game alert level, not an official NASA classification.";

  // Compressed Earth-Mars message delay used for Mission Control replies (gameplay tuning).
  const MISSION_CONTROL_DELAY_SECONDS = 3;

  const EMERGENCIES = {
    oxygenFailure: {
      title: "Oxygen Generator Failure",
      system: "oxygen generator",
      affects: ["oxygen"],
      // Stays broken after a non-repair choice until it is repaired.
      persistsUntilRepaired: true,
      briefing: [
        "The oxygen generator has stopped.",
        "Habitat oxygen is still being used but is no longer being produced (production 0%).",
      ],
      onTrigger: { rates: { oxygenProduction: 0 } },
      choices: {
        repairGenerator: {
          label: "Repair generator",
          resources: { power: -15 },
          time: 2,
          rates: { oxygenProduction: 1 },
          result: "The generator was repaired and oxygen production was restored.",
          risk: "Costs 15% power and takes 2 sols. Oxygen keeps falling with the generator off until the repair is finished.",
        },
        emergencyTanks: {
          label: "Emergency tanks",
          resources: { oxygenReserve: -20, oxygen: 20 },
          result: "Emergency oxygen was transferred into the usable supply; the generator remains offline.",
          risk: "Moves 20% from the oxygen reserve into the supply (oxygen cannot exceed 100%). The generator stays off until you repair it later.",
        },
        reduceActivity: {
          label: "Reduce activity",
          rates: { oxygenConsumption: 0.65, missionProgress: 0.6 },
          result: "Crew activity now uses less oxygen, but mission progress is slower.",
          risk: "Oxygen use falls to 65% and mission progress to 60%. The generator stays off until you repair it later.",
        },
      },
    },
    dustStorm: {
      title: "Martian Dust Storm",
      system: "dust storm",
      affects: ["power"],
      // Gameplay tuning: how long the storm affects the base before it passes.
      durationSols: 3,
      briefing: [
        "A dust storm has reached the base.",
        "While it lasts, the base's power use is 160% of normal.",
      ],
      onTrigger: { rates: { powerConsumption: 1.6 } },
      choices: {
        emergencyBatteries: {
          label: "Emergency batteries",
          resources: { batteryReserve: -20, power: 15 },
          rates: { powerConsumption: 1 },
          result: "Battery reserves supported critical systems and stabilized power demand.",
          risk: "Uses 20% of the battery reserve for +15% power (power cannot exceed 100%) and returns power use to normal for the rest of the storm.",
        },
        reduceConsumption: {
          label: "Reduce consumption",
          resources: { crewComfort: -10 },
          rates: { powerConsumption: 0.7, oxygenProduction: 0.75 },
          result: "Energy demand fell, but oxygen production and crew comfort were reduced.",
          risk: "Power use falls to 70%, but oxygen production drops to 75% and crew comfort falls 10% for the rest of the storm.",
        },
        normalOperations: {
          label: "Normal operations",
          resources: { power: -10 },
          rates: { powerConsumption: 1.6 },
          result: "Normal operations continued. Power demand remains unsustainably high.",
          risk: "Costs 10% power now, and power use stays at 160% until the storm passes.",
        },
      },
    },
    waterMalfunction: {
      title: "Water Recycling Malfunction",
      system: "water recycler",
      affects: ["water"],
      persistsUntilRepaired: true,
      briefing: [
        "The water recycler is running at 40% efficiency.",
        "Water is being used faster than it is being recycled.",
      ],
      onTrigger: { rates: { waterRecycling: 0.4 } },
      choices: {
        repairRecycler: {
          label: "Repair recycler",
          resources: { power: -12 },
          time: 2,
          rates: { waterRecycling: 1 },
          result: "The recycler was repaired and full recycling efficiency was restored.",
          risk: "Costs 12% power and takes 2 sols. Water keeps falling at 40% recycling until the repair is finished.",
        },
        emergencyReserve: {
          label: "Emergency reserve",
          resources: { waterReserve: -20, water: 20 },
          result: "Stored water was transferred into the usable supply; recycling remains impaired.",
          risk: "Moves 20% from the water reserve into the supply (water cannot exceed 100%). Recycling stays at 40% until you repair it later.",
        },
        rationWater: {
          label: "Ration water",
          resources: { crewHealth: -8 },
          rates: { waterConsumption: 0.6, greenhouseProduction: 0.7 },
          result: "Rationing lowered water use, but crew health and greenhouse production suffered.",
          risk: "Water use falls to 60%, but crew health drops 8% and greenhouse output to 70%. Recycling stays at 40% until you repair it later.",
        },
      },
    },
  };

  return freezeDeep({
    ALERT_THRESHOLDS,
    ALERT_LEVELS,
    CODE_BLACK_NOTE,
    MISSION_CONTROL_DELAY_SECONDS,
    EMERGENCIES,
  });
});
