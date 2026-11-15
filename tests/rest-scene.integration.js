/* Short real-Babylon geometry/input test, without WebGL or browser rendering.
 * BABYLON_TEST_MODULE=/path/to/babylon.js node tests/rest-scene.integration.js
 * Use the same Babylon build served by the application. No download is performed here.
 */
"use strict";
const assert = require("assert");
if (!process.env.BABYLON_TEST_MODULE) throw new Error("Set BABYLON_TEST_MODULE to a local Babylon.js build.");
global.BABYLON = require(process.env.BABYLON_TEST_MODULE);
global.navigator = { getGamepads: () => [] };
const listeners = {};
global.window = { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), removeEventListener() {} };
// Text/sky painting is stubbed; mesh construction, collisions and camera inputs are real Babylon.
global.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return new Proxy({ canvas: this, measureText: (s) => ({ width: s.length * 10 }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    }, { get: (target, key) => target[key] || (() => {}) });
  }
};
for (const name of ["graphics-quality", "mars-terrain", "mars-lander", "player-view", "mars-scene"]) require(`../static/js/${name}.js`);
const Model = require("../static/js/mission-state.js");
const Clock = require("../static/js/mission-clock.js");
const Rest = require("../static/js/rest-system.js");
const engine = new BABYLON.NullEngine();
engine.getDeltaTime = () => 16;
const canvas = { addEventListener() {}, removeEventListener() {}, focus() {}, style: {} };
let hints = 0;
const mars = MarsScene.create(engine, canvas, { onInteractionChange: () => hints++ });
function frame() {
  mars.scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  mars.scene.onBeforeRenderObservable.notifyObservers(mars.scene);
}
try {
  const state = Model.createMissionState();
  const clock = Clock.create(state, Model); clock.start();
  const rest = Rest.create(state, Model, clock, {
    place: (id) => ({ ...mars.bedContext(id), completed: true, pressurized: true, lifeSupport: true }),
    onSleep: () => mars.setControlsEnabled(false),
    onWake: () => mars.setControlsEnabled(true),
  });
  for (const bed of mars.lander.interactions.filter((i) => i.bed)) {
    mars.teleportAstronaut(bed.position.x, bed.position.z);
    frame();
    assert.equal(mars.nearestInteraction.id, bed.id, "bed is reachable with E");
    assert.equal(mars.bedContext(bed.id).obstructed, false, "bed aisle is clear");
    state.elapsedSeconds = 72;
    mars.camera.cameraDirection.set(1, 0, 1);
    mars.camera.cameraRotation.set(0.2, 0.2);
    assert.ok(rest.begin(bed.id).ok);
    assert.equal(mars.camera.inputs.attachedToElement, false, "movement and mouse disabled while resting");
    assert.equal(mars.camera.cameraDirection.length(), 0);
    assert.equal(mars.camera.cameraRotation.length(), 0);
    for (let i = 0; i < 10 && rest.active; i++) rest.tick(0.1);
    assert.equal(rest.active, false);
    assert.equal(mars.camera.inputs.attachedToElement, true, "movement and mouse reattached on wake");
    frame();
    assert.equal(mars.nearestInteraction.id, bed.id);
  }
  // An obstructing collider denies rest, including a body embedded well inside it.
  const obstruction = BABYLON.MeshBuilder.CreateBox("test-obstruction", { size: 1 }, mars.scene);
  obstruction.position.copyFrom(mars.astronautFeet.add(new BABYLON.Vector3(0, 0.7, 0)));
  obstruction.checkCollisions = true;
  assert.equal(mars.bedContext(mars.nearestInteraction.id).obstructed, true);
  assert.equal(rest.begin(mars.nearestInteraction.id).ok, false);
  obstruction.dispose();

  // Prepared habitat bed uses real geometry, with construction gating supplied by game state.
  const hp = mars.sites.habitat.position;
  mars.teleportAstronaut(hp.x + 1.3, hp.z + 1.4); frame();
  assert.equal(mars.nearestInteraction.id, "habitat-bed");
  assert.equal(mars.bedContext("habitat-bed").inside, true);
  assert.equal(mars.bedContext("habitat-bed").obstructed, false);
  state.elapsedSeconds = 72;
  assert.ok(rest.begin("habitat-bed").ok);
  for (let i = 0; i < 10 && rest.active; i++) rest.tick(0.1);
  assert.equal(rest.active, false);

  // Existing teleport/unstuck fix: leftover input never carries across the teleport.
  mars.camera.cameraDirection.set(2, 0, 2);
  mars.teleportAstronaut(mars.lander.spawn.position.x, mars.lander.spawn.position.z);
  assert.equal(mars.camera.cameraDirection.length(), 0);
  mars.camera.cameraDirection.set(2, 0, 2);
  assert.ok(mars.recoverToLander().ok);
  assert.equal(mars.camera.cameraDirection.length(), 0);
  const before = hints;
  mars.lander.setDoorOpen(true);
  const hatch = mars.lander.interactions.find((i) => i.id === "lander-airlock").position;
  mars.teleportAstronaut(hatch.x, hatch.z); frame();
  assert.ok(hints > before, "airlock prompt refresh survives teleport/threshold update");
  for (let i = 0; i < 100; i++) frame(); // allow the existing hatch hinge to open
  const direction = hatch.subtract(mars.lander.spawn.position); direction.y = 0; direction.normalize();
  const inside = hatch.subtract(direction.scale(0.3));
  mars.teleportAstronaut(inside.x, inside.z); frame();
  assert.ok(mars.lander.isInsideCabin(mars.astronautFeet.x, mars.astronautFeet.z));
  const crossingHints = hints;
  mars.camera.position.addInPlace(direction.scale(0.5)); frame();
  assert.ok(!mars.lander.isInsideCabin(mars.astronautFeet.x, mars.astronautFeet.z), `crossing from ${inside} toward ${direction}, reached ${mars.astronautFeet}`);
  assert.ok(hints > crossingHints, "same airlock interaction is refreshed when walking across threshold");
  console.log("Real Babylon rest integration passed: beds, collision refusal, wake controls, teleport/unstuck momentum and airlock hint refresh.");
} finally { mars.dispose(); engine.dispose(); }
