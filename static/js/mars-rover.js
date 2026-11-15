/*
 * Temporary exploration rover: a parked, non-driving placeholder.
 *
 * Visual presence + collision + named interaction points only. There is no
 * vehicle controller. Later it can become an exploration vehicle, a science
 * station or part of a mission by reusing ROVER (position, size, interaction
 * ids) and replacing the visuals.
 *
 * Final model: static/assets/models/rover/mars-rover.glb (ModelAssets "rover").
 * It does not exist yet, so the procedural placeholder is used. When the file
 * is exported and ModelAssets marks it available, create() loads it, scales it
 * to ROVER.length and hides the placeholder; the collider and interaction
 * points stay the same. (That model path is untested until the file exists.)
 *
 * Exposes MarsRover in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MarsRover = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROVER = Object.freeze({
    // Parked on the flat landing pad beside the walkway from the lander to the
    // habitat (clear of the lander, comms dish and survey markers).
    x: 8, z: -12,
    heading: -0.35,            // radians; the rover's front (+z) points towards the habitat
    length: 3.0, width: 2.2, height: 1.4, wheelRadius: 0.35,
    drivable: false,           // robotic science rover: never driven by the player
    // mars-rover.glb (trimesh export): Z-up, robotic arm at the model's -x end.
    // Laid flat (-90° about X) and turned so the arm end is the rover's front (+z).
    model: Object.freeze({ upFixX: -Math.PI / 2, yaw: Math.PI / 2 }),
    // Colours by part name (the model ships without materials).
    colors: Object.freeze({ white: [0.9, 0.9, 0.88], dark: [0.18, 0.19, 0.2], ivory: [0.85, 0.82, 0.72], gold: [0.8, 0.62, 0.2],
      gold_light: [0.9, 0.75, 0.4], silver: [0.7, 0.72, 0.75], rubber: [0.07, 0.07, 0.08], black: [0.05, 0.05, 0.06], blue: [0.1, 0.25, 0.55] }),
    interactions: Object.freeze([
      // Both points open the same rover control panel (one E press = one panel).
      Object.freeze({ id: "rover-inspect", label: "Rover controls", forward: 2.6, side: 0, radius: 2.0, panel: "rover" }),
      Object.freeze({ id: "rover-science-bay", label: "Rover science instruments", forward: -2.6, side: 0, radius: 1.8, panel: "rover" }),
    ]),
  });

  // --- Power (save-ready: state.systems.rover.powered) -----------------------------
  // Turning the rover on lights its indicators and starts its science
  // instruments; it does not draw on base resources and cannot be driven.
  function isPowered(state) {
    return Boolean(state && state.systems && state.systems.rover && state.systems.rover.powered === true);
  }

  function setPowered(state, on) {
    const next = Boolean(on);
    if (isPowered(state) === next) {
      return { ok: false, powered: next, message: next ? "The rover is already powered on." : "The rover is already powered off." };
    }
    if (!state.systems) state.systems = {};
    state.systems.rover = { ...(state.systems.rover || {}), powered: next };
    return { ok: true, powered: next, message: next
      ? "Rover powered ON: indicator lights on, mast camera and sensor package running."
      : "Rover powered OFF: indicator lights and science instruments switched off." };
  }

  function statusRows(state) {
    const on = isPowered(state);
    return [
      ["Power", on ? "ON" : "OFF"],
      ["Indicator lights", on ? "On (green)" : "Off"],
      ["Science instruments", on ? "Active: mast camera and rotating sensor scanning" : "Off"],
      ["Driving", "Not drivable: robotic science rover"],
    ];
  }

  /** World position of a point given in the rover's frame (forward = +z, side = +x). */
  function toWorld(forward, side) {
    const s = Math.sin(ROVER.heading), c = Math.cos(ROVER.heading);
    return { x: ROVER.x + side * c + forward * s, z: ROVER.z - side * s + forward * c };
  }

  /** Interaction points for the existing interaction system. */
  function interactions(terrain) {
    const B = globalThis.BABYLON;
    return ROVER.interactions.map((point) => {
      const p = toWorld(point.forward, point.side);
      return { id: point.id, label: point.label, panel: point.panel, rover: true,
        position: new B.Vector3(p.x, terrain.heightAt(p.x, p.z) + 1.5, p.z), radius: point.radius };
    });
  }

  /**
   * Builds the parked rover on the terrain. options: { shadows }.
   * Returns { root, collider, modelReady } (modelReady resolves to whether the
   * final .glb replaced the placeholder; false while the file is missing).
   */
  function create(scene, terrain, options = {}) {
    const B = globalThis.BABYLON;
    const pbr = (name, rgb, roughness, metallic = 0, emissive = null) => {
      const material = new B.PBRMaterial(name, scene);
      material.albedoColor = new B.Color3(...rgb);
      material.roughness = roughness;
      material.metallic = metallic;
      if (emissive) material.emissiveColor = new B.Color3(...emissive);
      material.maxSimultaneousLights = 3;
      return material;
    };
    const mat = {
      body: pbr("roverBody", [0.88, 0.89, 0.9], 0.55, 0.1),
      panel: pbr("roverPanel", [0.07, 0.24, 0.5], 0.5, 0.2),
      dark: pbr("roverDark", [0.12, 0.13, 0.15], 0.7, 0.3),
      tyre: pbr("roverTyre", [0.09, 0.09, 0.1], 0.9),
      metal: pbr("roverMetal", [0.6, 0.62, 0.65], 0.35, 0.8),
      solar: pbr("roverSolar", [0.04, 0.08, 0.2], 0.25, 0.4),
      accent: pbr("roverAccent", [0.75, 0.12, 0.14], 0.5, 0.1),
    };
    const lamp = new B.StandardMaterial("roverStatusLamp", scene);
    lamp.emissiveColor = new B.Color3(1, 0.62, 0.1); // amber = not operational
    lamp.disableLighting = true;

    // Root on the terrain, tilted to match the ground under the wheels.
    const { length: L, width: W, wheelRadius: R } = ROVER;
    const corner = (f, s) => { const p = toWorld(f, s); return terrain.heightAt(p.x, p.z); };
    const hf = (corner(L / 2, 0) + corner(L / 2, W / 2) + corner(L / 2, -W / 2)) / 3;
    const hb = (corner(-L / 2, 0) + corner(-L / 2, W / 2) + corner(-L / 2, -W / 2)) / 3;
    const hl = (corner(0, -W / 2) + corner(L / 2, -W / 2) + corner(-L / 2, -W / 2)) / 3;
    const hr = (corner(0, W / 2) + corner(L / 2, W / 2) + corner(-L / 2, W / 2)) / 3;
    const root = new B.TransformNode("marsRover", scene);
    root.position.set(ROVER.x, (hf + hb + hl + hr) / 4, ROVER.z);
    root.rotation.set(-Math.atan2(hf - hb, L), ROVER.heading, Math.atan2(hr - hl, W));

    const placeholder = [];
    function part(mesh, material, x, y, z, { caster = true } = {}) {
      mesh.parent = root;
      mesh.position.set(x, y, z);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (caster && options.shadows) options.shadows.addShadowCaster(mesh);
      placeholder.push(mesh);
      return mesh;
    }
    const box = (name, w, h, d, material, x, y, z, opts) => part(B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene), material, x, y, z, opts);

    // Chassis and body.
    const deckY = R * 2 + 0.15;
    box("roverChassis", W - 0.5, 0.25, L - 0.2, mat.dark, 0, R + 0.35, 0);
    box("roverBody", W - 0.7, 0.5, L - 0.6, mat.body, 0, deckY + 0.1, -0.1);
    box("roverSidePanelL", 0.04, 0.32, L - 0.9, mat.panel, -(W - 0.7) / 2 - 0.02, deckY + 0.1, -0.1, { caster: false });
    box("roverSidePanelR", 0.04, 0.32, L - 0.9, mat.panel, (W - 0.7) / 2 + 0.02, deckY + 0.1, -0.1, { caster: false });
    box("roverSolarDeck", W - 0.3, 0.05, L - 0.9, mat.solar, 0, deckY + 0.38, -0.35);
    box("roverStripe", W - 0.68, 0.05, 0.08, mat.accent, 0, deckY + 0.36, L / 2 - 0.42, { caster: false });

    // Six wheels on rocker arms.
    [-1, 1].forEach((side) => {
      const x = side * (W / 2 - 0.12);
      box(`roverRocker${side}`, 0.08, 0.1, L - 0.4, mat.metal, side * (W / 2 - 0.32), R + 0.42, 0, { caster: false });
      [-1, 0, 1].forEach((slot) => {
        const z = slot * (L / 2 - 0.35);
        const tyre = part(B.MeshBuilder.CreateCylinder(`roverWheel${side}${slot}`, { diameter: R * 2, height: 0.26, tessellation: 18 }, scene), mat.tyre, x, R, z);
        tyre.rotation.z = Math.PI / 2;
        const hub = part(B.MeshBuilder.CreateCylinder(`roverHub${side}${slot}`, { diameter: R, height: 0.28, tessellation: 12 }, scene), mat.metal, x, R, z, { caster: false });
        hub.rotation.z = Math.PI / 2;
      });
    });

    // Camera mast, high-gain antenna and status lamp.
    box("roverMast", 0.08, 0.9, 0.08, mat.metal, -0.45, deckY + 0.8, L / 2 - 0.6);
    box("roverCameraHead", 0.38, 0.18, 0.2, mat.dark, -0.45, deckY + 1.3, L / 2 - 0.55);
    const dish = part(B.MeshBuilder.CreateCylinder("roverAntenna", { diameterTop: 0.55, diameterBottom: 0.1, height: 0.12, tessellation: 20 }, scene), mat.body, 0.5, deckY + 0.75, -0.6);
    dish.rotation.x = -0.5;
    box("roverAntennaPost", 0.06, 0.35, 0.06, mat.metal, 0.5, deckY + 0.55, -0.6, { caster: false });
    const status = part(B.MeshBuilder.CreateSphere("roverStatusLamp", { diameter: 0.12, segments: 8 }, scene), lamp, 0.55, deckY + 0.42, L / 2 - 0.5, { caster: false });
    status.isPickable = false;

    // One invisible collider for the whole vehicle (keeps collision cheap).
    const collider = B.MeshBuilder.CreateBox("marsRoverCollider", { width: W, height: ROVER.height + 0.4, depth: L }, scene);
    collider.parent = root;
    collider.position.set(0, (ROVER.height + 0.4) / 2, 0);
    collider.isVisible = false;
    collider.isPickable = false;
    collider.checkCollisions = true;

    root.computeWorldMatrix(true);
    [...placeholder, collider].forEach((mesh) => { mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); });

    // --- Power indicators and science instruments (shared by placeholder and model) ---
    const lightOn = new B.StandardMaterial("roverIndicatorOn", scene);
    lightOn.emissiveColor = new B.Color3(0.2, 1, 0.45); lightOn.disableLighting = true;
    const lightOff = new B.StandardMaterial("roverIndicatorOff", scene);
    lightOff.emissiveColor = new B.Color3(0.18, 0.04, 0.03); lightOff.diffuseColor = new B.Color3(0.15, 0.05, 0.05);
    const sensorOn = new B.StandardMaterial("roverSensorOn", scene);
    sensorOn.emissiveColor = new B.Color3(0.35, 0.85, 1); sensorOn.disableLighting = true;
    const beamMat = new B.StandardMaterial("roverScanBeam", scene);
    beamMat.emissiveColor = new B.Color3(0.3, 0.8, 1); beamMat.disableLighting = true; beamMat.alpha = 0.22; beamMat.backFaceCulling = false;
    const power = new B.TransformNode("marsRoverPowerParts", scene);
    power.parent = root;
    const indicators = [-1, 1].map((side) => {
      const lamp = B.MeshBuilder.CreateSphere(`roverIndicator${side}`, { diameter: 0.13, segments: 8 }, scene);
      lamp.parent = power; lamp.isPickable = false; lamp.material = lightOff;
      return lamp;
    });
    const sensorMount = new B.TransformNode("roverSensorMount", scene);
    sensorMount.parent = power;
    const sensor = B.MeshBuilder.CreateCylinder("roverSensorPuck", { diameter: 0.28, height: 0.14, tessellation: 18 }, scene);
    sensor.parent = sensorMount; sensor.isPickable = false; sensor.material = mat.dark;
    const sensorEye = B.MeshBuilder.CreateBox("roverSensorEye", { width: 0.1, height: 0.06, depth: 0.04 }, scene);
    sensorEye.parent = sensorMount; sensorEye.position.set(0, 0, 0.14); sensorEye.isPickable = false; sensorEye.material = lightOff;
    // Instrument status ring around the base of the mast sensor (lit while running).
    const cameraLight = B.MeshBuilder.CreateTorus("roverCameraLight", { diameter: 0.36, thickness: 0.045, tessellation: 24 }, scene);
    cameraLight.parent = sensorMount; cameraLight.position.set(0, -0.06, 0); cameraLight.isPickable = false; cameraLight.material = lightOff;
    const beam = B.MeshBuilder.CreateDisc("roverScanBeam", { radius: 2.4, arc: 0.18, tessellation: 24 }, scene);
    beam.parent = power; beam.isPickable = false; beam.material = beamMat; beam.rotation.x = Math.PI / 2; beam.setEnabled(false);

    /**
     * Places the power parts (rover-local metres). surfaceY(x, z) returns the
     * height of the vehicle's top surface at that point, so every light sits
     * on the body instead of floating.
     */
    function placePowerParts({ halfX, rearZ, frontZ, surfaceY }) {
      const left = -halfX * 0.45, right = halfX * 0.45;
      indicators[0].position.set(left, surfaceY(left, rearZ) + 0.06, rearZ);
      indicators[1].position.set(right, surfaceY(right, rearZ) + 0.06, rearZ);
      const sensorZ = rearZ + 0.35;
      sensorMount.position.set(0, surfaceY(0, sensorZ) + 0.07, sensorZ);
      beam.position.set(0, 0.06, frontZ + 0.35);
      // The disc arc starts at +x and opens 65° towards +z: turn it to open straight ahead.
      beam.rotation.y = -Math.PI / 2 + Math.PI * 0.18;
    }
    const placeholderTop = deckY + 0.405; // solar deck top of the procedural rover
    placePowerParts({ halfX: (W - 0.3) / 2, rearZ: -(L - 0.9) / 2 - 0.1, frontZ: (L - 0.9) / 2 - 0.2, surfaceY: () => placeholderTop });
    placeholder.forEach((mesh) => { if (mesh.name === "roverStatusLamp") mesh.setEnabled(false); });

    let poweredShown = null;
    function showPower(on) {
      const value = Boolean(on);
      if (value === poweredShown) return;
      poweredShown = value;
      indicators.forEach((lamp) => { lamp.material = value ? lightOn : lightOff; });
      sensorEye.material = value ? sensorOn : lightOff;
      cameraLight.material = value ? sensorOn : lightOff;
      beam.setEnabled(value);
    }
    showPower(false);
    // Rotating sensor and a gently pulsing beacon while powered.
    let t = 0;
    scene.onBeforeRenderObservable.add(() => {
      if (!poweredShown) return;
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 0);
      t += dt;
      sensorMount.rotation.y += dt * 1.6;
      const pulse = 0.75 + 0.25 * Math.sin(t * 4);
      lightOn.emissiveColor.set(0.2 * pulse, 1 * pulse, 0.45 * pulse);
    });

    const modelReady = loadModel(scene, root, placeholder, options, mat, placePowerParts).catch((error) => {
      console.warn("Rover model could not be placed; keeping the placeholder rover.", error && error.message);
      return false;
    });
    return { root, collider, modelReady, showPower };
  }

  /**
   * Swaps in mars-rover.glb: laid flat, arm end forward, scaled to ROVER.length,
   * wheels on the ground, simple colours per part. The collider and interaction
   * points stay the same; the placeholder is removed only once the model is in.
   */
  async function loadModel(scene, root, placeholder, options, mat, placePowerParts) {
    const assets = globalThis.ModelAssets;
    if (!assets || !assets.MANIFEST.rover.available) return false;
    const result = await assets.load(scene, "rover");
    if (!result) return false;
    const B = globalThis.BABYLON;
    const glbRoot = result.meshes.find((mesh) => mesh.name === "__root__") || result.meshes[0];
    // Measure in a neutral frame: lay the model flat and turn it, unscaled.
    const holder = new B.TransformNode("marsRoverModel", scene);
    const upright = new B.TransformNode("marsRoverModelUpright", scene);
    upright.parent = holder;
    upright.rotation.x = ROVER.model.upFixX;
    glbRoot.parent = upright;
    holder.rotation.y = ROVER.model.yaw;
    holder.computeWorldMatrix(true);
    upright.computeWorldMatrix(true);
    result.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const { min, max } = holder.getHierarchyBoundingVectors(true);
    const length = Math.max(max.z - min.z, max.x - min.x) || 1;
    const scale = ROVER.length / length;
    // Centre it and stand the wheels on the ground, then attach to the rover root.
    const offset = new B.Vector3(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    const fit = new B.TransformNode("marsRoverModelFit", scene);
    holder.parent = fit;
    holder.position.copyFrom(offset);
    fit.scaling.setAll(scale);
    fit.parent = root;
    const colorMaterials = {};
    result.meshes.forEach((mesh) => {
      if (mesh.getTotalVertices() <= 0) return;
      const rgb = ROVER.colors[mesh.name];
      if (rgb) {
        if (!colorMaterials[mesh.name]) {
          const m = new B.PBRMaterial(`roverModel-${mesh.name}`, scene);
          m.albedoColor = new B.Color3(...rgb);
          m.roughness = mesh.name === "silver" || mesh.name.startsWith("gold") ? 0.35 : 0.65;
          m.metallic = mesh.name === "silver" || mesh.name.startsWith("gold") ? 0.6 : 0.05;
          m.maxSimultaneousLights = 3;
          colorMaterials[mesh.name] = m;
        }
        mesh.material = colorMaterials[mesh.name];
      } else if (!mesh.material) {
        mesh.material = mat.body;
      }
      mesh.isPickable = false;
      mesh.checkCollisions = false; // the rover's own box collider stays the solid shape
      mesh.receiveShadows = true;
      if (options.shadows) options.shadows.addShadowCaster(mesh);
    });
    // Measure the placed model in rover-local space to put the power parts on its body.
    fit.computeWorldMatrix(true);
    root.computeWorldMatrix(true);
    const toLocal = root.getWorldMatrix().clone().invert();
    function localBounds(meshes) {
      const lo = new B.Vector3(Infinity, Infinity, Infinity), hi = new B.Vector3(-Infinity, -Infinity, -Infinity);
      meshes.forEach((mesh) => {
        mesh.computeWorldMatrix(true);
        mesh.getBoundingInfo().boundingBox.vectorsWorld.forEach((corner) => {
          const p = B.Vector3.TransformCoordinates(corner, toLocal);
          lo.minimizeInPlace(p); hi.maximizeInPlace(p);
        });
      });
      return { lo, hi };
    }
    const parts = result.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    const whole = localBounds(parts);
    const body = localBounds(parts.filter((mesh) => ["white", "ivory"].includes(mesh.name)));
    // Height of the model's topmost surface at a rover-local (x, z): ray straight down.
    const toWorld = root.getWorldMatrix();
    const ray = new B.Ray(B.Vector3.Zero(), new B.Vector3(0, -1, 0), 20);
    const surfaceY = (x, z) => {
      ray.origin.copyFrom(B.Vector3.TransformCoordinates(new B.Vector3(x, whole.hi.y + 1, z), toWorld));
      const hit = scene.pickWithRay(ray, (mesh) => parts.includes(mesh));
      return hit && hit.hit ? B.Vector3.TransformCoordinates(hit.pickedPoint, toLocal).y : body.hi.y;
    };
    placePowerParts({ halfX: (body.hi.x - body.lo.x) / 2, rearZ: body.lo.z + 0.3, frontZ: body.hi.z - 0.1, surfaceY });
    result.meshes.forEach((mesh) => { mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); });
    placeholder.forEach((mesh) => mesh.dispose());
    return true;
  }

  return Object.freeze({ ROVER, toWorld, interactions, create, isPowered, setPowered, statusRows });
});
