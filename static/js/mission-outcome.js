/*
 * Mission success / failure evaluation and the final mission report.
 *
 * Failure is decided by the authoritative time loop (mission-state.js), which
 * ends the mission when crew health reaches 0 after life support runs out.
 * Success is checked at the end of the final sol: crew alive, every
 * life-support resource above the minimum, and required missions complete.
 *
 * Exposes MissionOutcome in the browser and module.exports in Node.
 */
(function (root, factory) {
  const inNode = typeof module === "object" && module.exports;
  const balance = inNode ? require("./balance-config.js") : root.BalanceConfig;
  const missionOne = inNode ? require("./mission-one.js") : root.MissionOne;
  const api = factory(balance, missionOne);

  if (inNode) {
    module.exports = api;
  }

  root.MissionOutcome = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (BalanceConfig, MissionOne) {
  "use strict";

  const MISSIONS = Object.freeze({
    establishBase: Object.freeze({ title: "Mission 1: Establish the Mars Base", objectives: MissionOne.OBJECTIVES.length }),
  });

  const FAILURE_TEXT = Object.freeze({
    oxygen: "Oxygen ran out and the crew could not recover in time.",
    water: "Water ran out and the crew could not recover in time.",
    food: "Food ran out and the crew could not recover in time.",
    power: "Power ran out and life support could not keep the crew safe.",
    crewHealth: "Crew health reached a terminal level.",
  });

  const RESOURCE_NAMES = Object.freeze({ oxygen: "Oxygen", water: "Water", food: "Food", power: "Power" });

  function solsSurvived(state) {
    if (!state.failure) return state.missionComplete ? state.maxSol : state.sol - 1 + state.elapsedSeconds / 90;
    return state.failure.sol - 1 + state.failure.elapsedSeconds / 90;
  }

  function buildReport(state, emergencyConfig) {
    const missions = Object.entries(MISSIONS).map(([id, mission]) => {
      const progress = (state.missions || {})[id];
      return {
        id,
        title: mission.title,
        complete: Boolean(progress && progress.status === "complete"),
        objectivesDone: progress ? Object.keys(progress.completed || {}).length : 0,
        objectivesTotal: mission.objectives,
      };
    });
    const emergencies = Object.entries(state.emergencies || {}).map(([id, emergency]) => ({
      id,
      title: emergencyConfig && emergencyConfig[id] ? emergencyConfig[id].title : id,
      status: emergency.status,
      choices: [...(emergency.choices || [])],
    }));
    const base = (state.missions || {}).establishBase;
    return {
      solsSurvived: Math.round(solsSurvived(state) * 10) / 10,
      finalSol: state.sol,
      maxSol: state.maxSol,
      missions,
      missionsCompleted: missions.filter((mission) => mission.complete).length,
      emergencies,
      emergenciesHandled: emergencies.filter((emergency) => emergency.status === "resolved").length,
      resources: { ...state.resources },
      science: {
        surveyMarkers: base ? Object.keys(base.markers || {}).length : 0,
        surveyMarkersTotal: MissionOne.SURVEY_MARKERS.length,
        reportsSent: (state.reports || []).length,
      },
    };
  }

  /**
   * Returns { status: "ongoing" | "success" | "failure", headline, reasons,
   * dialogue, report }.
   */
  function evaluate(state, emergencyConfig) {
    const report = buildReport(state, emergencyConfig);
    if (!state.missionComplete) return { status: "ongoing", headline: "Mission in progress", reasons: [], dialogue: [], report };

    const reasons = [];
    if (state.failure) {
      reasons.push(FAILURE_TEXT[state.failure.cause] || FAILURE_TEXT.crewHealth);
    } else {
      if (state.resources.crewHealth <= 0) reasons.push(FAILURE_TEXT.crewHealth);
      BalanceConfig.LIFE_SUPPORT.forEach((resource) => {
        if (state.resources[resource] <= BalanceConfig.SUCCESS.minimumLifeSupportAtEnd) {
          reasons.push(`${RESOURCE_NAMES[resource]} was empty at the end, so the habitat was no longer survivable.`);
        }
      });
      BalanceConfig.SUCCESS.requiredMissions.forEach((id) => {
        const mission = report.missions.find((candidate) => candidate.id === id);
        if (!mission || !mission.complete) reasons.push(`${MISSIONS[id].title} was not completed.`);
      });
    }

    if (reasons.length === 0) {
      return {
        status: "success",
        headline: "Mission success",
        reasons,
        report,
        dialogue: [
          { speaker: "Mission Control", text: `Sol ${state.maxSol} complete. The crew is safe and the base is running. Congratulations! (Simulated message.)` },
          { speaker: "You", text: "Base secure and the science is logged. Ready to hand over to the next crew." },
        ],
      };
    }
    return {
      status: "failure",
      headline: state.failure ? "Mission failed" : "Mission incomplete",
      reasons,
      report,
      dialogue: state.failure
        ? [
          { speaker: "Mission Control", text: "The mission has ended: the crew could not be kept safe this time. Let's review what happened and try again. (Simulated message.)" },
          { speaker: "You", text: "We'll learn from this and do better next time." },
        ]
        : [
          { speaker: "Mission Control", text: `You reached Sol ${state.maxSol}, but the mission goals were not all met. (Simulated message.)` },
          { speaker: "You", text: "Understood. We'll finish the job next time." },
        ],
    };
  }

  /** Grants the success reward once per mission run and once per save (via the shop). */
  function claimSuccessReward(state, shop, emergencyConfig) {
    if (evaluate(state, emergencyConfig).status !== "success") return { ok: false, message: "No reward: the mission was not successful." };
    if (state.successRewardHandled) return { ok: false, message: "Mission success reward already handled for this run." };
    const outcome = shop.claimMissionReward(BalanceConfig.SUCCESS_REWARD_ID);
    if (outcome.ok || outcome.alreadyClaimed) state.successRewardHandled = true;
    return outcome;
  }

  return Object.freeze({ MISSIONS, FAILURE_TEXT, evaluate, buildReport, claimSuccessReward, solsSurvived });
});
