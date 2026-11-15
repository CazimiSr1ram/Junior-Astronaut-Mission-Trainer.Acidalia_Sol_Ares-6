/*
 * Mars field exploration: world objects (Babylon.js).
 *
 * Places the exploration landmarks, sample rocks, salvage caches, beacons and
 * the science analysis terminal on the existing procedural terrain, and hands
 * interaction points to the existing interaction system (mars-scene.js). It
 * has no input handling, UI or state of its own: progress lives in
 * state.exploration (exploration-data.js) and game.js shows the panels.
 *
 * Models (static/assets/models/exploration, from the handoff package):
 *   - Layered_Rock_Formation_Babylon.glb  solid, can be jumped onto
 *   - Meteorite_Field_Babylon.glb         larger fragments solid, pebbles not
 *   - Layered_Hills_Curved_Collider.glb   at the edge of the play area: solid
 *                                        and visible (the 92k-triangle visual
 *                                        export is not used; see placeHills)
 *   - Exploration_Beacon.glb              one per location
 * The Impact Crater location uses the crater already in the procedural
 * terrain (the supplied crater model is not compatible; see README).
 *
 * Exposes ExplorationWorld in the browser.
 */
(function (root) {
  "use strict";

  const SAMPLE_RADIUS = 2.2;
  const CACHE_RADIUS = 2.6;
  const TERMINAL_RADIUS = 2.6;

  const LANDMARKS = Object.freeze({
    rock: Object.freeze({ asset: "explorationRockFormation", location: "layered-rock", footprintRadius: 5.2, rotationY: 0.4, collide: "all", standable: true }),
    meteorites: Object.freeze({ asset: "explorationMeteoriteField", location: "meteorite-field", footprintRadius: 7.5, rotationY: 0, collide: "large", standable: true }),
  });

  /** Lowest terrain height under a circular footprint (so nothing floats). */
  function groundUnder(terrain, x, z, radius) {
    let lowest = terrain.heightAt(x, z);
    for (let a = 0; a < 16; a += 1) {
      for (const f of [0.5, 1]) {
        const angle = (a / 16) * Math.PI * 2;
        lowest = Math.min(lowest, terrain.heightAt(x + Math.cos(angle) * radius * f, z + Math.sin(angle) * radius * f));
      }
    }
    return lowest;
  }

  function interactions(terrain) {
    const B = root.BABYLON;
    const D = root.ExplorationData;
    const at = (x, z) => new B.Vector3(x, terrain.heightAt(x, z) + 1.4, z);
    return [
      ...D.SAMPLES.map((sample) => ({
        id: `explore-${sample.id}`, label: `Collect sample: ${D.SAMPLE_TYPES[sample.type].label}`,
        position: at(sample.x, sample.z), radius: SAMPLE_RADIUS, exploration: "sample", targetId: sample.id,
      })),
      ...D.CACHES.map((cache) => ({
        id: `explore-${cache.id}`, label: `Recover salvage: ${cache.title} (fictional equipment)`,
        position: at(cache.x, cache.z), radius: CACHE_RADIUS, exploration: "cache", targetId: cache.id,
      })),
      { id: D.TERMINAL.id, label: "Science analysis terminal", position: at(D.TERMINAL.x, D.TERMINAL.z),
        radius: TERMINAL_RADIUS, exploration: "terminal", targetId: D.TERMINAL.id },
    ];
  }

  function create(scene, terrain, options = {}) {
    const B = root.BABYLON;
    const D = root.ExplorationData;
    const assets = root.ModelAssets;
    const shadows = options.shadows;
    const points = options.interactions || [];
    let disposed = false;
    const owned = []; // every mesh/material/node this module creates
    const own = (thing) => { owned.push(thing); return thing; };
    const pbr = (name, hex, roughness = 0.85, metallic = 0) => {
      const m = own(new B.PBRMaterial(name, scene));
      m.albedoColor = B.Color3.FromHexString(hex);
      m.roughness = roughness;
      m.metallic = metallic;
      m.maxSimultaneousLights = 3;
      return m;
    };
    const finish = (mesh, { collide = false, standable = false, cast = true } = {}) => {
      mesh.isPickable = false;
      mesh.checkCollisions = collide;
      mesh.receiveShadows = true;
      if (standable) mesh.metadata = { ...(mesh.metadata || {}), standable: true };
      if (cast && shadows) shadows.addShadowCaster(mesh);
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      return mesh;
    };
    const groundY = (x, z) => terrain.heightAt(x, z);

    // ---- Sample rocks (procedural, on the ground, with a small marker flag) ----
    const sampleMats = Object.fromEntries(Object.entries(D.SAMPLE_TYPES).map(([type, def]) => [type, pbr(`exploreSample-${type}`, def.colour, 0.9)]));
    const flagMat = pbr("exploreSampleFlag", "#f0a020", 0.6);
    flagMat.emissiveColor = new B.Color3(0.35, 0.2, 0.02);
    const poleMat = pbr("exploreSamplePole", "#d9d9d9", 0.5, 0.4);
    const sampleMeshes = {};
    D.SAMPLES.forEach((sample, i) => {
      const y = groundY(sample.x, sample.z);
      const rock = own(B.MeshBuilder.CreateIcoSphere(`exploreSample-${sample.id}`, { radius: 0.28, subdivisions: 1, flat: true }, scene));
      rock.scaling.set(1 + (i % 3) * 0.15, 0.7, 0.9 + (i % 2) * 0.2);
      rock.rotation.y = i * 1.3;
      rock.position.set(sample.x, y + 0.12, sample.z);
      rock.material = sampleMats[sample.type];
      const pole = own(B.MeshBuilder.CreateCylinder(`exploreSamplePole-${sample.id}`, { height: 1.1, diameter: 0.035, tessellation: 6 }, scene));
      pole.position.set(sample.x + 0.45, y + 0.5, sample.z);
      pole.material = poleMat;
      const flag = own(B.MeshBuilder.CreatePlane(`exploreSampleFlag-${sample.id}`, { width: 0.3, height: 0.2, sideOrientation: B.Mesh.DOUBLESIDE }, scene));
      flag.position.set(sample.x + 0.6, y + 0.95, sample.z);
      flag.material = flagMat;
      [rock, pole, flag].forEach((mesh) => finish(mesh, { cast: mesh === rock }));
      sampleMeshes[sample.id] = [rock, pole, flag];
    });

    // ---- Salvage caches (fictional equipment crates) ----
    const crateMat = pbr("exploreCrate", "#8a8f96", 0.55, 0.5);
    const stripeMat = pbr("exploreCrateStripe", "#d9822b", 0.6);
    const openMat = pbr("exploreCrateOpen", "#4b4f55", 0.7, 0.4);
    const cacheMeshes = {};
    D.CACHES.forEach((cache, i) => {
      const yaw = i * 0.9;
      const y = groundUnder(terrain, cache.x, cache.z, 0.7);
      const body = own(B.MeshBuilder.CreateBox(`exploreCache-${cache.id}`, { width: 1.1, height: 0.55, depth: 0.75 }, scene));
      body.position.set(cache.x, y + 0.27, cache.z);
      body.rotation.y = yaw;
      body.material = crateMat;
      const stripe = own(B.MeshBuilder.CreateBox(`exploreCacheStripe-${cache.id}`, { width: 1.12, height: 0.08, depth: 0.77 }, scene));
      stripe.position.set(cache.x, y + 0.42, cache.z);
      stripe.rotation.y = yaw;
      stripe.material = stripeMat;
      const lid = own(B.MeshBuilder.CreateBox(`exploreCacheLid-${cache.id}`, { width: 1.14, height: 0.07, depth: 0.79 }, scene));
      lid.position.set(cache.x, y + 0.585, cache.z);
      lid.rotation.y = yaw;
      lid.material = crateMat;
      finish(body, { collide: true, standable: true });
      finish(stripe);
      lid.isPickable = false;
      lid.receiveShadows = true;
      if (shadows) shadows.addShadowCaster(lid);
      cacheMeshes[cache.id] = { body, stripe, lid, y, yaw };
    });

    // ---- Science analysis terminal (Abandoned Equipment Site) ----
    const T = D.TERMINAL;
    const ty = groundUnder(terrain, T.x, T.z, 0.6);
    const consoleMat = pbr("exploreTerminalBody", "#c9ccd1", 0.5, 0.3);
    const screenMat = pbr("exploreTerminalScreen", "#0a1a24", 0.3);
    screenMat.emissiveColor = new B.Color3(0.1, 0.55, 0.7);
    const terminalRoot = own(new B.TransformNode("exploreTerminal", scene));
    terminalRoot.position.set(T.x, ty, T.z);
    terminalRoot.rotation.y = T.facing;
    const pedestal = own(B.MeshBuilder.CreateBox("exploreTerminalPedestal", { width: 0.7, height: 1.05, depth: 0.5 }, scene));
    pedestal.parent = terminalRoot;
    pedestal.position.y = 0.52;
    pedestal.material = consoleMat;
    const screen = own(B.MeshBuilder.CreateBox("exploreTerminalScreen", { width: 0.62, height: 0.42, depth: 0.04 }, scene));
    screen.parent = terminalRoot;
    screen.position.set(0, 1.2, -0.12);
    screen.rotation.x = -0.45;
    screen.material = screenMat;
    const label = own(B.MeshBuilder.CreatePlane("exploreTerminalLabel", { width: 0.66, height: 0.16 }, scene));
    label.parent = terminalRoot;
    label.position.set(0, 0.86, -0.255);
    const labelTexture = own(new B.DynamicTexture("exploreTerminalLabelText", { width: 512, height: 124 }, scene, true));
    labelTexture.drawText("SCIENCE ANALYSIS", null, 58, "bold 46px sans-serif", "#ffffff", "#1d3a4d", true);
    labelTexture.drawText("fictional field equipment", null, 106, "30px sans-serif", "#b9d7e6", null, true);
    const labelMat = own(new B.StandardMaterial("exploreTerminalLabelMat", scene));
    labelMat.diffuseTexture = labelTexture;
    labelMat.emissiveColor = new B.Color3(0.8, 0.8, 0.8);
    labelMat.disableLighting = true;
    label.material = labelMat;
    terminalRoot.computeWorldMatrix(true);
    finish(pedestal, { collide: true });
    finish(screen);
    finish(label, { cast: false });

    // ---- Imported models ----
    const placed = { rock: false, meteorites: false, hills: false, beacons: 0 };
    const rockMat = pbr("exploreHills", "#8a5238", 0.95);

    /** Imports a model under a fresh holder node; returns { holder, glbRoot, meshes } or null. */
    async function importModel(key) {
      if (!assets || !assets.MANIFEST[key] || !assets.MANIFEST[key].available) return null;
      const result = await assets.load(scene, key);
      if (!result) return null;
      if (disposed) { result.meshes.forEach((mesh) => mesh.dispose()); return null; }
      const glbRoot = result.meshes.find((mesh) => mesh.name === "__root__") || result.meshes[0];
      const holder = own(new B.TransformNode(`explore-${key}`, scene));
      glbRoot.parent = holder;
      result.meshes.forEach((mesh) => own(mesh));
      return { holder, glbRoot, meshes: result.meshes.filter((mesh) => mesh.getTotalVertices() > 0) };
    }

    /** Puts a holder's bottom centre at (x, groundY, z) with the given yaw. */
    function seat(model, x, z, rotationY, y) {
      const { holder } = model;
      holder.computeWorldMatrix(true);
      model.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
      const { min, max } = holder.getHierarchyBoundingVectors(true);
      const inner = own(new B.TransformNode(`${holder.name}-centre`, scene));
      model.glbRoot.parent = inner;
      inner.parent = holder;
      inner.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
      holder.rotation.y = rotationY;
      holder.position.set(x, y, z);
      holder.computeWorldMatrix(true);
      inner.computeWorldMatrix(true);
      return { size: max.subtract(min) };
    }

    async function placeLandmark(key) {
      const spec = LANDMARKS[key];
      const loc = D.LOCATIONS.find((item) => item.id === spec.location);
      const model = await importModel(spec.asset);
      if (!model) return false;
      seat(model, loc.anchor.x, loc.anchor.z, spec.rotationY, groundUnder(terrain, loc.anchor.x, loc.anchor.z, spec.footprintRadius) - 0.05);
      model.meshes.forEach((mesh) => {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        const centre = box.centerWorld;
        // Nothing floats: drop decorative pieces hovering above the ground (e.g. a "falling" meteor).
        if (box.minimumWorld.y > terrain.heightAt(centre.x, centre.z) + 0.4) { mesh.dispose(); return; }
        const tall = box.maximumWorld.y - box.minimumWorld.y > 0.45;
        if (mesh.material) mesh.material.maxSimultaneousLights = 3;
        finish(mesh, { collide: spec.collide === "all" || (spec.collide === "large" && tall), standable: spec.standable });
      });
      return true;
    }

    async function placeBeacons() {
      const model = await importModel("explorationBeacon");
      if (!model) return 0;
      // The export's pole lies sideways (2.2 m along z at y 1.33-1.57), leaving the
      // light floating. Standing it up about its centre joins base (top 0.93 m) and light (from 2.37 m).
      const pole = model.meshes.find((mesh) => mesh.name === "Beacon_Pole");
      if (pole) {
        pole.setPivotPoint(new B.Vector3(0, 1.45, 0));
        pole.rotationQuaternion = null; // glTF nodes use quaternions; this node has no rotation of its own
        pole.rotation.x = Math.PI / 2;
      }
      const first = D.BEACONS[0];
      seat(model, first.x, first.z, 0, groundUnder(terrain, first.x, first.z, 0.6) - 0.05);
      const poleMaterial = pbr("exploreBeaconCollider", "#000000");
      // Clone first, then freeze (a clone of a frozen mesh would keep the old world matrix).
      const holders = D.BEACONS.map((beacon, i) => {
        if (i === 0) return model.holder;
        const copy = own(model.holder.clone(`explore-beacon-${beacon.location}`, null, false));
        copy.position.set(beacon.x, groundUnder(terrain, beacon.x, beacon.z, 0.6) - 0.05, beacon.z);
        copy.getChildMeshes(false).forEach((mesh) => own(mesh));
        return copy;
      });
      let count = 0;
      D.BEACONS.forEach((beacon, i) => {
        const holder = holders[i];
        holder.computeWorldMatrix(true);
        holder.getChildTransformNodes(false).forEach((node) => node.computeWorldMatrix(true));
        holder.getChildMeshes(false).forEach((mesh) => { if (mesh.getTotalVertices() > 0) finish(mesh); });
        // Simple solid post instead of per-triangle collisions.
        const post = own(B.MeshBuilder.CreateCylinder(`explore-beacon-collider-${beacon.location}`, { height: 2.8, diameter: 0.6, tessellation: 8 }, scene));
        post.position.set(beacon.x, holder.position.y + 1.4, beacon.z);
        post.material = poleMaterial;
        post.isVisible = false;
        finish(post, { collide: true, cast: false });
        count += 1;
      });
      return count;
    }

    // Layered Hills: the package's collision mesh is both the solid shape and
    // the visible hills. Its 92k-triangle "visual" export was compared and not
    // used: no normals, one neutral-grey material, a flat skirt that floats
    // above this terrain, and 24 loose scrap pieces that read as salvage.
    async function placeHills() {
      const model = await importModel("explorationHillsCollider");
      if (!model) return false;
      const { center, rotationY, footprint } = D.HILLS;
      seat(model, center.x, center.z, rotationY, groundUnder(terrain, center.x, center.z, Math.min(footprint.halfDepth, 40)) - 0.3);
      model.meshes.forEach((mesh) => {
        mesh.material = rockMat;
        finish(mesh, { collide: true, cast: false });
      });
      return true;
    }

    const ready = (async () => {
      try { placed.rock = await placeLandmark("rock"); } catch (error) { console.warn("Layered rock formation not placed.", error && error.message); }
      try { placed.meteorites = await placeLandmark("meteorites"); } catch (error) { console.warn("Meteorite field not placed.", error && error.message); }
      try { placed.beacons = await placeBeacons(); } catch (error) { console.warn("Exploration beacons not placed.", error && error.message); }
      try { placed.hills = await placeHills(); } catch (error) { console.warn("Layered hills not placed.", error && error.message); }
      return { ...placed };
    })();

    /** Hides collected samples and opens recovered caches (also after loading a save). */
    function sync(explorationApi) {
      D.SAMPLES.forEach((sample) => {
        const collected = explorationApi.isCollected(sample.id);
        sampleMeshes[sample.id].forEach((mesh) => mesh.setEnabled(!collected));
        const point = points.find((item) => item.targetId === sample.id);
        if (point) point.hidden = collected;
      });
      D.CACHES.forEach((cache) => {
        const recovered = explorationApi.isRecovered(cache.id);
        const parts = cacheMeshes[cache.id];
        parts.lid.unfreezeWorldMatrix();
        parts.lid.position.y = parts.y + (recovered ? 0.7 : 0.585);
        parts.lid.rotation.set(recovered ? -0.9 : 0, parts.yaw, 0);
        parts.lid.computeWorldMatrix(true);
        parts.body.material = recovered ? openMat : crateMat;
        const point = points.find((item) => item.targetId === cache.id);
        if (point) point.hidden = recovered;
      });
    }

    function dispose() {
      disposed = true;
      owned.slice().reverse().forEach((thing) => { try { if (!thing.isDisposed || !thing.isDisposed()) thing.dispose(); } catch (error) { /* already gone with the scene */ } });
      owned.length = 0;
    }

    return {
      ready,
      sync,
      dispose,
      get placed() { return { ...placed }; },
    };
  }

  root.ExplorationWorld = Object.freeze({ interactions, create, groundUnder, LANDMARKS, SAMPLE_RADIUS, CACHE_RADIUS, TERMINAL_RADIUS });
})(globalThis);
