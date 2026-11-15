"use strict";

// Field exploration and science (exploration-data.js): layout on the real terrain,
// collection, analysis, discovery, salvage, duplicate prevention and save data.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const MarsTerrain = require("../static/js/mars-terrain.js");
const MissionOne = require("../static/js/mission-one.js");
const MissionModel = require("../static/js/mission-state.js");
const MissionOutcome = require("../static/js/mission-outcome.js");
const MarsProps = require("../static/js/mars-props.js");
const MarsRover = require("../static/js/mars-rover.js");
const ModelAssets = require("../static/js/model-assets.js");
const D = require("../static/js/exploration-data.js");

const terrain = MarsTerrain.createTerrain();
const rocks = MarsTerrain.scatterRocks(terrain);
const { LOCATIONS, SAMPLES, CACHES, TERMINAL, BEACONS, HILLS } = D;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const loc = (id) => LOCATIONS.find((item) => item.id === id);
const slopeAt = (x, z, step = 0.5) => Math.max(
  Math.abs(terrain.heightAt(x + step, z) - terrain.heightAt(x - step, z)) / (2 * step),
  Math.abs(terrain.heightAt(x, z + step) - terrain.heightAt(x, z - step)) / (2 * step));

// Content: five documented locations, 12 samples, 4 caches; ids reconciled with the handoff.
{
  assert.deepStrictEqual(LOCATIONS.map((l) => l.id), ["layered-hills", "impact-crater", "abandoned-equipment", "layered-rock", "meteorite-field"]);
  assert.ok(!LOCATIONS.some((l) => l.id === "abandoned-site"), "one canonical id for the equipment site");
  assert.strictEqual(SAMPLES.length, 12);
  assert.strictEqual(CACHES.length, 4);
  assert.strictEqual(new Set([...SAMPLES, ...CACHES].map((item) => item.id)).size, 16, "unique ids");
  [...SAMPLES, ...CACHES].forEach((item) => assert.ok(loc(item.location), `${item.id} belongs to a known location`));
  SAMPLES.forEach((s) => assert.ok(D.SAMPLE_TYPES[s.type], `${s.id} has a known type`));
  LOCATIONS.forEach((l) => assert.ok(SAMPLES.some((s) => s.location === l.id), `${l.id} has at least one sample`));
  assert.deepStrictEqual(BEACONS.map((b) => b.location).sort(), LOCATIONS.map((l) => l.id).sort(), "one beacon per location");
  // Salvage: the four materials stay separate; no Solar Cells, Helium-3, classes or base resources.
  CACHES.forEach((c) => Object.keys(c.materials).forEach((m) => assert.ok(D.MATERIALS.includes(m), `${c.id}: ${m}`)));
  // Fictional content is labelled; science facts carry a review note.
  assert.match(loc("abandoned-equipment").fact, /fictional/i);
  Object.values(D.SAMPLE_TYPES).forEach((type) => assert.ok(type.fact.review, `${type.label}: fact flagged for review`));
}

// The science terminal is at the Abandoned Equipment Site, outside the equipment model, and
// clear of its info point and the caches there.
{
  const site = MarsProps.SITES.equipmentSite;
  assert.strictEqual(TERMINAL.location, "abandoned-equipment");
  assert.ok(dist(TERMINAL, loc("abandoned-equipment").anchor) <= loc("abandoned-equipment").discoveryRadius, "inside the site");
  assert.ok(dist(TERMINAL, site) > site.footprintRadius + 1, "outside the abandoned rover model");
  assert.ok(dist(TERMINAL, site) < 10, "close to the equipment site");
  const info = { x: site.x + site.interaction.offset[0], z: site.z + site.interaction.offset[2] };
  assert.ok(dist(TERMINAL, info) > 2, "not on top of the equipment info point");
  CACHES.filter((c) => c.location === "abandoned-equipment").forEach((c) => assert.ok(dist(TERMINAL, c) > 2.6 + 2.2, `terminal and ${c.id} prompts do not overlap`));
  // Not the Mission Terminal (research missions use lander-mission-terminal).
  assert.notStrictEqual(TERMINAL.id, "lander-mission-terminal");
}

// Every sample, cache, terminal and beacon sits on reachable ground: inside the play area,
// walkable slope, clear of the base, boulders, survey markers, the rover and other props.
{
  const play = 300 - 5;
  const props = [MarsProps.SITES.equipmentSite];
  const landmarks = [
    { x: loc("layered-rock").anchor.x, z: loc("layered-rock").anchor.z, r: 5.2 },
    { x: loc("meteorite-field").anchor.x, z: loc("meteorite-field").anchor.z, r: 7.5 },
  ];
  const points = [
    ...SAMPLES.map((s) => ({ ...s, r: 0.5 })),
    ...CACHES.map((c) => ({ ...c, r: 0.8 })),
    { ...TERMINAL, r: 0.6 },
  ];
  points.forEach((p) => {
    assert.ok(Math.hypot(p.x, p.z) < play, `${p.id} inside the play area`);
    assert.ok(slopeAt(p.x, p.z) < terrain.config.maxWalkSlope * 0.8, `${p.id} on walkable ground (slope ${slopeAt(p.x, p.z).toFixed(2)})`);
    assert.strictEqual(MarsTerrain.insideBaseFootprint(p.x, p.z, 4), false, `${p.id} clear of the base`);
    rocks.boulders.forEach((b) => assert.ok(Math.hypot(b.x - p.x, b.z - p.z) > b.scale * 1.5 + p.r + 1, `${p.id} clear of a boulder at (${b.x.toFixed(0)}, ${b.z.toFixed(0)})`));
    MissionOne.SURVEY_MARKERS.forEach((m) => assert.ok(dist(m, p) > 8, `${p.id} clear of ${m.id}`));
    assert.ok(Math.hypot(p.x - MarsRover.ROVER.x, p.z - MarsRover.ROVER.z) > 8, `${p.id} clear of the rover`);
    props.forEach((site) => assert.ok(dist(site, p) > site.footprintRadius + p.r + 0.8, `${p.id} outside the equipment model`));
    landmarks.forEach((l) => assert.ok(dist(l, p) > l.r + p.r + 0.8, `${p.id} outside the landmark model`));
    // Outside the hills footprint (rotated rectangle around HILLS.center).
    const dx = p.x - HILLS.center.x, dz = p.z - HILLS.center.z;
    const c = Math.cos(HILLS.rotationY), s = Math.sin(HILLS.rotationY);
    const along = dx * c - dz * s, across = dx * s + dz * c;
    assert.ok(Math.abs(along) > HILLS.footprint.halfLength || Math.abs(across) > HILLS.footprint.halfDepth, `${p.id} not inside the hills`);
  });
  // Nothing is placed on top of anything else.
  points.forEach((a, i) => points.slice(i + 1).forEach((b) => assert.ok(dist(a, b) > 2.5, `${a.id} and ${b.id} are apart`)));
  BEACONS.forEach((b) => {
    assert.ok(slopeAt(b.x, b.z) < terrain.config.maxWalkSlope, `beacon at ${b.location} on ground it can stand on`);
    points.forEach((p) => assert.ok(dist(b, p) > 1.5, `beacon at ${b.location} not on ${p.id}`));
  });
  // Every point can be walked to: straight from its location's beacon over walkable slopes.
  points.forEach((p) => {
    const beacon = BEACONS.find((b) => b.location === p.location);
    const steps = Math.ceil(dist(beacon, p));
    for (let k = 0; k <= steps; k += 1) {
      const x = beacon.x + ((p.x - beacon.x) * k) / steps, z = beacon.z + ((p.z - beacon.z) * k) / steps;
      assert.ok(slopeAt(x, z) < terrain.config.maxWalkSlope, `${p.id}: walkable approach from the beacon`);
    }
  });
  // The Impact Crater location is a real crater in the terrain, and its floor is walkable.
  const crater = terrain.craters.find((c) => Math.hypot(c.x - loc("impact-crater").anchor.x, c.z - loc("impact-crater").anchor.z) < 2);
  assert.ok(crater, "impact crater exists in the procedural terrain");
  SAMPLES.filter((s) => s.location === "impact-crater").forEach((s) => assert.ok(Math.hypot(s.x - crater.x, s.z - crater.z) < crater.radius, `${s.id} is in the crater`));
  // Hills: at the edge of the play area, facing the base.
  assert.ok(Math.abs(Math.hypot(HILLS.center.x, HILLS.center.z) - 300) < 1);
}

// Collection, analysis, discovery, salvage and duplicate prevention.
{
  const state = MissionModel.createMissionState();
  const before = JSON.stringify({ resources: state.resources, missions: state.missions, reports: state.reports });
  const ex = D.create(state);
  assert.deepStrictEqual(state.exploration.materials, { metal: 0, polymer: 0, electronics: 0, ceramic: 0 });

  // Discovery by position: nothing at the base, one site when inside its radius, never twice.
  assert.deepStrictEqual(ex.discoverNear(0, 0), []);
  const found = ex.discoverNear(-50, -112);
  assert.deepStrictEqual(found.map((r) => r.location.id), ["abandoned-equipment"]);
  assert.match(found[0].message, /Location discovered: Abandoned Equipment Site/);
  assert.deepStrictEqual(ex.discoverNear(-50, -112), [], "no second notification");
  assert.strictEqual(ex.discover("abandoned-equipment").duplicate, true);
  assert.strictEqual(ex.discover("abandoned-site").ok, false, "old handoff id is not a location");
  // Every sample is within (or just beside) its location's discovery radius.
  SAMPLES.forEach((s) => assert.ok(dist(s, loc(s.location).anchor) <= loc(s.location).discoveryRadius, `${s.id} near its site`));

  // Analysis needs a collected sample; each sample is collected and analysed once.
  assert.strictEqual(ex.analyseSample("sample-03").ok, false, "cannot analyse before collecting");
  assert.strictEqual(ex.collectSample("sample-03").ok, true);
  assert.strictEqual(ex.collectSample("sample-03").duplicate, true, "no duplicate collection");
  assert.strictEqual(ex.collectSample("sample-99").ok, false);
  const analysed = ex.analyseSample("sample-03");
  assert.strictEqual(analysed.ok, true);
  assert.match(analysed.message, /Basalt/);
  assert.strictEqual(ex.analyseSample("sample-03").duplicate, true, "no duplicate analysis");
  assert.deepStrictEqual(ex.scienceLog().map((e) => e.kind), ["location", "sample"]);

  // Salvage: materials once per cache, kept separate.
  const tool = ex.recoverCache("cache-tool-crate");
  assert.strictEqual(tool.ok, true);
  assert.match(tool.message, /fictional/);
  assert.strictEqual(ex.recoverCache("cache-tool-crate").duplicate, true, "no duplicate salvage");
  ex.recoverCache("cache-thermal-parts");
  assert.deepStrictEqual(ex.materials, { metal: 2, polymer: 2, electronics: 0, ceramic: 2 });

  // Objectives track progress.
  assert.deepStrictEqual(ex.objectives().map((o) => [o.id, o.done, o.total]),
    [["discover", 1, 5], ["collect", 1, 12], ["analyse", 1, 12], ["salvage", 2, 4]]);

  // No base resources, research missions, reports, Solar Cells, Helium-3 or classes touched.
  assert.strictEqual(JSON.stringify({ resources: state.resources, missions: state.missions, reports: state.reports }), before);
  ["solar", "helium3", "solarCells", "classes"].forEach((key) => assert.strictEqual(state.exploration[key], undefined));

  // The end-of-mission report counts exploration science without mixing it into mission reports.
  const report = MissionOutcome.buildReport(state, MissionModel.EMERGENCY_CONFIG);
  assert.strictEqual(report.science.sitesDiscovered, 1);
  assert.strictEqual(report.science.samplesAnalysed, 1);
  assert.strictEqual(report.science.samplesTotal, 12);
  assert.strictEqual(report.science.reportsSent, 0);
}

// Save export/import: round trip, and a tampered save cannot add materials or skip steps.
{
  const state = MissionModel.createMissionState();
  const ex = D.create(state);
  ex.discover("meteorite-field");
  ex.collectSample("sample-09");
  ex.collectSample("sample-10");
  ex.analyseSample("sample-09");
  ex.recoverCache("cache-power-unit");
  const saved = JSON.parse(JSON.stringify(ex.exportSave()));
  const fresh = MissionModel.createMissionState();
  const ex2 = D.create(fresh);
  assert.strictEqual(ex2.importSave(saved).ok, true);
  assert.deepStrictEqual(ex2.exportSave(), ex.exportSave());
  assert.deepStrictEqual(ex2.materials, ex.materials);
  assert.strictEqual(ex2.collectSample("sample-09").duplicate, true, "collected samples stay collected after loading");

  const tampered = D.create(MissionModel.createMissionState());
  tampered.importSave({ version: 1, discovered: ["meteorite-field", "meteorite-field", "abandoned-site"], collected: ["sample-01"],
    analysed: ["sample-01", "sample-02"], salvaged: ["cache-tool-crate", "cache-tool-crate", "nope"], materials: { metal: 999 } });
  assert.deepStrictEqual(tampered.state.discovered, ["meteorite-field"]);
  assert.deepStrictEqual(tampered.state.analysed, ["sample-01"], "cannot analyse an uncollected sample via a save");
  assert.deepStrictEqual(tampered.materials, { metal: 2, polymer: 1, electronics: 0, ceramic: 0 }, "materials recomputed from caches");
  assert.strictEqual(tampered.importSave({ version: 99 }).ok, false);
  // Mission state saved as JSON keeps exploration progress.
  const roundTrip = JSON.parse(JSON.stringify(state));
  assert.deepStrictEqual(D.create(roundTrip).exportSave(), ex.exportSave());
}

// Models: files present; the incompatible crater and duplicate equipment model are not used.
{
  ["explorationRockFormation", "explorationMeteoriteField", "explorationHillsCollider", "explorationBeacon"].forEach((key) => {
    const entry = ModelAssets.MANIFEST[key];
    assert.ok(entry && entry.available && entry.used !== false, `${key} is used`);
    assert.ok(fs.existsSync(path.join(__dirname, "..", entry.folder, entry.file)), `${key} file exists`);
  });
  assert.strictEqual(ModelAssets.MANIFEST.explorationCrater.used, false);
  assert.strictEqual(ModelAssets.MANIFEST.explorationHillsVisual.used, false, "compared with the collider and not used");
  assert.ok(!fs.existsSync(path.join(__dirname, "../static/assets/models/exploration/Mars_Abandoned_Equipment_Site_Babylon.glb")), "no duplicate equipment model");
}

// No second input system: the world module has no key listeners and no global UI.
{
  const world = fs.readFileSync(path.join(__dirname, "../static/js/exploration-world.js"), "utf8");
  const data = fs.readFileSync(path.join(__dirname, "../static/js/exploration-data.js"), "utf8");
  [world, data].forEach((source) => {
    assert.ok(!/addEventListener\(\s*["']key/.test(source), "no keyboard listener");
    assert.ok(!/document\.(createElement|body)/.test(source), "no DOM UI of its own");
  });
}

console.log("exploration tests passed");
