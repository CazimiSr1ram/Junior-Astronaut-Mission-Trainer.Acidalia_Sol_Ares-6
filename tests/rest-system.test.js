"use strict";
const assert = require("assert");
const Model = require("../static/js/mission-state.js");
const Clock = require("../static/js/mission-clock.js");
const Rest = require("../static/js/rest-system.js");
const MissionOne = require("../static/js/mission-one.js");
const Outcome = require("../static/js/mission-outcome.js");
const safe = () => ({ inside: true, completed: true, pressurized: true, accessible: true, obstructed: false, lifeSupport: true });
function setup(crew = ["player"]) {
  const state = Model.createMissionState(crew);
  state.elapsedSeconds = 72;
  state.crew[0].fatigue = 60;
  const clock = Clock.create(state, Model);
  clock.start();
  const place = safe();
  const events = [], wakes = [];
  const hooks = { place: () => place, onEvent: (e) => events.push(e), onWake: (r) => wakes.push(r) };
  const rest = Rest.create(state, Model, clock, hooks);
  return { state, clock, place, events, wakes, hooks, rest };
}
function finish(rest) {
  let frames = 0;
  while (rest.active && frames++ < 500) rest.tick(0.05);
  assert.ok(!rest.active, "rest must finish within bounded frames");
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// One decision skips exactly the remaining night; sunrise wakes; next night is ordinary.
{
  const { state, clock, rest, events, wakes } = setup();
  assert.ok(rest.begin("lander-bed--1").ok);
  assert.ok(!rest.begin("lander-bed-1").ok, "duplicate click refused");
  finish(rest);
  assert.equal(state.sol, 2);
  close(state.elapsedSeconds, 0);
  assert.equal(state.crew[0].isAsleep, false);
  assert.equal(wakes[0].message, "Good morning! Sol 2");
  assert.equal(wakes[0].seconds, 18);
  assert.equal(events.filter((e) => e.type === "solStart").length, 1);
  for (let i = 0; i < 260; i++) clock.tick(0.25);
  assert.equal(state.sol, 2);
  close(state.elapsedSeconds, 65);
  rest.tick(10000);
  close(state.elapsedSeconds, 65);
}

// Both lander bunks and a future constructed habitat use the same rest engine.
for (const bed of ["lander-bed--1", "lander-bed-1", "habitat-bed"]) {
  const { state, rest } = setup();
  assert.ok(rest.begin(bed).ok);
  finish(rest);
  assert.equal(state.sol, 2);
}
// A habitat without construction is never silently unlocked by completing a mission.
{
  const { state, rest, place } = setup();
  state.missions = { establishBase: { status: "complete" } };
  place.completed = false;
  assert.match(rest.begin("habitat-bed").message, /construction/);
}

// Day rest uses normal time, fatigue recovery and resource processing, and never crosses dusk.
for (const start of [10, 59.9]) {
  const { state, rest } = setup();
  state.elapsedSeconds = start;
  const fatigue = state.crew[0].fatigue;
  const food = state.resources.food;
  assert.ok(rest.begin("lander-bed-1").ok);
  rest.tick(0.05);
  close(state.elapsedSeconds, start + 0.05);
  finish(rest);
  assert.equal(state.sol, 1);
  assert.ok(state.elapsedSeconds < 60);
  assert.ok(state.crew[0].fatigue < fatigue);
  assert.ok(state.resources.food < food);
  assert.equal(state.crew[0].isAsleep, false);
}

// Clear refusals, with no changes to time, resources or sleep flags.
for (const [field, value, expected] of [
  ["inside", false, /inside/], ["pressurized", false, /air/],
  ["lifeSupport", false, /life support/], ["accessible", false, /clear floor/],
  ["obstructed", true, /clear floor/],
]) {
  const { state, rest, place } = setup();
  place[field] = value;
  const before = JSON.stringify(state);
  assert.match(rest.begin("lander-bed-1").message, expected);
  assert.equal(JSON.stringify(state), before);
}
{
  const { state, rest } = setup();
  Model.triggerEmergency(state, "oxygenFailure");
  state.resources.oxygen = 15;
  assert.equal(rest.begin("lander-bed-1").ok, false);
}

// Rest resource deltas, solar, greenhouse and fatigue exactly match ordinary clock simulation.
for (const start of [12, 70]) {
  const { state, rest } = setup();
  state.elapsedSeconds = start;
  state.resources.oxygen = 70;
  Model.triggerEmergency(state, "oxygenFailure"); // noncritical: reserves allow rest
  const expected = JSON.parse(JSON.stringify(state));
  Model.setCrewAsleep(expected, "player", true);
  Model.advanceMissionTime(expected, start < 60 ? 3 : 20);
  assert.ok(rest.begin("lander-bed-1").ok);
  finish(rest);
  for (const key of Object.keys(expected.resources)) close(state.resources[key], expected.resources[key]);
  close(state.crew[0].fatigue, expected.crew[0].fatigue);
  assert.ok(state.resources.oxygen < 70, "oxygen consumption continues with failed production");
}

// A critical alert arising during fast-forward interrupts immediately; no subsequent skip.
for (const [field, value] of [["pressurized", false], ["lifeSupport", false], ["inside", false], ["obstructed", true]]) {
  const { state, rest, hooks, place } = setup();
  hooks.onElapsed = () => { place[field] = value; };
  rest.begin("lander-bed-1");
  rest.tick(0.25);
  assert.ok(!rest.active);
  close(state.elapsedSeconds, 72.25);
  assert.equal(state.crew[0].isAsleep, false);
}
{
  const { state, rest, hooks, wakes, clock } = setup();
  hooks.onElapsed = () => { Model.triggerEmergency(state, "oxygenFailure"); state.resources.oxygen = 15; };
  assert.ok(rest.begin("lander-bed-1").ok);
  rest.tick(0.25);
  assert.ok(!rest.active);
  close(state.elapsedSeconds, 72.25);
  assert.match(wakes[0].message, /critical/);
  assert.equal(state.crew[0].isAsleep, false);
  clock.tick(0.25);
  close(state.elapsedSeconds, 72.5);
}

// Mission report timers and completion are processed during sleep by the existing mission module.
{
  const { state, rest, events } = setup();
  Model.triggerEmergency(state, "dustStorm");
  state.emergencies.dustStorm.endsAt = 73;
  rest.begin("lander-bed-1");
  finish(rest);
  assert.equal(state.emergencies.dustStorm.status, "resolved");
  assert.ok(events.some((event) => event.type === "emergencyEnded"));
}
{
  const { state, rest, hooks } = setup();
  const mission = MissionOne.create(state);
  Object.assign(mission.progress, { status: "active", current: MissionOne.OBJECTIVES.findIndex((o) => o.id === "report"), report: "transmitting", reportRemaining: 2 });
  hooks.onElapsed = (seconds) => mission.tick(seconds, { insideCabin: true, onSurface: false });
  rest.begin("lander-bed-1");
  finish(rest);
  assert.equal(mission.progress.report, "acknowledged");
  assert.equal(mission.progress.status, "complete");
}

// A mission-ending event wakes and clears flags, including errors in event hooks.
{
  const { state, rest } = setup();
  state.resources.crewHealth = 0.001;
  state.rates.oxygenConsumption = 10000; // catastrophic loss during the first simulated step
  rest.begin("lander-bed-1");
  finish(rest);
  assert.ok(state.missionComplete && state.failure, "normal resource integration detects death during sleep");
  assert.equal(state.crew[0].isAsleep, false);
  assert.equal(state.sol, 1);
}
{
  const { state, rest, hooks, wakes } = setup();
  hooks.onElapsed = () => Model.failMission(state, "crewHealth");
  rest.begin("lander-bed-1");
  finish(rest);
  assert.ok(state.missionComplete);
  assert.equal(state.crew[0].isAsleep, false);
  assert.match(wakes[0].message, /mission has ended/);
  close(state.elapsedSeconds, 72.25);
}
{
  const { state, rest, hooks } = setup();
  hooks.onElapsed = () => { throw new Error("test event failure"); };
  rest.begin("lander-bed-1");
  assert.throws(() => rest.tick(0.1), /test event failure/);
  assert.ok(!rest.active);
  assert.equal(state.crew[0].isAsleep, false);
}

// Sol 90 completion is never bypassed, and the existing outcome evaluator still runs.
{
  const { state, rest, events } = setup();
  state.sol = 90;
  rest.begin("lander-bed-1");
  finish(rest);
  assert.equal(state.sol, 90);
  assert.equal(state.elapsedSeconds, 90);
  assert.ok(state.missionComplete);
  assert.equal(state.crew[0].isAsleep, false);
  assert.equal(events.filter((e) => e.type === "missionComplete").length, 1);
  assert.equal(Outcome.evaluate(state).status, "failure", "sleep cannot grant missing mission objectives");
  state.missions = { establishBase: { status: "complete" } };
  assert.equal(Outcome.evaluate(state).status, "success");
  assert.equal(rest.begin("lander-bed-1").ok, false);
}

// Real active crew gate acceleration; disconnected/inactive crew do not block it.
for (const inactiveField of [null, "connected", "active"]) {
  const { state, rest } = setup(["player", "peer"]);
  if (inactiveField) state.crew[1][inactiveField] = false;
  rest.begin("lander-bed-1");
  rest.tick(0.1);
  close(state.elapsedSeconds, inactiveField ? 78 : 72.1);
  if (!inactiveField) Model.setCrewAsleep(state, "peer", true);
  finish(rest);
  assert.equal(state.sol, 2);
  assert.ok(state.crew.every((member) => !member.isAsleep));
}
console.log("Rest system tests passed.");
