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
    status: "not-operational",
    interactions: Object.freeze([
      Object.freeze({ id: "rover-inspect", label: "Inspect rover", forward: 2.6, side: 0, radius: 2.0,
        info: "Exploration rover (temporary model). It is not operational yet: driving and science tools are coming in a later mission." }),
      Object.freeze({ id: "rover-science-bay", label: "Rover science bay (coming soon)", forward: -2.6, side: 0, radius: 1.8,
        info: "The rover's science bay will hold sample tools in a later mission. Nothing to do here yet." }),
    ]),
  });

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
      return { id: point.id, label: point.label, info: point.info, rover: true,
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

    const modelReady = loadModel(scene, root, placeholder, options).catch(() => false);
    return { root, collider, modelReady };
  }

  /** Swaps in mars-rover.glb when it exists (scaled to ROVER.length). */
  async function loadModel(scene, root, placeholder, options) {
    const assets = globalThis.ModelAssets;
    if (!assets || !assets.MANIFEST.rover.available) return false;
    const result = await assets.load(scene, "rover");
    if (!result) return false;
    const B = globalThis.BABYLON;
    const model = result.meshes[0];
    model.computeWorldMatrix(true);
    const { min, max } = model.getHierarchyBoundingVectors(true);
    const longest = Math.max(max.x - min.x, max.z - min.z) || 1;
    const holder = new B.TransformNode("marsRoverModel", scene);
    holder.parent = root;
    model.parent = holder;
    holder.scaling.setAll(ROVER.length / longest);
    model.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    result.meshes.forEach((mesh) => {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (mesh.material) mesh.material.maxSimultaneousLights = 3;
      if (options.shadows && mesh.getTotalVertices() > 0) options.shadows.addShadowCaster(mesh);
    });
    placeholder.forEach((mesh) => mesh.dispose());
    return true;
  }

  return Object.freeze({ ROVER, toWorld, interactions, create });
});
