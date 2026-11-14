/*
 * Central survival balance and mission success/failure rules.
 *
 * ALL VALUES HERE ARE GAMEPLAY TUNING, NOT SCIENTIFIC DATA. They were chosen so
 * a well-run base roughly breaks even over 90 sols, and should be reviewed by
 * the project researcher.
 *
 * Exposes BalanceConfig in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BalanceConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const freezeDeep = (value) => {
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object" && !Object.isFrozen(child)) freezeDeep(child);
    });
    return Object.freeze(value);
  };

  return freezeDeep({
    // Percentage points per sol at rate multiplier 1.
    RESOURCE_CHANGE_PER_SOL: {
      oxygenProduction: 7,
      oxygenConsumption: 7,
      waterRecycling: 6.6,
      waterConsumption: 7,
      greenhouseProduction: 4,
      foodConsumption: 5,
      powerConsumption: 8,
      // Solar power generated per sol, delivered only during daytime.
      solarGeneration: 9,
    },

    // Resources the crew needs to survive.
    LIFE_SUPPORT: ["oxygen", "water", "food", "power"],

    // Crew health lost per sol while a life-support resource is at 0%. Losses
    // from several empty resources add up. This gives the crew time to recover
    // (repair, use reserves) instead of failing the moment a resource hits 0.
    HEALTH_LOSS_PER_SOL_AT_ZERO: { oxygen: 60, water: 20, food: 10, power: 15 },

    // Crew health regained per sol while no life-support resource is empty.
    HEALTH_RECOVERY_PER_SOL: 5,

    // Mission success requirements at the end of the final sol.
    SUCCESS: {
      // Every life-support resource must be above this at the end.
      minimumLifeSupportAtEnd: 0,
      // Mission state keys (missionState.missions) that must be complete.
      requiredMissions: ["establishBase"],
    },

    // Shop reward id granted once per save for a successful mission.
    SUCCESS_REWARD_ID: "mission-success",
  });
});
