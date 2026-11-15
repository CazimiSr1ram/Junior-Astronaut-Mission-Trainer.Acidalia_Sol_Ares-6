"use strict";
const assert = require("assert");
const Model = require("../static/js/mission-state.js");
const Habitat = require("../static/js/habitat-systems.js");
const Eva = require("../static/js/eva-integration.js");
const Research = require("../static/js/research-missions.js");
const MissionOne = require("../static/js/mission-one.js");
const Rest = require("../static/js/rest-system.js");
const Clock = require("../static/js/mission-clock.js");
const safeEnv = { safeCabin: true, atTerminal: true, suitSafe: true, atEquipment: false };
const fresh = () => Model.createMissionState();
const ok = (r) => assert.ok(r.ok, JSON.stringify(r));

// Habitat construction remains external; dedicated lock has a strict two-door interlock.
{
  const s = fresh(), h = Habitat.create(s);
  assert.equal(h.chamber(), null);
  assert.equal(h.act("openOuter", { suitSafe: true }).ok, false);
  s.systems.habitat = { constructed: true, pressurized: true, lifeSupport: true };
  const env = { suitSafe: true, insideHabitat: false };
  const a = h.chamber();
  const observer = Model.observeTime(s, h.tick);
  ok(h.act("openOuter", env)); ok(h.act("enter", env));
  assert.equal(h.act("fill", env).ok, false);
  assert.equal(h.act("openInner", env).ok, false);
  ok(h.act("closeOuter", env)); ok(h.act("fill", env));
  assert.equal(h.act("openOuter", env).ok, false, "doors stay sealed during cycle");
  const food = s.resources.food;
  Model.advanceMissionTime(s, 5);
  assert.ok(s.resources.food < food);
  assert.equal(s.elapsedSeconds, 5);
  assert.equal(h.act("openInner", env).ok, false, "verification required");
  ok(h.act("verify", env)); ok(h.act("openInner", env));
  assert.equal(h.act("openOuter", env).ok, false);
  ok(h.act("toHabitat", env));
  assert.equal(a.side, "habitat");
  assert.equal(s.systems.habitat.pressurized, true, "cabin never depressurises");
  ok(h.act("openInner", env)); ok(h.act("enter", env));
  assert.equal(h.act("vent", env).ok, false);
  ok(h.act("closeInner", env));
  assert.equal(h.act("vent", { suitSafe: false }).ok, false);
  ok(h.act("vent", env)); Model.advanceMissionTime(s, 5);
  ok(h.act("openOuter", env)); ok(h.act("toMars", env));
  assert.equal(a.side, "outside");
  assert.ok(!a.outerOpen && !a.innerOpen);
  observer();
}
// State-backed status, not fabricated CO2 or temperature readings.
{
  const s = fresh();
  let status = Habitat.atmosphere(s, { cabin: "pressurized", powerOn: true, hatchOpen: false });
  assert.equal(status.pressure, "Safe"); assert.equal(status.co2, "pending");
  assert.match(status.temperature, /Pending/);
  s.resources.power = 0;
  assert.equal(Habitat.atmosphere(s, { pressurized: true, lifeSupport: true }).safe, false);
  assert.equal(Habitat.atmosphere(s, { cabin: "depressurizing" }).pressure, "Low");
  assert.equal(Habitat.atmosphere(s, { cabin: "pressurized", hatchOpen: true }).pressure, "Critical");
}
// Suit adapter owns no suit state/rates; full oxygen never masks pressure/CO2/battery failures.
{
  const s = fresh(), alarms = [];
  const bridge = Eva.create(s, { onPressureEmergency: (critical) => alarms.push(critical) });
  assert.equal(bridge.read().connected, false);
  const suit = { oxygenPercent: 100, pressureStatus: "safe", co2Status: "safe", integrityPercent: 100, batteryPercent: 100, leakStatus: "none" };
  let listener;
  const disconnect = bridge.register({ read: () => ({ ...suit }), oxygenCapacityUnits: 20,
    subscribe: (fn) => { listener = fn; return () => { listener = null; }; },
    receiveOxygen: ({ oxygenPercent }) => { suit.oxygenPercent = oxygenPercent; return true; } });
  assert.ok(bridge.read().safe);
  assert.throws(() => bridge.register({ read: () => suit }), /already connected/);
  MissionOne.setSuitSafetyCheck(() => bridge.read().safe);
  const progress = { suitOn: true, helmetOn: true };
  for (const [key, bad] of [["pressureStatus", "critical"], ["co2Status", "high"], ["integrityPercent", 0], ["batteryPercent", 0], ["leakStatus", "serious"]]) {
    const previous = suit[key]; suit[key] = bad; listener();
    assert.equal(MissionOne.isSuitProtecting(progress), false);
    suit[key] = previous; listener();
  }
  assert.deepEqual(alarms, [true, false, true, false]);
  suit.oxygenPercent = 0; s.resources.oxygenReserve = 7;
  const station = { safe: true, operational: true, atStation: true };
  assert.equal(bridge.refill({ ...station, atStation: false }).ok, false);
  assert.equal(bridge.refill({ ...station, operational: false }).ok, false);
  assert.equal(s.resources.oxygenReserve, 7);
  ok(bridge.refill(station));
  assert.equal(suit.oxygenPercent, 35); assert.equal(s.resources.oxygenReserve, 0);
  assert.equal(bridge.refill(station).ok, false);
  disconnect(); MissionOne.setSuitSafetyCheck(null);
}
// Refused/failed transfers return reserves without fabricating a filled tank.
for (const throws of [false, true]) {
  const s = fresh(), bridge = Eva.create(s);
  bridge.register({ read: () => ({ oxygenPercent: 0 }), oxygenCapacityUnits: 10,
    receiveOxygen: () => { if (throws) throw new Error("Station failure"); return false; } });
  const reserve = s.resources.oxygenReserve;
  assert.equal(bridge.refill({ safe: true, operational: true, atStation: true }).ok, false);
  assert.equal(s.resources.oxygenReserve, reserve);
}

// Mission 2 cannot substitute backup oxygen for repair; existing three choices are unchanged.
{
  const s = fresh(), missions = Research.create(s, Model);
  assert.equal(missions.start("oxygenEmergency").ok, false);
  s.missions = { establishBase: { status: "complete" } };
  ok(missions.start("oxygenEmergency"));
  assert.equal(s.rates.oxygenProduction, 0);
  assert.equal(Object.keys(Model.EMERGENCY_CONFIG.oxygenFailure.choices).length, 3);
  Model.resolveEmergency(s, "oxygenFailure", "emergencyTanks");
  ok(missions.check("oxygenEmergency", safeEnv));
  assert.equal(missions.check("oxygenEmergency", safeEnv).ok, false);
  Model.resolveEmergency(s, "oxygenFailure", "repairGenerator");
  ok(missions.check("oxygenEmergency", safeEnv));
  ok(missions.check("oxygenEmergency", safeEnv));
  assert.equal(missions.check("oxygenEmergency", { ...safeEnv, safeCabin: false }).ok, false);
  ok(missions.check("oxygenEmergency", safeEnv));
  assert.equal(missions.check("oxygenEmergency", { ...safeEnv, atTerminal: false }).ok, false);
  ok(missions.check("oxygenEmergency", safeEnv));
  assert.equal(s.missions.oxygenEmergency.status, "complete");
  assert.equal(s.reports.length, 1);
  assert.equal(missions.check("oxygenEmergency", safeEnv).ok, false);
}

// Mission 3 preparation, unchanged power effects, shelter observations and post-storm panel inspection.
{
  const s = fresh(), missions = Research.create(s, Model);
  s.missions = { oxygenEmergency: { status: "complete" } };
  ok(missions.start("dustStormMission"));
  assert.equal(missions.check("dustStormMission", safeEnv).ok, false);
  ok(missions.check("dustStormMission", { ...safeEnv, atEquipment: true, safeCabin: false }));
  assert.equal(missions.check("dustStormMission", safeEnv).ok, false); // starts existing storm
  assert.equal(s.rates.solarGeneration, 1, "no unapproved solar-rate change");
  Model.resolveEmergency(s, "dustStorm", "reduceConsumption");
  ok(missions.check("dustStormMission", safeEnv)); ok(missions.check("dustStormMission", safeEnv));
  assert.equal(missions.check("dustStormMission", safeEnv).ok, false);
  Model.observeTime(s, (seconds) => missions.tick(seconds, safeEnv));
  Model.advanceMissionTime(s, 270);
  assert.ok(s.missions.dustStormMission.shelteredSeconds > 0);
  ok(missions.check("dustStormMission", safeEnv));
  assert.equal(missions.check("dustStormMission", safeEnv).ok, false);
  ok(missions.check("dustStormMission", { ...safeEnv, atEquipment: true, safeCabin: false }));
  ok(missions.check("dustStormMission", safeEnv));
  assert.equal(s.missions.dustStormMission.status, "complete");
}
// One observer sees all elapsed mission time, including sleep and repair; never preview copies.
{
  const s = fresh(), clock = Clock.create(s, Model); clock.start();
  let elapsed = 0;
  Model.observeTime(s, (seconds) => { elapsed += seconds; });
  s.elapsedSeconds = 75;
  const rest = Rest.create(s, Model, clock, { place: () => ({ inside: true, completed: true, accessible: true, pressurized: true, lifeSupport: true }) });
  ok(rest.begin("lander-bed-1"));
  for (let i = 0; i < 10 && rest.active; i++) rest.tick(0.1);
  assert.equal(elapsed, 15); assert.equal(s.crew[0].isAsleep, false);
  Model.triggerEmergency(s, "oxygenFailure");
  Model.previewEmergencyChoice(s, "oxygenFailure", "repairGenerator");
  assert.equal(elapsed, 15);
  Model.resolveEmergency(s, "oxygenFailure", "repairGenerator");
  assert.equal(elapsed, 195);
  assert.match(Rest.unavailable(s, Model, { criticalEmergency: true }), /urgent/);
}
console.log("Research integration tests passed: airlock interlocks, shared time, telemetry safety, reserve refills, mission recovery and storm checklists.");
