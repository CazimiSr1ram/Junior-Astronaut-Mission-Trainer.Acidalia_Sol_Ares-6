/* Habitat sleeping pods: reachable from any open side, inside the habitat only.
 * Real Babylon geometry and collisions, without WebGL or browser rendering.
 * BABYLON_TEST_MODULE=/path/to/babylon.js node tests/habitat-beds.integration.js
 */
"use strict";
const assert = require("assert");
if (!process.env.BABYLON_TEST_MODULE) throw new Error("Set BABYLON_TEST_MODULE to a local Babylon.js build.");
global.BABYLON = require(process.env.BABYLON_TEST_MODULE);
global.navigator = { getGamepads: () => [] };
global.window = { addEventListener() {}, removeEventListener() {} };
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
const mars = MarsScene.create(engine, canvas, {});
function frame() {
  mars.scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  mars.scene.onBeforeRenderObservable.notifyObservers(mars.scene);
}
const { LAYOUT } = TempHabitat;
try {
  const state = Model.createMissionState();
  const clock = Clock.create(state, Model); clock.start();
  const rest = Rest.create(state, Model, clock, {
    place: (id) => ({ ...mars.bedContext(id), completed: true, pressurized: true, lifeSupport: true }),
    onSleep: () => mars.setControlsEnabled(false),
    onWake: () => mars.setControlsEnabled(true),
  });
  assert.ok(TempHabitat.startConstruction(state, { missionOneComplete: true }).ok);
  assert.ok(TempHabitat.advanceConstruction(state, TempHabitat.CONSTRUCTION.seconds).completed);
  mars.setHabitatStage(TempHabitat.stage(state), TempHabitat.progress(state));
  for (let i = 0; i < 3; i++) frame();
  const hp = mars.sites.habitat.position;
  const nearestAt = (x, z) => { mars.teleportAstronaut(x, z); frame(); return mars.nearestInteraction?.id || null; };

  // Walk at the pod through real collisions, as a player would, and stop when its
  // prompt appears. The prompt must appear before the walk ends (pod collider
  // reached or route exhausted), and the body must never enter the pod.
  function walkInto(bedId, from, to) {
    mars.teleportAstronaut(from.x, from.z); frame();
    const bed = LAYOUT.beds.find((b) => b.id === bedId);
    const footprint = TempHabitat.bedFootprint(hp, bed);
    const step = new BABYLON.Vector3(to.x - from.x, 0, to.z - from.z).normalize().scale(0.05);
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.05);
    for (let i = 0; i < steps && mars.nearestInteraction?.id !== bedId; i++) {
      mars.camera.position.addInPlace(step); frame();
      const f = mars.astronautFeet;
      assert.ok(TempHabitat.footprintDistance(footprint, f.x, f.z) > 0.2, `${bedId}: body stays out of the pod`);
    }
    const feet = mars.astronautFeet;
    const gap = TempHabitat.footprintDistance(footprint, feet.x, feet.z);
    assert.equal(mars.nearestInteraction?.id, bedId, `${bedId}: prompt while walking in from (${from.x.toFixed(1)}, ${from.z.toFixed(1)}); ended ${gap.toFixed(2)} m from the pod`);
    assert.equal(mars.bedContext(bedId).accessible, true);
    assert.equal(mars.bedContext(bedId).inside, true);
    assert.equal(mars.bedContext(bedId).obstructed, false, `${bedId}: standing spot is clear`);
    return gap;
  }

  for (const bed of LAYOUT.beds) {
    const f = TempHabitat.bedFootprint(hp, bed);
    const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
    const outer = bed.x > 0 ? 1 : -1; // the open side facing away from the other pod
    const outerEdge = outer > 0 ? f.maxX : f.minX;
    const approaches = {
      front: [{ x: cx, z: f.minZ - 2 }, { x: cx, z: cz }],
      "front corner": [{ x: outerEdge + outer * 1.3, z: f.minZ - 1.3 }, { x: cx, z: cz }],
      "open side": [{ x: outerEdge + outer * 1.6, z: cz }, { x: cx, z: cz }],
      "side, near back": [{ x: outerEdge + outer * 1.4, z: f.maxZ - 0.9 }, { x: cx, z: f.maxZ - 0.9 }],
    };
    for (const [name, [from, to]] of Object.entries(approaches)) {
      const gap = walkInto(bed.id, from, to);
      console.log(`  ${bed.id} ${name}: prompt shown ${gap.toFixed(2)} m from the pod`);
    }
    // Comfortable range, not an exact spot: anywhere along the front edge works.
    for (const x of [f.minX + 0.1, cx, f.maxX - 0.1]) {
      const id = nearestAt(x, f.minZ - 0.7);
      assert.ok(LAYOUT.beds.some((b) => b.id === id), `front edge x=${x.toFixed(2)} selects a pod (got ${id})`);
    }
    assert.equal(nearestAt(cx, f.minZ - 0.7), bed.id, `${bed.id}: its own front selects it`);
    // Out of reach in the middle of the room.
    assert.notEqual(nearestAt(cx, f.minZ - LAYOUT.bedReach - 0.3), bed.id, `${bed.id}: not selected beyond reach`);

    // Daytime rest, then night sleep until morning, from this pod.
    nearestAt(cx, f.minZ - 0.6);
    state.sol = 2; state.elapsedSeconds = 10;
    let result = rest.begin(bed.id);
    assert.ok(result.ok && result.night === false, `${bed.id}: daytime rest starts`);
    for (let i = 0; i < 40 && rest.active; i++) rest.tick(0.25);
    assert.equal(rest.active, false); assert.equal(state.sol, 2, "day rest stays in the same sol");
    nearestAt(cx, f.minZ - 0.6);
    state.elapsedSeconds = 72;
    result = rest.begin(bed.id);
    assert.ok(result.ok && result.night === true, `${bed.id}: night sleep starts`);
    for (let i = 0; i < 40 && rest.active; i++) rest.tick(0.25);
    assert.equal(rest.active, false); assert.equal(state.sol, 3, `${bed.id}: slept until the next morning`);
  }

  // Both pods are independent: each one's front selects only itself.
  const [b1, b2] = LAYOUT.beds.map((bed) => TempHabitat.bedFootprint(hp, bed));
  assert.equal(nearestAt((b1.minX + b1.maxX) / 2, b1.minZ - 0.6), LAYOUT.beds[0].id);
  assert.equal(nearestAt((b2.minX + b2.maxX) / 2, b2.minZ - 0.6), LAYOUT.beds[1].id);

  // No conflict with the airlock, life support or storage stations.
  const exit = LAYOUT.exit, ls = LAYOUT.lifeSupport, st = LAYOUT.storage;
  assert.equal(nearestAt(hp.x + exit.x, hp.z + exit.z), exit.id, "airlock exit keeps its own prompt");
  assert.equal(nearestAt(hp.x + ls.approachX, hp.z + ls.z), ls.id, "life support keeps its own prompt");
  assert.equal(nearestAt(hp.x + st.approachX, hp.z + st.z), st.id, "storage keeps its own prompt");

  // Outside the habitat wall, directly behind the pods: no bed prompt and no rest.
  state.elapsedSeconds = 72;
  for (const bed of LAYOUT.beds) {
    const id = nearestAt(hp.x + bed.x, hp.z + LAYOUT.shellRadius + 0.5);
    assert.ok(!LAYOUT.beds.some((b) => b.id === id), `outside behind ${bed.id}: no bed prompt (got ${id})`);
    assert.equal(mars.bedContext(bed.id).inside, false);
    assert.equal(rest.begin(bed.id).ok, false, `cannot sleep in ${bed.id} from outside`);
  }
  // Outside the airlock as well.
  assert.equal(rest.begin(LAYOUT.beds[0].id).ok, false);
  nearestAt(hp.x + LAYOUT.entry.x, hp.z + LAYOUT.entry.z);
  assert.equal(rest.begin(LAYOUT.beds[0].id).ok, false, "cannot sleep from the airlock entry outside");
  // Habitat wall: walking outwards in every direction (including along the pods
  // into the gap behind them) never leaves the 3.6 m interior, so a crew member
  // inside the pressurised habitat is never treated as outdoors.
  const radius = () => { const f = mars.astronautFeet; return Math.hypot(f.x - hp.x, f.z - hp.z); };
  let farthest = 0;
  for (const [sx, sz] of [[0, -0.6], [1.75, 0.3], [-1.75, 0.3], [2.0, 2.1], [-2.0, 2.1], [1.9, 2.8], [-1.9, 2.8], [0, -2.3]]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      mars.teleportAstronaut(hp.x + sx, hp.z + sz); frame();
      for (let i = 0; i < 90; i++) {
        mars.camera.position.x += Math.sin(a) * 0.06; mars.camera.position.z += Math.cos(a) * 0.06; frame();
        farthest = Math.max(farthest, radius());
        const f = mars.astronautFeet;
        assert.ok(mars.insideHabitat(f.x, f.z), `walking ${k * 22.5}° from (${sx}, ${sz}) left the habitat interior (r ${radius().toFixed(2)} m)`);
      }
    }
  }
  assert.ok(farthest < LAYOUT.interiorRadius - 0.1, `crew stay clear of the interior boundary (farthest ${farthest.toFixed(2)} m)`);
  // The gap behind the pods is unreachable.
  for (const bed of LAYOUT.beds) {
    const f = TempHabitat.bedFootprint(hp, bed);
    mars.teleportAstronaut(hp.x + bed.x * 3.2, hp.z + bed.z); frame();
    for (let i = 0; i < 60; i++) { mars.camera.position.z += 0.06; mars.camera.position.x -= Math.sign(bed.x) * 0.03; frame(); }
    assert.ok(mars.astronautFeet.z < f.maxZ + 0.1, `${bed.id}: cannot slip behind the pod (z ${(mars.astronautFeet.z - hp.z).toFixed(2)})`);
  }
  // From outside, the wall still blocks: the only way in is the airlock.
  let closest = Infinity;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    mars.teleportAstronaut(hp.x + Math.sin(a) * 5.2, hp.z + Math.cos(a) * 5.2); frame();
    for (let i = 0; i < 80; i++) { mars.camera.position.x -= Math.sin(a) * 0.06; mars.camera.position.z -= Math.cos(a) * 0.06; frame(); closest = Math.min(closest, radius()); }
  }
  assert.ok(closest > LAYOUT.shellRadius, `the wall blocks entry from outside (closest ${closest.toFixed(2)} m)`);
  console.log(`  wall: farthest inside ${farthest.toFixed(2)} m (interior ${LAYOUT.interiorRadius} m); closest from outside ${closest.toFixed(2)} m`);
  console.log("Habitat bed integration passed: both pods from front, corner and sides, day rest, night sleep, no outside sleep, no station conflicts, sealed habitat wall.");
} finally { mars.dispose(); engine.dispose(); }
