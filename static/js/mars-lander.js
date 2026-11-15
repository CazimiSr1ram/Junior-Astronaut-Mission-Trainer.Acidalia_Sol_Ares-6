(function (root) {
  "use strict";

  /*
   * TEMPORARY procedural Mars lander / home base.
   *
   * Built only from Babylon.js primitives so gameplay can continue while the
   * final .glb model is designed. To replace it later, keep the returned API
   * (spawn, floorHeightAt, interactions, safeZone, setDoorOpen, setPowerOn,
   * setSuitStowed, setPanel, root) and swap
   * the geometry for a loaded model.
   *
   * Local frame: the airlock door faces local +z. Cabin floor is FLOOR_HEIGHT
   * above the ground and is reached by a ramp outside the airlock.
   */

  const APOTHEM = 4.2; // cabin centre to inside face of a wall panel
  const WALL_HEIGHT = 3.0;
  const WALL_THICKNESS = 0.2;
  const FLOOR_HEIGHT = 0.7;
  const DOOR_WIDTH = 1.6;
  const DOOR_HEIGHT = 2.3;
  const VESTIBULE_DEPTH = 1.6;
  const RAMP_LENGTH = 3.5;
  const RAMP_WIDTH = 1.6;
  // Home-base area marker only; no hazard protection is implemented yet.
  const SAFE_ZONE_RADIUS = 10;
  const PANEL_WIDTH = 2 * (APOTHEM + WALL_THICKNESS / 2) * Math.tan(Math.PI / 8) + 0.06;

  function v3(x, y, z) {
    return new BABYLON.Vector3(x, y, z);
  }

  function create(scene, options) {
    const { position, heightAt, materials, shadows } = options;
    const yaw = options.rotationY ?? 0;
    const groundY = heightAt(position.x, position.z);
    const root = new BABYLON.TransformNode("marsLanderBase", scene);
    root.position.set(position.x, groundY, position.z);
    root.rotation.y = yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const staticMeshes = [];

    const own = {
      floor: pbr("marsLanderFloor", [0.32, 0.34, 0.37], 0.7, 0.3),
      interior: pbr("marsLanderInterior", [0.78, 0.8, 0.82], 0.6, 0.05),
      hazard: pbr("marsLanderHazard", [0.85, 0.62, 0.1], 0.6, 0.05),
      crate: pbr("marsLanderCrate", [0.6, 0.62, 0.64], 0.5, 0.4),
      crateOrange: pbr("marsLanderCrateOrange", [0.8, 0.4, 0.12], 0.6, 0.05),
      glow: new BABYLON.StandardMaterial("marsLanderLightPanel", scene),
      window: pbr("marsLanderWindow", [0.08, 0.14, 0.2], 0.08, 0.6),
    };
    // Cabin lights start dim (emergency lighting) until main power is activated.
    own.glow.emissiveColor = new BABYLON.Color3(0.2, 0.22, 0.26);
    own.suit = pbr("marsLanderEvaSuit", [0.9, 0.9, 0.88], 0.6, 0.02);
    own.visor = pbr("marsLanderEvaVisor", [0.75, 0.52, 0.16], 0.12, 0.85);
    own.glow.disableLighting = true;
    own.interior.emissiveColor = new BABYLON.Color3(0.06, 0.065, 0.07);
    Object.values(own).forEach((material) => { material.maxSimultaneousLights = 3; });

    function pbr(name, rgb, roughness, metallic) {
      const material = new BABYLON.PBRMaterial(name, scene);
      material.albedoColor = new BABYLON.Color3(...rgb);
      material.roughness = roughness;
      material.metallic = metallic;
      return material;
    }

    function add(mesh, material, local, { collide = false, caster = true, rotation = null, parent = root } = {}) {
      mesh.parent = parent;
      mesh.position.copyFrom(local);
      if (rotation) mesh.rotation.copyFrom(rotation);
      mesh.material = material;
      mesh.checkCollisions = collide;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      if (caster) shadows.addShadowCaster(mesh);
      if (parent === root) staticMeshes.push(mesh);
      return mesh;
    }

    function box(name, width, height, depth, material, local, opts) {
      return add(BABYLON.MeshBuilder.CreateBox(name, { width, height, depth }, scene), material, local, opts);
    }

    function label(text, width, local, rotationY, accent = "#f2a900") {
      const texture = GraphicsQuality.createTextTexture(`${text}-lander-label`, 1024, 192, scene, 1.5);
      const ctx = texture.getContext();
      ctx.fillStyle = "#071525";
      ctx.fillRect(0, 0, 1024, 192);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, 1012, 180);
      ctx.fillStyle = "#f8fbff";
      ctx.font = "600 78px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 512, 100);
      texture.update();
      const material = new BABYLON.StandardMaterial(`${text}-lander-label-material`, scene);
      material.diffuseTexture = texture;
      material.emissiveTexture = texture;
      material.emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7);
      material.disableLighting = true;
      material.fogEnabled = false;
      const plane = BABYLON.MeshBuilder.CreatePlane(`${text}-lander-sign`, { width, height: width * 0.1875 }, scene);
      return add(plane, material, local, { caster: false, rotation: v3(0, rotationY, 0) });
    }

    const panels = {};

    function screen(name, title, lines, local, rotationY, tilt = -0.35, panelId = null) {
      // Read from about a metre away inside the cabin: drawn at 2x for sharp text.
      const texture = GraphicsQuality.createTextTexture(`${name}-texture`, 512, 320, scene, 2);
      const ctx = texture.getContext();
      function draw(nextTitle, nextLines, accent = "#31c8ff") {
        ctx.fillStyle = "#03101e";
        ctx.fillRect(0, 0, 512, 320);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, 496, 304);
        ctx.fillStyle = "#bdefff";
        ctx.font = "600 40px Arial";
        ctx.fillText(nextTitle, 28, 64);
        ctx.font = "28px monospace";
        ctx.fillStyle = "#7fd8a8";
        nextLines.slice(0, 4).forEach((line, index) => ctx.fillText(line, 28, 124 + index * 44));
        texture.update();
      }
      draw(title, lines);
      if (panelId) panels[panelId] = draw;
      const material = new BABYLON.StandardMaterial(`${name}-material`, scene);
      material.diffuseTexture = texture;
      material.emissiveTexture = texture;
      material.emissiveColor = new BABYLON.Color3(0.8, 0.9, 1);
      material.disableLighting = true;
      material.fogEnabled = false;
      const plane = BABYLON.MeshBuilder.CreatePlane(name, { width: 1.1, height: 0.69 }, scene);
      return add(plane, material, local, { caster: false, rotation: v3(tilt, rotationY, 0) });
    }

    // Readable-sign rotation for a viewer looking along local direction (dx, dz).
    // A Babylon plane at rotation 0 is read by a viewer looking along +z.
    function facing(dx, dz) {
      return Math.atan2(dx, dz);
    }

    // --- Descent stage (solid base under the cabin floor) ---------------------
    const octagonDiameter = (2 * (APOTHEM + WALL_THICKNESS)) / Math.cos(Math.PI / 8);
    const base = add(
      BABYLON.MeshBuilder.CreateCylinder("marsLanderDescentStage", { diameter: octagonDiameter, height: FLOOR_HEIGHT, tessellation: 8 }, scene),
      materials.frame, v3(0, FLOOR_HEIGHT / 2, 0), { collide: true, rotation: v3(0, Math.PI / 8, 0) }
    );
    add(BABYLON.MeshBuilder.CreateCylinder("marsLanderCabinFloor", { diameter: (2 * APOTHEM) / Math.cos(Math.PI / 8), height: 0.04, tessellation: 8 }, scene),
      own.floor, v3(0, FLOOR_HEIGHT + 0.02, 0), { caster: false, rotation: v3(0, Math.PI / 8, 0) });

    // --- Cabin walls: 8 panels; the +z panel is the airlock frame --------------
    for (let i = 1; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4;
      const distance = APOTHEM + WALL_THICKNESS / 2;
      box(`marsLanderWall${i}`, PANEL_WIDTH, WALL_HEIGHT, WALL_THICKNESS, materials.hull,
        v3(Math.sin(angle) * distance, FLOOR_HEIGHT + WALL_HEIGHT / 2, Math.cos(angle) * distance),
        { collide: true, rotation: v3(0, angle, 0) });
      // Interior lining so the inside reads as a lit cabin rather than bare hull.
      box(`marsLanderLining${i}`, PANEL_WIDTH - 0.3, WALL_HEIGHT - 0.4, 0.04, own.interior,
        v3(Math.sin(angle) * (APOTHEM - 0.02), FLOOR_HEIGHT + WALL_HEIGHT / 2, Math.cos(angle) * (APOTHEM - 0.02)),
        { caster: false, rotation: v3(0, angle, 0) });
      if (i === 2 || i === 6) {
        // Small viewport windows on the side walls.
        box(`marsLanderWindow${i}`, 0.9, 0.5, WALL_THICKNESS + 0.06, own.window,
          v3(Math.sin(angle) * distance, FLOOR_HEIGHT + 2.1, Math.cos(angle) * distance + (i === 2 ? 1.2 : -1.2)),
          { caster: false, rotation: v3(0, angle, 0) });
      }
    }
    const doorZ = APOTHEM + WALL_THICKNESS / 2;
    const postWidth = (PANEL_WIDTH - DOOR_WIDTH) / 2;
    [-1, 1].forEach((side) => {
      box(`marsLanderDoorPost${side}`, postWidth, WALL_HEIGHT, WALL_THICKNESS, materials.hull,
        v3(side * (DOOR_WIDTH / 2 + postWidth / 2), FLOOR_HEIGHT + WALL_HEIGHT / 2, doorZ), { collide: true });
    });
    box("marsLanderDoorLintel", DOOR_WIDTH, WALL_HEIGHT - DOOR_HEIGHT, WALL_THICKNESS, materials.hull,
      v3(0, FLOOR_HEIGHT + DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, doorZ), { collide: true });

    // --- Roof, ascent stage and antenna ---------------------------------------
    add(BABYLON.MeshBuilder.CreateCylinder("marsLanderRoof", { diameter: octagonDiameter, height: 0.25, tessellation: 8 }, scene),
      materials.hull, v3(0, FLOOR_HEIGHT + WALL_HEIGHT + 0.125, 0), { collide: true, rotation: v3(0, Math.PI / 8, 0) });
    add(BABYLON.MeshBuilder.CreateCylinder("marsLanderAscentStage", { diameterTop: 2.6, diameterBottom: 5.4, height: 2.2, tessellation: 16 }, scene),
      materials.hull, v3(0, FLOOR_HEIGHT + WALL_HEIGHT + 1.35, -0.4));
    add(BABYLON.MeshBuilder.CreateCylinder("marsLanderHatchRing", { diameter: 1.4, height: 0.2, tessellation: 24 }, scene),
      materials.frame, v3(0, FLOOR_HEIGHT + WALL_HEIGHT + 2.55, -0.4), { caster: false });
    add(BABYLON.MeshBuilder.CreateCylinder("marsLanderAntennaMast", { diameter: 0.08, height: 1.6 }, scene),
      materials.frame, v3(1.6, FLOOR_HEIGHT + WALL_HEIGHT + 1.0, -2.2), { caster: false });
    add(BABYLON.MeshBuilder.CreateSphere("marsLanderAntennaDish", { diameter: 0.9, slice: 0.35, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene),
      materials.hull, v3(1.6, FLOOR_HEIGHT + WALL_HEIGHT + 1.9, -2.2), { caster: false, rotation: v3(Math.PI * 0.75, 0.6, 0) });
    box("marsLanderStripe", 0.02, 0.35, 2.4, materials.accent, v3(APOTHEM + WALL_THICKNESS + 0.01, FLOOR_HEIGHT + 2.6, -1.6), { caster: false, rotation: v3(0, 0, 0) });
    // Interior ceiling light panels.
    box("marsLanderCeilingLight", 2.4, 0.04, 0.5, own.glow, v3(0, FLOOR_HEIGHT + WALL_HEIGHT - 0.03, 0), { caster: false });
    box("marsLanderCeilingLight2", 0.5, 0.04, 2.4, own.glow, v3(0, FLOOR_HEIGHT + WALL_HEIGHT - 0.03, 0), { caster: false });

    // --- Landing legs and footpads ---------------------------------------------
    for (let k = 0; k < 4; k += 1) {
      const angle = Math.PI / 4 + (k * Math.PI) / 2;
      const top = v3(Math.sin(angle) * (APOTHEM + 0.3), FLOOR_HEIGHT + 0.6, Math.cos(angle) * (APOTHEM + 0.3));
      const foot = v3(Math.sin(angle) * 6.6, 0.18, Math.cos(angle) * 6.6);
      add(BABYLON.MeshBuilder.CreateTube(`marsLanderLeg${k}`, { path: [top, foot], radius: 0.13, tessellation: 10, cap: BABYLON.Mesh.CAP_ALL }, scene),
        materials.frame, v3(0, 0, 0), { collide: true });
      const brace = v3(Math.sin(angle) * (APOTHEM + 0.25), 0.15, Math.cos(angle) * (APOTHEM + 0.25));
      add(BABYLON.MeshBuilder.CreateTube(`marsLanderBrace${k}`, { path: [brace, foot.add(v3(0, 0.1, 0))], radius: 0.07, tessellation: 8 }, scene),
        materials.frame, v3(0, 0, 0), { caster: false });
      add(BABYLON.MeshBuilder.CreateCylinder(`marsLanderFootpad${k}`, { diameter: 1.1, height: 0.16, tessellation: 20 }, scene),
        materials.frame, foot, { caster: false });
    }

    // --- Airlock vestibule, door and ramp ----------------------------------------
    const vestibuleZ = APOTHEM + WALL_THICKNESS + VESTIBULE_DEPTH / 2;
    box("marsLanderVestibuleFloor", DOOR_WIDTH + 0.6, FLOOR_HEIGHT, VESTIBULE_DEPTH, materials.frame,
      v3(0, FLOOR_HEIGHT / 2, vestibuleZ), { collide: true, caster: false });
    [-1, 1].forEach((side) => {
      box(`marsLanderVestibuleWall${side}`, 0.15, DOOR_HEIGHT + 0.3, VESTIBULE_DEPTH, materials.hull,
        v3(side * (DOOR_WIDTH / 2 + 0.22), FLOOR_HEIGHT + (DOOR_HEIGHT + 0.3) / 2, vestibuleZ), { collide: true });
      box(`marsLanderHazardStripe${side}`, 0.17, 0.25, VESTIBULE_DEPTH + 0.02, own.hazard,
        v3(side * (DOOR_WIDTH / 2 + 0.22), FLOOR_HEIGHT + DOOR_HEIGHT + 0.05, vestibuleZ), { caster: false });
    });
    box("marsLanderVestibuleRoof", DOOR_WIDTH + 0.6, 0.15, VESTIBULE_DEPTH + 0.2, materials.hull,
      v3(0, FLOOR_HEIGHT + DOOR_HEIGHT + 0.38, vestibuleZ), { collide: true });

    const rampAngle = Math.atan2(FLOOR_HEIGHT, RAMP_LENGTH);
    const rampStartZ = APOTHEM + WALL_THICKNESS + VESTIBULE_DEPTH;
    add(BABYLON.MeshBuilder.CreateBox("marsLanderRamp", { width: RAMP_WIDTH, height: 0.08, depth: Math.hypot(RAMP_LENGTH, FLOOR_HEIGHT) }, scene),
      materials.frame, v3(0, FLOOR_HEIGHT / 2 - 0.04, rampStartZ + RAMP_LENGTH / 2), { caster: false, rotation: v3(rampAngle, 0, 0) });
    [-1, 1].forEach((side) => {
      const x = side * (RAMP_WIDTH / 2 + 0.05);
      add(BABYLON.MeshBuilder.CreateTube(`marsLanderRail${side}`, {
        path: [v3(x, FLOOR_HEIGHT + 0.95, rampStartZ), v3(x, 0.95, rampStartZ + RAMP_LENGTH)], radius: 0.035, tessellation: 8,
      }, scene), own.hazard, v3(0, 0, 0), { caster: false });
      [0, 0.5, 1].forEach((t, index) => {
        const height = FLOOR_HEIGHT * (1 - t);
        add(BABYLON.MeshBuilder.CreateCylinder(`marsLanderRailPost${side}-${index}`, { diameter: 0.06, height: 0.95 }, scene),
          materials.frame, v3(x, height + 0.475, rampStartZ + RAMP_LENGTH * t), { caster: false });
      });
    });

    // Airlock door swings outward on a hinge at the -x side of the doorway.
    const hinge = new BABYLON.TransformNode("marsLanderDoorHinge", scene);
    hinge.parent = root;
    hinge.position.set(-DOOR_WIDTH / 2, FLOOR_HEIGHT, doorZ);
    const door = add(BABYLON.MeshBuilder.CreateBox("marsLanderAirlockDoor", { width: DOOR_WIDTH - 0.04, height: DOOR_HEIGHT - 0.02, depth: 0.1 }, scene),
      materials.accent, v3(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0), { collide: true, parent: hinge });
    add(BABYLON.MeshBuilder.CreateBox("marsLanderDoorWindow", { width: 0.5, height: 0.4, depth: 0.12 }, scene),
      own.window, v3(DOOR_WIDTH / 2, DOOR_HEIGHT * 0.72, 0), { caster: false, parent: hinge });

    // --- Storage / equipment bay on the -x side (outside) ------------------------
    const bayX = -(APOTHEM + WALL_THICKNESS + 1.0);
    box("marsLanderStorageRack", 1.6, 0.12, 3.4, materials.frame, v3(bayX, 1.1, -0.2), { collide: true });
    box("marsLanderStorageRoof", 1.8, 0.1, 3.6, materials.hull, v3(bayX - 0.05, 2.3, -0.2));
    [-1.85, 1.45].forEach((z, index) => {
      box(`marsLanderStoragePost${index}`, 0.12, 2.3, 0.12, materials.frame, v3(bayX - 0.7, 1.15, z), { collide: true, caster: false });
    });
    const crates = [
      [-1.2, 0.4, own.crate], [0, 0.4, own.crateOrange], [1.1, 0.4, own.crate],
      [-0.9, 1.5, own.crateOrange], [0.5, 1.5, own.crate],
    ];
    crates.forEach(([z, y, material], index) => {
      box(`marsLanderCrate${index}`, 1.1, 0.75, 0.9, material, v3(bayX, y, -0.2 + z), { collide: true });
    });
    label("STORAGE", 2.2, v3(bayX - 0.95, 2.05, -0.2), facing(1, 0), "#4cc9f0");

    // --- Interior: terminals, bunks, lockers -------------------------------------
    const consoleOffset = APOTHEM - 0.55;
    box("marsLanderSupplyConsole", 0.7, 1.0, 1.4, materials.frame, v3(consoleOffset, FLOOR_HEIGHT + 0.5, 0), { collide: true, caster: false });
    screen("marsLanderSupplyScreen", "O2 / SUPPLIES", ["Life-support status", "Press E to view"],
      v3(consoleOffset - 0.15, FLOOR_HEIGHT + 1.35, 0), facing(1, 0), -0.35, "supply");
    label("SUPPLY TERMINAL", 1.9, v3(APOTHEM - 0.08, FLOOR_HEIGHT + 2.35, 0), facing(1, 0), "#5de2a5");

    box("marsLanderMissionConsole", 0.7, 1.0, 1.4, materials.frame, v3(-consoleOffset, FLOOR_HEIGHT + 0.5, 0), { collide: true, caster: false });
    screen("marsLanderMissionScreen", "MISSION", ["Mission status", "Press E to view"],
      v3(-consoleOffset + 0.15, FLOOR_HEIGHT + 1.35, 0), facing(-1, 0), -0.35, "mission");
    label("MISSION TERMINAL", 1.9, v3(-(APOTHEM - 0.08), FLOOR_HEIGHT + 2.35, 0), facing(-1, 0), "#4cc9f0");

    [-1, 1].forEach((side) => {
      box(`marsLanderBunk${side}`, 1.9, 0.45, 0.9, own.interior, v3(side * 1.1, FLOOR_HEIGHT + 0.45, -(APOTHEM - 0.55)), { collide: true, caster: false });
      box(`marsLanderBunkMat${side}`, 1.8, 0.1, 0.8, materials.accent, v3(side * 1.1, FLOOR_HEIGHT + 0.72, -(APOTHEM - 0.55)), { caster: false });
    });
    [-1, 1].forEach((side) => {
      const angle = side * (3 * Math.PI) / 4;
      box(`marsLanderLocker${side}`, 1.2, 2.1, 0.5, own.crate,
        v3(Math.sin(angle) * (APOTHEM - 0.3), FLOOR_HEIGHT + 1.05, Math.cos(angle) * (APOTHEM - 0.3)),
        { collide: true, caster: false, rotation: v3(0, angle, 0) });
      label(side > 0 ? "SUPPLY LOCKER" : "EVA SUIT", 1.3,
        v3(Math.sin(angle) * (APOTHEM - 0.6), FLOOR_HEIGHT + 2.3, Math.cos(angle) * (APOTHEM - 0.6)), angle,
        side > 0 ? "#5de2a5" : "#f2a900");
    });

    // Wall panels either side of the hatch: cabin pressure (right) and main power (left).
    [[Math.PI / 4, "pressure", "CABIN PRESSURE", ["101.3 kPa (simulated)", "Hatch: closed"]],
      [-Math.PI / 4, "power", "MAIN POWER", ["OFF - emergency lighting", "Press E to activate"]]].forEach(([angle, id, title, lines]) => {
      const d = APOTHEM - 0.08;
      box(`marsLanderPanelBack-${id}`, 1.25, 0.85, 0.06, materials.frame,
        v3(Math.sin(angle) * (d + 0.02), FLOOR_HEIGHT + 1.55, Math.cos(angle) * (d + 0.02)), { caster: false, rotation: v3(0, angle, 0) });
      screen(`marsLanderPanel-${id}`, title, lines,
        v3(Math.sin(angle) * (d - 0.02), FLOOR_HEIGHT + 1.55, Math.cos(angle) * (d - 0.02)), angle, 0, id);
      label(title, 1.3, v3(Math.sin(angle) * (d - 0.02), FLOOR_HEIGHT + 2.2, Math.cos(angle) * (d - 0.02)), angle,
        id === "pressure" ? "#4cc9f0" : "#f2a900");
    });

    // Stowed EVA suit standing in front of its locker (hidden while worn).
    const suitAngle = -(3 * Math.PI) / 4;
    const suitStand = new BABYLON.TransformNode("marsLanderEvaSuitStand", scene);
    suitStand.parent = root;
    suitStand.position.set(Math.sin(suitAngle) * (APOTHEM - 1.25), FLOOR_HEIGHT, Math.cos(suitAngle) * (APOTHEM - 1.25));
    suitStand.rotation.y = suitAngle + Math.PI;
    const suitPart = (mesh, material, local) => add(mesh, material, local, { caster: true, parent: suitStand });
    [-0.14, 0.14].forEach((x, index) => {
      suitPart(BABYLON.MeshBuilder.CreateCylinder(`marsLanderEvaLeg${index}`, { diameter: 0.22, height: 0.85, tessellation: 12 }, scene), own.suit, v3(x, 0.43, 0));
    });
    suitPart(BABYLON.MeshBuilder.CreateCylinder("marsLanderEvaTorso", { diameterTop: 0.55, diameterBottom: 0.45, height: 0.7, tessellation: 16 }, scene), own.suit, v3(0, 1.2, 0));
    suitPart(BABYLON.MeshBuilder.CreateBox("marsLanderEvaBackpack", { width: 0.48, height: 0.6, depth: 0.22 }, scene), own.suit, v3(0, 1.25, -0.3));
    suitPart(BABYLON.MeshBuilder.CreateSphere("marsLanderEvaHelmet", { diameter: 0.42, segments: 16 }, scene), own.suit, v3(0, 1.72, 0));
    const visorMesh = suitPart(BABYLON.MeshBuilder.CreateSphere("marsLanderEvaVisor", { diameter: 0.34, segments: 16 }, scene), own.visor, v3(0, 1.73, 0.08));
    visorMesh.scaling.z = 0.6;

    // --- Exterior labels ------------------------------------------------------------
    label("AIRLOCK", 1.6, v3(0, FLOOR_HEIGHT + DOOR_HEIGHT + 0.68, APOTHEM + WALL_THICKNESS + VESTIBULE_DEPTH + 0.11), facing(0, -1));
    // Hatch status lamps (inside and outside): green open, amber cycling, red closed.
    const lampMaterial = new BABYLON.StandardMaterial("marsLanderHatchLamp", scene);
    lampMaterial.disableLighting = true;
    lampMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.12, 0.1);
    [[APOTHEM + WALL_THICKNESS + VESTIBULE_DEPTH + 0.12, FLOOR_HEIGHT + DOOR_HEIGHT + 0.25], [APOTHEM - 0.05, FLOOR_HEIGHT + DOOR_HEIGHT + 0.12]]
      .forEach(([z, y], index) => {
        add(BABYLON.MeshBuilder.CreateSphere(`marsLanderHatchLamp${index}`, { diameter: 0.18, segments: 10 }, scene),
          lampMaterial, v3(0.95, y, z), { caster: false });
      });
    label("AIRLOCK", 1.4, v3(0, FLOOR_HEIGHT + DOOR_HEIGHT + 0.35, APOTHEM - 0.03), facing(0, 1));
    // Freestanding home-base sign beside the foot of the ramp, visible on approach.
    const signZ = rampStartZ + RAMP_LENGTH + 0.6;
    box("marsLanderSignPost", 0.12, 2.4, 0.12, materials.frame, v3(-2.2, 1.2, signZ), { collide: true, caster: false });
    label("LANDER · HOME BASE", 2.6, v3(-2.2, 2.25, signZ + 0.08), facing(0, -1), "#ef3e42");

    // Static parts never move: freeze them for performance. The door hinge animates.
    root.computeWorldMatrix(true);
    staticMeshes.forEach((mesh) => mesh.freezeWorldMatrix());
    void base;

    // --- Coordinate helpers -----------------------------------------------------------
    function toLocal(x, z) {
      const dx = x - position.x;
      const dz = z - position.z;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
    }

    function toWorld(local) {
      const x = local.x * cos + local.z * sin;
      const z = -local.x * sin + local.z * cos;
      return v3(position.x + x, groundY + local.y, position.z + z);
    }

    /** Walkable floor/ramp height at a world point, or null outside the lander. */
    function floorHeightAt(x, z) {
      const p = toLocal(x, z);
      const insideCabin = Math.abs(p.x) <= APOTHEM && Math.abs(p.z) <= APOTHEM
        && Math.abs(p.x) + Math.abs(p.z) <= APOTHEM * Math.SQRT2;
      const inVestibule = Math.abs(p.x) <= DOOR_WIDTH / 2 + 0.1 && p.z > APOTHEM - 0.2 && p.z <= rampStartZ;
      if (insideCabin || inVestibule) return groundY + FLOOR_HEIGHT;
      if (Math.abs(p.x) <= RAMP_WIDTH / 2 && p.z > rampStartZ && p.z <= rampStartZ + RAMP_LENGTH) {
        return groundY + FLOOR_HEIGHT * (1 - (p.z - rampStartZ) / RAMP_LENGTH);
      }
      return null;
    }

    function isInsideCabin(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) < APOTHEM && Math.abs(p.z) < APOTHEM && Math.abs(p.x) + Math.abs(p.z) < APOTHEM * Math.SQRT2;
    }

    /** True in the hatch opening and just either side of it (the only legal way in or out). */
    function isInDoorway(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) <= DOOR_WIDTH / 2 + 0.05 && p.z >= APOTHEM - 0.8 && p.z <= APOTHEM + WALL_THICKNESS + 0.8;
    }

    /** Outside, at the hatch: on the vestibule, ramp or just in front of it (exterior panel reach). */
    function isAtHatchOutside(x, z) {
      const p = toLocal(x, z);
      return Math.abs(p.x) <= 1.4 && p.z > APOTHEM + 0.05 && p.z <= rampStartZ + RAMP_LENGTH + 1.0;
    }

    /** Safe standing point outside, at the foot of the ramp. */
    const exteriorSafePoint = toWorld({ x: 0, y: 0, z: rampStartZ + RAMP_LENGTH + 2 });

    const LAMP_COLORS = { open: [0.1, 0.9, 0.3], cycling: [1, 0.65, 0.05], closed: [0.9, 0.12, 0.1] };
    function setHatchStatus(status) {
      const [r, g, b] = LAMP_COLORS[status] || LAMP_COLORS.closed;
      lampMaterial.emissiveColor.set(r, g, b);
    }

    /** False when standing where the closing hatch would sweep through the astronaut. */
    function isClearOfHatch(x, z) {
      const p = toLocal(x, z);
      return !(Math.abs(p.x) <= DOOR_WIDTH / 2 + 0.6 && p.z > APOTHEM - 1.0);
    }

    function isInSafeZone(x, z) {
      return Math.hypot(x - position.x, z - position.z) <= SAFE_ZONE_RADIUS;
    }

    // --- Airlock door animation ---------------------------------------------------
    let doorOpen = false;
    let doorAngle = 0;
    scene.onBeforeRenderObservable.add(() => {
      const target = doorOpen ? -Math.PI * 0.55 : 0;
      if (Math.abs(target - doorAngle) < 1e-3) return;
      const step = Math.min(1, scene.getEngine().getDeltaTime() / 1000) * 3.5;
      doorAngle += Math.sign(target - doorAngle) * Math.min(step, Math.abs(target - doorAngle));
      hinge.rotation.y = doorAngle;
    });

    function setDoorOpen(open) {
      doorOpen = Boolean(open);
      return doorOpen;
    }

    function setPowerOn(on) {
      own.glow.emissiveColor = on ? new BABYLON.Color3(0.85, 0.92, 1) : new BABYLON.Color3(0.2, 0.22, 0.26);
    }

    function setSuitStowed(stowed) {
      suitStand.setEnabled(Boolean(stowed));
    }

    function setPanel(id, title, lines, accent) {
      if (panels[id]) panels[id](title, lines, accent);
    }

    const at = (angle, distance) => toWorld({ x: Math.sin(angle) * distance, y: FLOOR_HEIGHT + 1.3, z: Math.cos(angle) * distance });
    // The hatch is opened/closed by game logic (airlock procedure), not directly here.
    const interactions = [
      {
        id: "lander-airlock",
        label: "Use airlock controls",
        position: toWorld({ x: 0, y: FLOOR_HEIGHT + 1.2, z: APOTHEM + 0.1 }),
        radius: 2.6,
      },
      { id: "lander-pressure-panel", label: "Check cabin pressure", position: at(Math.PI / 4, APOTHEM - 0.9), radius: 1.6 },
      { id: "lander-power-panel", label: "Use main power panel", position: at(-Math.PI / 4, APOTHEM - 0.9), radius: 1.6 },
      { id: "lander-supply-locker", label: "Open supply locker", position: at((3 * Math.PI) / 4, APOTHEM - 1.0), radius: 1.7 },
      { id: "lander-suit-locker", label: "Open EVA suit locker", position: at(-(3 * Math.PI) / 4, APOTHEM - 1.0), radius: 1.7 },
      {
        id: "lander-supply-terminal",
        label: "Use supply terminal",
        position: toWorld({ x: consoleOffset - 0.4, y: FLOOR_HEIGHT + 1.2, z: 0 }),
        radius: 2.2,
      },
      {
        id: "lander-mission-terminal",
        label: "Use mission terminal",
        position: toWorld({ x: -(consoleOffset - 0.4), y: FLOOR_HEIGHT + 1.2, z: 0 }),
        radius: 2.2,
      },
    ];

    [-1, 1].forEach((side) => interactions.push({
      id: `lander-bed-${side}`, bed: "lander", label: "Press E to Rest",
      position: toWorld({ x: side * 1.1, y: FLOOR_HEIGHT + 1.4, z: -2.6 }), radius: 1.15,
    }));

    const spawn = {
      position: toWorld({ x: 0, y: FLOOR_HEIGHT, z: -1.4 }),
      lookAt: toWorld({ x: 0, y: FLOOR_HEIGHT + 1.5, z: APOTHEM + 6 }),
    };

    return {
      root,
      spawn,
      interactions,
      floorHeightAt,
      isInsideCabin,
      isInDoorway,
      isClearOfHatch,
      isAtHatchOutside,
      setHatchStatus,
      exteriorSafePoint,
      isInSafeZone,
      setDoorOpen,
      setPowerOn,
      setSuitStowed,
      setPanel,
      get doorOpen() { return doorOpen; },
      safeZone: { center: v3(position.x, groundY, position.z), radius: SAFE_ZONE_RADIUS },
      footprintRadius: rampStartZ + RAMP_LENGTH,
    };
  }

  root.MarsLander = Object.freeze({ create, FLOOR_HEIGHT, SAFE_ZONE_RADIUS });
})(globalThis);
