"use strict";

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");

function freshEmergency(emergencyId) {
  const state = MissionModel.createMissionState();
  assert.strictEqual(MissionModel.triggerEmergency(state, emergencyId), true);
  return state;
}

{
  const state = freshEmergency("dustStorm");
  assert.strictEqual(state.rates.powerConsumption, 1.6);
  const outcome = MissionModel.resolveEmergency(state, "dustStorm", "emergencyBatteries");
  assert.strictEqual(outcome.applied, true);
  assert.strictEqual(state.resources.batteryReserve, 20);
  assert.strictEqual(state.resources.power, 115);
  assert.strictEqual(state.rates.powerConsumption, 1);
  assert.strictEqual(MissionModel.resolveEmergency(state, "dustStorm", "normalOperations").applied, false);
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
  assert.strictEqual(state.rates.oxygenProduction, 0);
  const outcome = MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(outcome.applied, true);
  assert.strictEqual(state.resources.power, 85);
  assert.strictEqual(state.sol, 3);
  assert.strictEqual(state.rates.oxygenProduction, 1);
  assert.strictEqual(MissionModel.triggerEmergency(state, "oxygenFailure"), false);
}

{
  const state = freshEmergency("oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "emergencyTanks");
  assert.strictEqual(state.resources.oxygenReserve, 10);
  assert.strictEqual(state.resources.oxygen, 120);
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
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.strictEqual(state.resources.power, 88);
  assert.strictEqual(state.sol, 3);
  assert.strictEqual(state.rates.waterRecycling, 1);
}

{
  const state = freshEmergency("waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "emergencyReserve");
  assert.strictEqual(state.resources.waterReserve, 10);
  assert.strictEqual(state.resources.water, 120);
  assert.strictEqual(state.rates.waterRecycling, 0.4);
}

console.log("All emergency scenario tests passed.");
