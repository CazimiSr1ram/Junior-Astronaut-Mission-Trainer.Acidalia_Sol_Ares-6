"use strict";

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");
const MissionClock = require("../static/js/mission-clock.js");
const ShopModel = require("../static/js/shop-state.js");

function setup(crew = ["player"], devTools = true) {
  const state = MissionModel.createMissionState(crew);
  const clock = MissionClock.create(state, MissionModel, { devTools });
  return { state, clock };
}

function run(clock, seconds, step = 0.25) {
  for (let t = 0; t < seconds - 1e-9; t += step) clock.tick(step);
}

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

// Sol cycle constants are 60 s day + 30 s night = 90 s.
assert.deepStrictEqual({ ...MissionModel.SOL_CYCLE }, { daySeconds: 60, nightSeconds: 30, totalSeconds: 90 });

// Time does not run before start() (lobby, briefing and launch cutscene).
{
  const { state, clock } = setup();
  for (let i = 0; i < 100; i += 1) assert.strictEqual(clock.tick(0.25), false);
  assert.strictEqual(state.elapsedSeconds, 0);
  assert.strictEqual(state.sol, 1);
  assert.strictEqual(clock.start(), true);
  assert.strictEqual(clock.start(), false, "start is idempotent");
}

// Exact phase and sol boundaries.
{
  const { state, clock } = setup();
  clock.start();
  run(clock, 59.75);
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "day");
  run(clock, 0.25);
  assert.strictEqual(state.elapsedSeconds, 60);
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "night");
  assert.strictEqual(clock.snapshot().secondsToNextPhase, 30);
  run(clock, 29.75);
  assert.strictEqual(state.sol, 1);
  run(clock, 0.25);
  assert.strictEqual(state.sol, 2, "a sol lasts exactly 90 seconds");
  assert.strictEqual(state.elapsedSeconds, 0);
  run(clock, 270);
  assert.strictEqual(state.sol, 5, "three more sols take 270 seconds");
  assert.strictEqual(state.elapsedSeconds, 0);
}

// Large frame gaps are capped; pausing stops time.
{
  const { state, clock } = setup();
  clock.start();
  clock.tick(10);
  assert.strictEqual(state.elapsedSeconds, MissionClock.MAX_TICK_SECONDS);
  clock.setPaused(true);
  run(clock, 5);
  assert.strictEqual(state.elapsedSeconds, MissionClock.MAX_TICK_SECONDS);
  clock.setPaused(false);
  run(clock, 1);
  close(state.elapsedSeconds, 1.25, "time resumes after pause");
}

// Night skip rules with 1, 2 and 5 crew members (model level; networking is not implemented).
for (const size of [1, 2, 5]) {
  const crew = Array.from({ length: size }, (_, i) => (i === 0 ? "player" : `crew${i}`));
  const { state, clock } = setup(crew);
  clock.start();
  run(clock, 65);
  // Everyone but one asleep: the night continues normally.
  crew.slice(1).forEach((id) => clock.setCrewAsleep(id, true));
  run(clock, 10);
  assert.strictEqual(state.sol, 1, `${size} crew: one awake keeps night running`);
  close(state.elapsedSeconds, 75, `${size} crew: night time passes normally`);
  // Last crew member sleeps: remaining night is skipped immediately.
  const skip = clock.setCrewAsleep("player", true);
  assert.ok(skip, `${size} crew: all asleep should skip`);
  assert.strictEqual(state.sol, 2);
  assert.strictEqual(state.elapsedSeconds, 0);
  close(skip.seconds, 15, `${size} crew: skipped the remaining 15 s`);
  assert.ok(skip.reason.includes(`All ${size} crew`));
  // The crew wakes at the start of the new sol.
  assert.ok(state.crew.every((member) => !member.isAsleep), `${size} crew: everyone wakes at sol start`);
  // Daytime runs normally after waking.
  run(clock, 5);
  close(state.elapsedSeconds, 5, `${size} crew: daytime runs normally after waking`);
  assert.ok(state.crew.every((member) => member.fatigue < 50));
  // The next night is NOT skipped automatically: nobody chose to sleep again.
  run(clock, 60);
  assert.strictEqual(state.sol, 2, `${size} crew: next night is not auto-skipped`);
  close(state.elapsedSeconds, 65, `${size} crew: second night passes normally`);
  // Sleeping during the day skips nothing until night falls, then skips it.
  run(clock, 30); // sol 3, 5 s into the day
  assert.strictEqual(state.sol, 3);
  crew.forEach((id) => clock.setCrewAsleep(id, true));
  run(clock, 54); // still daytime: nothing skipped
  assert.strictEqual(state.sol, 3, `${size} crew: daytime sleep skips nothing`);
  close(state.elapsedSeconds, 59, `${size} crew: day time passes normally while asleep`);
  run(clock, 2); // nightfall with everyone asleep: the night is skipped
  assert.strictEqual(state.sol, 4, `${size} crew: night skipped once everyone is asleep`);
  assert.ok(state.crew.every((member) => !member.isAsleep), `${size} crew: wakes again at sol start`);
}

// Skipped sols still simulate resources and fatigue; dev skips are recorded.
{
  const { state, clock } = setup();
  const R = MissionModel.RESOURCE_CHANGE_PER_SOL;
  ["oxygen", "water", "food", "power"].forEach((key) => { state.resources[key] = 50; });
  clock.start();
  const skip = clock.advanceSols(3);
  assert.strictEqual(state.sol, 4);
  assert.strictEqual(skip.type, "dev-sols");
  close(state.resources.water, 50 + 3 * (R.waterRecycling - R.waterConsumption), "water simulated across skipped sols");
  close(state.resources.food, 50 + 3 * (R.greenhouseProduction - R.foodConsumption), "food simulated across skipped sols");
  close(state.resources.power, 50 + 3 * (R.solarGeneration - R.powerConsumption), "power and solar simulated across skipped sols");
  close(state.crew[0].fatigue, 36, "fatigue accumulates while awake");
  const phaseSkip = clock.skipToNextPhase();
  assert.strictEqual(MissionModel.getMissionClock(state).phase, "night");
  close(phaseSkip.seconds, 60, "phase skip covers the rest of the day");
  assert.throws(() => clock.advanceSols(0), RangeError);
  assert.throws(() => clock.advanceSols(11), RangeError);
  assert.throws(() => clock.setTimeScale(1000), RangeError);
}

// Emergencies during time progression.
{
  const { state, clock } = setup();
  clock.start();
  run(clock, 45);
  MissionModel.triggerEmergency(state, "oxygenFailure");
  const before = state.resources.oxygen;
  run(clock, 9); // 0.1 sol with no oxygen production
  close(state.resources.oxygen, before - 0.7, "failed generator stops oxygen production");
  const solBefore = state.sol;
  const elapsedBefore = state.elapsedSeconds;
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  const jump = clock.recordExternalJump(solBefore, elapsedBefore, "Emergency decision: oxygenFailure → repairGenerator");
  assert.strictEqual(jump.toSol, solBefore + 2);
  assert.strictEqual(jump.type, "external");
  assert.strictEqual(clock.lastSkip, jump);
}

// Whole mission at accelerated speed reaches Sol 90 and stops.
{
  const { state, clock } = setup();
  clock.start();
  clock.setTimeScale(30);
  let ticks = 0;
  while (!state.missionComplete && ticks < 100000) {
    clock.tick(0.25);
    ticks += 1;
  }
  assert.strictEqual(state.missionComplete, true);
  assert.strictEqual(state.sol, 90);
  assert.strictEqual(ticks, Math.ceil((90 * 90) / 7.5), "90 sols x 90 s at x30");
  assert.strictEqual(clock.tick(0.25), false, "clock stops after the mission");
}

// Without devTools, acceleration controls do not exist; the clock never touches currency.
{
  const { clock } = setup(["player"], false);
  ["setTimeScale", "skipToNextPhase", "advanceSols", "setCrewAsleep"].forEach((name) => {
    assert.strictEqual(clock[name], undefined, `${name} must not exist for players`);
  });
  assert.ok(Object.isFrozen(clock));

  let saved = null;
  const shop = ShopModel.create({ getItem: () => saved, setItem: (_, value) => { saved = value; } });
  const before = JSON.stringify(shop.state);
  const dev = setup(["player"], true);
  dev.clock.start();
  dev.clock.setTimeScale(30);
  dev.clock.advanceSols(5);
  dev.clock.skipToNextPhase();
  run(dev.clock, 20);
  assert.strictEqual(JSON.stringify(ShopModel.create({ getItem: () => saved, setItem() {} }).state), before,
    "time controls must not grant Solar Cells, Helium-3 or classes");
}

console.log("Mission clock tests passed: start gating, 60/30/90 s boundaries, pause, night skip (1/2/5 crew), simulated skips, emergencies, full mission, dev-only controls.");
