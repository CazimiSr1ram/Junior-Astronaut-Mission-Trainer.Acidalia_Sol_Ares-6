"use strict";

const assert = require("assert");
const MissionModel = require("../static/js/mission-state.js");
const MissionOne = require("../static/js/mission-one.js");
const ShopModel = require("../static/js/shop-state.js");

const INSIDE = { insideCabin: true, onSurface: false };
const RAMP = { insideCabin: false, onSurface: false };
const SURFACE = { insideCabin: false, onSurface: true };

function memoryShop() {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  return { storage, shop: ShopModel.create(storage) };
}

function setup() {
  const state = MissionModel.createMissionState();
  const mission = MissionOne.create(state);
  return { state, mission, p: mission.progress };
}

function ok(result, message) {
  assert.strictEqual(result.ok, true, `${message}: ${JSON.stringify(result.lines)}`);
  return result;
}

function refused(result, message) {
  assert.strictEqual(result.ok, false, `${message} should be refused`);
  assert.ok(result.lines.length > 0, `${message} should explain why`);
  return result;
}

function cycle(mission, env = INSIDE) {
  let out = [];
  for (let i = 0; i < 25; i += 1) out = out.concat(mission.tick(0.2, env));
  return out;
}

/** Runs the mission up to (not including) the objective with the given id. */
function advanceTo(mission, id) {
  const steps = {
    lifeSupport: () => ok(mission.checkLifeSupport(), "life support"),
    pressure: () => ok(mission.verifyPressure(), "pressure"),
    power: () => { ok(mission.activatePower(), "power on"); ok(mission.inspectPower(), "power inspect"); },
    supplies: () => ok(mission.checkSupplies(), "supplies"),
    suit: () => { ok(mission.donSuit(INSIDE), "don suit"); ok(mission.suitCheck(), "suit check"); },
    egress: () => {
      ok(mission.airlock("depressurize", INSIDE), "depressurize");
      cycle(mission);
      ok(mission.airlock("open", INSIDE), "open hatch");
      mission.tick(0.1, SURFACE);
    },
    survey: () => MissionOne.SURVEY_MARKERS.forEach((marker) => ok(mission.inspectMarker(marker.id), marker.id)),
  };
  for (const objective of MissionOne.OBJECTIVES) {
    if (objective.id === id) return;
    steps[objective.id]();
  }
}

// Not started: nothing can be completed.
{
  const { mission } = setup();
  refused(mission.checkLifeSupport(), "inactive mission");
  assert.strictEqual(mission.status, "inactive");
  const start = ok(mission.start(), "start");
  assert.ok(start.lines.some((l) => /not an official NASA procedure/.test(l.text)), "procedure disclaimer shown");
  assert.strictEqual(mission.start().ok, false, "start only once");
}

// Objectives must be done in order; each completion is stamped with the sol.
{
  const { state, mission, p } = setup();
  mission.start();
  refused(mission.verifyPressure(), "pressure before life support");
  refused(mission.checkSupplies(), "supplies before power");
  refused(mission.donSuit(INSIDE), "suit before supplies");
  const done = ok(mission.checkLifeSupport(), "life support");
  assert.strictEqual(done.completed, "lifeSupport");
  assert.deepStrictEqual(p.completed.lifeSupport, { sol: 1, elapsedSeconds: 0 });
  assert.strictEqual(mission.currentObjective().id, "pressure");
  // Re-using a finished station is a harmless readout, not a second completion.
  const again = ok(mission.checkLifeSupport(), "life support readout");
  assert.strictEqual(again.completed, null);
  assert.strictEqual(Object.keys(p.completed).length, 1);
  assert.strictEqual(state.sol, 1);
}

// Power must be activated before inspection; lights state is tracked.
{
  const { mission, p } = setup();
  mission.start();
  advanceTo(mission, "power");
  refused(mission.inspectPower(), "inspect before activation");
  ok(mission.activatePower(), "activate");
  assert.strictEqual(p.powerOn, true);
  refused(mission.activatePower(), "activate twice");
  assert.strictEqual(ok(mission.inspectPower(), "inspect").completed, "power");
}

// Low oxygen gives a warning during the pressure check but still lets the player continue.
{
  const { state, mission } = setup();
  mission.start();
  advanceTo(mission, "pressure");
  state.resources.oxygen = 15;
  const result = ok(mission.verifyPressure(), "low oxygen pressure check");
  assert.ok(result.lines.some((l) => /oxygen supply is low/i.test(l.text)));
}

// EVA suit: donned only in the safe cabin; suit check needs the helmet sealed.
{
  const { mission, p } = setup();
  mission.start();
  advanceTo(mission, "suit");
  refused(mission.suitCheck(), "suit check without suit");
  ok(mission.donSuit(INSIDE), "don suit");
  assert.ok(p.suitOn && p.helmetOn);
  ok(mission.toggleHelmet(INSIDE), "helmet off inside safe cabin");
  refused(mission.suitCheck(), "suit check with helmet off");
  ok(mission.toggleHelmet(INSIDE), "helmet back on");
  assert.strictEqual(ok(mission.suitCheck(), "suit check").completed, "suit");
}

// Airlock procedure, helmet safety and egress.
{
  const { mission, p } = setup();
  mission.start();
  advanceTo(mission, "egress");

  // Cannot open the hatch while pressurised; cannot depressurise without a sealed helmet.
  refused(mission.airlock("open", INSIDE), "open while pressurised");
  ok(mission.toggleHelmet(INSIDE), "helmet off");
  refused(mission.airlock("depressurize", INSIDE), "depressurise without helmet");
  ok(mission.toggleHelmet(INSIDE), "helmet on");

  ok(mission.airlock("depressurize", INSIDE), "depressurise");
  assert.strictEqual(p.cabin, "depressurizing");
  refused(mission.toggleHelmet(INSIDE), "helmet off while depressurising");
  refused(mission.removeSuit(INSIDE), "suit off while depressurising");
  refused(mission.airlock("open", INSIDE), "open during cycle");
  for (let i = 0; i < 24; i += 1) mission.tick(0.2, INSIDE);
  assert.strictEqual(p.cabin, "depressurizing", "cycle takes 5 s");
  const finished = mission.tick(0.25, INSIDE);
  assert.strictEqual(p.cabin, "depressurized");
  assert.ok(finished.length === 1 && /depressurised/i.test(finished[0].lines[0].text));
  assert.ok(mission.cabinPressureKpa() < 1, "cabin at Mars ambient");

  ok(mission.airlock("open", INSIDE), "open hatch");
  assert.strictEqual(p.hatchOpen, true);
  refused(mission.airlock("repressurize", INSIDE), "repressurise with hatch open");
  const helmet = refused(mission.toggleHelmet(RAMP), "helmet off on the ramp");
  assert.strictEqual(helmet.blockedUnsafe, true);
  refused(mission.toggleHelmet(INSIDE), "helmet off inside with hatch open");

  // Standing in the vestibule/ramp is not yet "on Mars".
  assert.strictEqual(mission.tick(0.1, RAMP).length, 0);
  const egress = mission.tick(0.1, SURFACE);
  assert.strictEqual(egress[0].completed, "egress");
  refused(mission.toggleHelmet(SURFACE), "helmet off on the surface");
  refused(mission.removeSuit(SURFACE), "suit off on the surface");
  refused(mission.airlock("close", SURFACE), "close hatch from outside");
}

// Survey markers: each once, all three required, unknown ids rejected.
{
  const { mission, p } = setup();
  mission.start();
  advanceTo(mission, "survey");
  const [a, b, c] = MissionOne.SURVEY_MARKERS;
  assert.strictEqual(ok(mission.inspectMarker(a.id), "A").completed, null);
  refused(mission.inspectMarker(a.id), "A twice");
  ok(mission.inspectMarker(b.id), "B");
  assert.strictEqual(ok(mission.inspectMarker(c.id), "C").completed, "survey");
  assert.throws(() => mission.inspectMarker("survey-z"));
  assert.strictEqual(mission.currentObjective().id, "report");
  assert.strictEqual(Object.keys(p.markers).length, 3);
}

// Report: only from inside the closed, repressurised cabin; reply after the simulated delay.
{
  const { state, mission, p } = setup();
  mission.start();
  advanceTo(mission, "report");
  refused(mission.submitReport(SURFACE), "report from outside");
  refused(mission.submitReport(INSIDE), "report with hatch open");
  ok(mission.airlock("close", INSIDE), "close hatch");
  refused(mission.submitReport(INSIDE), "report while depressurised");
  ok(mission.airlock("repressurize", INSIDE), "repressurise");
  refused(mission.submitReport(INSIDE), "report during repressurisation");
  cycle(mission);
  assert.strictEqual(p.cabin, "pressurized");
  ok(mission.toggleHelmet(INSIDE), "helmet off once safe");

  const sent = ok(mission.submitReport(INSIDE), "submit report");
  assert.ok(sent.lines.some((l) => /3 to 22 minutes/.test(l.text)), "signal delay explained");
  refused(mission.submitReport(INSIDE), "double submit while transmitting");
  assert.strictEqual(state.reports.length, 1);
  assert.strictEqual(state.reports[0].missionId, "establish-base");
  assert.strictEqual(mission.tick(2.9, INSIDE).length, 0, "reply not before the delay");
  const reply = mission.tick(0.2, INSIDE);
  assert.strictEqual(reply[0].completed, "report");
  assert.strictEqual(reply[0].missionComplete, true);
  assert.ok(reply[0].lines.some((l) => l.speaker === "Mission Control"));
  assert.strictEqual(mission.status, "complete");
  refused(mission.submitReport(INSIDE), "report after completion");
  assert.strictEqual(state.reports.length, 1, "no duplicate reports");
  assert.strictEqual(Object.keys(p.completed).length, MissionOne.OBJECTIVES.length);
}

// Mission progress lives on the shared mission state; actions never change resources.
{
  const { state, mission } = setup();
  const before = JSON.stringify(state.resources);
  mission.start();
  advanceTo(mission, "report");
  assert.strictEqual(JSON.stringify(state.resources), before, "mission actions do not create or spend resources");
  assert.strictEqual(state.missions.establishBase, mission.progress);
  // Re-creating the mission object on the same state continues the same progress.
  assert.strictEqual(MissionOne.create(state).currentObjective().id, "report");
}

// Reward: 50 Solar Cells, once per save, only after completion.
{
  const { storage, shop } = memoryShop();
  const { mission } = setup();
  mission.start();
  assert.strictEqual(mission.claimReward(shop).ok, false, "no reward before completion");
  advanceTo(mission, "report");
  mission.airlock("close", INSIDE);
  mission.airlock("repressurize", INSIDE);
  cycle(mission);
  mission.submitReport(INSIDE);
  mission.tick(5, INSIDE);
  assert.strictEqual(mission.status, "complete");
  const first = mission.claimReward(shop);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(shop.state.solar, 50);
  assert.strictEqual(shop.state.helium, 0);
  assert.strictEqual(mission.claimReward(shop).ok, false, "second claim in the same session");
  assert.strictEqual(shop.state.solar, 50);

  // A new session (fresh mission state) with the same save cannot claim again.
  const reloaded = ShopModel.create(storage);
  const second = setup();
  second.mission.start();
  advanceTo(second.mission, "report");
  second.mission.airlock("close", INSIDE);
  second.mission.airlock("repressurize", INSIDE);
  cycle(second.mission);
  second.mission.submitReport(INSIDE);
  second.mission.tick(5, INSIDE);
  const repeat = second.mission.claimReward(reloaded);
  assert.strictEqual(repeat.ok, false);
  assert.strictEqual(repeat.alreadyClaimed, true);
  assert.strictEqual(reloaded.state.solar, 50, "no duplicate Solar Cells");
}

console.log("Mission 1 tests passed: order, stations, suit and helmet safety, airlock cycle, egress, survey, report delay, completion and one-time reward.");
