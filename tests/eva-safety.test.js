"use strict";

const assert = require("assert");
const Balance = require("../static/js/balance-config.js");
const MissionModel = require("../static/js/mission-state.js");
const MissionClock = require("../static/js/mission-clock.js");
const MissionOne = require("../static/js/mission-one.js");
const MissionOutcome = require("../static/js/mission-outcome.js");
const ShopModel = require("../static/js/shop-state.js");

const SOL = MissionModel.SOL_CYCLE.totalSeconds;
const INSIDE = { insideCabin: true, onSurface: false, clearOfHatch: true };
const AT_HATCH = { insideCabin: true, onSurface: false, clearOfHatch: false };
const SURFACE = { insideCabin: false, onSurface: true, clearOfHatch: true };
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

function missionAt(objectiveId) {
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
    if (objective.id === objectiveId) break;
    steps[objective.id]();
  }
  return { state, mission, p: mission.progress };
}

// ---------------------------------------------------------------------------
// Bug 1: unsafe egress is prevented; suit protection is separate from cabin state.
// ---------------------------------------------------------------------------

// The hatch cannot be opened without a sealed, checked suit, even after Mission 1.
{
  const { mission, p } = missionAt("none-complete-all");
  assert.strictEqual(mission.status, "complete");
  mission.removeSuit(INSIDE);
  assert.strictEqual(p.suitOn, false);
  const noSuit = mission.airlockOptions(INSIDE).find((o) => o.action === "depressurize");
  assert.strictEqual(noSuit.enabled, false, "Mission 1 completion does not count as protection");
  assert.match(noSuit.reason, /SAFETY: put on the EVA suit/);
  assert.strictEqual(mission.airlock("depressurize", INSIDE).ok, false);
  assert.strictEqual(mission.airlock("open", INSIDE).ok, false, "hatch stays shut while pressurised");

  mission.donSuit(INSIDE);
  const unchecked = mission.airlockOptions(INSIDE).find((o) => o.action === "depressurize");
  assert.strictEqual(unchecked.enabled, false, "suit must be checked after putting it on");
  assert.match(unchecked.reason, /suit check/);
  mission.suitCheck();
  assert.strictEqual(mission.airlock("depressurize", INSIDE).ok, true, "allowed once suited, sealed and checked");
}

// Cabin pressure and suit protection are separate states.
{
  const { mission, p } = missionAt("egress");
  assert.strictEqual(MissionOne.isSuitProtecting(p), true);
  mission.toggleHelmet(INSIDE);
  assert.strictEqual(MissionOne.isSuitProtecting(p), false, "helmet off = no suit protection");
  assert.strictEqual(p.cabin, "pressurized", "but the cabin is still pressurised");
  mission.toggleHelmet(INSIDE);
  mission.airlock("depressurize", INSIDE);
  mission.tick(6, INSIDE);
  assert.strictEqual(p.cabin, "depressurized");
  assert.strictEqual(MissionOne.isSuitProtecting(p), true, "the sealed suit still protects in the depressurised cabin");
}

// Closing the hatch is refused while standing in its path (prevents getting stuck in the door).
{
  const { mission, p } = missionAt("survey");
  assert.strictEqual(p.hatchOpen, true);
  const blocked = mission.airlockOptions(AT_HATCH).find((o) => o.action === "close");
  assert.strictEqual(blocked.enabled, false);
  assert.match(blocked.reason, /Step back from the hatch/);
  assert.strictEqual(mission.airlock("close", INSIDE).ok, true);
}

// Unprotected exposure damages crew health through the survival system and is recoverable.
{
  const state = MissionModel.createMissionState();
  MissionModel.setExposure(state, true);
  MissionModel.advanceMissionTime(state, 10);
  close(state.resources.crewHealth, 100 - Balance.EXPOSURE_HEALTH_LOSS_PER_SOL * (10 / SOL), "health lost in 10 s of exposure");
  const hurt = state.resources.crewHealth;
  MissionModel.setExposure(state, false);
  MissionModel.advanceMissionTime(state, SOL);
  assert.ok(state.resources.crewHealth > hurt, "health recovers once protected again");
  assert.ok(!state.failure);
}

// Staying unprotected is fatal, with a clear cause, at the configured rate.
{
  const state = MissionModel.createMissionState();
  MissionModel.setExposure(state, true);
  MissionModel.advanceMissionTime(state, SOL);
  assert.strictEqual(state.failure.cause, "exposure");
  const seconds = (state.failure.sol - 1) * SOL + state.failure.elapsedSeconds;
  const expected = (100 / Balance.EXPOSURE_HEALTH_LOSS_PER_SOL) * SOL;
  assert.ok(Math.abs(seconds - expected) <= MissionModel.SOL_CYCLE.totalSeconds / 20, `fatal after ~${expected} s, got ${seconds}`);
  const result = MissionOutcome.evaluate(state, MissionModel.EMERGENCY_CONFIG);
  assert.strictEqual(result.status, "failure");
  assert.match(result.reasons[0], /without a sealed EVA suit/);
}

// A repair time jump cannot skip exposure damage.
{
  const state = MissionModel.createMissionState();
  MissionModel.triggerEmergency(state, "waterMalfunction");
  MissionModel.setExposure(state, true);
  const outcome = MissionModel.resolveEmergency(state, "waterMalfunction", "repairRecycler");
  assert.strictEqual(state.failure.cause, "exposure", "exposure is processed during the repair");
  assert.ok(outcome.secondsSimulated < 2 * SOL);
}

// No exposure, no damage.
{
  const state = MissionModel.createMissionState();
  MissionModel.setExposure(state, false);
  MissionModel.advanceMissionTime(state, 5 * SOL);
  assert.strictEqual(state.resources.crewHealth, 100);
}

// ---------------------------------------------------------------------------
// Bug 3: Mission 1 completion updates progression; Mission 2 becomes available at the Mission Terminal.
// ---------------------------------------------------------------------------
{
  const storage = (() => { let saved = null; return { getItem: () => saved, setItem: (_, v) => { saved = v; } }; })();
  const shop = ShopModel.create(storage);
  const { state, mission } = missionAt("none-complete-all");
  assert.strictEqual(mission.status, "complete");
  assert.deepStrictEqual(state.progression.completed, ["establishBase"]);
  assert.deepStrictEqual(state.progression.next, { id: "oxygenEmergency", title: "Mission 2: Oxygen Emergency", status: "available" });
  mission.claimReward(shop);
  assert.strictEqual(shop.state.solar, 50, "Mission 1 reward once");

  // Seven accelerated sols afterwards: the clock keeps running and nothing is granted.
  const clock = MissionClock.create(state, MissionModel, { devTools: true });
  clock.start();
  const solBefore = state.sol;
  clock.advanceSols(7);
  assert.strictEqual(state.sol, solBefore + 7);
  assert.ok(!state.missionComplete);
  assert.deepStrictEqual(shop.state.missionRewards, ["establish-base"], "no Mission 2 reward");
  assert.strictEqual(shop.state.solar, 50);
  assert.strictEqual(state.progression.next.status, "available");
}

// Completion lines tell the player what to do next.
{
  const { mission } = missionAt("report");
  mission.airlock("close", INSIDE); mission.airlock("repressurize", INSIDE); mission.tick(6, INSIDE);
  mission.submitReport(INSIDE);
  const [reply] = mission.tick(4, INSIDE);
  const text = reply.lines.map((l) => l.text).join(" ");
  assert.match(text, /Mission 2: Oxygen Emergency is now available at the Mission Terminal/);
  assert.doesNotMatch(text, /coming soon/i);
  assert.match(text, /assemble the temporary habitat/);
  assert.match(text, /Sol 90/);
}

// ---------------------------------------------------------------------------
// Bug 5: re-entry through the same whole-cabin airlock, from the exterior panel.
// ---------------------------------------------------------------------------
const AT_HATCH_OUTSIDE = { insideCabin: false, onSurface: false, clearOfHatch: true, atHatchOutside: true };
const FAR_OUTSIDE = { insideCabin: false, onSurface: true, clearOfHatch: true, atHatchOutside: false };
const option = (mission, env, action) => mission.airlockOptions(env).find((o) => o.action === action);

// The previous dead end: outside, hatch closed, cabin pressurised.
{
  const { mission, p } = missionAt("none-complete-all");
  p.hatchOpen = false; p.cabin = "pressurized"; // as left by an earlier glitch
  assert.match(option(mission, FAR_OUTSIDE, "depressurize").reason, /Stand at the hatch/);
  const exterior = option(mission, AT_HATCH_OUTSIDE, "depressurize");
  assert.strictEqual(exterior.enabled, true, "exterior panel can cycle the empty cabin");
  assert.match(exterior.label, /exterior panel/);
  assert.strictEqual(option(mission, AT_HATCH_OUTSIDE, "open").enabled, false, "hatch still needs the cabin depressurised");
  mission.airlock("depressurize", AT_HATCH_OUTSIDE);
  mission.tick(6, AT_HATCH_OUTSIDE);
  const opened = mission.airlock("open", AT_HATCH_OUTSIDE);
  assert.strictEqual(opened.ok, true);
  assert.ok(opened.lines.some((l) => /repressurise before removing your helmet/.test(l.text)));
  assert.strictEqual(option(mission, AT_HATCH_OUTSIDE, "close").enabled, false, "must step inside to close");
  assert.strictEqual(mission.airlock("close", INSIDE).ok, true);
  assert.strictEqual(mission.toggleHelmet(INSIDE).ok, false, "helmet stays on until repressurised");
  mission.airlock("repressurize", INSIDE);
  mission.tick(6, INSIDE);
  assert.strictEqual(p.cabin, "pressurized");
  assert.strictEqual(mission.toggleHelmet(INSIDE).ok, true, "helmet can come off once repressurised");
}

// The exterior panel still needs a sealed, checked suit.
{
  const { mission, p } = missionAt("none-complete-all");
  p.hatchOpen = false; p.cabin = "pressurized";
  mission.toggleHelmet(INSIDE); // helmet off (safe inside); now pretend we are outside
  assert.match(option(mission, AT_HATCH_OUTSIDE, "depressurize").reason, /SAFETY: put on the EVA suit/);
}

// Five full exit and re-entry cycles with the same airlock; stations usable after each return.
{
  const { state, mission, p } = missionAt("none-complete-all");
  const reportsBefore = state.reports.length;
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    if (!p.helmetOn) mission.toggleHelmet(INSIDE);
    assert.strictEqual(mission.airlock("depressurize", INSIDE).ok, true, `cycle ${cycle}: depressurise`);
    mission.tick(6, INSIDE);
    assert.strictEqual(mission.airlock("open", INSIDE).ok, true, `cycle ${cycle}: open`);
    mission.tick(1, SURFACE); // outside
    assert.strictEqual(mission.toggleHelmet(SURFACE).ok, false, `cycle ${cycle}: helmet locked outside`);
    assert.strictEqual(mission.airlock("close", AT_HATCH).ok, false, `cycle ${cycle}: cannot close standing in the hatch`);
    assert.strictEqual(mission.airlock("close", INSIDE).ok, true, `cycle ${cycle}: close from inside`);
    assert.strictEqual(mission.removeSuit(INSIDE).ok, false, `cycle ${cycle}: suit locked until repressurised`);
    mission.airlock("repressurize", INSIDE);
    mission.tick(6, INSIDE);
    assert.strictEqual(p.cabin, "pressurized", `cycle ${cycle}: repressurised`);
    assert.strictEqual(mission.toggleHelmet(INSIDE).ok, true, `cycle ${cycle}: helmet off inside`);
    assert.strictEqual(mission.checkLifeSupport().ok, true, `cycle ${cycle}: supply terminal usable`);
  }
  assert.strictEqual(mission.removeSuit(INSIDE).ok, true, "suit locker usable after returning");
  assert.strictEqual(state.reports.length, reportsBefore, "cycling the airlock sends no reports");
  assert.deepStrictEqual(state.resources.crewHealth, 100, "no free health changes from the airlock");
}

console.log("EVA safety tests passed: suit-check gating, suit vs cabin state, hatch clearance, exposure damage/recovery/failure, time-jump guard, Mission 1 progression and 7 sols after, exterior re-entry and 5 airlock cycles.");
