"use strict";

const assert = require("assert");
const ClassBonuses = require("../static/js/class-bonuses.js");
const MissionModel = require("../static/js/mission-state.js");
const ShopModel = require("../static/js/shop-state.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const R = MissionModel.RESOURCE_CHANGE_PER_SOL;
const DAY = MissionModel.SOL_CYCLE.daySeconds;
// Solar power gathered in the first `seconds` of the mission (daytime only).
const solarFor = (seconds) => {
  const fullSols = Math.floor(seconds / SOL);
  return (fullSols + Math.min(seconds - fullSols * SOL, DAY) / DAY) * R.solarGeneration;
};
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

function memoryStorage() {
  let saved = null;
  return { getItem: () => saved, setItem: (_, value) => { saved = value; } };
}

// Every shop class has a bonus definition; Intern is the free default.
{
  assert.deepStrictEqual(Object.keys(ClassBonuses.CLASSES).sort(), ["Intern", ...Object.keys(ShopModel.CLASSES)].sort());
  assert.deepStrictEqual(ClassBonuses.getBonuses("Intern"), { ...ClassBonuses.NEUTRAL });
  assert.strictEqual(ClassBonuses.getBonuses("Engineer").repairSpeed, 1.4);
  assert.strictEqual(ClassBonuses.getBonuses("Botanist").greenhouseProduction, 1.3);
  assert.strictEqual(ClassBonuses.getBonuses("Commander").emergencyConsumption, 0.9);
  ["Medic", "Scientist"].forEach((name) => {
    assert.ok(ClassBonuses.getClass(name).pending, `${name} bonus is clearly marked pending`);
    assert.deepStrictEqual(ClassBonuses.getBonuses(name), { ...ClassBonuses.NEUTRAL }, `${name} has no fake effect`);
    assert.match(ClassBonuses.describe(name), /Pending:/);
  });
  ["Intern", "Commander", "Engineer", "Botanist"].forEach((name) => assert.strictEqual(ClassBonuses.getClass(name).pending, null));
  assert.throws(() => ClassBonuses.getBonuses("Wizard"), /Unknown class/);
}

// Purchased vs unpurchased: only owned classes (and Intern) can be equipped; purchases persist.
{
  const storage = memoryStorage();
  let shop = ShopModel.create(storage);
  Object.keys(ShopModel.CLASSES).forEach((name) => assert.strictEqual(shop.canEquip(name), false, `${name} not owned yet`));
  assert.strictEqual(shop.canEquip("Intern"), true);
  assert.strictEqual(shop.buy("Engineer").ok, false, "cannot afford without currency");
  shop.reward(); // 150 Solar Cells + 2 Helium-3 test grant
  assert.strictEqual(shop.buy("Engineer").ok, true);
  assert.strictEqual(shop.state.solar, 50, "Engineer costs 100 Solar Cells");
  assert.strictEqual(shop.canEquip("Engineer"), true);
  assert.strictEqual(shop.canEquip("Botanist"), false);
  shop = ShopModel.create(storage);
  assert.strictEqual(shop.canEquip("Engineer"), true, "purchase kept after reload");
}

// Engineer: emergency repairs 40% faster, with resources processed for the shorter time.
{
  const intern = MissionModel.createMissionState();
  const engineer = MissionModel.createMissionState();
  [intern, engineer].forEach((state) => MissionModel.triggerEmergency(state, "oxygenFailure"));
  const a = MissionModel.resolveEmergency(intern, "oxygenFailure", "repairGenerator", { repairSpeed: ClassBonuses.getBonuses("Intern").repairSpeed });
  const b = MissionModel.resolveEmergency(engineer, "oxygenFailure", "repairGenerator", { repairSpeed: ClassBonuses.getBonuses("Engineer").repairSpeed });
  assert.strictEqual(a.secondsSimulated, 2 * SOL);
  close(b.secondsSimulated, (2 * SOL) / 1.4, "Engineer repair time");
  const sols = b.secondsSimulated / SOL;
  close(engineer.resources.oxygen, 100 - R.oxygenConsumption * sols, "oxygen used during the shorter repair");
  close(engineer.resources.power, 100 - 15 - R.powerConsumption * sols + solarFor(b.secondsSimulated), "same repair cost, less time");
  assert.ok(engineer.resources.oxygen > intern.resources.oxygen, "Engineer loses less oxygen");
  assert.strictEqual(engineer.rates.oxygenProduction, 1, "generator restored");
  // Preview uses the same bonus and matches the real outcome.
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "waterMalfunction");
  const preview = MissionModel.previewEmergencyChoice(state, "waterMalfunction", "repairRecycler", { repairSpeed: 1.4 });
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler", { repairSpeed: 1.4 });
  assert.deepStrictEqual(preview.after, state.resources);
  const invalid = MissionModel.createMissionState();
  MissionModel.triggerEmergency(invalid, "oxygenFailure");
  assert.throws(() => MissionModel.resolveEmergency(invalid, "oxygenFailure", "repairGenerator", { repairSpeed: 10 }), RangeError);
  assert.strictEqual(invalid.emergencies.oxygenFailure.status, "active", "invalid speed changes nothing");
}

// Botanist: +30% greenhouse food production, applied once, removed when the class changes.
{
  const state = MissionModel.createMissionState();
  state.resources.food = 50;
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Botanist"]);
  assert.strictEqual(state.rates.greenhouseProduction, 1.3);
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Botanist"]);
  assert.strictEqual(state.rates.greenhouseProduction, 1.3, "re-equipping does not stack");
  MissionModel.advanceMissionTime(state, SOL);
  close(state.resources.food, 50 - R.foodConsumption + R.greenhouseProduction * 1.3, "food after one sol as Botanist");
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Engineer"]);
  assert.strictEqual(state.rates.greenhouseProduction, 1, "switching class removes the Botanist bonus");
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Intern"]);
  assert.ok(!("class" in state.rateModifiers), "Intern leaves no class effect");
}

// Botanist bonus combines with emergencies instead of overwriting them.
{
  const state = MissionModel.createMissionState();
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Botanist"]);
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "rationWater");
  close(state.rates.greenhouseProduction, 0.7 * 1.3, "rationing and Botanist combine");
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.strictEqual(state.rates.greenhouseProduction, 1.3, "class bonus survives the emergency ending");
}

// Team bonuses (for future multiplayer): best of each bonus, never multiplied.
{
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Botanist")), { repairSpeed: 1, greenhouseProduction: 1.3, emergencyConsumption: 1 });
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Engineer")), { repairSpeed: 1.4, greenhouseProduction: 1, emergencyConsumption: 1 });
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Commander")), { repairSpeed: 1, greenhouseProduction: 1, emergencyConsumption: 0.9 },
    "five Commanders still give 0.9, not 0.9^5");
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(["Engineer", "Botanist", "Intern", "Medic", "Commander"]),
    { repairSpeed: 1.4, greenhouseProduction: 1.3, emergencyConsumption: 0.9 });
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Intern")), { ...ClassBonuses.NEUTRAL },
    "an all-Intern crew has no bonuses but can still act");
}

// Essential actions do not depend on class: an Intern can make every emergency choice and repair.
{
  for (const [emergencyId, emergency] of Object.entries(MissionModel.EMERGENCY_CONFIG)) {
    for (const choiceId of Object.keys(emergency.choices)) {
      const state = MissionModel.createMissionState();
      ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Intern"]);
      MissionModel.triggerEmergency(state, emergencyId);
      const outcome = MissionModel.resolveEmergency(state, emergencyId, choiceId, { repairSpeed: ClassBonuses.getBonuses("Intern").repairSpeed });
      assert.strictEqual(outcome.applied, true, `Intern can choose ${emergencyId}/${choiceId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Commander: oxygen, water and power use x0.9 while any emergency is unresolved.
// ---------------------------------------------------------------------------
const commanderState = () => {
  const state = MissionModel.createMissionState();
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Commander"]);
  return state;
};
const consumption = (state) => [state.rates.oxygenConsumption, state.rates.waterConsumption, state.rates.powerConsumption];

// No emergency: no effect at all.
{
  const commander = commanderState();
  const intern = MissionModel.createMissionState();
  assert.deepStrictEqual(consumption(commander), [1, 1, 1]);
  MissionModel.advanceMissionTime(commander, 3 * SOL);
  MissionModel.advanceMissionTime(intern, 3 * SOL);
  assert.deepStrictEqual(commander.resources, intern.resources, "identical to an Intern without emergencies");
}

// One emergency: 10% less oxygen, water and power use.
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "oxygenFailure");
  assert.deepStrictEqual(consumption(state), [0.9, 0.9, 0.9]);
  assert.strictEqual(state.rates.foodConsumption, undefined, "food use is not part of the bonus");
  MissionModel.advanceMissionTime(state, SOL);
  close(state.resources.oxygen, 100 - R.oxygenConsumption * 0.9, "oxygen with the generator off");
  close(state.resources.water, Math.min(100, 100 + R.waterRecycling - R.waterConsumption * 0.9), "water");
  close(state.resources.food, 100 - R.foodConsumption + R.greenhouseProduction, "food unaffected");
}

// Overlapping emergencies: applied once (0.9), combined with each emergency's own effects.
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.triggerEmergency(state, "waterMalfunction");
  assert.strictEqual(state.rates.oxygenConsumption, 0.9, "not 0.9^3");
  assert.strictEqual(state.rates.waterConsumption, 0.9);
  close(state.rates.powerConsumption, 1.6 * 0.9, "storm power use 160% x 0.9");
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Commander"]);
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Commander"]);
  assert.strictEqual(state.rates.oxygenConsumption, 0.9, "re-equipping does not stack");
  MissionModel.resolveEmergency(state, "oxygenFailure", "reduceActivity");
  close(state.rates.oxygenConsumption, 0.65 * 0.9, "Reduce activity x Commander");
}

// Switches off the moment the final emergency is resolved (no time jump involved).
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(state.rates.oxygenConsumption, 0.9, "still on: the water emergency is unresolved");
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.deepStrictEqual(consumption(state), [1, 1, 1], "off once no emergency remains");
  assert.strictEqual(MissionModel.hasUnresolvedEmergency(state), false);
}

// Switches off exactly when a storm passes, including in the middle of a repair time jump.
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "normalOperations");
  MissionModel.advanceMissionTime(state, 2 * SOL);
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  const stormSol = R.solarGeneration - R.powerConsumption * 1.6 * 0.9;
  const repairOnlySol = R.solarGeneration - R.powerConsumption * 0.9;
  close(state.resources.power, 100 - 10 + 2 * stormSol - 15 + stormSol + repairOnlySol,
    "storm + Commander, then repair + Commander, each for the right time");
  assert.deepStrictEqual(consumption(state), [1, 1, 1], "off after the repair finishes");
  MissionModel.advanceMissionTime(state, SOL);
  close(state.resources.power, 100 - 10 + 3 * stormSol - 15 + repairOnlySol + (R.solarGeneration - R.powerConsumption),
    "normal use afterwards");
}

// Emergency previews include the Commander reduction and match the real outcome.
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "oxygenFailure");
  const preview = MissionModel.previewEmergencyChoice(state, "oxygenFailure", "repairGenerator");
  const internState = MissionModel.createMissionState();
  MissionModel.triggerEmergency(internState, "oxygenFailure");
  const internPreview = MissionModel.previewEmergencyChoice(internState, "oxygenFailure", "repairGenerator");
  assert.ok(preview.after.oxygen > internPreview.after.oxygen, "Commander preview uses less oxygen");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.deepStrictEqual(preview.after, state.resources);
}

// Engineer and Botanist bonuses are unchanged; switching class removes the Commander bonus.
{
  const state = commanderState();
  MissionModel.triggerEmergency(state, "waterMalfunction");
  ClassBonuses.applyPassiveBonuses(state, MissionModel, ["Botanist"]);
  assert.deepStrictEqual(consumption(state), [1, 1, 1], "Commander bonus removed");
  assert.strictEqual(state.rates.greenhouseProduction, 1.3);
  const crew = MissionModel.createMissionState();
  ClassBonuses.applyPassiveBonuses(crew, MissionModel, ["Commander", "Engineer", "Botanist"]);
  MissionModel.triggerEmergency(crew, "oxygenFailure");
  assert.strictEqual(crew.rates.oxygenConsumption, 0.9);
  assert.strictEqual(crew.rates.greenhouseProduction, 1.3);
  const repair = MissionModel.resolveEmergency(crew, "oxygenFailure", "repairGenerator", { repairSpeed: 1.4 });
  close(repair.secondsSimulated, (2 * SOL) / 1.4, "Engineer speed still applies");
}

console.log("Class bonus tests passed: purchased/unpurchased/equipped, Engineer repairs, Botanist greenhouse, pending classes, no stacking, team combination, Intern access, Commander emergency bonus.");
