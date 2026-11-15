"use strict";

// Temporary habitat: layout sanity and integration with the existing habitat,
// rest and survival systems (no duplicate systems, no free resources).

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");
const MissionClock = require("../static/js/mission-clock.js");
const HabitatSystems = require("../static/js/habitat-systems.js");
const RestSystem = require("../static/js/rest-system.js");
const TempHabitat = require("../static/js/temp-habitat.js");

const { LAYOUT } = TempHabitat;

// Layout: every interior point is inside the shelter, beds are reachable and do not overlap.
{
  const inside = (x, z) => Math.hypot(x, z) < LAYOUT.interiorRadius;
  assert.ok(LAYOUT.beds.length >= 2, "at least two sleeping pods");
  // Dome: 4.1 m wide half-sphere, flattened to 72%, on a 1.0 m wall (temp-habitat.js).
  const domeHeightAt = (r) => (r >= 4.1 ? 1.0 : 1.0 + 0.72 * Math.sqrt(4.1 * 4.1 - r * r));
  LAYOUT.beds.forEach((bed) => {
    // Pod footprint: all four corners inside the collision wall, top below the dome.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const r = Math.hypot(bed.x + sx * bed.width / 2, bed.z + sz * bed.depth / 2);
      assert.ok(r < LAYOUT.interiorRadius, `${bed.id} fits inside the wall (${r.toFixed(2)} m)`);
      assert.ok(LAYOUT.floorHeight + bed.height + 0.05 < domeHeightAt(r), `${bed.id} top clears the dome at r=${r.toFixed(2)}`);
    });
    assert.ok(inside(bed.x, bed.approachZ), `${bed.id} approach point is inside`);
    // Standing body (0.4 m half-width) at the approach point is clear of the pod front.
    assert.ok(bed.z - bed.depth / 2 - bed.approachZ >= 0.45, `${bed.id}: standing spot is clear of the pod`);
  });
  // Pods do not overlap each other.
  for (let i = 0; i < LAYOUT.beds.length; i += 1) {
    for (let j = i + 1; j < LAYOUT.beds.length; j += 1) {
      const a = LAYOUT.beds[i], b = LAYOUT.beds[j];
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2, `${a.id} and ${b.id} overlap`);
    }
  }
  assert.ok(LAYOUT.podModel.groups.length >= LAYOUT.beds.length, "a pod model group for every bed slot");
  const points = [LAYOUT.exit, ...LAYOUT.beds.map((b) => ({ ...b, z: b.approachZ })),
    { ...LAYOUT.lifeSupport, x: LAYOUT.lifeSupport.approachX }, { ...LAYOUT.storage, x: LAYOUT.storage.approachX }];
  points.forEach((point) => assert.ok(inside(point.x, point.z), `${point.id} inside`));
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const gap = Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
      assert.ok(gap >= Math.max(points[i].radius, points[j].radius), `${points[i].id} and ${points[j].id} are not on top of each other (${gap.toFixed(2)} m)`);
    }
  }
  const ids = [LAYOUT.entry.id, LAYOUT.exit.id, ...LAYOUT.beds.map((b) => b.id), LAYOUT.lifeSupport.id, LAYOUT.storage.id];
  assert.strictEqual(new Set(ids).size, ids.length, "interaction ids are unique");
  // Ids the existing game code relies on are preserved.
  ["habitat-entry", "habitat-exit", "habitat-bed"].forEach((id) => assert.ok(ids.includes(id), id));
  assert.ok(Math.hypot(LAYOUT.entry.x, LAYOUT.entry.z) > LAYOUT.shellRadius, "entry is outside");
}

// assemble(): marks the shelter ready once, never overwrites another habitat state, adds no resources.
{
  const state = MissionModel.createMissionState();
  const resources = JSON.stringify(state.resources);
  assert.strictEqual(TempHabitat.assemble(state), true);
  assert.deepStrictEqual({ ...state.systems.habitat }, { kind: "temporary", constructed: true, pressurized: true, lifeSupport: true });
  assert.strictEqual(JSON.stringify(state.resources), resources, "assembling adds no resources");
  assert.strictEqual(state.systems.greenhouse.operational, true, "other systems untouched");
  assert.strictEqual(TempHabitat.assemble(state), false, "second call does nothing");

  const built = MissionModel.createMissionState();
  built.systems.habitat = { constructed: false, pressurized: false, lifeSupport: false, kind: "final" };
  assert.strictEqual(TempHabitat.assemble(built), false, "never overwrites a habitat state from another system");
  assert.strictEqual(built.systems.habitat.kind, "final");
}

// The existing habitat airlock works once assembled (was locked: "construction not available").
{
  const state = MissionModel.createMissionState();
  const locked = HabitatSystems.create(state);
  assert.strictEqual(locked.act("openOuter", { suitSafe: true }).ok, false, "before assembly: locked");
  TempHabitat.assemble(state);
  const habitat = HabitatSystems.create(state);
  assert.ok(habitat.chamber(), "airlock chamber available");
  assert.strictEqual(habitat.status.safe, true, "habitat air is safe with base power and oxygen");
  const suit = { suitSafe: true };
  // Entering from Mars, using the teammate's airlock steps unchanged.
  ["openOuter", "enter", "closeOuter", "fill"].forEach((action) => assert.ok(habitat.act(action, suit).ok, action));
  habitat.tick(HabitatSystems.CYCLE_SECONDS);
  ["verify", "openInner", "toHabitat"].forEach((action) => assert.ok(habitat.act(action, suit).ok, action));
  assert.strictEqual(habitat.chamber().side, "habitat");
  // An unsafe suit still cannot leave.
  assert.strictEqual(habitat.act("vent", { suitSafe: false }).ok, false, "no venting without a safe suit");
  // No power -> habitat life support is not safe (no free life support).
  state.resources.power = 0;
  assert.strictEqual(HabitatSystems.create(state).status.safe, false, "habitat needs base power");
}

// The habitat beds are rest points of the existing rest system (sleep until morning at night).
{
  const state = MissionModel.createMissionState();
  TempHabitat.assemble(state);
  const clock = MissionClock.create(state, MissionModel, { devTools: false });
  clock.start();
  const habitatPlace = () => ({ inside: true, obstructed: false, accessible: true, cabin: "habitat",
    completed: state.systems.habitat.constructed, pressurized: state.systems.habitat.pressurized,
    lifeSupport: state.systems.habitat.lifeSupport, criticalEmergency: false });
  const rest = RestSystem.create(state, MissionModel, clock, { place: habitatPlace });
  while (MissionModel.getMissionClock(state).phase !== "night") clock.tick(0.5);
  const before = { ...state.resources };
  const result = rest.begin("habitat-bed-2");
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.night, true);
  for (let i = 0; i < 40 && rest.active; i += 1) rest.tick(0.25);
  assert.strictEqual(rest.active, false);
  assert.strictEqual(state.sol, 2, "slept until morning");
  assert.strictEqual(state.crew[0].isAsleep, false, "awake at sunrise");
  assert.ok(state.resources.food < before.food, "supplies were used overnight (no free resources in the habitat)");

  // Before assembly the habitat bed refuses (the old placeholder behaviour).
  const fresh = MissionModel.createMissionState();
  const freshClock = MissionClock.create(fresh, MissionModel, { devTools: false });
  freshClock.start();
  const freshRest = RestSystem.create(fresh, MissionModel, freshClock, { place: () => ({ inside: true, accessible: true, obstructed: false, cabin: "habitat", completed: false, pressurized: false, lifeSupport: false }) });
  assert.strictEqual(freshRest.begin("habitat-bed").ok, false);
}

// Survival: base consumption is the same with or without the habitat (it produces nothing).
{
  const a = MissionModel.createMissionState();
  const b = MissionModel.createMissionState();
  TempHabitat.assemble(b);
  MissionModel.advanceMissionTime(a, 180);
  MissionModel.advanceMissionTime(b, 180);
  assert.deepStrictEqual(b.resources, a.resources, "identical resources after 2 sols");
}

// ---------------------------------------------------------------------------
// Construction: packed on landing, unlocked after Mission 1, built once.
// ---------------------------------------------------------------------------
const MissionOne = require("../static/js/mission-one.js");

function missionOneComplete() {
  const state = MissionModel.createMissionState();
  const mission = MissionOne.create(state);
  const IN = { insideCabin: true, onSurface: false, clearOfHatch: true };
  const OUT = { insideCabin: false, onSurface: true, clearOfHatch: true };
  mission.start();
  mission.checkLifeSupport(); mission.verifyPressure(); mission.activatePower(); mission.inspectPower(); mission.checkSupplies();
  mission.donSuit(IN); mission.suitCheck();
  mission.airlock("depressurize", IN); mission.tick(6, IN); mission.airlock("open", IN); mission.tick(0.1, OUT);
  MissionOne.SURVEY_MARKERS.forEach((marker) => mission.inspectMarker(marker.id));
  mission.airlock("close", IN); mission.airlock("repressurize", IN); mission.tick(6, IN);
  mission.submitReport(IN); mission.tick(4, IN);
  assert.strictEqual(mission.status, "complete");
  return { state, mission };
}

// On landing: packed, locked before Mission 1 (with the exact reason), habitat unusable.
{
  const state = MissionModel.createMissionState();
  assert.strictEqual(TempHabitat.stage(state), "packed");
  assert.strictEqual(TempHabitat.progress(state), 0);
  const locked = TempHabitat.constructionStatus(state, false);
  assert.strictEqual(locked.available, false);
  assert.match(locked.reason, /Complete Mission 1 first/);
  const refused = TempHabitat.startConstruction(state, { missionOneComplete: false });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(state.systems.habitat, undefined, "nothing changes when refused");
  assert.strictEqual(HabitatSystems.create(state).act("openOuter", { suitSafe: true }).ok, false, "airlock locked while packed");
}

// After Mission 1: unlocked; assembly takes mission time, costs no base resources, then unlocks everything.
{
  const { state } = missionOneComplete();
  assert.strictEqual(TempHabitat.constructionStatus(state, true).available, true);
  const resources = JSON.stringify(state.resources);
  const started = TempHabitat.startConstruction(state, { missionOneComplete: true });
  assert.strictEqual(started.ok, true);
  assert.match(started.message, /Earth-delivered habitat kit/);
  assert.strictEqual(TempHabitat.stage(state), "building");
  assert.strictEqual(JSON.stringify(state.resources), resources, "no oxygen, water, food or power deducted");
  // Cannot be started twice (in progress).
  assert.strictEqual(TempHabitat.startConstruction(state, { missionOneComplete: true }).ok, false);
  assert.match(TempHabitat.constructionStatus(state, true).reason, /already in progress/);
  // Not usable while building.
  assert.strictEqual(HabitatSystems.create(state).chamber(), null, "airlock stays locked during assembly");

  // Progress through the shared mission-time observer, as the game wires it.
  let completions = 0;
  MissionModel.observeTime(state, (seconds) => { if (TempHabitat.advanceConstruction(state, seconds).completed) completions += 1; });
  MissionModel.advanceMissionTime(state, TempHabitat.CONSTRUCTION.seconds / 2);
  assert.ok(Math.abs(TempHabitat.progress(state) - 0.5) < 1e-6, "half way after half the time");
  MissionModel.advanceMissionTime(state, TempHabitat.CONSTRUCTION.seconds);
  assert.strictEqual(TempHabitat.stage(state), "built");
  assert.strictEqual(completions, 1, "completion reported exactly once");
  assert.deepStrictEqual(Object.keys(state.systems.habitat).sort(), ["builtSol", "constructed", "kind", "lifeSupport", "pressurized"]);
  // Cannot be built twice.
  assert.strictEqual(TempHabitat.startConstruction(state, { missionOneComplete: true }).ok, false);
  assert.match(TempHabitat.constructionStatus(state, true).reason, /already assembled/);
  // Airlock, beds (rest system) unlocked.
  const habitat = HabitatSystems.create(state);
  assert.ok(habitat.chamber(), "airlock available once built");
  assert.ok(habitat.act("openOuter", { suitSafe: true }).ok);
}

// The lander stays a safe shelter and sleeping place while the habitat is packed or building.
{
  const { state } = missionOneComplete();
  TempHabitat.startConstruction(state, { missionOneComplete: true });
  const clock = MissionClock.create(state, MissionModel, { devTools: false });
  clock.start();
  const landerPlace = () => ({ inside: true, obstructed: false, accessible: true, cabin: "lander", completed: true, pressurized: true, lifeSupport: true, criticalEmergency: false });
  const habitatPlace = () => ({ inside: true, obstructed: false, accessible: true, cabin: "habitat", completed: state.systems.habitat.constructed === true,
    pressurized: state.systems.habitat.pressurized === true, lifeSupport: state.systems.habitat.lifeSupport === true, criticalEmergency: false });
  const landerRest = RestSystem.create(state, MissionModel, clock, { place: landerPlace });
  const habitatRest = RestSystem.create(state, MissionModel, clock, { place: habitatPlace });
  assert.match(habitatRest.reason("habitat-bed"), /needs construction/, "habitat beds wait for assembly");
  assert.strictEqual(landerRest.reason("lander-bed-1"), null, "lander bunks still available");
}

// Save-ready: the built (and in-progress) state is plain data and survives a save-format round trip.
{
  const { state } = missionOneComplete();
  TempHabitat.startConstruction(state, { missionOneComplete: true });
  TempHabitat.advanceConstruction(state, 3);
  const midway = JSON.parse(JSON.stringify(state));
  assert.strictEqual(TempHabitat.stage(midway), "building");
  assert.ok(Math.abs(TempHabitat.progress(midway) - 3 / TempHabitat.CONSTRUCTION.seconds) < 1e-9, "progress restored");
  assert.strictEqual(TempHabitat.advanceConstruction(midway, TempHabitat.CONSTRUCTION.seconds).completed, true, "restored assembly can finish");

  TempHabitat.advanceConstruction(state, TempHabitat.CONSTRUCTION.seconds);
  const saved = JSON.parse(JSON.stringify(state));
  assert.strictEqual(TempHabitat.stage(saved), "built");
  assert.strictEqual(TempHabitat.startConstruction(saved, { missionOneComplete: true }).ok, false, "a restored built habitat cannot be rebuilt");
  assert.ok(HabitatSystems.create(saved).chamber(), "airlock works from restored state");
  assert.strictEqual(HabitatSystems.create(saved).status.safe, true);
}

console.log("temp-habitat tests passed");
