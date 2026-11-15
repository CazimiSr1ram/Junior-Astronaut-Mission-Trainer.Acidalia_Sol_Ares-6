/*
 * Temporary habitat: an inflatable crew shelter the crew set up after landing.
 *
 * VISUALS + LAYOUT ONLY. Gameplay stays in the existing systems:
 *   - airlock steps and atmosphere: habitat-systems.js (unchanged)
 *   - resting and sleeping:         rest-system.js (unchanged; beds are its rest points)
 *   - resources and survival:       mission-state.js (shared base supplies; this
 *                                   shelter produces nothing)
 *
 * Replacing it with the final Blender habitat (.glb) later: keep LAYOUT (or
 * update its points) and the interaction ids, and swap create()'s meshes. The
 * collider named "marsHabitat" and the interior radius are what the rest of
 * the game relies on.
 *
 * Exposes TempHabitat in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TempHabitat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const freezeDeep = (value) => {
    Object.values(value).forEach((child) => { if (child && typeof child === "object") freezeDeep(child); });
    return Object.freeze(value);
  };

  // Local coordinates relative to the habitat centre (metres). The airlock
  // faces -z (towards the lander); +z is the back wall.
  const LAYOUT = freezeDeep({
    shellRadius: 4,          // collision wall
    interiorRadius: 3.6,     // "inside the habitat" for safety, beds and ground height
    floorHeight: 0.35,       // floor top above the terrain at the centre
    airlockZ: -4.6,
    entry: { id: "habitat-entry", label: "Temporary habitat airlock", x: 0, z: -6.5, radius: 2 },
    exit: { id: "habitat-exit", label: "Use habitat airlock", x: 0, z: -2.5, radius: 1.5 },
    // Sleeping area: configurable sleeping-pod slots against the back wall,
    // entered from the front (-z). Each slot shows one pod from the pod model
    // (ModelAssets "pods"), or a procedural placeholder pod of the same size if
    // the model cannot load. width = x, depth = z, height above the floor (m).
    beds: [
      { id: "habitat-bed", label: "SLEEP POD 1", x: 0.6, z: 2.1, width: 1.08, depth: 2.5, height: 1.9, approachZ: 0.25, radius: 1.0 },
      { id: "habitat-bed-2", label: "SLEEP POD 2", x: -0.6, z: 2.1, width: 1.08, depth: 2.5, height: 1.9, approachZ: 0.25, radius: 1.0 },
    ],
    // Pods.glb: three enclosed pods (bunk beds and a ladder inside) modelled at
    // about 4x human scale, with no materials. Two pods are used.
    podModel: {
      scale: 0.25,
      groups: [
        { shell: "Pod.01", beds: ["Bed.01", "Bed.02"], ladder: "Ladder.01" },
        { shell: "Pod.02", beds: ["Bed.03", "Bed.04"], ladder: "Ladder.02" },
      ],
    },
    lifeSupport: { id: "habitat-life-support", label: "Habitat life support", x: -3.15, z: -0.6, approachX: -2.25, radius: 1.3 },
    storage: { id: "habitat-storage", label: "Habitat storage", x: 3.15, z: -0.6, approachX: 2.25, radius: 1.3 },
  });

  // Construction: the crew assemble the habitat from an Earth-delivered kit
  // after Mission 1. Takes mission time but no base oxygen, water, food or power.
  const CONSTRUCTION = Object.freeze({ seconds: 12, kit: "Earth-delivered habitat kit (fabric shell, frame and air tanks)" });

  /**
   * Habitat stage from the (save-ready, plain data) mission state:
   * "packed" (cargo pallet), "building" (assembling) or "built".
   */
  function stage(state) {
    const habitat = state.systems && state.systems.habitat;
    if (!habitat) return "packed";
    if (habitat.constructed) return "built";
    return habitat.construction ? "building" : "packed";
  }

  /** Assembly progress 0..1. */
  function progress(state) {
    const habitat = state.systems && state.systems.habitat;
    if (!habitat) return 0;
    if (habitat.constructed) return 1;
    const job = habitat.construction;
    return job ? Math.min(1, job.elapsed / job.seconds) : 0;
  }

  /** Whether "Assemble Temporary Habitat" is available, with the exact reason if not. */
  function constructionStatus(state, missionOneComplete) {
    const habitat = state.systems && state.systems.habitat;
    if (state.missionComplete) return { available: false, reason: "This mission has ended." };
    if (habitat && habitat.constructed) return { available: false, reason: "The temporary habitat is already assembled." };
    if (habitat && habitat.construction) return { available: false, reason: "Assembly is already in progress." };
    if (habitat) return { available: false, reason: "A habitat is already set up here." };
    if (!missionOneComplete) return { available: false, reason: "Complete Mission 1 first. The crew assemble the habitat after the base is established." };
    return { available: true, reason: null };
  }

  /** Starts assembly (once). Does not take any base resources. */
  function startConstruction(state, { missionOneComplete } = {}) {
    const status = constructionStatus(state, missionOneComplete);
    if (!status.available) return { ok: false, message: status.reason };
    if (!state.systems) state.systems = {};
    state.systems.habitat = {
      kind: "temporary", constructed: false, pressurized: false, lifeSupport: false,
      construction: { elapsed: 0, seconds: CONSTRUCTION.seconds, startedSol: state.sol },
    };
    return { ok: true, message: `Assembling the temporary habitat from the ${CONSTRUCTION.kit}. This takes about ${CONSTRUCTION.seconds} seconds.` };
  }

  /**
   * Advances assembly by elapsed mission seconds (call from the shared time
   * observer). When finished the habitat is built, pressurised from its own
   * air tanks and connected to base power. Returns { completed }.
   */
  function advanceConstruction(state, seconds) {
    const habitat = state.systems && state.systems.habitat;
    const job = habitat && !habitat.constructed && habitat.construction;
    if (!job || !Number.isFinite(seconds) || seconds <= 0) return { completed: false };
    job.elapsed = Math.min(job.seconds, job.elapsed + seconds);
    if (job.elapsed < job.seconds) return { completed: false };
    habitat.constructed = true;
    habitat.pressurized = true;
    habitat.lifeSupport = true;
    habitat.builtSol = state.sol;
    delete habitat.construction;
    return { completed: true };
  }

  /**
   * Instantly marks the temporary habitat as assembled (tests / developer use).
   * Never overwrites an existing habitat state, and adds no resources: the
   * shelter shares the base's oxygen, water, food and power.
   */
  function assemble(state) {
    if (!state.systems) state.systems = {};
    if (state.systems.habitat) return false;
    state.systems.habitat = { kind: "temporary", constructed: true, pressurized: true, lifeSupport: true };
    return true;
  }

  /** Interaction points (world space) for the existing interaction system. */
  function interactions(center, eyeY = 1.5) {
    const B = globalThis.BABYLON;
    const at = (x, z) => new B.Vector3(center.x + x, center.y + LAYOUT.floorHeight + eyeY, center.z + z);
    return [
      { id: LAYOUT.entry.id, label: LAYOUT.entry.label, position: new B.Vector3(center.x + LAYOUT.entry.x, center.y + 1.5, center.z + LAYOUT.entry.z), radius: LAYOUT.entry.radius },
      { id: LAYOUT.exit.id, label: LAYOUT.exit.label, position: at(LAYOUT.exit.x, LAYOUT.exit.z), radius: LAYOUT.exit.radius },
      ...LAYOUT.beds.map((bed) => ({ id: bed.id, bed: "habitat", label: "Press E to Rest", position: at(bed.x, bed.approachZ), radius: bed.radius })),
      { id: LAYOUT.lifeSupport.id, label: LAYOUT.lifeSupport.label, position: at(LAYOUT.lifeSupport.approachX, LAYOUT.lifeSupport.z), radius: LAYOUT.lifeSupport.radius },
      { id: LAYOUT.storage.id, label: LAYOUT.storage.label, position: at(LAYOUT.storage.approachX, LAYOUT.storage.z), radius: LAYOUT.storage.radius },
    ];
  }

  /**
   * Loads Pods.glb (via ModelAssets) and places one pod per bed slot: scaled
   * to fit, standing on the floor, with simple materials (the model has none)
   * and the pod shell as its collision mesh. Resolves to [true|false] per slot.
   */
  async function loadPodModel(scene, ctx) {
    const B = globalThis.BABYLON;
    const spec = LAYOUT.podModel;
    const result = globalThis.ModelAssets ? await globalThis.ModelAssets.load(scene, "pods") : null;
    if (!result) return LAYOUT.beds.map(() => false);
    const byName = new Map(result.meshes.map((mesh) => [mesh.name, mesh]));
    const used = new Set();
    result.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const placed = LAYOUT.beds.map((bed, index) => {
      const group = spec.groups[index];
      const shell = group && byName.get(group.shell);
      if (!shell) return false;
      const members = [shell, ...group.beds.map((name) => byName.get(name)), byName.get(group.ladder)].filter(Boolean);
      members.forEach((mesh) => used.add(mesh));
      // Pivot at the bottom centre of the pod shell, in the loaded model's space.
      const box = shell.getBoundingInfo().boundingBox;
      const pivot = new B.TransformNode(`marsHabitatPodModel${index}`, scene);
      pivot.position.set(box.centerWorld.x, box.minimumWorld.y, box.centerWorld.z);
      pivot.computeWorldMatrix(true);
      members.forEach((mesh) => mesh.setParent(pivot));
      pivot.scaling.setAll(spec.scale);
      pivot.position.copyFrom(ctx.v3(bed.x, ctx.floorY, bed.z));
      pivot.computeWorldMatrix(true);
      if (ctx.parent) pivot.setParent(ctx.parent);
      shell.material = ctx.mat.podShell;
      shell.checkCollisions = true;
      group.beds.forEach((name) => { const mesh = byName.get(name); if (mesh) mesh.material = ctx.mat.cushion; });
      const ladder = byName.get(group.ladder);
      if (ladder) ladder.material = ctx.mat.frame;
      members.forEach((mesh) => {
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.computeWorldMatrix(true);
      });
      if (ctx.shadows) ctx.shadows.addShadowCaster(shell);
      return true;
    });
    // Remove the unused pod and bed, and the empty glTF root node.
    result.meshes.forEach((mesh) => { if (!used.has(mesh) && mesh.name !== "__root__") mesh.dispose(); });
    result.meshes.filter((mesh) => mesh.name === "__root__").forEach((root) => root.dispose(true));
    return placed;
  }

  /**
   * Builds the shelter meshes at `center` (terrain point under the habitat).
   * options: { shadows, frame (material), accent (material) }
   */
  function create(scene, center, options = {}) {
    const B = globalThis.BABYLON;
    const v3 = (x, y, z) => new B.Vector3(center.x + x, center.y + y, center.z + z);
    const meshes = [];
    // Everything of the assembled shelter hangs under this node, so it can be
    // hidden (packed), inflated (building) and shown (built) as one.
    const shelterRoot = new B.TransformNode("marsHabitatShelter", scene);
    shelterRoot.position.copyFrom(center);
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
      fabric: pbr("tempHabFabric", [0.9, 0.91, 0.9], 0.92, 0, [0.05, 0.05, 0.05]),
      fabricBand: pbr("tempHabBand", [0.62, 0.65, 0.68], 0.8),
      strap: pbr("tempHabStrap", [0.2, 0.27, 0.38], 0.7),
      floor: pbr("tempHabFloor", [0.42, 0.45, 0.48], 0.75, 0.1, [0.05, 0.055, 0.06]),
      interior: pbr("tempHabInterior", [0.78, 0.8, 0.82], 0.6, 0.05, [0.06, 0.065, 0.07]),
      cushion: pbr("tempHabCushion", [0.16, 0.33, 0.55], 0.85, 0, [0.02, 0.04, 0.07]),
      podShell: pbr("tempHabPodShell", [0.86, 0.88, 0.9], 0.55, 0.05, [0.05, 0.05, 0.055]),
      crate: pbr("tempHabCrate", [0.55, 0.58, 0.6], 0.6, 0.2, [0.04, 0.04, 0.045]),
      frame: options.frame || pbr("tempHabFrame", [0.5, 0.52, 0.55], 0.4, 0.7),
      accent: options.accent || pbr("tempHabAccent", [0.75, 0.12, 0.14], 0.5, 0.1),
    };
    const glow = new B.StandardMaterial("tempHabLightStrip", scene);
    glow.emissiveColor = new B.Color3(0.55, 0.85, 1);
    glow.disableLighting = true;
    const lamp = new B.StandardMaterial("tempHabStatusLamp", scene);
    lamp.emissiveColor = new B.Color3(0.15, 0.9, 0.35);
    lamp.disableLighting = true;

    function add(mesh, material, { collide = false, caster = true, visible = true } = {}) {
      mesh.material = material;
      mesh.checkCollisions = collide;
      mesh.isVisible = visible;
      mesh.receiveShadows = true;
      if (caster && visible && options.shadows) options.shadows.addShadowCaster(mesh);
      meshes.push(mesh);
      return mesh;
    }
    function box(name, w, h, d, material, x, y, z, opts) {
      const mesh = add(B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene), material, opts);
      mesh.position.copyFrom(v3(x, y, z));
      return mesh;
    }

    // --- Shell -------------------------------------------------------------------
    // Invisible collision wall (keeps the original name other code relies on).
    const collider = add(B.MeshBuilder.CreateCylinder("marsHabitat",
      { diameter: LAYOUT.shellRadius * 2, height: 3.2, tessellation: 24, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.DOUBLESIDE }, scene),
    mat.fabric, { collide: true, visible: false });
    collider.position.copyFrom(v3(0, 1.6, 0));
    // Inflatable dome: a soft, slightly flattened half-sphere on a low wall.
    const wall = add(B.MeshBuilder.CreateCylinder("marsHabitatWall",
      { diameter: 8.2, height: 1.0, tessellation: 40, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.DOUBLESIDE }, scene), mat.fabric);
    wall.position.copyFrom(v3(0, 0.5, 0));
    const dome = add(B.MeshBuilder.CreateSphere("marsHabitatDome",
      { diameter: 8.2, slice: 0.5, segments: 28, sideOrientation: B.Mesh.DOUBLESIDE }, scene), mat.fabric);
    dome.position.copyFrom(v3(0, 1.0, 0));
    dome.scaling.y = 0.72;
    // Pressure band and restraint straps (the "inflatable" look).
    const band = add(B.MeshBuilder.CreateTorus("marsHabitatBand", { diameter: 8.24, thickness: 0.16, tessellation: 40 }, scene), mat.strap, { caster: false });
    band.position.copyFrom(v3(0, 1.0, 0));
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI;
      // One strap over the dome along a meridian (side to side through the top).
      const path = [];
      const R = 4.14;
      for (let s = 0; s <= 16; s += 1) {
        const phi = (s / 16) * Math.PI;
        const r = R * Math.cos(phi);
        path.push(v3(Math.cos(angle) * r, 1.0 + 0.72 * R * Math.sin(phi), Math.sin(angle) * r));
      }
      add(B.MeshBuilder.CreateTube(`marsHabitatStrap${i}`, { path, radius: 0.045, tessellation: 6 }, scene), mat.strap, { caster: false });
    }
    // Footing ring and ground anchors with guy lines.
    const footing = add(B.MeshBuilder.CreateCylinder("marsHabitatFooting", { diameter: 8.8, height: 0.35, tessellation: 40 }, scene), mat.fabricBand, { caster: false });
    footing.position.copyFrom(v3(0, 0.17, 0));
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      if (Math.abs(Math.sin(angle) + 1) < 0.2) continue; // keep the airlock side clear
      const top = v3(Math.cos(angle) * 3.7, 2.0, Math.sin(angle) * 3.7);
      const stake = v3(Math.cos(angle) * 6.0, 0.05, Math.sin(angle) * 6.0);
      add(B.MeshBuilder.CreateTube(`marsHabitatGuy${i}`, { path: [top, stake], radius: 0.015, tessellation: 4 }, scene), mat.strap, { caster: false });
      box(`marsHabitatStake${i}`, 0.12, 0.25, 0.12, mat.frame, Math.cos(angle) * 6.0, 0.12, Math.sin(angle) * 6.0, { caster: false });
    }

    // --- Airlock module (towards the lander) ----------------------------------------
    const z = LAYOUT.airlockZ;
    box("marsHabitatAirlock", 2.4, 2.6, 2.4, mat.fabric, 0, 1.3, z, { collide: true, visible: false });
    const tunnel = add(B.MeshBuilder.CreateCylinder("marsHabitatAirlockTunnel",
      { diameter: 2.6, height: 2.4, tessellation: 28 }, scene), mat.fabric);
    tunnel.rotation.x = Math.PI / 2;
    tunnel.position.copyFrom(v3(0, 1.3, z));
    [z - 1.2, z + 1.2].forEach((rz, i) => {
      const ring = add(B.MeshBuilder.CreateTorus(`marsHabitatAirlockRing${i}`, { diameter: 2.62, thickness: 0.14, tessellation: 28 }, scene), mat.frame, { caster: false });
      ring.rotation.x = Math.PI / 2;
      ring.position.copyFrom(v3(0, 1.3, rz));
    });
    box("marsHabitatAirlockSkid", 2.4, 0.2, 2.6, mat.frame, 0, 0.1, z, { caster: false });
    box("marsHabitatHatch", 1.2, 2.0, 0.08, mat.accent, 0, 1.1, z - 1.23, { caster: false });
    const statusLamp = add(B.MeshBuilder.CreateSphere("marsHabitatStatusLamp", { diameter: 0.16, segments: 8 }, scene), lamp, { caster: false });
    statusLamp.position.copyFrom(v3(0.85, 2.25, z - 1.3));

    // Sign above the airlock (sharp text texture).
    const signW = 2.6, signH = 0.5;
    const texture = globalThis.GraphicsQuality
      ? globalThis.GraphicsQuality.createTextTexture("tempHabSignTexture", 1040, 200, scene, 1.5)
      : new B.DynamicTexture("tempHabSignTexture", { width: 1040, height: 200 }, scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = "#0b1d33"; ctx.fillRect(0, 0, 1040, 200);
    ctx.strokeStyle = "#4cc9f0"; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 1024, 184);
    ctx.fillStyle = "#f8fbff"; ctx.font = "700 74px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TEMP HAB · CREW SHELTER", 520, 104);
    texture.update();
    const signMaterial = new B.StandardMaterial("tempHabSignMaterial", scene);
    signMaterial.diffuseTexture = texture;
    signMaterial.emissiveTexture = texture;
    signMaterial.emissiveColor = new B.Color3(0.8, 0.85, 0.9);
    signMaterial.disableLighting = true;
    const sign = add(B.MeshBuilder.CreatePlane("marsHabitatSign", { width: signW, height: signH }, scene), signMaterial, { caster: false });
    sign.position.copyFrom(v3(0, 2.85, z - 1.32));
    sign.rotation.y = Math.PI; // readable from the lander side (-z)
    sign.isPickable = false;

    // Supply crates left outside after unloading.
    const crateA = box("marsHabitatCrateA", 0.9, 0.7, 0.9, mat.crate, 2.3, 0.35, z - 0.6, { collide: true });
    const crateB = box("marsHabitatCrateB", 0.7, 0.5, 0.7, mat.crate, 2.35, 0.95, z - 0.6, { collide: true });
    [crateA, crateB].forEach((crate) => { crate.metadata = { standable: true }; }); // can be jumped onto

    // --- Interior ------------------------------------------------------------------
    const floorY = LAYOUT.floorHeight;
    const floor = add(B.MeshBuilder.CreateCylinder("marsHabitatFloor", { diameter: 7.8, height: 0.1, tessellation: 40 }, scene), mat.floor, { caster: false });
    floor.position.copyFrom(v3(0, floorY - 0.05, 0));
    const floorRing = add(B.MeshBuilder.CreateTorus("marsHabitatFloorRing", { diameter: 5.2, thickness: 0.04, tessellation: 40 }, scene), glow, { caster: false });
    floorRing.position.copyFrom(v3(0, floorY + 0.005, 0));
    floorRing.scaling.y = 0.2;
    // Ceiling light strip ring (emissive, no extra light source for performance).
    const ceilingRing = add(B.MeshBuilder.CreateTorus("marsHabitatCeilingLight", { diameter: 3.2, thickness: 0.07, tessellation: 32 }, scene), glow, { caster: false });
    ceilingRing.position.copyFrom(v3(0, 3.45, 0));

    // Sleeping area: one pod per bed slot. Placeholder pods are built now and
    // replaced by the pod model once it has loaded (same size and position).
    function podSign(bed, index, frontZ) {
      const tex = globalThis.GraphicsQuality
        ? globalThis.GraphicsQuality.createTextTexture(`tempHabPodSign${index}`, 512, 128, scene, 1.5)
        : new B.DynamicTexture(`tempHabPodSign${index}`, { width: 512, height: 128 }, scene, true);
      const c = tex.getContext();
      c.fillStyle = "#0b1d33"; c.fillRect(0, 0, 512, 128);
      c.strokeStyle = "#4cc9f0"; c.lineWidth = 8; c.strokeRect(6, 6, 500, 116);
      c.fillStyle = "#f8fbff"; c.font = "700 56px Arial, Helvetica, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(bed.label, 256, 68);
      tex.update();
      const m = new B.StandardMaterial(`tempHabPodSignMaterial${index}`, scene);
      m.diffuseTexture = tex; m.emissiveTexture = tex; m.emissiveColor = new B.Color3(0.8, 0.85, 0.9); m.disableLighting = true;
      const plane = add(B.MeshBuilder.CreatePlane(`marsHabitatPodSign${index}`, { width: 0.9, height: 0.225 }, scene), m, { caster: false });
      plane.position.copyFrom(v3(bed.x, floorY + bed.height - 0.3, frontZ - 0.03));
      plane.isPickable = false;
      const strip = add(B.MeshBuilder.CreateBox(`marsHabitatPodLight${index}`, { width: 0.7, height: 0.035, depth: 0.03 }, scene), glow, { caster: false });
      strip.position.copyFrom(v3(bed.x, floorY + bed.height - 0.5, frontZ - 0.03));
    }
    const placeholders = LAYOUT.beds.map((bed, index) => {
      const frontZ = bed.z - bed.depth / 2;
      const parts = [];
      const piece = (mesh, material, x, y, zz, opts) => { add(mesh, material, opts); mesh.position.copyFrom(v3(x, y, zz)); parts.push(mesh); return mesh; };
      // Pod shell (collidable), dark opening panel and the mattress edge at the front.
      piece(B.MeshBuilder.CreateBox(`marsHabitatBed${index ? index + 1 : ""}`, { width: bed.width, height: bed.height, depth: bed.depth }, scene),
        mat.podShell, bed.x, floorY + bed.height / 2, bed.z, { collide: true });
      piece(B.MeshBuilder.CreateBox(`marsHabitatPodOpening${index}`, { width: bed.width - 0.2, height: 0.75, depth: 0.02 }, scene),
        mat.strap, bed.x, floorY + 0.65, frontZ - 0.011, { caster: false });
      piece(B.MeshBuilder.CreateBox(`marsHabitatMattress${index ? index + 1 : ""}`, { width: bed.width - 0.28, height: 0.12, depth: 0.04 }, scene),
        mat.cushion, bed.x, floorY + 0.38, frontZ - 0.03, { caster: false });
      podSign(bed, index, frontZ);
      return parts;
    });

    // Swap in the pod model when it has loaded; keep placeholders otherwise.
    const podsReady = loadPodModel(scene, { v3, floorY, mat, shadows: options.shadows, parent: shelterRoot })
      .then((placed) => {
        placed.forEach((ok, index) => { if (ok) placeholders[index].forEach((mesh) => mesh.dispose()); });
        return placed;
      })
      .catch((error) => {
        console.warn("Sleeping pods model not placed; keeping placeholder pods.", error && error.message);
        return LAYOUT.beds.map(() => false);
      });

    // Life-support / control panel (left wall).
    const ls = LAYOUT.lifeSupport;
    box("marsHabitatLifeSupport", 0.5, 1.6, 1.4, mat.frame, ls.x, floorY + 0.8, ls.z, { collide: true });
    const screenTexture = globalThis.GraphicsQuality
      ? globalThis.GraphicsQuality.createTextTexture("tempHabLifeSupportScreen", 512, 320, scene, 2)
      : new B.DynamicTexture("tempHabLifeSupportScreen", { width: 512, height: 320 }, scene, true);
    const sctx = screenTexture.getContext();
    sctx.fillStyle = "#03101e"; sctx.fillRect(0, 0, 512, 320);
    sctx.strokeStyle = "#31c8ff"; sctx.lineWidth = 6; sctx.strokeRect(8, 8, 496, 304);
    sctx.fillStyle = "#bdefff"; sctx.font = "600 40px Arial"; sctx.fillText("LIFE SUPPORT", 28, 64);
    sctx.font = "28px monospace"; sctx.fillStyle = "#7fd4ff";
    ["Shared base supply", "Press E for readings", "O2 · PWR · CO2"].forEach((text, i) => sctx.fillText(text, 28, 130 + i * 52));
    screenTexture.update();
    const screenMaterial = new B.StandardMaterial("tempHabLifeSupportScreenMaterial", scene);
    screenMaterial.diffuseTexture = screenTexture;
    screenMaterial.emissiveTexture = screenTexture;
    screenMaterial.emissiveColor = new B.Color3(0.8, 0.9, 1);
    screenMaterial.disableLighting = true;
    const screen = add(B.MeshBuilder.CreatePlane("marsHabitatLifeSupportScreen", { width: 1.1, height: 0.7 }, scene), screenMaterial, { caster: false });
    screen.position.copyFrom(v3(ls.x + 0.26, floorY + 1.25, ls.z));
    screen.rotation.y = -Math.PI / 2; // faces +x, into the habitat

    // Storage shelves with supply crates (right wall).
    const st = LAYOUT.storage;
    box("marsHabitatStorage", 0.6, 1.8, 1.5, mat.frame, st.x, floorY + 0.9, st.z, { collide: true, caster: false });
    [[0.35, -0.35], [0.35, 0.35], [1.05, 0], [1.6, -0.3]].forEach(([y, dz], i) => {
      box(`marsHabitatStorageCrate${i}`, 0.5, i === 3 ? 0.3 : 0.45, 0.55, mat.crate, st.x - 0.05, floorY + y, st.z + dz, { caster: false });
    });
    box("marsHabitatStorageLabel", 0.02, 0.12, 1.2, mat.accent, st.x - 0.31, floorY + 1.95, st.z, { caster: false });

    // Gather the shelter under its root (keeps world positions).
    shelterRoot.computeWorldMatrix(true);
    meshes.forEach((mesh) => { if (!mesh.parent) mesh.setParent(shelterRoot); });

    // --- Packed cargo pallet (shown until the habitat is assembled) ---------------
    const palletRoot = new B.TransformNode("marsHabitatPallet", scene);
    palletRoot.position.copyFrom(v3(0, 0, LAYOUT.airlockZ + 0.4));
    const palletPart = (name, w, h, d, material, x, y, z, collide = false) => {
      const mesh = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      mesh.material = material;
      mesh.parent = palletRoot;
      mesh.position.set(x, y, z);
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.checkCollisions = collide;
      if (options.shadows) options.shadows.addShadowCaster(mesh);
      return mesh;
    };
    palletPart("marsHabitatPalletSkid", 2.8, 0.18, 2.0, mat.frame, 0, 0.09, 0);
    palletPart("marsHabitatPalletBundle", 2.3, 0.85, 1.5, mat.fabric, 0, 0.6, 0);
    [-0.7, 0, 0.7].forEach((x, i) => palletPart(`marsHabitatPalletStrap${i}`, 0.08, 0.88, 1.54, mat.strap, x, 0.6, 0));
    palletPart("marsHabitatPalletTank", 0.5, 0.5, 1.2, mat.crate, 1.2, 1.28, 0.1);
    palletPart("marsHabitatPalletCrate", 0.7, 0.55, 0.7, mat.crate, -0.9, 1.3, 0.25);
    // One simple collider for the whole pallet.
    const palletCollider = palletPart("marsHabitatPalletCollider", 2.8, 1.6, 2.0, mat.frame, 0, 0.8, 0, true);
    palletCollider.isVisible = false;
    const kitTexture = globalThis.GraphicsQuality
      ? globalThis.GraphicsQuality.createTextTexture("tempHabKitSign", 1024, 160, scene, 1.5)
      : new B.DynamicTexture("tempHabKitSign", { width: 1024, height: 160 }, scene, true);
    const kctx = kitTexture.getContext();
    kctx.fillStyle = "#0b1d33"; kctx.fillRect(0, 0, 1024, 160);
    kctx.strokeStyle = "#f2a900"; kctx.lineWidth = 10; kctx.strokeRect(8, 8, 1008, 144);
    kctx.fillStyle = "#f8fbff"; kctx.font = "700 60px Arial, Helvetica, sans-serif"; kctx.textAlign = "center"; kctx.textBaseline = "middle";
    kctx.fillText("TEMP HAB KIT · PACKED", 512, 84);
    kitTexture.update();
    const kitMaterial = new B.StandardMaterial("tempHabKitSignMaterial", scene);
    kitMaterial.diffuseTexture = kitTexture; kitMaterial.emissiveTexture = kitTexture;
    kitMaterial.emissiveColor = new B.Color3(0.8, 0.85, 0.9); kitMaterial.disableLighting = true;
    const kitSign = B.MeshBuilder.CreatePlane("marsHabitatPalletSign", { width: 1.8, height: 0.28 }, scene);
    kitSign.material = kitMaterial; kitSign.parent = palletRoot; kitSign.isPickable = false;
    kitSign.position.set(0, 0.62, -0.77);
    kitSign.rotation.y = Math.PI; // readable from the lander side

    /**
     * Shows the habitat stage: "packed" (pallet only), "building" (shelter
     * inflating from the pallet, not solid yet) or "built" (shelter only, solid).
     */
    let shownStage = null;
    let shownProgress = -1;
    function setSolid(solid) {
      shelterRoot.getChildMeshes().forEach((mesh) => {
        if (!mesh.metadata) mesh.metadata = {};
        if (mesh.metadata.habitatSolid === undefined) mesh.metadata.habitatSolid = mesh.checkCollisions;
        mesh.checkCollisions = solid && mesh.metadata.habitatSolid;
      });
    }
    function setStage(nextStage, amount = 0) {
      const p = Math.max(0, Math.min(1, amount));
      if (nextStage === shownStage && (nextStage !== "building" || Math.abs(p - shownProgress) < 0.002)) return;
      if (nextStage === "built") {
        shelterRoot.setEnabled(true);
        shelterRoot.scaling.setAll(1);
        setSolid(true);
        palletRoot.setEnabled(false);
      } else if (nextStage === "building") {
        shelterRoot.setEnabled(true);
        setSolid(false);
        const eased = p * p * (3 - 2 * p);
        shelterRoot.scaling.set(0.35 + 0.65 * eased, 0.05 + 0.95 * eased, 0.35 + 0.65 * eased);
        palletRoot.setEnabled(true);
      } else {
        shelterRoot.setEnabled(false);
        palletRoot.setEnabled(true);
      }
      shownStage = nextStage;
      shownProgress = p;
    }
    setStage("packed");

    return { collider, meshes, interactions: interactions(center), podsReady, setStage, get stage() { return shownStage; } };
  }

  return Object.freeze({ LAYOUT, CONSTRUCTION, stage, progress, constructionStatus, startConstruction, advanceConstruction,
    assemble, interactions, create, loadPodModel });
});
