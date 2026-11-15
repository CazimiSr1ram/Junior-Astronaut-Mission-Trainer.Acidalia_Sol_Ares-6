"use strict";
const assert = require("assert");
const Model = require("../static/js/mission-state.js");
const Habitat = require("../static/js/habitat-systems.js");
const Guide = require("../static/js/airlock-guide.js");
const MissionOne = require("../static/js/mission-one.js");
const state = Model.createMissionState();
state.systems.habitat = { constructed: true, pressurized: true, lifeSupport: true };
const habitat = Habitat.create(state);
const suit = { on: true, helmet: true, checked: true, safe: true, ready: true };
const env = { suitSafe: true, insideHabitat: true };
function run(direction, expected) {
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const a = habitat.chamber();
    const guide = Guide.next(a, direction, suit);
    assert.ok(guide.step >= 1 && guide.step <= 4);
    if (guide.waiting) {
      assert.ok(!a.outerOpen && !a.innerOpen, "both doors sealed during pressure cycle");
      const before = state.resources.food;
      Model.advanceMissionTime(state, Habitat.CYCLE_SECONDS / 2);
      habitat.tick(Habitat.CYCLE_SECONDS / 2);
      assert.ok(state.resources.food < before, "survival costs continue during cycle");
      habitat.tick(Habitat.CYCLE_SECONDS / 2);
      continue;
    }
    assert.ok(guide.action, `no next action: ${JSON.stringify(guide)}`);
    const outcome = habitat.act(guide.action, env);
    assert.ok(outcome.ok, `${guide.action}: ${JSON.stringify(outcome)}`);
    assert.ok(!(a.outerOpen && a.innerOpen), "door interlock remains intact");
    seen.push(guide.action);
    if (guide.action === (direction === "enter" ? "toHabitat" : "toMars")) break;
  }
  assert.deepStrictEqual(seen, expected);
}
run("enter", ["openOuter", "enter", "closeOuter", "fill", "verify", "openInner", "toHabitat"]);
const a = habitat.chamber();
assert.equal(a.side, "habitat");
assert.equal(Guide.next(a, "exit", { ...suit, on: false }).action, "suitOn");
assert.equal(Guide.next(a, "exit", { ...suit, helmet: false }).action, "sealHelmet");
assert.equal(Guide.next(a, "exit", { ...suit, checked: false }).action, "suitCheck");
run("exit", ["openInner", "enter", "closeInner", "vent", "openOuter", "toMars"]);
assert.equal(a.side, "outside");
assert.equal(Guide.next(a, "enter", { ...suit, ready: false }).action, null);
assert.ok(Guide.next(a, "enter", { ...suit, ready: false }).reason);
assert.equal(habitat.act("openInner", env).ok, false, "cannot bypass safe pressure");
assert.equal(habitat.act("openOuter", { ...env, suitSafe: false }).ok, false, "unsafe suit blocks exit");
Object.assign(a, { side: "chamber", innerOpen: false, outerOpen: false, pressure: "safe", verified: true });
assert.equal(Guide.next(a, "exit", { ...suit, ready: false }).action, "openInner", "unsafe suit directs the player back to shelter");
okReturn();
function okReturn() {
  assert.ok(habitat.act("openInner", env).ok);
  assert.equal(Guide.next(a, "exit", { ...suit, ready: false }).action, "toHabitat");
  assert.ok(habitat.act("toHabitat", env).ok);
}
const mission = MissionOne.create(state);
mission.progress.status = "complete"; mission.progress.completed.suit = { sol: 1 };
assert.ok(mission.donSuit({ habitatSafe: true }).ok, "existing suit can be equipped in safe habitat");
assert.ok(mission.suitCheck().ok);
assert.equal(mission.removeSuit({ habitatSafe: false }).ok, false, "cannot remove suit in unsafe area");
assert.ok(mission.removeSuit({ habitatSafe: true }).ok, "safe habitat allows removal");
console.log("Guided airlock tests passed: entry, exit, interlocks, timed costs, suit preparation and safety.");
