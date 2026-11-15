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
for (const name of ["graphics-quality", "jump-physics", "mars-terrain", "mars-lander", "model-assets", "mars-props", "mars-rover", "mars-racer-exhibit", "exploration-data", "exploration-world", "temp-habitat", "player-view", "mars-scene"]) require(`../static/js/${name}.js`);
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
  // Both appearances use the same shoulder/hip hierarchy, independent of EVA.
  for (const preset of ["male", "female"]) {
    mars.astronaut.setAppearance(preset);
    assert.equal(mars.astronaut.appearance, preset);
    for (const side of [-1, 1]) {
      const hand = mars.scene.getMeshByName(`flight-hand-${side}`);
      const boot = mars.scene.getMeshByName(`flight-boot-${side}`);
      const arm = mars.scene.getMeshByName(side < 0 ? "flight-left-arm" : "flight-right-arm");
      const leg = mars.scene.getMeshByName(side < 0 ? "flight-left-leg" : "flight-right-leg");
      assert.strictEqual(hand.parent, arm.parent, "hand follows the arm's shoulder");
      assert.strictEqual(boot.parent, leg.parent, "boot follows the leg's hip");
      assert.match(hand.parent.name, /shoulder/);
      assert.match(boot.parent.name, /hip/);
    }
    mars.setCameraView("third-person");
    mars.astronaut.setEvaEquipped(false);
    frame();
    const armJoint = mars.scene.getTransformNodeByName("flight-shoulder--1");
    const legJoint = mars.scene.getTransformNodeByName("flight-hip--1");
    const hand = mars.scene.getMeshByName("flight-hand--1");
    const boot = mars.scene.getMeshByName("flight-boot--1");
    const distance = (a, b) => BABYLON.Vector3.Distance(a.getAbsolutePosition(), b.getAbsolutePosition());
    mars.scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const handDistance = distance(armJoint, hand), bootDistance = distance(legJoint, boot);
    for (let i = 0; i < 8; i++) { mars.camera.position.x += 0.025; frame(); }
    mars.scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    assert.ok(Math.abs(armJoint.rotation.x) > 0.01, `${preset} arms animate when moving`);
    assert.ok(Math.abs(legJoint.rotation.x) > 0.01, `${preset} legs animate when moving`);
    assert.ok(Math.abs(distance(armJoint, hand) - handDistance) < 1e-5, "hand stays attached while moving");
    assert.ok(Math.abs(distance(legJoint, boot) - bootDistance) < 1e-5, "boot stays attached while moving");
    mars.astronaut.setCrouched(true); frame();
    assert.ok(mars.astronaut.crouched, `${preset} can crouch`);
    mars.astronaut.setCrouched(false);
    mars.astronaut.setEvaEquipped(true);
    assert.ok(mars.astronaut.evaEquipped, `${preset} can show EVA appearance`);
    for (const side of [-1, 1]) {
      const glove = mars.scene.getMeshByName(`eva-glove-${side}`);
      const boot = mars.scene.getMeshByName(side < 0 ? "astronaut-left-boot" : "astronaut-right-boot");
      assert.equal(glove.parent.name, `eva-elbow-${side}`, "EVA glove follows elbow and shoulder");
      assert.equal(glove.parent.parent.name, `eva-shoulder-${side}`);
      assert.equal(boot.parent.name, `eva-ankle-${side}`, "EVA boot follows ankle, knee and hip");
      assert.equal(boot.parent.parent.name, `eva-knee-${side}`);
      assert.equal(boot.parent.parent.parent.name, `eva-hip-${side}`);
    }
    mars.astronaut.setEvaEquipped(false);
    mars.setCameraView("first-person");
  }
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
  assert.ok(TempHabitat.startConstruction(state, { missionOneComplete: true }).ok);
  assert.ok(TempHabitat.advanceConstruction(state, TempHabitat.CONSTRUCTION.seconds).completed);
  mars.setHabitatStage(TempHabitat.stage(state), TempHabitat.progress(state));
  const habitatBed = TempHabitat.LAYOUT.beds[0];
  mars.teleportAstronaut(hp.x + habitatBed.x, hp.z + habitatBed.approachZ); frame();
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
