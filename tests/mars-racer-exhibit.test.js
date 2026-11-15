"use strict";
const assert = require("assert");
const fs = require("fs");
const ModelAssets = require("../static/js/model-assets.js");
const Terrain = require("../static/js/mars-terrain.js");
require("../static/js/mars-racer-exhibit.js");
const entry = ModelAssets.MANIFEST.racerExhibit;
assert.ok(entry.available);
assert.ok(fs.existsSync(`.${entry.folder}${entry.file}`), "supplied racer GLB is present");
const p = global.MarsRacerExhibit.LOCATION;
for (const key of ["lander", "habitat"]) {
  const site = Terrain.BASE_LAYOUT[key];
  assert.ok(Math.hypot(p.x - site.x, p.z - site.z) > site.radius + 3, `${key} footprint remains clear`);
}
assert.notEqual(entry.file, ModelAssets.MANIFEST.rover.file, "science rover remains separate");
console.log("Mars Racer exhibit tests passed: model path, base clearance and separate science rover.");
