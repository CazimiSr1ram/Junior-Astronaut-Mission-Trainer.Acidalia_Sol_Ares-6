"use strict";

const assert = require("assert");
const Config = require("../static/js/emergency-config.js");
const MissionModel = require("../static/js/mission-state.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const R = MissionModel.RESOURCE_CHANGE_PER_SOL;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

function stateAt(level) {
  const state = MissionModel.createMissionState();
  Object.keys(state.resources).forEach((key) => { state.resources[key] = level; });
  return state;
}

// Central configuration is the single source of thresholds and emergencies.
{
  assert.deepStrictEqual({ ...Config.ALERT_THRESHOLDS }, { critical: 20, codeBlack: 10 });
  assert.strictEqual(MissionModel.RESOURCE_WARNING_THRESHOLD, Config.ALERT_THRESHOLDS.critical);
  assert.strictEqual(MissionModel.RESOURCE_CRITICAL_THRESHOLD, Config.ALERT_THRESHOLDS.codeBlack);
  assert.strictEqual(MissionModel.EMERGENCY_CONFIG, Config.EMERGENCIES);
  assert.deepStrictEqual(Object.keys(Config.ALERT_LEVELS), ["normal", "critical", "codeBlack"]);
  assert.match(Config.CODE_BLACK_NOTE, /fictional game alert level, not an official NASA classification/);
  assert.ok(Object.isFrozen(Config.EMERGENCIES.oxygenFailure.choices.repairGenerator), "config is immutable");
  for (const [id, emergency] of Object.entries(Config.EMERGENCIES)) {
    assert.strictEqual(Object.keys(emergency.choices).length, 3, `${id} offers three choices`);
    assert.ok(emergency.briefing.length > 0 && emergency.affects.length > 0, `${id} has a briefing and affected resources`);
    Object.values(emergency.choices).forEach((choice) => assert.ok(choice.risk && choice.result, `${id} choices explain risk and result`));
  }
}

// Alert level boundaries.
{
  const levels = [[100, "normal"], [21, "normal"], [20, "critical"], [10.5, "critical"], [10, "codeBlack"], [0, "codeBlack"]];
  levels.forEach(([value, level]) => assert.strictEqual(MissionModel.getAlertLevel(value), level, `level at ${value}%`));
}

// Every emergency and choice at high, medium and low resource levels.
const RESOURCE_LEVELS = [100, 50, 15, 5];
for (const [emergencyId, emergency] of Object.entries(Config.EMERGENCIES)) {
  for (const [choiceId, choice] of Object.entries(emergency.choices)) {
    for (const level of RESOURCE_LEVELS) {
      const label = `${emergencyId}/${choiceId} at ${level}%`;
      const state = stateAt(level);
      assert.strictEqual(MissionModel.triggerEmergency(state, emergencyId), true);
      const alert = MissionModel.getEmergencyAlert(state, emergencyId);
      assert.strictEqual(alert.level, MissionModel.getAlertLevel(level), `${label}: alert level`);

      const before = { ...state.resources };
      const preview = MissionModel.previewEmergencyChoice(state, emergencyId, choiceId);
      assert.deepStrictEqual(state.resources, before, `${label}: preview does not change the real state`);
      const outcome = MissionModel.resolveEmergency(state, emergencyId, choiceId);
      assert.strictEqual(outcome.applied, true, label);
      assert.deepStrictEqual(preview.after, state.resources, `${label}: preview matches the real outcome`);

      // No free gains: compare with the same state left alone for the same time
      // (natural production such as solar power can still happen meanwhile).
      const control = MissionModel.createMissionState();
      Object.assign(control.resources, before);
      MissionModel.triggerEmergency(control, emergencyId);
      Object.assign(control.resources, before);
      MissionModel.advanceMissionTime(control, outcome.secondsSimulated);
      Object.entries(state.resources).forEach(([key, value]) => {
        assert.ok(value >= 0 && value <= 100, `${label}: ${key} within 0-100 (${value})`);
        const declaredGain = Math.max(0, (choice.resources || {})[key] || 0);
        assert.ok(value <= Math.min(100, control.resources[key] + declaredGain) + 1e-9, `${label}: no free ${key}`);
      });

      // No repeated rewards: the same or another non-repair choice cannot be used again.
      let after = JSON.stringify(state);
      Object.keys(emergency.choices).forEach((otherId) => {
        const repeat = MissionModel.resolveEmergency(state, emergencyId, otherId);
        if (repeat.applied) {
          assert.ok(emergency.choices[otherId].time && outcome.status === "stabilized", `${label}: only a repair may follow`);
          assert.strictEqual(repeat.status, "resolved", `${label}: later repair resolves it`);
          after = JSON.stringify(state);
          return;
        }
        assert.strictEqual(JSON.stringify(state), after, `${label}: refused choice changed nothing`);
      });
      assert.strictEqual(MissionModel.triggerEmergency(state, emergencyId), false, `${label}: cannot be re-triggered`);
    }
  }
}

// Oxygen: stabilise with tanks, the generator stays off, then recover with a later repair.
{
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "oxygenFailure");
  const tanks = MissionModel.resolveEmergency(state, "oxygenFailure", "emergencyTanks");
  assert.strictEqual(tanks.status, "stabilized");
  assert.strictEqual(state.resources.oxygenReserve, 10);
  assert.strictEqual(state.rates.oxygenProduction, 0, "generator still offline");
  assert.deepStrictEqual(MissionModel.getAvailableChoices(state, "oxygenFailure"), ["repairGenerator"]);
  MissionModel.advanceMissionTime(state, SOL);
  close(state.resources.oxygen, 100 - R.oxygenConsumption, "oxygen falls while stabilised");
  const repair = MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(repair.status, "resolved");
  assert.strictEqual(repair.secondsSimulated, 2 * SOL);
  close(state.resources.oxygen, 100 - 3 * R.oxygenConsumption, "repair time simulated with the generator off");
  assert.strictEqual(state.rates.oxygenProduction, 1, "generator restored");
  assert.deepStrictEqual(MissionModel.getAvailableChoices(state, "oxygenFailure"), []);
  assert.strictEqual(MissionModel.getEmergencyAlert(state, "oxygenFailure"), null, "no alert once resolved");
}

// Oxygen: reduced activity ends when the generator is repaired.
{
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "reduceActivity");
  assert.strictEqual(state.rates.oxygenConsumption, 0.65);
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(state.rates.oxygenConsumption, 1);
  assert.strictEqual(state.rates.missionProgress, 1);
}

// Water: rationing, then recovery restores recycling and lifts rationing.
{
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.resolveEmergency(state, "waterMalfunction", "rationWater");
  assert.strictEqual(state.resources.crewHealth, 92, "rationing costs 8% crew health");
  assert.strictEqual(state.emergencies.waterMalfunction.status, "stabilized");
  assert.strictEqual(state.rates.waterRecycling, 0.4);
  MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.deepStrictEqual(
    { recycling: state.rates.waterRecycling, use: state.rates.waterConsumption, greenhouse: state.rates.greenhouseProduction },
    { recycling: 1, use: 1, greenhouse: 1 },
  );
  close(state.resources.crewHealth, Math.min(100, 92 + 2 * require("../static/js/balance-config.js").HEALTH_RECOVERY_PER_SOL), "crew health recovers while supplies last");
}

// Dust storm passes after its configured duration; consumption is processed during the storm.
{
  const events = [];
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "normalOperations");
  assert.strictEqual(state.emergencies.dustStorm.status, "stabilized");
  assert.deepStrictEqual(MissionModel.getAvailableChoices(state, "dustStorm"), [], "no further storm choices");
  assert.strictEqual(MissionModel.getEmergencyAlert(state, "dustStorm").secondsLeft, Config.EMERGENCIES.dustStorm.durationSols * SOL);
  MissionModel.advanceMissionTime(state, 4 * SOL, { onEvent: (e) => events.push(e) });
  close(state.resources.power, 100 - 10 + 3 * (R.solarGeneration - R.powerConsumption * 1.6) + (R.solarGeneration - R.powerConsumption),
    "power at 160% for 3 sols, then normal");
  assert.strictEqual(state.emergencies.dustStorm.status, "resolved");
  assert.strictEqual(state.emergencies.dustStorm.endedBy, "passed");
  assert.strictEqual(state.rates.powerConsumption, 1);
  assert.strictEqual(events.filter((e) => e.type === "emergencyEnded").length, 1);
}

// A storm can pass in the middle of another emergency's repair time jump.
{
  const events = [];
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "normalOperations");
  MissionModel.advanceMissionTime(state, 2 * SOL);
  MissionModel.triggerEmergency(state, "oxygenFailure");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator", { onEvent: (e) => events.push(e) });
  const stormSol = R.solarGeneration - R.powerConsumption * 1.6;
  close(state.resources.power, 100 - 10 + 2 * stormSol - 15 + stormSol + (R.solarGeneration - R.powerConsumption),
    "storm draw stops when it passes mid-repair");
  assert.strictEqual(state.emergencies.dustStorm.status, "resolved");
  assert.ok(events.some((e) => e.type === "emergencyEnded" && e.emergencyId === "dustStorm" && e.simulated));
}

// Overlapping emergencies combine instead of overwriting each other.
{
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.resolveEmergency(state, "dustStorm", "reduceConsumption");
  MissionModel.triggerEmergency(state, "oxygenFailure");
  assert.strictEqual(state.rates.oxygenProduction, 0, "failed generator produces nothing");
  MissionModel.resolveEmergency(state, "oxygenFailure", "repairGenerator");
  assert.strictEqual(state.rates.oxygenProduction, 0.75, "storm reduction still applies after the repair");
  MissionModel.advanceMissionTime(state, 2 * SOL);
  assert.strictEqual(state.rates.oxygenProduction, 1, "back to normal once the storm passes");
}

// Alerts are ordered by severity and change as resources recover.
{
  const state = stateAt(60);
  state.resources.oxygen = 8;
  MissionModel.triggerEmergency(state, "dustStorm");
  MissionModel.triggerEmergency(state, "oxygenFailure");
  const alerts = MissionModel.getActiveAlerts(state);
  assert.deepStrictEqual(alerts.map((a) => [a.emergencyId, a.level]), [["oxygenFailure", "codeBlack"], ["dustStorm", "normal"]]);
  MissionModel.resolveEmergency(state, "oxygenFailure", "emergencyTanks");
  assert.strictEqual(MissionModel.getEmergencyAlert(state, "oxygenFailure").level, "normal", "28% oxygen after tanks");
  assert.strictEqual(MissionModel.getEmergencyAlert(state, "oxygenFailure").status, "stabilized");
}

console.log("Emergency alert tests passed: central thresholds, 3 emergencies x 3 choices at 100/50/15/5%, previews, limits, no repeats, recovery, storm duration and stacking.");
