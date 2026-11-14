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
  ["Commander", "Medic", "Scientist"].forEach((name) => {
    assert.ok(ClassBonuses.getClass(name).pending, `${name} bonus is clearly marked pending`);
    assert.deepStrictEqual(ClassBonuses.getBonuses(name), { ...ClassBonuses.NEUTRAL }, `${name} has no fake effect`);
    assert.match(ClassBonuses.describe(name), /Pending:/);
  });
  ["Intern", "Engineer", "Botanist"].forEach((name) => assert.strictEqual(ClassBonuses.getClass(name).pending, null));
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
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Botanist")), { repairSpeed: 1, greenhouseProduction: 1.3 });
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(Array(5).fill("Engineer")), { repairSpeed: 1.4, greenhouseProduction: 1 });
  assert.deepStrictEqual(ClassBonuses.combineTeamBonuses(["Engineer", "Botanist", "Intern", "Medic", "Commander"]),
    { repairSpeed: 1.4, greenhouseProduction: 1.3 });
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

console.log("Class bonus tests passed: purchased/unpurchased/equipped, Engineer repairs, Botanist greenhouse, pending classes, no stacking, team combination, Intern access.");
