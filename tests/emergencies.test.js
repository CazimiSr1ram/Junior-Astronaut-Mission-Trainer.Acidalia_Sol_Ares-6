"use strict";

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

function freshEmergency(emergencyId, setup) {
  const state = MissionModel.createMissionState();
  if (setup) setup(state);
  assert.strictEqual(MissionModel.triggerEmergency(state, emergencyId), true);
  return state;
}

function setLevels(state, level) {
  ["oxygen", "water", "food", "power"].forEach((key) => { state.resources[key] = level; });
}

function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Existing scenarios (costs unchanged; values are now kept within 0-100).
// ---------------------------------------------------------------------------

{
  const state = freshEmergency("dustStorm");
  assert.strictEqual(state.rates.powerConsumption, 1.6);
  const outcome = MissionModel.resolveEmergency(state, "dustStorm", "emergencyBatteries");
  assert.strictEqual(outcome.applied, true);
  assert.strictEqual(outcome.secondsSimulated, 0, "non-repair choices take no time");
  assert.strictEqual(state.resources.batteryReserve, 20);
  assert.strictEqual(state.resources.power, 100, "power is capped at 100 (was 115 for one frame before)");
  assert.strictEqual(state.rates.powerConsumption, 1);
  assert.strictEqual(MissionModel.resolveEmergency(state, "dustStorm", "normalOperations").applied, false);
}

{
  // Same choice when power has room: the full +15 applies.
  const state = freshEmergency("dustStorm", (s) => { s.resources.power = 50; });
  MissionModel.resolveEmergency(state, "dustStorm", "emergencyBatteries");
  assert.strictEqual(state.resources.power, 65);
}

{
  const state = freshEmergency("dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "reduceConsumption");
  assert.strictEqual(state.resources.crewComfort, 90);
  assert.strictEqual(state.rates.powerConsumption, 0.7);
  assert.strictEqual(state.rates.oxygenProduction, 0.75);
}

{
  const state = freshEmergency("dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "normalOperations");
  assert.strictEqual(state.resources.power, 90);
  assert.strictEqual(state.rates.powerConsumption, 1.6);
}

{
  const state = freshEmergency("oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "emergencyTanks");
  assert.strictEqual(state.resources.oxygenReserve, 10);
  assert.strictEqual(state.resources.oxygen, 100, "oxygen is capped at 100 (was 120 for one frame before)");
  assert.strictEqual(state.rates.oxygenProduction, 0);
}

{
  const state = freshEmergency("oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "reduceActivity");
  assert.strictEqual(state.rates.oxygenConsumption, 0.65);
  assert.strictEqual(state.rates.missionProgress, 0.6);
}

{
  const state = freshEmergency("waterMalfunction");
  assert.strictEqual(state.rates.waterRecycling, 0.4);
  const outcome = MissionModel.resolveEmergency(state, "waterMalfunction", "rationWater");
  assert.strictEqual(outcome.applied, true);
  assert.strictEqual(state.resources.crewHealth, 92);
  assert.strictEqual(state.rates.waterConsumption, 0.6);
  assert.strictEqual(state.rates.greenhouseProduction, 0.7);
  assert.strictEqual(MissionModel.resolveEmergency(state, "waterMalfunction", "emergencyReserve").applied, false);
}

{
  const state = freshEmergency("waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "emergencyReserve");
  assert.strictEqual(state.resources.waterReserve, 10);
  assert.strictEqual(state.resources.water, 100, "water is capped at 100 (was 120 for one frame before)");
  assert.strictEqual(state.rates.waterRecycling, 0.4);
}

// ---------------------------------------------------------------------------
// Repairs now take real simulated time (2 sols = 180 s).
// ---------------------------------------------------------------------------

{
  // Oxygen generator repair from full resources, starting at the beginning of Sol 1.
  const state = freshEmergency("oxygenFailure");
  assert.strictEqual(state.rates.oxygenProduction, 0);
  const outcome = MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(outcome.applied, true);
  assert.strictEqual(outcome.secondsSimulated, 2 * SOL);
  assert.strictEqual(state.sol, 3);
  assert.strictEqual(state.elapsedSeconds, 0, "time of day advances with the sols");
  // Generator stays broken for both sols: oxygen -7/sol (production 0), not -3/sol.
  close(state.resources.oxygen, 100 - 2 * 7, "oxygen during repair");
  close(state.resources.water, 100 - 2 * 3, "water during repair");
  close(state.resources.food, 100 - 2 * 4, "food during repair");
  close(state.resources.power, 100 - 15 - 2 * 8, "power: repair cost + 2 sols of use");
  close(state.crew[0].fatigue, 2 * 12, "fatigue builds while awake");
  assert.strictEqual(state.resources.oxygenReserve, 30, "reserves are not drawn automatically");
  assert.strictEqual(state.rates.oxygenProduction, 1, "generator restored after repair");
  assert.strictEqual(state.emergencies.oxygenFailure.status, "resolved");
  assert.strictEqual(state.emergencies.oxygenFailure.choice, "repairGenerator");
  assert.strictEqual(MissionModel.triggerEmergency(state, "oxygenFailure"), false);
}

{
  // Water recycler repair: recycling stays at 40% during the repair.
  const state = freshEmergency("waterMalfunction");
  const outcome = MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.strictEqual(outcome.secondsSimulated, 2 * SOL);
  assert.strictEqual(state.sol, 3);
  close(state.resources.water, 100 - 2 * (7 - 4 * 0.4), "water during repair (recycling impaired)");
  close(state.resources.oxygen, 100 - 2 * 3, "oxygen during repair");
  close(state.resources.food, 100 - 2 * 4, "food during repair");
  close(state.resources.power, 100 - 12 - 2 * 8, "power: repair cost + 2 sols of use");
  assert.strictEqual(state.rates.waterRecycling, 1, "recycler restored after repair");
}

// Repairs at 100%, 50%, 20% and near-zero resources: valid limits, no free gains.
const REPAIRS = [
  ["oxygenFailure", "repairGenerator", { oxygen: 14, water: 6, food: 8, power: 15 + 16 }],
  ["waterMalfunction", "repairRecycler", { oxygen: 6, water: 10.8, food: 8, power: 12 + 16 }],
];
for (const [emergencyId, choiceId, loss] of REPAIRS) {
  for (const level of [100, 50, 20, 2]) {
    const state = freshEmergency(emergencyId, (s) => setLevels(s, level));
    const before = snapshot(state);
    const outcome = MissionModel.resolveEmergency(state, emergencyId, choiceId);
    assert.strictEqual(outcome.applied, true);
    Object.entries(loss).forEach(([resource, amount]) => {
      close(state.resources[resource], Math.max(0, level - amount), `${choiceId} at ${level}%: ${resource}`);
    });
    Object.entries(state.resources).forEach(([resource, value]) => {
      assert.ok(value >= 0 && value <= 100, `${resource} out of range at ${level}%`);
      assert.ok(value <= before.resources[resource] + 1e-9, `${choiceId} at ${level}% must not gain ${resource}`);
    });
    assert.strictEqual(state.sol, 3, `${choiceId} at ${level}% still completes`);
    assert.strictEqual(state.emergencies[emergencyId].status, "resolved");
  }
}

// Repairs starting in the day and at night keep the time of day and emit events in order.
{
  const events = [];
  const state = freshEmergency("oxygenFailure");
  MissionModel.advanceMissionTime(state, 10);
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator", { onEvent: (e) => events.push(e) });
  assert.strictEqual(state.sol, 3);
  assert.strictEqual(state.elapsedSeconds, 10);
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "day");
  assert.deepStrictEqual(events.map((e) => `${e.type}:${e.sol}`), ["nightfall:1", "solStart:2", "nightfall:2", "solStart:3"]);
  assert.ok(events.every((e) => e.simulated === true && e.reason === "repair:oxygenFailure:repairGenerator"));
}
{
  const events = [];
  const state = freshEmergency("waterMalfunction");
  MissionModel.advanceMissionTime(state, 70);
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler", { onEvent: (e) => events.push(e) });
  assert.strictEqual(state.sol, 3);
  assert.strictEqual(state.elapsedSeconds, 70);
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "night");
  assert.deepStrictEqual(events.map((e) => `${e.type}:${e.sol}`), ["solStart:2", "nightfall:2", "solStart:3", "nightfall:3"]);
}

// Sleeping crew recover fatigue during a repair instead of gaining it.
{
  const state = freshEmergency("oxygenFailure");
  state.crew[0].fatigue = 30;
  MissionModel.setCrewAsleep(state, "player", true);
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(state.crew[0].fatigue, 0);
}

// Other active emergencies keep affecting resources during the repair.
{
  const state = freshEmergency("oxygenFailure");
  MissionModel.triggerEmergency(state, "dustStorm"); // power use x1.6 until resolved
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  close(state.resources.power, 100 - 15 - 2 * 8 * 1.6, "dust storm power draw continues during repair");
  assert.strictEqual(state.emergencies.dustStorm.status, "active");
}

// Repairs near Sol 90 simulate only the remaining time and complete the mission.
{
  const events = [];
  const state = freshEmergency("oxygenFailure", (s) => { s.sol = 89; s.elapsedSeconds = 30; });
  const outcome = MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator", { onEvent: (e) => events.push(e) });
  assert.strictEqual(outcome.secondsSimulated, 150, "60 s left in Sol 89 + 90 s of Sol 90");
  assert.strictEqual(outcome.missionComplete, true);
  assert.strictEqual(state.missionComplete, true);
  assert.strictEqual(state.sol, 90);
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "complete");
  close(state.resources.oxygen, 100 - 7 * (150 / SOL), "oxygen only for the remaining mission time");
  assert.strictEqual(events.filter((e) => e.type === "missionComplete").length, 1);
  assert.strictEqual(state.emergencies.oxygenFailure.status, "resolved");
}
{
  const state = freshEmergency("waterMalfunction", (s) => { s.sol = 90; s.elapsedSeconds = 80; });
  const outcome = MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.strictEqual(outcome.secondsSimulated, 10);
  assert.strictEqual(state.missionComplete, true);
}

// No repeated rewards or re-resolution after a repair.
{
  const state = freshEmergency("waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  const after = snapshot(state);
  assert.strictEqual(MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler").applied, false);
  assert.strictEqual(MissionModel.resolveEmergency(state, "waterMalfunction", "emergencyReserve").applied, false);
  assert.strictEqual(MissionModel.triggerEmergency(state, "waterMalfunction"), false);
  assert.deepStrictEqual(snapshot(state), after, "repeat attempts change nothing");
}

// Time-jump guards: hooks cannot advance time or resolve emergencies recursively.
{
  const state = freshEmergency("oxygenFailure");
  MissionModel.triggerEmergency(state, "dustStorm");
  const attempts = [];
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator", {
    onEvent() {
      attempts.push(MissionModel.resolveEmergency(state, "dustStorm", "emergencyBatteries").applied);
      assert.throws(() => MissionModel.advanceMissionTime(state, 10), /already advancing/);
    },
  });
  assert.ok(attempts.length > 0 && attempts.every((applied) => applied === false));
  assert.strictEqual(state.emergencies.dustStorm.status, "active", "no emergency resolved inside the time jump");
  assert.strictEqual(state.sol, 3, "nested advances did not add time");
  // Guard is released afterwards.
  assert.strictEqual(MissionModel.resolveEmergency(state, "dustStorm", "normalOperations").applied, true);
}

// A failing hook still leaves the emergency resolved and the system restored.
{
  const state = freshEmergency("oxygenFailure");
  assert.throws(() => MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator", {
    onEvent() { throw new Error("hook failure"); },
  }), /hook failure/);
  assert.strictEqual(state.emergencies.oxygenFailure.status, "resolved");
  assert.strictEqual(state.rates.oxygenProduction, 1);
  assert.doesNotThrow(() => MissionModel.advanceMissionTime(state, 1), "guard released after a hook error");
}

// Segmented time advance matches one-shot totals and lands exactly on boundaries.
{
  const a = MissionModel.createMissionState();
  const b = MissionModel.createMissionState();
  MissionModel.advanceMissionTime(a, 5 * SOL + 17);
  for (let i = 0; i < 5 * SOL + 17; i += 1) MissionModel.advanceMissionTime(b, 1);
  ["oxygen", "water", "food", "power"].forEach((key) => close(a.resources[key], b.resources[key], `segmented ${key}`));
  assert.strictEqual(a.sol, 6);
  assert.strictEqual(b.sol, 6);
  const c = MissionModel.createMissionState();
  for (let i = 0; i < 900; i += 1) MissionModel.advanceMissionTime(c, 0.1);
  assert.strictEqual(c.sol, 2, "900 x 0.1 s is exactly one sol (no float drift)");
  assert.strictEqual(c.elapsedSeconds, 0);
}

console.log("All emergency scenario tests passed (including repair time simulation, limits, Sol 90 and guards).");
