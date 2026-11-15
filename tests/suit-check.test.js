"use strict";

// Regression: the EVA suit check must stay available after Mission 1.
// The Mission 1 objective ("complete the first suit check") is recorded once;
// the suit check itself is a reusable action before every EVA.

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");
const MissionOne = require("../static/js/mission-one.js");
const ShopModel = require("../static/js/shop-state.js");
const Eva = require("../static/js/eva-integration.js");

const INSIDE = { insideCabin: true, onSurface: false, clearOfHatch: true };
const SURFACE = { insideCabin: false, onSurface: true, clearOfHatch: true };

function missionUpTo(stopAt) {
  const state = MissionModel.createMissionState();
  const mission = MissionOne.create(state);
  mission.start();
  const steps = {
    lifeSupport: () => mission.checkLifeSupport(),
    pressure: () => mission.verifyPressure(),
    power: () => { mission.activatePower(); mission.inspectPower(); },
    supplies: () => mission.checkSupplies(),
    suit: () => { mission.donSuit(INSIDE); mission.suitCheck(); },
    egress: () => { mission.airlock("depressurize", INSIDE); mission.tick(6, INSIDE); mission.airlock("open", INSIDE); mission.tick(0.1, SURFACE); },
    survey: () => MissionOne.SURVEY_MARKERS.forEach((marker) => mission.inspectMarker(marker.id)),
    report: () => {
      mission.airlock("close", INSIDE); mission.airlock("repressurize", INSIDE); mission.tick(6, INSIDE);
      mission.submitReport(INSIDE); mission.tick(4, INSIDE);
    },
  };
  for (const objective of MissionOne.OBJECTIVES) {
    if (objective.id === stopAt) break;
    steps[objective.id]();
  }
  return { state, mission, p: mission.progress };
}
const text = (result) => result.lines.map((l) => l.text).join(" ");
const depressurizeOption = (mission) => mission.airlockOptions(INSIDE).find((o) => o.action === "depressurize");
function returnInsideAndRepressurise(mission) {
  mission.airlock("close", INSIDE); mission.airlock("repressurize", INSIDE); mission.tick(6, INSIDE);
}

// Before Mission 1 reaches the suit step: not yet available (nothing to check).
{
  const { mission } = missionUpTo("supplies");
  const availability = mission.suitCheckAvailability();
  assert.strictEqual(availability.enabled, false);
  assert.match(availability.reason, /earlier objectives/);
}

// At the suit step (Mission 1 in progress): needs the suit on, then passes and records the objective once.
{
  const { mission, p } = missionUpTo("suit");
  assert.deepStrictEqual(mission.suitCheckAvailability(), { enabled: false, reason: "Put on the suit first." });
  mission.donSuit(INSIDE);
  assert.strictEqual(mission.suitCheckAvailability().enabled, true);
  const first = mission.suitCheck();
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.completed, "suit", "first check completes the Mission 1 objective");
  assert.match(text(first), /Suit Check Passed — Ready for EVA/);
  assert.match(text(first), /Spacesuit equipped/);
  assert.match(text(first), /Helmet sealed/);
  assert.strictEqual(p.suitChecked, true);
  // A recheck during Mission 1 does not complete anything again.
  const again = mission.suitCheck();
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.completed, null);
}

// THE BUG: immediately after Mission 1, the suit check is still available and works.
{
  const { state, mission, p } = missionUpTo("none-complete-all");
  assert.strictEqual(mission.status, "complete");
  const completedBefore = JSON.stringify(p.completed);
  const currentBefore = p.current;
  assert.strictEqual(mission.suitCheckAvailability().enabled, true, "suit check available after Mission 1");
  const recheck = mission.suitCheck();
  assert.strictEqual(recheck.ok, true);
  assert.strictEqual(recheck.completed, null, "recheck awards no Mission 1 progress");
  assert.strictEqual(recheck.missionComplete, undefined);
  assert.match(text(recheck), /Suit Check Passed — Ready for EVA/);
  assert.doesNotMatch(text(recheck), /Objective complete|Mission 1 complete/);
  assert.strictEqual(JSON.stringify(p.completed), completedBefore);
  assert.strictEqual(p.current, currentBefore);

  // Solar Cells are granted once only, however many checks are run.
  let saved = null;
  const shop = ShopModel.create({ getItem: () => saved, setItem: (_, value) => { saved = value; } });
  const balance = () => shop.state.balances?.solarCells ?? shop.state.solarCells;
  assert.strictEqual(mission.claimReward(shop).ok, true);
  const afterReward = JSON.stringify(shop.state);
  mission.suitCheck(); mission.suitCheck();
  assert.strictEqual(mission.claimReward(shop).ok, false, "reward not granted twice");
  assert.strictEqual(JSON.stringify(shop.state), afterReward, `balance unchanged (${balance()})`);
  assert.ok(state);
}

// After Mission 1: take the suit off, put it on again -> must recheck; then EVA allowed.
{
  const { mission, p } = missionUpTo("none-complete-all");
  mission.removeSuit(INSIDE);
  assert.deepStrictEqual(mission.suitCheckAvailability(), { enabled: false, reason: "Put on the suit first." });
  mission.donSuit(INSIDE);
  assert.strictEqual(p.suitChecked, false, "putting the suit on again needs a new check");
  assert.strictEqual(depressurizeOption(mission).enabled, false, "airlock blocked until the suit is checked");
  assert.match(depressurizeOption(mission).reason, /suit check/);
  assert.strictEqual(mission.suitCheckAvailability().enabled, true);
  assert.strictEqual(mission.suitCheck().ok, true);
  assert.strictEqual(depressurizeOption(mission).enabled, true, "checked suit -> EVA allowed");
}

// After returning from Mars exploration (second EVA after Mission 1), the check still works.
{
  const { mission, p } = missionUpTo("none-complete-all");
  mission.removeSuit(INSIDE); mission.donSuit(INSIDE); mission.suitCheck();
  mission.airlock("depressurize", INSIDE); mission.tick(6, INSIDE); mission.airlock("open", INSIDE); mission.tick(1, SURFACE);
  returnInsideAndRepressurise(mission);
  assert.strictEqual(p.cabin, "pressurized");
  mission.toggleHelmet(INSIDE); // helmet off in the safe cabin
  const helmetOff = mission.suitCheck();
  assert.strictEqual(helmetOff.ok, false, "helmet off -> check fails with the reason");
  assert.match(text(helmetOff), /Helmet sealed: not sealed/);
  mission.toggleHelmet(INSIDE);
  assert.strictEqual(mission.suitCheck().ok, true, "check works again after returning from EVA");
}

// Co-developer suit controller connected: low oxygen / damage fail with the specific reason;
// refill and repair make the suit pass again. Airlock exit is blocked while unsafe.
{
  const { state, mission, p } = missionUpTo("none-complete-all");
  const bridge = Eva.create(state, {});
  const suit = { oxygenPercent: 100, pressureStatus: "safe", co2Status: "safe", integrityPercent: 100, batteryPercent: 100, leakStatus: "none" };
  let listener = null;
  const disconnect = bridge.register({ read: () => ({ ...suit }), oxygenCapacityUnits: 20,
    subscribe: (fn) => { listener = fn; return () => { listener = null; }; },
    receiveOxygen: ({ oxygenPercent }) => { suit.oxygenPercent = oxygenPercent; return true; } });
  MissionOne.setSuitSafetyCheck(() => MissionOne.suitVerdictFromReadings(bridge.read()));
  try {
    const ok = mission.suitCheck();
    assert.strictEqual(ok.ok, true);
    assert.match(text(ok), /Oxygen supply \(100%\)/);
    assert.match(text(ok), /Suit integrity \(100%\)/);
    assert.match(text(ok), /Suit pressure \(safe\)/);

    suit.oxygenPercent = 0; listener();
    const lowOxygen = mission.suitCheck();
    assert.strictEqual(lowOxygen.ok, false);
    assert.match(text(lowOxygen), /Oxygen supply: 0%, refill at the suit locker/);
    assert.strictEqual(p.suitChecked, false, "a failed check clears the ready state");
    assert.strictEqual(depressurizeOption(mission).enabled, false, "unsafe suit cannot leave");
    assert.strictEqual(MissionOne.isSuitProtecting(p), false);

    // Refill through the co-developer's adapter.
    state.resources.oxygenReserve = 30;
    assert.strictEqual(bridge.refill({ safe: true, operational: true, atStation: true }).ok, true);
    assert.strictEqual(mission.suitCheck().ok, true, "passes after refilling");

    suit.integrityPercent = 0; suit.leakStatus = "minor"; listener();
    const damaged = mission.suitCheck();
    assert.strictEqual(damaged.ok, false);
    assert.match(text(damaged), /Suit integrity: 0%, repair needed/);
    assert.match(text(damaged), /Leaks: minor/);
    suit.integrityPercent = 100; suit.leakStatus = "none"; listener(); // repaired by the suit system
    assert.strictEqual(mission.suitCheck().ok, true, "passes after repair");
    assert.strictEqual(depressurizeOption(mission).enabled, true);
  } finally {
    disconnect();
    MissionOne.setSuitSafetyCheck(null);
  }
}

// No suit controller connected: readings are reported as pending and only suit/helmet decide (unchanged behaviour).
{
  const verdict = MissionOne.suitVerdictFromReadings({ connected: false });
  assert.strictEqual(verdict.safe, true);
  assert.match(verdict.checks[0].detail, /pending/);
  // A boolean safety check (older interface) is still accepted.
  const { mission } = missionUpTo("none-complete-all");
  MissionOne.setSuitSafetyCheck(() => false);
  try {
    const failed = mission.suitCheck();
    assert.strictEqual(failed.ok, false);
    assert.match(text(failed), /suit systems report unsafe/);
  } finally {
    MissionOne.setSuitSafetyCheck(null);
  }
  assert.strictEqual(mission.suitCheck().ok, true);
}

// After Mission 2 (research mission) is complete: still available and works.
{
  const { state, mission } = missionUpTo("none-complete-all");
  state.missions.oxygenEmergency = { status: "complete", step: 5, checks: [] };
  mission.removeSuit(INSIDE); mission.donSuit(INSIDE);
  assert.strictEqual(mission.suitCheckAvailability().enabled, true);
  const result = mission.suitCheck();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.completed, null);
}

console.log("suit-check tests passed");
