/*
 * Astronaut class bonuses: one central definition, applied to real gameplay.
 *
 * Bonuses are "active" only when the game has the matching activity. Bonuses
 * for activities that do not exist yet are marked "pending" and do nothing.
 * Every class can still do every essential action; bonuses only change speed
 * or output.
 *
 * No stacking: a player has exactly one class. For a crew (future multiplayer)
 * combineTeamBonuses() takes the best value of each bonus, never a product, so
 * five Botanists give the same greenhouse bonus as one.
 *
 * Exposes ClassBonuses in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ClassBonuses = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Rate source id used for passive class effects in the mission state.
  const CLASS_RATE_SOURCE = "class";

  const NEUTRAL = Object.freeze({
    repairSpeed: 1, // emergency repair speed multiplier (1.4 = 40% faster)
    greenhouseProduction: 1, // greenhouse food output multiplier
  });

  const CLASSES = Object.freeze({
    Intern: Object.freeze({
      summary: "No specialist bonus. Can do every essential task.",
      bonuses: Object.freeze({}),
      pending: null,
    }),
    Commander: Object.freeze({
      summary: "Improves team emergency coordination.",
      bonuses: Object.freeze({}),
      pending: "Needs multiplayer team emergencies, which are not in the game yet.",
    }),
    Engineer: Object.freeze({
      summary: "Repairs equipment 40% faster.",
      bonuses: Object.freeze({ repairSpeed: 1.4 }),
      pending: null,
    }),
    Medic: Object.freeze({
      summary: "Performs medical treatment 40% faster.",
      bonuses: Object.freeze({}),
      pending: "Medical treatment is not in the game yet.",
    }),
    Botanist: Object.freeze({
      summary: "Greenhouse food production +30%.",
      bonuses: Object.freeze({ greenhouseProduction: 1.3 }),
      pending: null,
    }),
    Scientist: Object.freeze({
      summary: "Performs research tasks 40% faster.",
      bonuses: Object.freeze({}),
      pending: "Research tasks are not in the game yet.",
    }),
  });

  function getClass(name) {
    if (!Object.prototype.hasOwnProperty.call(CLASSES, name)) throw new Error(`Unknown class: ${name}`);
    return CLASSES[name];
  }

  /** Effective bonus values for one class (neutral where it has none). */
  function getBonuses(name) {
    return { ...NEUTRAL, ...getClass(name).bonuses };
  }

  /** Crew bonuses without stacking: the best value of each bonus across the crew. */
  function combineTeamBonuses(classNames) {
    const combined = { ...NEUTRAL };
    [...new Set(classNames)].forEach((name) => {
      Object.entries(getBonuses(name)).forEach(([key, value]) => {
        combined[key] = Math.max(combined[key], value);
      });
    });
    return combined;
  }

  /** Short HUD text for a class. */
  function describe(name) {
    const definition = getClass(name);
    if (definition.pending) return `${definition.summary} Pending: ${definition.pending}`;
    return definition.summary;
  }

  /**
   * Sets the passive class effects on the mission state (replacing, never
   * adding to, any previous class effects).
   */
  function applyPassiveBonuses(state, missionModel, classNames) {
    const bonuses = combineTeamBonuses(classNames);
    const rates = bonuses.greenhouseProduction !== 1 ? { greenhouseProduction: bonuses.greenhouseProduction } : null;
    missionModel.setRateSource(state, CLASS_RATE_SOURCE, rates);
    return bonuses;
  }

  return Object.freeze({
    CLASSES,
    NEUTRAL,
    CLASS_RATE_SOURCE,
    getClass,
    getBonuses,
    combineTeamBonuses,
    describe,
    applyPassiveBonuses,
  });
});
