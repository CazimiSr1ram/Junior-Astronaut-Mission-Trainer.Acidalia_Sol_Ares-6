"use strict";

const assert = require("assert");
const Balance = require("../static/js/balance-config.js");
const MissionModel = require("../static/js/mission-state.js");
const MissionClock = require("../static/js/mission-clock.js");
const MissionOne = require("../static/js/mission-one.js");
const MissionOutcome = require("../static/js/mission-outcome.js");
const ShopModel = require("../static/js/shop-state.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const EMERGENCIES = MissionModel.EMERGENCY_CONFIG;
const evaluate = (state) => MissionOutcome.evaluate(state, EMERGENCIES);

function memoryStorage() {
  let saved = null;
  return { getItem: () => saved, setItem: (_, value) => { saved = value; } };
}

/** Marks Mission 1 complete the way the mission module records it. */
function completeMissionOne(state) {
  MissionOne.create(state);
  const progress = state.missions.establishBase;
  progress.status = "complete";
  MissionOne.OBJECTIVES.forEach((objective) => { progress.completed[objective.id] = { sol: 1, elapsedSeconds: 0 }; });
  MissionOne.SURVEY_MARKERS.forEach((marker) => { progress.markers[marker.id] = true; });
  state.reports.push({ missionId: MissionOne.MISSION_ID, sol: 1, elapsedSeconds: 0 });
  progress.current = MissionOne.OBJECTIVES.length;
}

// Exact Sol 90 boundary.
{
  const state = MissionModel.createMissionState();
  completeMissionOne(state);
  state.sol = 90;
  state.elapsedSeconds = 89;
  MissionModel.advanceMissionTime(state, 0.999);
  assert.strictEqual(state.missionComplete, false, "not over 1 ms before the end of Sol 90");
  assert.strictEqual(evaluate(state).status, "ongoing");
  MissionModel.advanceMissionTime(state, 0.001);
  assert.strictEqual(state.missionComplete, true, "over exactly at the end of Sol 90");
  assert.strictEqual(state.sol, 90);
  assert.strictEqual(evaluate(state).status, "success");
  MissionModel.advanceMissionTime(state, 500);
  assert.strictEqual(state.sol, 90, "time cannot continue past the ending");
}

// A full 90-sol solo mission as an Intern (no emergencies) is winnable.
{
  const state = MissionModel.createMissionState();
  const clock = MissionClock.create(state, MissionModel, { devTools: true });
  clock.start();
  completeMissionOne(state);
  clock.setTimeScale(30);
  while (!state.missionComplete) clock.tick(0.25);
  const result = evaluate(state);
  assert.strictEqual(result.status, "success", JSON.stringify(result.reasons));
  assert.strictEqual(result.report.solsSurvived, 90);
  Balance.LIFE_SUPPORT.forEach((key) => assert.ok(state.resources[key] > 0, `${key} still above 0 at the end`));
  assert.ok(state.resources.food < 20, "food is the tight resource, as designed");
  assert.strictEqual(state.resources.crewHealth, 100);
  assert.strictEqual(result.report.missionsCompleted, 1);
  assert.strictEqual(result.report.science.surveyMarkers, 3);
}

// Reaching Sol 90 without Mission 1 is not a success.
{
  const state = MissionModel.createMissionState();
  state.sol = 90;
  MissionModel.advanceMissionTime(state, SOL);
  const result = evaluate(state);
  assert.strictEqual(result.status, "failure");
  assert.strictEqual(result.headline, "Mission incomplete");
  assert.ok(result.reasons.some((reason) => /Mission 1/.test(reason)));
}

// A resource that is empty at the very end makes the habitat unsurvivable.
{
  const state = MissionModel.createMissionState();
  completeMissionOne(state);
  state.sol = 90;
  state.resources.food = 1;
  MissionModel.advanceMissionTime(state, SOL);
  const result = evaluate(state);
  assert.strictEqual(state.failure, undefined, "crew survived the last sol");
  assert.strictEqual(result.status, "failure");
  assert.ok(result.reasons.some((reason) => /Food was empty/.test(reason)));
}

// A brief zero is recoverable: power empties overnight and solar refills it by day.
{
  const state = MissionModel.createMissionState();
  state.resources.power = 1;
  state.elapsedSeconds = 60; // nightfall
  MissionModel.advanceMissionTime(state, MissionModel.SOL_CYCLE.nightSeconds);
  assert.strictEqual(state.resources.power, 0, "power ran out during the night");
  assert.ok(state.resources.crewHealth < 100 && state.resources.crewHealth > 90, "some health was lost");
  MissionModel.advanceMissionTime(state, MissionModel.SOL_CYCLE.daySeconds);
  assert.ok(!state.failure, "a night without power is survivable");
  assert.ok(state.resources.power > 0, "solar refills power during the day");
  assert.strictEqual(state.resources.crewHealth, 100, "crew health recovers");
}

// Oxygen runs out, then emergency tanks restore supply: the crew recovers.
{
  const state = MissionModel.createMissionState();
  state.resources.oxygen = 2;
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.advanceMissionTime(state, 0.5 * SOL);
  assert.strictEqual(state.resources.oxygen, 0);
  const hurt = state.resources.crewHealth;
  assert.ok(hurt < 100 && hurt > 0, "crew harmed but alive");
  MissionModel.resolveEmergency(state, "oxygenFailure", "emergencyTanks");
  MissionModel.advanceMissionTime(state, 0.5 * SOL);
  assert.ok(!state.failure, "recovered in time");
  assert.ok(state.resources.crewHealth > hurt, "health recovers once oxygen is available");
}

// Unrecoverable life-support loss ends the mission, at the moment health runs out.
{
  const events = [];
  const state = MissionModel.createMissionState();
  state.resources.oxygen = 0;
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.advanceMissionTime(state, 10 * SOL, { onEvent: (e) => events.push(e) });
  assert.strictEqual(state.missionComplete, true);
  assert.strictEqual(state.failure.cause, "oxygen");
  const expectedSols = 100 / Balance.HEALTH_LOSS_PER_SOL_AT_ZERO.oxygen;
  const failedAt = MissionOutcome.solsSurvived(state);
  assert.ok(Math.abs(failedAt - expectedSols) < 0.06, `failed after ~${expectedSols.toFixed(2)} sols, got ${failedAt}`);
  assert.strictEqual(events.filter((e) => e.type === "missionFailed").length, 1);
  const result = evaluate(state);
  assert.strictEqual(result.status, "failure");
  assert.strictEqual(result.headline, "Mission failed");
  assert.match(result.reasons[0], /Oxygen ran out/);
  const sol = state.sol;
  MissionModel.advanceMissionTime(state, 5 * SOL);
  assert.strictEqual(state.sol, sol, "a failed mission cannot be continued");
}

// From 5% oxygen the 2-sol repair is survivable, but only just.
{
  const state = MissionModel.createMissionState();
  state.resources.oxygen = 5;
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.ok(!state.failure, "crew survives the repair");
  assert.ok(state.resources.crewHealth > 0 && state.resources.crewHealth < 40, "but with low health");
}

// An emergency repair time jump cannot skip past a failure.
{
  const state = MissionModel.createMissionState();
  state.resources.oxygen = 1;
  MissionModel.triggerEmergency(state, "oxygenFailure");
  const outcome = MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(state.failure.cause, "oxygen", "crew lost during the 2-sol repair");
  assert.ok(outcome.secondsSimulated < 2 * SOL, "the jump stopped at the failure");
  assert.strictEqual(outcome.missionComplete, true);
  assert.strictEqual(evaluate(state).status, "failure");
}

// An emergency cost that drops crew health to 0 ends the mission immediately.
{
  const state = MissionModel.createMissionState();
  state.resources.crewHealth = 5;
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "rationWater");
  assert.strictEqual(state.failure.cause, "crewHealth");
  assert.strictEqual(evaluate(state).status, "failure");
}

// Rewards: success pays once per run and once per save; failure pays nothing.
{
  const storage = memoryStorage();
  const shop = ShopModel.create(storage);
  const failed = MissionModel.createMissionState();
  failed.resources.oxygen = 0;
  MissionModel.triggerEmergency(failed, "oxygenFailure");
  MissionModel.advanceMissionTime(failed, 5 * SOL);
  assert.strictEqual(MissionOutcome.claimSuccessReward(failed, shop, EMERGENCIES).ok, false);
  assert.strictEqual(shop.state.solar, 0);

  const won = MissionModel.createMissionState();
  completeMissionOne(won);
  won.sol = 90;
  MissionModel.advanceMissionTime(won, SOL);
  const first = MissionOutcome.claimSuccessReward(won, shop, EMERGENCIES);
  assert.strictEqual(first.ok, true);
  assert.deepStrictEqual([shop.state.solar, shop.state.helium], [100, 1]);
  assert.strictEqual(MissionOutcome.claimSuccessReward(won, shop, EMERGENCIES).ok, false, "same run");

  // Restart: a new run with the same save keeps purchases and cannot re-claim.
  shop.reward(); // +150 Solar Cells, +2 Helium-3 (test grant)
  assert.strictEqual(shop.buy("Commander").ok, true);
  const reloaded = ShopModel.create(storage);
  const rerun = MissionModel.createMissionState();
  assert.deepStrictEqual([rerun.sol, rerun.missionComplete, rerun.failure], [1, false, undefined], "fresh mission state");
  assert.deepStrictEqual(reloaded.state.owned, ["Commander"], "purchases survive the restart");
  completeMissionOne(rerun);
  rerun.sol = 90;
  MissionModel.advanceMissionTime(rerun, SOL);
  const repeat = MissionOutcome.claimSuccessReward(rerun, reloaded, EMERGENCIES);
  assert.strictEqual(repeat.ok, false);
  assert.strictEqual(repeat.alreadyClaimed, true);
  assert.deepStrictEqual([reloaded.state.solar, reloaded.state.helium], [100, 1], "no duplicate reward");
}

// Final report contents.
{
  const state = MissionModel.createMissionState();
  completeMissionOne(state);
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "emergencyBatteries");
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  state.sol = 90;
  MissionModel.advanceMissionTime(state, SOL);
  const { report, status } = evaluate(state);
  assert.strictEqual(status, "success");
  assert.strictEqual(report.emergencies.length, 2);
  assert.strictEqual(report.emergenciesHandled, 2);
  assert.deepStrictEqual(report.emergencies.find((e) => e.id === "waterMalfunction").choices, ["repairRecycler"]);
  assert.deepStrictEqual(report.science, { surveyMarkers: 3, surveyMarkersTotal: 3, reportsSent: 1,
    sitesDiscovered: 0, sitesTotal: 5, samplesAnalysed: 0, samplesTotal: 12 }); // field exploration counted separately
  assert.ok("oxygen" in report.resources && "crewHealth" in report.resources);
}

console.log("Mission outcome tests passed: Sol 90 boundary, Intern success, incomplete and unsurvivable endings, recoverable zeros, terminal failures, time-jump guard, rewards and restart.");
