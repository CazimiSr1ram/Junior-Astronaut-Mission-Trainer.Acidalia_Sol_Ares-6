"use strict";

const assert = require("assert");
const MarsTerrain = require("../static/js/mars-terrain.js");

const terrain = MarsTerrain.createTerrain();
const { config } = terrain;

// Determinism: same seed -> identical terrain; different seed -> different terrain.
{
  const again = MarsTerrain.createTerrain();
  assert.deepStrictEqual(Array.from(again.heights.slice(0, 5000)), Array.from(terrain.heights.slice(0, 5000)));
  const other = MarsTerrain.createTerrain({ seed: 99 });
  assert.notStrictEqual(other.heightAt(150, -120), terrain.heightAt(150, -120));
}

// Flat, safe landing zone and every base structure footprint sits at height 0.
{
  for (let r = 0; r <= config.padRadius; r += 3) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      assert.ok(Math.abs(terrain.heightAt(Math.cos(a) * r, Math.sin(a) * r)) < 1e-3, `pad not flat at r=${r}`);
    }
  }
  Object.entries(MarsTerrain.BASE_LAYOUT).forEach(([name, site]) => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const h = terrain.heightAt(site.x + Math.cos(a) * site.radius, site.z + Math.sin(a) * site.radius);
      assert.ok(Math.abs(h) < 1e-3, `${name} footprint is not on flat ground`);
    }
  });
  assert.strictEqual(terrain.heightAt(MarsTerrain.SPAWN.x, MarsTerrain.SPAWN.z), 0);
}

// Real surface variation outside the pad: hills, ridges, valleys.
{
  const samples = [];
  for (let x = -280; x <= 280; x += 10) {
    for (let z = -280; z <= 280; z += 10) {
      if (Math.hypot(x, z) > config.padRadius + config.padBlend) samples.push(terrain.heightAt(x, z));
    }
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 30, "terrain relief should exceed 30 m");
  assert.ok(sd > 5, "terrain should vary, not be a flat plane");
}

// Craters are depressions with raised rims.
{
  assert.ok(terrain.craters.length >= 20, "expected a crater field");
  const hero = terrain.craters[0];
  const centre = terrain.heightAt(hero.x, hero.z);
  let rim = 0;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    rim += terrain.heightAt(hero.x + Math.cos(a) * hero.radius, hero.z + Math.sin(a) * hero.radius) / 16;
  }
  assert.ok(rim - centre > 6, `hero crater should be deep (rim ${rim.toFixed(1)} vs centre ${centre.toFixed(1)})`);
  terrain.craters.forEach((crater) => {
    assert.ok(Math.hypot(crater.x, crater.z) - crater.radius > config.padRadius, "crater intrudes on the landing pad");
  });
}

// Mesh data: sizes, valid indices, upward-facing triangles, heights match heightAt().
{
  const mesh = terrain.buildMeshData();
  const vertices = terrain.vertsPerSide ** 2;
  assert.strictEqual(mesh.positions.length, vertices * 3);
  assert.strictEqual(mesh.indices.length, config.resolution ** 2 * 6);
  assert.ok(mesh.indices.every((index) => index < vertices));
  // Babylon.js ComputeNormals: cross(p1 - p2, p3 - p2). Must point up (+y).
  const p = (i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
  for (let t = 0; t < mesh.indices.length; t += 9973 * 3) {
    const [a, b, c] = [p(mesh.indices[t]), p(mesh.indices[t + 1]), p(mesh.indices[t + 2])];
    const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    assert.ok(u[2] * v[0] - u[0] * v[2] > 0, "terrain triangle faces downward");
  }
  for (let i = 0; i < vertices; i += 997) {
    const [x, y, z] = p(i);
    assert.ok(Math.abs(terrain.heightAt(x, z) - y) < 1e-4, "heightAt must match mesh vertices");
  }
  // Interpolation is continuous across the triangle diagonal.
  const x = -100 + terrain.cell * 0.5;
  const z = 80 + terrain.cell * 0.5;
  assert.ok(Math.abs(terrain.heightAt(x - 1e-4, z - 1e-4) - terrain.heightAt(x + 1e-4, z + 1e-4)) < 1e-3);
  assert.ok(mesh.colors.every((value) => value >= 0 && value <= 1));
}

// Movement constraint: boundary clamp, steep uphill refused, downhill and flat allowed.
{
  const clamped = terrain.constrainMove(0, 290, 0, 320);
  assert.ok(Math.hypot(clamped.x, clamped.z) <= config.playRadius + 1e-9);
  assert.deepStrictEqual(terrain.constrainMove(0, -12, 0.3, -12), { x: 0.3, z: -12 });

  const steep = MarsTerrain.createTerrain({ maxWalkSlope: 0.05 });
  let checked = 0;
  for (let x = -250; x <= 250 && checked < 20; x += 7) {
    for (let z = -250; z <= 250 && checked < 20; z += 7) {
      if (Math.hypot(x, z) > config.playRadius - 5) continue;
      const rise = steep.heightAt(x + 0.5, z) - steep.heightAt(x, z);
      if (rise / 0.5 > 0.3) {
        assert.deepStrictEqual(steep.constrainMove(x, z, x + 0.5, z), { x, z }, "steep uphill step should be refused");
        const back = steep.constrainMove(x + 0.5, z, x, z);
        assert.deepStrictEqual(back, { x, z }, "downhill step should be allowed");
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, "test needs at least one steep sample");
}

// Rock scatter: deterministic, nothing on the pad or base footprints, inside the world.
{
  const rocks = MarsTerrain.scatterRocks(terrain);
  const again = MarsTerrain.scatterRocks(terrain);
  assert.deepStrictEqual(rocks.boulders.slice(0, 10), again.boulders.slice(0, 10));
  assert.ok(rocks.small.length >= 2000, "expected dense small-rock scatter");
  assert.ok(rocks.boulders.length >= 40, "expected boulders and rock formations");
  [...rocks.small, ...rocks.boulders].forEach((rock) => {
    const r = Math.hypot(rock.x, rock.z);
    assert.ok(r > config.padRadius, "rock placed on the landing pad");
    assert.ok(r < config.playRadius + 31, "rock outside the world");
    assert.ok(!MarsTerrain.insideBaseFootprint(rock.x, rock.z), "rock inside a base footprint");
    assert.ok(rock.y <= terrain.heightAt(rock.x, rock.z), "rock should be seated into the ground");
  });
}

// Soil textures tile seamlessly and have the expected size.
{
  const soil = MarsTerrain.generateSoilTextures(128);
  assert.strictEqual(soil.albedo.length, 128 * 128 * 4);
  assert.strictEqual(soil.normal.length, 128 * 128 * 4);
  const at = (x, y) => soil.albedo[(y * 128 + x) * 4];
  let seam = 0;
  let interior = 0;
  for (let y = 0; y < 128; y += 1) {
    seam += Math.abs(at(127, y) - at(0, y));
    interior += Math.abs(at(64, y) - at(63, y));
  }
  assert.ok(seam < interior * 3 + 128 * 2, "texture seam is visibly discontinuous");
}

// Day/night/dust-storm lighting.
{
  const env = (elapsedSeconds, dust = 0) => MarsTerrain.computeEnvironment({ elapsedSeconds, dust });
  const morning = env(0);
  const noon = env(30);
  const night = env(75);
  assert.strictEqual(noon.phase, "day");
  assert.strictEqual(night.phase, "night");
  assert.ok(noon.sunIntensity > morning.sunIntensity && morning.sunIntensity > night.sunIntensity);
  assert.strictEqual(night.sunIntensity, 0);
  assert.ok(night.ambientIntensity < noon.ambientIntensity);
  assert.ok(night.starVisibility > 0.8 && noon.starVisibility === 0);
  assert.ok(night.helmetLamp > 0.9 && noon.helmetLamp === 0);
  assert.ok(noon.sunDirection[1] < 0, "daytime light must point downward");
  assert.ok(noon.sunDirection[2] > 0, "noon sun should be in the southern sky");
  assert.ok(env(5).sunDirection[0] < 0 && env(55).sunDirection[0] > 0, "sun should rise east and set west");
  const storm = env(30, 1);
  assert.ok(storm.sunIntensity < noon.sunIntensity * 0.3, "dust storm should dim the sun");
  assert.ok(storm.fogDensity > noon.fogDensity * 5, "dust storm should reduce visibility");
  // Continuous at the day/night boundary and across the sol wrap.
  assert.ok(Math.abs(env(59.99).elevation - env(60.01).elevation) < 0.5);
  assert.ok(Math.abs(env(89.99).elevation - env(0).elevation) < 0.5);
}

console.log("Mars terrain tests passed: determinism, flat pad, relief, craters, mesh, movement limits, rocks, textures and lighting.");
