"use strict";

// Imported model placement and asset manifest checks (no browser needed).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const MarsTerrain = require("../static/js/mars-terrain.js");
const MissionOne = require("../static/js/mission-one.js");
const ModelAssets = require("../static/js/model-assets.js");
const MarsProps = require("../static/js/mars-props.js");

// Manifest matches the files on disk: nothing "available" is missing, nothing missing is claimed.
{
  Object.entries(ModelAssets.MANIFEST).forEach(([key, entry]) => {
    const file = path.join(__dirname, "..", entry.folder, entry.file);
    assert.strictEqual(fs.existsSync(file), entry.available, `${key}: available=${entry.available} but file ${fs.existsSync(file) ? "exists" : "is missing"} (${entry.folder}${entry.file})`);
  });
  assert.strictEqual(ModelAssets.MANIFEST.rover.available, true, "rover .glb exported to static/assets/models/rover/");
  assert.strictEqual(ModelAssets.MANIFEST.habitat.available, false, "final habitat .glb not exported yet");
}

// Sites: away from the landing area, inside the play area, on flat ground, clear of
// boulders, procedural craters, base buildings and survey markers.
{
  const terrain = MarsTerrain.createTerrain();
  const rocks = MarsTerrain.scatterRocks(terrain);
  Object.entries(MarsProps.SITES).forEach(([key, site]) => {
    const r = Math.hypot(site.x, site.z);
    assert.ok(r >= 110, `${key} is away from the landing area (${r.toFixed(0)} m)`);
    assert.ok(r + site.footprintRadius < terrain.config.playRadius - 20, `${key} is well inside the play area`);
    terrain.craters.forEach((crater) => assert.ok(Math.hypot(site.x - crater.x, site.z - crater.z) > crater.radius * 1.25 + site.footprintRadius, `${key} clear of crater at ${crater.x},${crater.z}`));
    rocks.boulders.forEach((rock) => assert.ok(Math.hypot(site.x - rock.x, site.z - rock.z) > site.footprintRadius + rock.scale * 1.5, `${key} clear of boulder at ${rock.x.toFixed(0)},${rock.z.toFixed(0)}`));
    assert.strictEqual(MarsTerrain.insideBaseFootprint(site.x, site.z, site.footprintRadius), false, `${key} clear of base buildings`);
    MissionOne.SURVEY_MARKERS.forEach((marker) => assert.ok(Math.hypot(site.x - marker.x, site.z - marker.z) > 40, `${key} clear of ${marker.id}`));
    // Flat enough that nothing floats: ground under the footprint varies little.
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 16; a += 1) for (const f of [0, 0.5, 1]) {
      const h = terrain.heightAt(site.x + Math.cos(a / 16 * 2 * Math.PI) * site.footprintRadius * f, site.z + Math.sin(a / 16 * 2 * Math.PI) * site.footprintRadius * f);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    assert.ok(hi - lo < 1.5, `${key} footprint is flat (${(hi - lo).toFixed(2)} m)`);
    assert.ok(Math.abs(MarsProps.groundUnder(terrain, site.x, site.z, site.footprintRadius) - lo) < 0.5, `${key} placed at the lowest ground`);
    // The info point is outside the solid model, on walkable ground.
    const [ox, , oz] = site.interaction.offset;
    assert.ok(Math.hypot(ox, oz) > site.footprintRadius + 0.5, `${key} info point is outside the model`);
  });
  // The crater is disabled until it can sit on the terrain without floating.
  assert.strictEqual(MarsProps.SITES.crater.enabled, false);
  assert.notStrictEqual(MarsProps.SITES.equipmentSite.enabled, false);
  const sites = Object.values(MarsProps.SITES);
  assert.ok(Math.hypot(sites[0].x - sites[1].x, sites[0].z - sites[1].z) > 100, "sites are far apart");
}

console.log("mars-props tests passed");
