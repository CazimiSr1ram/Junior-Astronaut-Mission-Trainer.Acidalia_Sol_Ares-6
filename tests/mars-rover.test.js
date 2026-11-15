"use strict";

// Temporary rover placeholder: placement and interaction points (no browser).

const assert = require("assert");
const MarsTerrain = require("../static/js/mars-terrain.js");
const MissionOne = require("../static/js/mission-one.js");
const ModelAssets = require("../static/js/model-assets.js");
const MarsRover = require("../static/js/mars-rover.js");

const { ROVER } = MarsRover;
const terrain = MarsTerrain.createTerrain();
const halfDiagonal = Math.hypot(ROVER.length, ROVER.width) / 2;

// Parked on flat ground, clear of the base buildings, rocks, survey markers and the walkway.
{
  assert.strictEqual(MarsTerrain.insideBaseFootprint(ROVER.x, ROVER.z, halfDiagonal + 1), false, "clear of base buildings and the lander");
  const rocks = MarsTerrain.scatterRocks(terrain);
  rocks.boulders.forEach((rock) => assert.ok(Math.hypot(rock.x - ROVER.x, rock.z - ROVER.z) > halfDiagonal + rock.scale * 1.5 + 2, "clear of boulders"));
  MissionOne.SURVEY_MARKERS.forEach((marker) => assert.ok(Math.hypot(marker.x - ROVER.x, marker.z - ROVER.z) > 10, `clear of ${marker.id}`));
  // The straight walkway from the lander ramp to the habitat runs along x = 0.
  assert.ok(Math.abs(ROVER.x) - halfDiagonal > 2.5, "leaves the lander-habitat walkway clear");
  const heights = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([f, s]) => {
    const p = MarsRover.toWorld(f * ROVER.length / 2, s * ROVER.width / 2);
    return terrain.heightAt(p.x, p.z);
  });
  assert.ok(Math.max(...heights) - Math.min(...heights) < 0.3, "wheels on near-level ground");
}

// Orientation helper: forward (+z in the rover frame) follows the heading.
{
  const front = MarsRover.toWorld(1, 0);
  assert.ok(Math.abs(front.x - (ROVER.x + Math.sin(ROVER.heading))) < 1e-9);
  assert.ok(Math.abs(front.z - (ROVER.z + Math.cos(ROVER.heading))) < 1e-9);
  const side = MarsRover.toWorld(0, 1);
  assert.ok(Math.abs(Math.hypot(side.x - ROVER.x, side.z - ROVER.z) - 1) < 1e-9);
}

// Named interaction points: unique, outside the vehicle, reachable on foot, not on top of each other.
{
  const ids = ROVER.interactions.map((point) => point.id);
  assert.deepStrictEqual(ids, ["rover-inspect", "rover-science-bay"]);
  ROVER.interactions.forEach((point) => {
    assert.ok(Math.abs(point.forward) > ROVER.length / 2 + 0.5 || Math.abs(point.side) > ROVER.width / 2 + 0.5, `${point.id} is outside the vehicle`);
  });
  const [a, b] = ROVER.interactions.map((point) => MarsRover.toWorld(point.forward, point.side));
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > ROVER.interactions[0].radius + ROVER.interactions[1].radius, "front and rear points do not overlap");
}

// The rover model is available at the expected path; the placeholder is only a fallback.
assert.strictEqual(ModelAssets.MANIFEST.rover.available, true);
assert.strictEqual(`${ModelAssets.MANIFEST.rover.folder}${ModelAssets.MANIFEST.rover.file}`, "/static/assets/models/rover/mars-rover.glb");
assert.strictEqual(ROVER.drivable, false, "robotic rover is never drivable");

// Power ON/OFF: save-ready state, honest messages, no double toggles, no resource cost.
{
  const MissionModel = require("../static/js/mission-state.js");
  const state = MissionModel.createMissionState();
  const resources = JSON.stringify(state.resources);
  assert.strictEqual(MarsRover.isPowered(state), false, "starts powered off");
  assert.deepStrictEqual(MarsRover.statusRows(state).slice(0, 3), [["Power", "OFF"], ["Indicator lights", "Off"], ["Science instruments", "Off"]]);
  const on = MarsRover.setPowered(state, true);
  assert.strictEqual(on.ok, true);
  assert.match(on.message, /indicator lights on/);
  assert.strictEqual(MarsRover.isPowered(state), true);
  assert.match(MarsRover.statusRows(state)[2][1], /Active/);
  assert.strictEqual(MarsRover.setPowered(state, true).ok, false, "already on: no duplicate toggle");
  const saved = JSON.parse(JSON.stringify(state));
  assert.strictEqual(MarsRover.isPowered(saved), true, "power state survives a save-format round trip");
  const off = MarsRover.setPowered(state, false);
  assert.strictEqual(off.ok, true);
  assert.match(off.message, /switched off/);
  assert.strictEqual(MarsRover.isPowered(state), false);
  assert.strictEqual(MarsRover.setPowered(state, false).ok, false, "already off");
  assert.strictEqual(JSON.stringify(state.resources), resources, "no oxygen, water, food or power used");
  assert.match(MarsRover.statusRows(state)[3][1], /Not drivable/);
}

// Both rover points open the same control panel (no separate info message).
ROVER.interactions.forEach((point) => {
  assert.strictEqual(point.panel, "rover");
  assert.strictEqual(point.info, undefined);
});

console.log("mars-rover tests passed");
