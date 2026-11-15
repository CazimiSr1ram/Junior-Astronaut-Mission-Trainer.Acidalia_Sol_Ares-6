/* Run with BABYLON_TEST_MODULE=/path/to/babylon.js node tests/mars-display.integration.js */
"use strict";
const assert = require("assert");
if (!process.env.BABYLON_TEST_MODULE) throw new Error("Set BABYLON_TEST_MODULE to a local Babylon.js build.");
global.BABYLON = require(process.env.BABYLON_TEST_MODULE);
require("../static/js/mars-display.js");
const B = BABYLON;
const engine = new B.NullEngine();
engine.getDeltaTime = () => 16;
const scene = new B.Scene(engine);
const camera = new B.FreeCamera("lobby-camera", B.Vector3.Zero(), scene);
scene.activeCamera = camera;
const screen = B.MeshBuilder.CreatePlane("monitor", { width: 4.75, height: 2.7 }, scene);
screen.parent = new B.TransformNode("frame", scene);
screen.material = new B.StandardMaterial("monitor-material", scene);
const labels = B.RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 0]), 1, 1, scene);
const display = MarsDisplay.create(scene, screen, labels);
assert.ok(scene.customRenderTargets.includes(display.target));
assert.deepStrictEqual(display.target.renderList.map((m) => m.name), ["mars-monitor-planet", "mars-monitor-atmosphere"]);
assert.strictEqual(display.target.activeCamera, display.camera);
assert.equal(camera.layerMask & MarsDisplay.LAYER, 0, "private geometry excluded from lobby camera");
assert.equal(display.planet.layerMask, MarsDisplay.LAYER);
assert.equal(display.planet.checkCollisions, false);
assert.ok(display.planet.position.x > 9000, "planet is outside the playable scene");
assert.ok(2.19 < display.camera.orthoTop - display.camera.orthoBottom, "halo fits with vertical margins");
assert.ok(2.19 < display.camera.orthoRight - display.camera.orthoLeft, "halo fits with horizontal margins");
const initial = display.planet.rotation.y;
scene.onBeforeRenderObservable.notifyObservers(scene);
assert.ok(display.planet.rotation.y > initial, "planet rotates with frame time");
for (const [level, width, refresh] of [["low", 512, 2], ["medium", 1024, 1], ["high", 1536, 1]]) {
  display.applyGraphics({ shadowFiltering: level });
  assert.equal(display.target.getSize().width, width);
  assert.equal(display.target.refreshRate, refresh);
}
display.dispose();
assert.ok(!scene.customRenderTargets.includes(display.target), "render target removed on disposal");
assert.ok(display.planet.isDisposed());
scene.dispose(); engine.dispose();
console.log("Mars display integration passed: isolated render target, containment, animation, presets and disposal.");
