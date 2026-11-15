"use strict";

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");
const MissionClock = require("../static/js/mission-clock.js");
const MissionOne = require("../static/js/mission-one.js");
const MissionOutcome = require("../static/js/mission-outcome.js");
const ClassBonuses = require("../static/js/class-bonuses.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const NIGHT = MissionModel.SOL_CYCLE.nightSeconds;
const R = MissionModel.RESOURCE_CHANGE_PER_SOL;
const GROW = R.greenhouseProduction;
const EAT = R.foodConsumption;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

function state(setup = () => {}) {
  const s = MissionModel.createMissionState();
  s.resources.food = 50;
  setup(s);
  return s;
}

// Sufficient power and water: the greenhouse produces food.
{
  const s = state();
  assert.deepStrictEqual(
    (({ operational, powered, watered, producing }) => ({ operational, powered, watered, producing }))(MissionModel.getGreenhouseStatus(s)),
    { operational: true, powered: true, watered: true, producing: true },
  );
  MissionModel.advanceMissionTime(s, SOL);
  close(s.resources.food, 50 - EAT + GROW, "food with a working greenhouse");
  close(MissionModel.getResourceRatesPerSol(s).food, GROW - EAT, "displayed food rate");
}

// Not tied to daylight: with power available (artificial lighting), night growth equals day growth.
{
  const night = state((x) => { x.elapsedSeconds = 60; });
  const day = state();
  MissionModel.advanceMissionTime(night, NIGHT);
  MissionModel.advanceMissionTime(day, NIGHT);
  close(night.resources.food, 50 + (GROW - EAT) * (NIGHT / SOL), "food grown at night with power");
  close(night.resources.food, day.resources.food, "same growth by night and by day");
}

// No water: production stops; the crew still eats.
{
  const s = state((x) => { x.resources.water = 0; });
  assert.strictEqual(MissionModel.getGreenhouseStatus(s).producing, false);
  close(MissionModel.getResourceRatesPerSol(s).food, -EAT, "displayed food rate without water");
  MissionModel.advanceMissionTime(s, SOL);
  close(s.resources.food, 50 - EAT, "no food grown without water");
}

// No electricity: production stops at night while power is empty, and resumes by day with solar power.
{
  const s = state((x) => { x.resources.power = 0; x.elapsedSeconds = 60; });
  assert.strictEqual(MissionModel.getGreenhouseStatus(s).producing, false);
  MissionModel.advanceMissionTime(s, NIGHT);
  close(s.resources.food, 50 - EAT * (NIGHT / SOL), "no food grown during a night without power");
  const beforeDay = s.resources.food;
  MissionModel.advanceMissionTime(s, MissionModel.SOL_CYCLE.daySeconds);
  close(s.resources.food, beforeDay + (GROW - EAT) * (2 / 3), "production resumes once solar power returns");
}

// Power running out part-way through a span stops production at that exact point.
{
  const s = state((x) => { x.resources.power = 1; x.elapsedSeconds = 60; });
  MissionModel.advanceMissionTime(s, NIGHT);
  const nightUse = R.powerConsumption * (NIGHT / SOL);
  const share = 1 / nightUse; // power lasted this share of the night
  close(s.resources.food, 50 - EAT * (NIGHT / SOL) + GROW * (NIGHT / SOL) * share, "grows only while power lasts");
}

// Greenhouse equipment failure: no production even with power and water, until it is working again.
{
  const s = state();
  MissionModel.setGreenhouseOperational(s, false);
  assert.strictEqual(MissionModel.getGreenhouseStatus(s).producing, false);
  MissionModel.advanceMissionTime(s, SOL);
  close(s.resources.food, 50 - EAT, "failed greenhouse grows nothing");
  MissionModel.setGreenhouseOperational(s, true);
  MissionModel.advanceMissionTime(s, SOL);
  close(s.resources.food, 50 - EAT + (GROW - EAT), "production resumes after the fix");
}

// Botanist: +30% only while the greenhouse is producing.
{
  const working = state();
  ClassBonuses.applyPassiveBonuses(working, MissionModel, ["Botanist"]);
  MissionModel.advanceMissionTime(working, SOL);
  close(working.resources.food, 50 - EAT + GROW * 1.3, "Botanist with a working greenhouse");

  const failed = state();
  ClassBonuses.applyPassiveBonuses(failed, MissionModel, ["Botanist"]);
  MissionModel.setGreenhouseOperational(failed, false);
  MissionModel.advanceMissionTime(failed, SOL);
  close(failed.resources.food, 50 - EAT, "Botanist cannot grow food in a failed greenhouse");

  const dry = state((x) => { x.resources.water = 0; });
  ClassBonuses.applyPassiveBonuses(dry, MissionModel, ["Botanist"]);
  MissionModel.advanceMissionTime(dry, SOL);
  close(dry.resources.food, 50 - EAT, "Botanist cannot grow food without water");
}

// Sol skips process the greenhouse the same way as normal time.
{
  const skipped = state();
  const clock = MissionClock.create(skipped, MissionModel, { devTools: true });
  clock.start();
  clock.advanceSols(5);
  const stepped = state();
  for (let i = 0; i < 5 * SOL; i += 1) MissionModel.advanceMissionTime(stepped, 1);
  close(skipped.resources.food, stepped.resources.food, "5-sol skip equals 450 one-second steps");
  close(skipped.resources.food, 50 + 5 * (GROW - EAT), "food after 5 skipped sols");

  const failed = state();
  MissionModel.setGreenhouseOperational(failed, false);
  const failedClock = MissionClock.create(failed, MissionModel, { devTools: true });
  failedClock.start();
  failedClock.advanceSols(5);
  close(failed.resources.food, 50 - 5 * EAT, "skipped sols with a failed greenhouse grow nothing");
}

// No free food: food never rises by more than the greenhouse could grow, and never above 100%.
{
  for (const [label, setup] of [
    ["normal", () => {}],
    ["no water", (x) => { x.resources.water = 0; }],
    ["no power at night", (x) => { x.resources.power = 0; x.elapsedSeconds = 60; }],
    ["full food", (x) => { x.resources.food = 100; }],
  ]) {
    const s = state(setup);
    const before = s.resources.food;
    MissionModel.advanceMissionTime(s, 10 * SOL);
    assert.ok(s.resources.food <= Math.min(100, before + 10 * (GROW * 1.3 - EAT)) + 1e-9, `${label}: no free food`);
    assert.ok(s.resources.food >= 0 && s.resources.food <= 100, `${label}: food within 0-100`);
  }
}

// Full 90-sol solo run as an Intern under normal conditions is still a success.
{
  const s = MissionModel.createMissionState();
  ClassBonuses.applyPassiveBonuses(s, MissionModel, ["Intern"]);
  MissionOne.create(s);
  const progress = s.missions.establishBase;
  progress.status = "complete";
  MissionOne.OBJECTIVES.forEach((objective) => { progress.completed[objective.id] = { sol: 1, elapsedSeconds: 0 }; });
  const clock = MissionClock.create(s, MissionModel, { devTools: true });
  clock.start();
  clock.setTimeScale(30);
  while (!s.missionComplete) clock.tick(0.25);
  const result = MissionOutcome.evaluate(s, MissionModel.EMERGENCY_CONFIG);
  assert.strictEqual(result.status, "success", JSON.stringify(result.reasons));
  close(s.resources.food, 100 + 90 * (GROW - EAT), "the greenhouse produced on every sol");
  assert.strictEqual(s.resources.crewHealth, 100);
}

console.log("Greenhouse tests passed: power and water required, no daylight dependency, equipment failure, Botanist on working/failed greenhouse, sol skips, no free food, 90-sol Intern run.");
