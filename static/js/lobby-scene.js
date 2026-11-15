(function (root) {
  "use strict";

  function createMaterial(scene, name, color, metallic = 0.15, roughness = 0.65) {
    const material = new BABYLON.PBRMaterial(name, scene);
    material.albedoColor = BABYLON.Color3.FromHexString(color);
    material.metallic = metallic;
    material.roughness = roughness;
    return material;
  }

  function createBox(scene, name, dimensions, position, material, collisions = false) {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, dimensions, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    mesh.checkCollisions = collisions;
    return mesh;
  }

  function createLabel(scene, text, width, height, position, rotation, colors = {}) {
    const texture = new BABYLON.DynamicTexture(
      `${text}-texture`,
      { width: 1024, height: 256 },
      scene,
      false
    );
    texture.hasAlpha = true;
    const context = texture.getContext();
    context.fillStyle = colors.background || "#071525";
    context.fillRect(0, 0, 1024, 256);
    context.strokeStyle = colors.accent || "#4cc9f0";
    context.lineWidth = 14;
    context.strokeRect(8, 8, 1008, 240);
    context.fillStyle = colors.text || "#f8fbff";
    context.font = "600 72px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 512, 132);
    texture.update();

    const material = new BABYLON.StandardMaterial(`${text}-material`, scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new BABYLON.Color3(0.35, 0.55, 0.75);
    material.disableLighting = true;

    const plane = BABYLON.MeshBuilder.CreatePlane(
      `${text}-sign`,
      { width, height },
      scene
    );
    plane.position.copyFrom(position);
    plane.rotation.copyFrom(rotation || BABYLON.Vector3.Zero());
    plane.material = material;
    return plane;
  }

  function createMonitor(scene, type, position, rotationY, frameMaterial) {
    const frame = createBox(
      scene,
      `${type}-monitor-frame`,
      { width: 5.1, height: 3.05, depth: 0.28 },
      position,
      frameMaterial
    );
    frame.rotation.y = rotationY;

    const texture = new BABYLON.DynamicTexture(
      `${type}-monitor-texture`,
      { width: 768, height: 432 },
      scene,
      false
    );
    const context = texture.getContext();
    const gradient = context.createLinearGradient(0, 0, 768, 432);
    gradient.addColorStop(0, "#020b18");
    gradient.addColorStop(1, "#0b2440");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 768, 432);
    context.strokeStyle = "#31c8ff";
    context.lineWidth = 4;
    context.strokeRect(12, 12, 744, 408);
    context.fillStyle = "#bdefff";
    context.font = "600 29px Arial";
    context.fillText(type.toUpperCase(), 32, 48);

    if (type === "earth" || type === "mars") {
      const planetGradient = context.createRadialGradient(380, 220, 20, 380, 220, 128);
      if (type === "earth") {
        planetGradient.addColorStop(0, "#4bd0ff");
        planetGradient.addColorStop(0.65, "#1472bf");
        planetGradient.addColorStop(1, "#071f5f");
      } else {
        planetGradient.addColorStop(0, "#ffb078");
        planetGradient.addColorStop(0.6, "#c54f32");
        planetGradient.addColorStop(1, "#542012");
      }
      context.beginPath();
      context.fillStyle = planetGradient;
      context.arc(380, 225, 125, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = type === "earth" ? "#79d98b" : "#7c2d22";
      context.lineWidth = 17;
      context.beginPath();
      context.arc(355, 205, 70, 0.3, 2.1);
      context.stroke();
    } else if (type === "launch vehicle") {
      context.fillStyle = "#e7f3fb";
      context.fillRect(350, 110, 68, 205);
      context.beginPath();
      context.moveTo(350, 110);
      context.lineTo(384, 65);
      context.lineTo(418, 110);
      context.fill();
      context.fillStyle = "#f15b40";
      context.beginPath();
      context.moveTo(350, 270);
      context.lineTo(310, 335);
      context.lineTo(350, 315);
      context.fill();
      context.beginPath();
      context.moveTo(418, 270);
      context.lineTo(458, 335);
      context.lineTo(418, 315);
      context.fill();
    } else {
      context.strokeStyle = "#5de2a5";
      context.lineWidth = 6;
      context.beginPath();
      for (let x = 40; x < 730; x += 18) {
        const y = 250 + Math.sin(x / 45) * 50 + Math.sin(x / 17) * 14;
        if (x === 40) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.fillStyle = "#7fa8c4";
      context.font = "22px monospace";
      context.fillText("FLIGHT SYSTEMS NOMINAL", 36, 390);
    }
    texture.update();

    const screenMaterial = new BABYLON.StandardMaterial(`${type}-screen-material`, scene);
    screenMaterial.diffuseTexture = texture;
    screenMaterial.emissiveTexture = texture;
    screenMaterial.emissiveColor = new BABYLON.Color3(0.55, 0.75, 0.95);
    screenMaterial.disableLighting = true;
    const screen = BABYLON.MeshBuilder.CreatePlane(`${type}-screen`, { width: 4.75, height: 2.7 }, scene);
    screen.position.copyFrom(position);
    screen.rotation.y = rotationY;
    const forward = new BABYLON.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY));
    screen.position.addInPlace(forward.scale(-0.16));
    screen.material = screenMaterial;
    return frame;
  }

  function createSuitDisplay(scene, x, label, materials) {
    const pod = createBox(
      scene,
      `${label}-pod`,
      { width: 3.5, height: 6.4, depth: 2.7 },
      new BABYLON.Vector3(x, 3.3, 13.8),
      materials.dark
    );
    const glass = new BABYLON.PBRMaterial(`${label}-glass`, scene);
    glass.albedoColor = new BABYLON.Color3(0.25, 0.55, 0.7);
    glass.alpha = 0.16;
    glass.metallic = 0.05;
    glass.roughness = 0.1;
    const door = BABYLON.MeshBuilder.CreatePlane(`${label}-glass-door`, { width: 3.05, height: 5.75 }, scene);
    door.position = new BABYLON.Vector3(x, 3.4, 12.42);
    door.rotation.y = Math.PI;
    door.material = glass;

    const suit = new BABYLON.TransformNode(`${label}-suit`, scene);
    const torso = BABYLON.MeshBuilder.CreateCylinder(`${label}-torso`, {
      height: 2.1,
      diameterTop: 1.25,
      diameterBottom: 1.5,
      tessellation: 16,
    }, scene);
    torso.position = new BABYLON.Vector3(x, 3.25, 13.15);
    torso.material = materials.suit;
    torso.parent = suit;
    const helmet = BABYLON.MeshBuilder.CreateSphere(`${label}-helmet`, { diameter: 1.35, segments: 16 }, scene);
    helmet.position = new BABYLON.Vector3(x, 4.9, 13.15);
    helmet.material = materials.suit;
    helmet.parent = suit;
    const visor = BABYLON.MeshBuilder.CreateSphere(`${label}-visor`, {
      diameter: 1.08,
      segments: 16,
      slice: 0.48,
    }, scene);
    visor.position = new BABYLON.Vector3(x, 4.9, 12.72);
    visor.rotation.x = Math.PI / 2;
    visor.material = materials.visor;
    visor.parent = suit;
    [-1, 1].forEach((side) => {
      const limb = BABYLON.MeshBuilder.CreateCylinder(`${label}-arm-${side}`, { height: 2, diameter: 0.38 }, scene);
      limb.position = new BABYLON.Vector3(x + side * 0.92, 3.25, 13.15);
      limb.rotation.z = side * 0.15;
      limb.material = materials.suit;
      limb.parent = suit;
      const leg = BABYLON.MeshBuilder.CreateCylinder(`${label}-leg-${side}`, { height: 2.1, diameter: 0.5 }, scene);
      leg.position = new BABYLON.Vector3(x + side * 0.4, 1.25, 13.15);
      leg.material = materials.suit;
      leg.parent = suit;
    });
    createLabel(scene, label, 2.6, 0.55, new BABYLON.Vector3(x, 6.12, 12.36), new BABYLON.Vector3(0, Math.PI, 0));
    return pod;
  }

  function createTerminal(scene, id, label, position, material, interactions, onInteract) {
    const base = BABYLON.MeshBuilder.CreateCylinder(`${id}-base`, { height: 1, diameter: 1.8, tessellation: 12 }, scene);
    base.position.copyFrom(position.add(new BABYLON.Vector3(0, 0.5, 0)));
    base.material = material;
    base.checkCollisions = true;
    const stand = createBox(scene, `${id}-stand`, { width: 1.2, height: 2.1, depth: 0.65 }, position.add(new BABYLON.Vector3(0, 1.65, 0)), material, true);
    stand.rotation.x = -0.16;
    createLabel(scene, label, 2.25, 0.7, position.add(new BABYLON.Vector3(0, 2.8, -0.38)), new BABYLON.Vector3(0, Math.PI, 0), {
      accent: "#f2a900",
    });
    interactions.push({ id, label, position: position.add(new BABYLON.Vector3(0, 1.5, 0)), onInteract });
  }

  function create(engine, canvas, callbacks = {}) {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = BABYLON.Color4.FromHexString("#07111dff");
    scene.collisionsEnabled = true;
    scene.gravity = new BABYLON.Vector3(0, -0.24, 0);
    scene.ambientColor = new BABYLON.Color3(0.16, 0.2, 0.28);
    scene.imageProcessingConfiguration.contrast = 1.15;
    scene.imageProcessingConfiguration.exposure = 1.05;
    scene.skipPointerMovePicking = true;

    const materials = {
      floor: createMaterial(scene, "floor", "#263341", 0.42, 0.36),
      floorLight: createMaterial(scene, "floor-light", "#435468", 0.32, 0.4),
      wall: createMaterial(scene, "wall", "#dce3e8", 0.08, 0.72),
      dark: createMaterial(scene, "structure", "#111c28", 0.68, 0.28),
      blue: createMaterial(scene, "nasa-blue", "#123f70", 0.25, 0.46),
      red: createMaterial(scene, "accent-red", "#b52b35", 0.22, 0.45),
      desk: createMaterial(scene, "desk", "#314254", 0.45, 0.38),
      suit: createMaterial(scene, "suit", "#e6e8e7", 0.05, 0.68),
      visor: createMaterial(scene, "visor", "#b97926", 0.76, 0.14),
    };

    const emissive = new BABYLON.StandardMaterial("light-strips", scene);
    emissive.diffuseColor = BABYLON.Color3.FromHexString("#79dfff");
    emissive.emissiveColor = BABYLON.Color3.FromHexString("#55c7ff");

    const camera = new BABYLON.UniversalCamera("lobbyCamera", new BABYLON.Vector3(0, 1.75, -24), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1.7, -10));
    camera.minZ = 0.08;
    camera.speed = 0.24;
    camera.inertia = 0.72;
    camera.angularSensibility = 3600;
    camera.checkCollisions = true;
    camera.applyGravity = true;
    camera.ellipsoid = new BABYLON.Vector3(0.48, 0.88, 0.48);
    camera.ellipsoidOffset = new BABYLON.Vector3(0, 0.88, 0);
    camera.keysUp = [87];
    camera.keysDown = [83];
    camera.keysLeft = [65];
    camera.keysRight = [68];
    // Flat floor at y = 0; the astronaut's body (not the camera) collides with walls.
    const astronautView = AstronautView.create(scene, camera, { eyeHeight: 1.75, getGroundHeight: () => 0 });

    const fillLight = new BABYLON.HemisphericLight("lobby-fill", new BABYLON.Vector3(0, 1, 0), scene);
    fillLight.intensity = 0.42;
    fillLight.groundColor = new BABYLON.Color3(0.08, 0.1, 0.14);
    const keyLight = new BABYLON.DirectionalLight("lobby-key", new BABYLON.Vector3(-0.35, -1, 0.25), scene);
    keyLight.position = new BABYLON.Vector3(8, 13, -10);
    keyLight.intensity = 1.55;
    const shadows = new BABYLON.ShadowGenerator(1024, keyLight);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 20;

    const floor = BABYLON.MeshBuilder.CreateGround("lobby-floor", { width: 40, height: 60, subdivisions: 2 }, scene);
    floor.material = materials.floor;
    floor.checkCollisions = true;
    floor.receiveShadows = true;

    for (let x = -18; x <= 18; x += 4) {
      createBox(scene, `floor-inlay-${x}`, { width: 0.055, height: 0.012, depth: 58 }, new BABYLON.Vector3(x, 0.012, 0), materials.floorLight);
    }
    for (let z = -28; z <= 28; z += 4) {
      createBox(scene, `floor-cross-${z}`, { width: 38, height: 0.012, depth: 0.055 }, new BABYLON.Vector3(0, 0.014, z), materials.floorLight);
    }
    createBox(scene, "route-line-left", { width: 0.12, height: 0.025, depth: 49 }, new BABYLON.Vector3(-1.3, 0.03, 2), emissive);
    createBox(scene, "route-line-right", { width: 0.12, height: 0.025, depth: 49 }, new BABYLON.Vector3(1.3, 0.03, 2), emissive);

    createBox(scene, "left-wall", { width: 0.6, height: 8, depth: 60 }, new BABYLON.Vector3(-20, 4, 0), materials.wall, true);
    createBox(scene, "right-wall", { width: 0.6, height: 8, depth: 60 }, new BABYLON.Vector3(20, 4, 0), materials.wall, true);
    createBox(scene, "entry-wall-left", { width: 15.5, height: 8, depth: 0.6 }, new BABYLON.Vector3(-12.25, 4, -30), materials.wall, true);
    createBox(scene, "entry-wall-right", { width: 15.5, height: 8, depth: 0.6 }, new BABYLON.Vector3(12.25, 4, -30), materials.wall, true);
    createBox(scene, "launch-wall-left", { width: 15.5, height: 8, depth: 0.6 }, new BABYLON.Vector3(-12.25, 4, 30), materials.wall, true);
    createBox(scene, "launch-wall-right", { width: 15.5, height: 8, depth: 0.6 }, new BABYLON.Vector3(12.25, 4, 30), materials.wall, true);
    createBox(scene, "ceiling", { width: 40, height: 0.35, depth: 60 }, new BABYLON.Vector3(0, 8.1, 0), materials.dark, true);

    for (let z = -27; z <= 27; z += 6) {
      createBox(scene, `beam-${z}`, { width: 39.5, height: 0.38, depth: 0.55 }, new BABYLON.Vector3(0, 7.68, z), materials.dark);
      createBox(scene, `light-${z}-left`, { width: 12, height: 0.08, depth: 0.16 }, new BABYLON.Vector3(-10.5, 7.43, z), emissive);
      createBox(scene, `light-${z}-right`, { width: 12, height: 0.08, depth: 0.16 }, new BABYLON.Vector3(10.5, 7.43, z), emissive);
    }
    for (let z = -24; z <= 24; z += 8) {
      [-19.35, 19.35].forEach((x) => {
        createBox(scene, `pillar-${x}-${z}`, { width: 1.1, height: 7.4, depth: 1.3 }, new BABYLON.Vector3(x, 3.7, z), materials.dark, true);
        createBox(scene, `pillar-accent-${x}-${z}`, { width: 1.14, height: 0.18, depth: 1.34 }, new BABYLON.Vector3(x, 5.8, z), materials.blue);
      });
    }

    createLabel(scene, "WELCOME — MISSION TRAINING CENTER", 12, 1.25, new BABYLON.Vector3(0, 6.25, -29.62), BABYLON.Vector3.Zero(), { accent: "#ef3e42" });
    createLabel(scene, "MISSION BRIEFING", 8.5, 1, new BABYLON.Vector3(0, 6.15, -7), BABYLON.Vector3.Zero());
    createLabel(scene, "SUIT PREPARATION", 6, 0.8, new BABYLON.Vector3(-16.1, 6.5, 10), new BABYLON.Vector3(0, Math.PI / 2, 0));
    createLabel(scene, "LAUNCH PREPARATION  →", 8, 0.9, new BABYLON.Vector3(0, 6.2, 29.62), new BABYLON.Vector3(0, Math.PI, 0), { accent: "#f2a900" });

    const briefingPlatform = BABYLON.MeshBuilder.CreateCylinder("briefing-platform", { diameter: 14, height: 0.22, tessellation: 48 }, scene);
    briefingPlatform.position = new BABYLON.Vector3(0, 0.12, -4);
    briefingPlatform.material = materials.blue;
    const briefingTable = BABYLON.MeshBuilder.CreateCylinder("briefing-table", { diameter: 7.5, height: 1.05, tessellation: 48 }, scene);
    briefingTable.scaling.z = 0.58;
    briefingTable.position = new BABYLON.Vector3(0, 1.05, -4);
    briefingTable.material = materials.desk;
    briefingTable.checkCollisions = true;
    shadows.addShadowCaster(briefingTable);
    const holoBase = BABYLON.MeshBuilder.CreateCylinder("mission-display-base", { diameter: 2.4, height: 0.35, tessellation: 32 }, scene);
    holoBase.position = new BABYLON.Vector3(0, 1.76, -4);
    holoBase.material = materials.dark;
    const holo = BABYLON.MeshBuilder.CreateSphere("mission-hologram", { diameter: 1.65, segments: 24 }, scene);
    holo.position = new BABYLON.Vector3(0, 3.1, -4);
    holo.material = materials.blue;
    holo.material.emissiveColor = new BABYLON.Color3(0.05, 0.32, 0.7);
    scene.onBeforeRenderObservable.add(() => {
      holo.rotation.y += 0.0025 * scene.getAnimationRatio();
    });
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const chair = createBox(scene, `chair-${angle}`, { width: 1.05, height: 1.1, depth: 1.1 }, new BABYLON.Vector3(Math.sin(angle) * 5.5, 0.7, -4 + Math.cos(angle) * 3.65), materials.dark, true);
      chair.rotation.y = angle;
      shadows.addShadowCaster(chair);
    }

    createMonitor(scene, "earth", new BABYLON.Vector3(-13.8, 4.5, -12), Math.PI / 2, materials.dark);
    createMonitor(scene, "mars", new BABYLON.Vector3(13.8, 4.5, -12), -Math.PI / 2, materials.dark);
    createMonitor(scene, "launch vehicle", new BABYLON.Vector3(-13.8, 4.5, -4), Math.PI / 2, materials.dark);
    createMonitor(scene, "mission telemetry", new BABYLON.Vector3(13.8, 4.5, -4), -Math.PI / 2, materials.dark);

    createSuitDisplay(scene, -16.2, "EVA SUIT 01", materials);
    createSuitDisplay(scene, -11.8, "EVA SUIT 02", materials);
    createBox(scene, "equipment-bench", { width: 8.5, height: 1.1, depth: 2.2 }, new BABYLON.Vector3(13.8, 0.65, 14), materials.desk, true);
    for (let x = 10.8; x <= 16.8; x += 2) {
      const caseMesh = createBox(scene, `equipment-case-${x}`, { width: 1.35, height: 0.7, depth: 1.1 }, new BABYLON.Vector3(x, 1.55, 14), materials.dark, true);
      shadows.addShadowCaster(caseMesh);
    }
    createLabel(scene, "FLIGHT EQUIPMENT", 5.5, 0.75, new BABYLON.Vector3(13.8, 2.55, 15.15), BABYLON.Vector3.Zero());

    const interactions = [];
    createTerminal(scene, "mission-terminal", "MISSION SELECT", new BABYLON.Vector3(8, 0, 2), materials.blue, interactions, callbacks.onMissionTerminal);
    createTerminal(scene, "class-shop-terminal", "CLASS SHOP", new BABYLON.Vector3(-8, 0, 2), materials.red, interactions, callbacks.onClassShop);
    createTerminal(scene, "supply-shop-terminal", "SUPPLY SHOP", new BABYLON.Vector3(8, 0, 14), materials.blue, interactions, callbacks.onSupplyShop);
    createTerminal(scene, "launch-terminal", "BEGIN LAUNCH PREP", new BABYLON.Vector3(0, 0, 25), materials.blue, interactions, callbacks.onLaunchTerminal);

    createBox(scene, "launch-door-left", { width: 3.6, height: 6, depth: 0.45 }, new BABYLON.Vector3(-2, 3, 29.45), materials.dark, true);
    createBox(scene, "launch-door-right", { width: 3.6, height: 6, depth: 0.45 }, new BABYLON.Vector3(2, 3, 29.45), materials.dark, true);
    ["CREW ACCESS", "SUIT CHECK", "FLIGHT DECK"].forEach((text, index) => {
      createLabel(scene, text, 4.3, 0.58, new BABYLON.Vector3(16.1, 5.8 - index * 1.0, 21), new BABYLON.Vector3(0, -Math.PI / 2, 0), { accent: index === 0 ? "#f2a900" : "#4cc9f0" });
    });

    let nearestInteraction = null;
    let controlsEnabled = false;
    let sprinting = false;

    function updateInteraction() {
      if (!controlsEnabled) {
        callbacks.onInteractionChange?.(null);
        nearestInteraction = null;
        return;
      }
      let nearest = null;
      let distance = Infinity;
      interactions.forEach((interaction) => {
        const candidateDistance = BABYLON.Vector3.Distance(astronautView.position, interaction.position);
        if (candidateDistance < 3.2 && candidateDistance < distance) {
          nearest = interaction;
          distance = candidateDistance;
        }
      });
      if (nearest !== nearestInteraction) {
        nearestInteraction = nearest;
        callbacks.onInteractionChange?.(nearest);
      }
    }

    scene.onBeforeRenderObservable.add(updateInteraction);

    function onKeyDown(event) {
      if (event.code === "KeyV" && controlsEnabled && !event.repeat) {
        astronautView.toggleMode();
      }
      if ((event.code === "ControlLeft" || event.code === "ControlRight") && controlsEnabled) {
        astronautView.setCrouched(true);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        sprinting = true;
        camera.speed = 0.48;
      }
      if (event.code === "KeyE" && nearestInteraction && controlsEnabled) {
        nearestInteraction.onInteract?.();
      }
    }

    function onKeyUp(event) {
      if (event.code === "ControlLeft" || event.code === "ControlRight") {
        astronautView.setCrouched(false);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        sprinting = false;
        camera.speed = 0.24;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function setControlsEnabled(enabled) {
      controlsEnabled = enabled;
      if (enabled) {
        camera.attachControl(canvas, true);
      } else {
        astronautView.setCrouched(false);
        camera.detachControl();
        callbacks.onInteractionChange?.(null);
      }
    }

    function dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      scene.dispose();
    }

    return {
      scene,
      camera,
      setControlsEnabled,
      toggleCameraView: astronautView.toggleMode,
      setCameraView: astronautView.setMode,
      get cameraView() { return astronautView.mode; },
      interact: () => nearestInteraction?.onInteract?.(),
      dispose,
      get sprinting() { return sprinting; },
    };
  }

  root.LobbyScene = Object.freeze({ create });
})(globalThis);
