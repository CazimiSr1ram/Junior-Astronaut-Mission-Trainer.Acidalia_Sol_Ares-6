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
    // The texture matches the sign's shape (it used to be a fixed 4:1 texture
    // stretched over signs up to 9.6:1, smearing the lettering sideways) and
    // is drawn 1.5x larger with mipmaps for sharp text near and far.
    const H = 256;
    const W = Math.round(H * (width / height));
    const scale = Math.min(1.5, 4096 / W);
    const texture = GraphicsQuality.createTextTexture(`${text}-texture`, W, H, scene, scale);
    const context = texture.getContext();
    context.fillStyle = colors.background || "#071525";
    context.fillRect(0, 0, W, H);
    context.strokeStyle = colors.accent || "#4cc9f0";
    context.lineWidth = 14;
    context.lineJoin = "round";
    context.strokeRect(10, 10, W - 20, H - 20);
    // Thin inner line for a crisp, finished neon edge.
    context.globalAlpha = 0.45;
    context.lineWidth = 3;
    context.strokeRect(26, 26, W - 52, H - 52);
    context.globalAlpha = 1;
    context.fillStyle = colors.text || "#f8fbff";
    let fontSize = 104;
    context.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    // Shrink long titles so they fit inside the border.
    const maxTextWidth = W - 110;
    const measured = context.measureText(text).width;
    if (measured > maxTextWidth) {
      fontSize = Math.floor(fontSize * maxTextWidth / measured);
      context.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    }
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, W / 2, H / 2 + 4);
    texture.update();

    const material = new BABYLON.StandardMaterial(`${text}-material`, scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new BABYLON.Color3(0.82, 0.9, 1);
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

  function createSignPanel(scene, text, width, height, position, rotation, colors, backingMaterial) {
    const signRotation = rotation || BABYLON.Vector3.Zero();
    const facing = new BABYLON.Vector3(-Math.sin(signRotation.y), 0, -Math.cos(signRotation.y));
    const chassis = createBox(
      scene,
      `${text}-sign-chassis`,
      { width: width + 0.36, height: height + 0.3, depth: 0.24 },
      position,
      backingMaterial
    );
    chassis.rotation.copyFrom(signRotation);

    const trimMaterial = new BABYLON.StandardMaterial(`${text}-sign-trim-material`, scene);
    trimMaterial.diffuseColor = BABYLON.Color3.FromHexString(colors.accent || "#4cc9f0");
    trimMaterial.emissiveColor = trimMaterial.diffuseColor.scale(0.55);
    trimMaterial.disableLighting = true;
    const trimPosition = position.add(facing.scale(0.14));
    const trim = createBox(
      scene,
      `${text}-sign-trim`,
      { width: width + 0.14, height: height + 0.14, depth: 0.04 },
      trimPosition,
      trimMaterial
    );
    trim.rotation.copyFrom(signRotation);

    return createLabel(
      scene,
      text,
      width,
      height,
      position.add(facing.scale(0.17)),
      signRotation,
      colors
    );
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

    const texture = GraphicsQuality.createTextTexture(`${type}-monitor-texture`, 768, 432, scene, 1.5);
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
      materials.dark,
      true
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
    createLabel(scene, label, 2.6, 0.55, new BABYLON.Vector3(x, 6.12, 12.36), new BABYLON.Vector3(0, Math.atan2(x, 36.36), 0));
    return pod;
  }

  function createTerminal(scene, id, label, position, material, darkMaterial, emissive, interactions, onInteract) {
    const baseCollider = BABYLON.MeshBuilder.CreateCylinder(`${id}-base-collider`, { height: 1, diameter: 1.8, tessellation: 12 }, scene);
    baseCollider.position.copyFrom(position.add(new BABYLON.Vector3(0, 0.5, 0)));
    baseCollider.isVisible = false;
    baseCollider.checkCollisions = true;
    const standCollider = createBox(
      scene,
      `${id}-stand-collider`,
      { width: 1.2, height: 2.1, depth: 0.65 },
      position.add(new BABYLON.Vector3(0, 1.65, 0)),
      darkMaterial,
      true
    );
    standCollider.isVisible = false;

    const base = BABYLON.MeshBuilder.CreateCylinder(`${id}-base`, { height: 0.28, diameter: 2, tessellation: 24 }, scene);
    base.position.copyFrom(position.add(new BABYLON.Vector3(0, 0.14, 0)));
    base.material = material;

    const baseRing = BABYLON.MeshBuilder.CreateTorus(`${id}-base-ring`, { diameter: 1.82, thickness: 0.055, tessellation: 32 }, scene);
    baseRing.position.copyFrom(position.add(new BABYLON.Vector3(0, 0.3, 0)));
    baseRing.material = emissive;

    const support = createBox(
      scene,
      `${id}-support`,
      { width: 0.42, height: 1.12, depth: 0.46 },
      position.add(new BABYLON.Vector3(0, 0.95, 0)),
      material,
      true
    );
    support.rotation.x = -0.08;

    const housing = createBox(
      scene,
      `${id}-housing`,
      { width: 2.15, height: 1.72, depth: 0.72 },
      position.add(new BABYLON.Vector3(0, 2.24, 0)),
      darkMaterial
    );
    housing.rotation.x = -0.1;

    const screenFrame = createBox(
      scene,
      `${id}-screen-frame`,
      { width: 1.94, height: 1.4, depth: 0.06 },
      position.add(new BABYLON.Vector3(0, 2.28, -0.39)),
      material
    );
    screenFrame.rotation.x = -0.1;

    const screen = createBox(
      scene,
      `${id}-screen`,
      { width: 1.78, height: 1.24, depth: 0.04 },
      position.add(new BABYLON.Vector3(0, 2.28, -0.44)),
      darkMaterial
    );
    screen.rotation.x = -0.1;
    createLabel(scene, label, 1.68, 0.62, position.add(new BABYLON.Vector3(0, 2.28, -0.47)), new BABYLON.Vector3(-0.1, 0, 0), {
      accent: id === "launch-terminal" ? "#f2a900" : "#4cc9f0",
    });
    interactions.push({ id, label, position: position.add(new BABYLON.Vector3(0, 1.5, 0)), onInteract });
  }

  function createMarsTexture(scene) {
    const texture = new BABYLON.DynamicTexture("mission-mars-map", { width: 512, height: 256 }, scene, false);
    const context = texture.getContext();
    const surface = context.createLinearGradient(0, 0, 0, 256);
    surface.addColorStop(0, "#d88958");
    surface.addColorStop(0.48, "#ae4932");
    surface.addColorStop(1, "#66271f");
    context.fillStyle = surface;
    context.fillRect(0, 0, 512, 256);

    context.fillStyle = "rgba(77, 27, 24, 0.42)";
    [[76, 80, 52, 23, -0.24], [190, 130, 72, 26, 0.18], [342, 84, 55, 20, -0.32], [416, 183, 68, 26, 0.24]]
      .forEach(([x, y, rx, ry, angle]) => {
        context.beginPath();
        context.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
        context.fill();
      });
    context.fillStyle = "rgba(236, 155, 101, 0.52)";
    [[132, 184, 42, 16, -0.2], [286, 52, 48, 18, 0.3], [382, 129, 36, 14, -0.18]]
      .forEach(([x, y, rx, ry, angle]) => {
        context.beginPath();
        context.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
        context.fill();
      });
    context.fillStyle = "rgba(226, 218, 196, 0.8)";
    context.fillRect(0, 0, 512, 8);
    context.fillRect(0, 248, 512, 8);
    texture.update();
    return texture;
  }

  /**
   * LAUNCH PREP staging area: a gated, fenced zone with walk-on crew queue pads
   * (layout and rules in launch-queue.js). Pads are flush with the floor and
   * walkable; railings, gate posts and barriers are solid. Lights, rings,
   * floor markings and signs have no collision.
   */
  function createLaunchPrep(scene, materials, emissive, shadows) {
    const L = LaunchQueue.LAYOUT;
    const V = (x, y, z) => new BABYLON.Vector3(x, y, z);
    const amber = new BABYLON.StandardMaterial("launch-prep-amber", scene);
    amber.diffuseColor = BABYLON.Color3.FromHexString("#f2a900");
    amber.emissiveColor = BABYLON.Color3.FromHexString("#f2a900").scale(0.55);
    const cyan = new BABYLON.StandardMaterial("launch-prep-cyan", scene);
    cyan.diffuseColor = BABYLON.Color3.FromHexString("#4cc9f0");
    cyan.emissiveColor = BABYLON.Color3.FromHexString("#4cc9f0").scale(0.55);
    const soloDeck = createMaterial(scene, "launch-pad-solo", "#3b3420", 0.4, 0.45);
    const crewDeck = createMaterial(scene, "launch-pad-crew", "#14315f", 0.35, 0.45);
    const frame = createMaterial(scene, "launch-prep-frame", "#9aa5b1", 0.6, 0.35);
    const solid = (mesh) => { mesh.checkCollisions = true; shadows.addShadowCaster(mesh); return mesh; };

    function hangFromCeiling(name, center, halfWidth) {
      [-1, 1].forEach((side) => {
        const top = 7.9;
        const bottom = center.y + 0.5;
        createBox(scene, `${name}-hanger-${side}`, { width: 0.07, height: top - bottom, depth: 0.07 },
          V(center.x + side * halfWidth, (top + bottom) / 2, center.z), materials.dark);
      });
    }

    // --- Gate and barrier (the only way in) ---------------------------------------
    const gx = L.gate.halfWidth;
    [-1, 1].forEach((side) => {
      solid(createBox(scene, `launch-gate-post-${side}`, { width: 0.4, height: 4.8, depth: 0.4 }, V(side * (gx + 0.2), 2.4, L.barrierZ), frame));
      const length = 19.7 - (gx + 0.4);
      const centerX = side * (gx + 0.4 + length / 2);
      solid(createBox(scene, `launch-barrier-${side}`, { width: length, height: 1.15, depth: 0.14 }, V(centerX, 0.575, L.barrierZ), frame));
      createBox(scene, `launch-barrier-rail-${side}`, { width: length, height: 0.06, depth: 0.18 }, V(centerX, 1.18, L.barrierZ), amber);
    });
    createBox(scene, "launch-gate-header", { width: 2 * gx + 0.8, height: 0.35, depth: 0.45 }, V(0, 4.95, L.barrierZ), frame);
    createBox(scene, "launch-gate-header-light", { width: 2 * gx, height: 0.06, depth: 0.47 }, V(0, 4.76, L.barrierZ), amber);

    // --- Directional signs (arrows verified in tests/launch-queue.test.js) --------
    L.signs.forEach((sign) => {
      const position = V(sign.x, sign.y, sign.z);
      const rotation = V(0, sign.rotationY, 0);
      if (sign.id === "sign-equipment") return; // the existing hanging LAUNCH PREP sign is re-labelled below
      createSignPanel(scene, sign.text, sign.width, sign.height, position, rotation, { accent: "#f2a900" }, materials.dark);
      if (!sign.id.startsWith("sign-gate")) hangFromCeiling(sign.id, position, sign.width / 2 - 0.4);
    });

    // --- Floor markings ---------------------------------------------------------------
    createBox(scene, "launch-floor-band", { width: 2 * gx + 0.4, height: 0.012, depth: 0.45 }, V(0, 0.02, L.barrierZ - 0.8), amber);
    for (let z = 7.5; z <= 16; z += 1.7) {
      [-1, 1].forEach((side) => {
        const chevron = createBox(scene, `launch-chevron-${z}-${side}`, { width: 0.75, height: 0.012, depth: 0.14 }, V(side * 0.26, 0.021, z), amber);
        chevron.rotation.y = side * 0.62; // "^" pointing towards the gate (+z)
      });
    }

    // --- Platforms ---------------------------------------------------------------------
    function flatText(name, text, width, height, x, z, rotationY, color, fontPx, sub = null) {
      const tex = GraphicsQuality.createTextTexture(`${name}-texture`, 512, 256, scene, 1);
      const c = tex.getContext();
      c.clearRect(0, 0, 512, 256);
      c.fillStyle = color; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `800 ${fontPx}px Arial, Helvetica, sans-serif`;
      c.fillText(text, 256, sub ? 104 : 128);
      if (sub) { c.font = "700 44px Arial, Helvetica, sans-serif"; c.fillText(sub, 256, 214); }
      tex.hasAlpha = true;
      tex.update();
      const m = new BABYLON.StandardMaterial(`${name}-material`, scene);
      m.diffuseTexture = tex; m.emissiveTexture = tex; m.useAlphaFromDiffuseTexture = true;
      m.emissiveColor = new BABYLON.Color3(0.75, 0.75, 0.75); m.disableLighting = true;
      const plane = BABYLON.MeshBuilder.CreatePlane(name, { width, height }, scene);
      plane.material = m; plane.isPickable = false;
      plane.position = V(x, 0.052, z);
      plane.rotation = V(Math.PI / 2, rotationY, 0); // lying flat, readable when walking in that direction
      return plane;
    }

    const displays = new Map();
    L.pads.forEach((pad) => {
      const facing = LaunchQueue.facingGate(pad); // towards the gate (ENTER side)
      const color = pad.playable ? amber : cyan;
      const deck = BABYLON.MeshBuilder.CreateCylinder(`${pad.id}-deck`, { diameter: pad.radius * 2, height: 0.04, tessellation: 48 }, scene);
      deck.position = V(pad.x, 0.02, pad.z);
      deck.material = pad.playable ? soloDeck : crewDeck;
      deck.receiveShadows = true;
      const ring = BABYLON.MeshBuilder.CreateTorus(`${pad.id}-ring`, { diameter: pad.radius * 2, thickness: 0.07, tessellation: 48 }, scene);
      ring.position = V(pad.x, 0.045, pad.z);
      ring.scaling.y = 0.3;
      ring.material = color;

      // Numbered standing positions (walkable markers).
      LaunchQueue.standingSpots(pad).forEach((spot) => {
        const disc = BABYLON.MeshBuilder.CreateCylinder(`${pad.id}-spot-${spot.number}`, { diameter: L.spotRadius * 2, height: 0.012, tessellation: 32 }, scene);
        disc.position = V(spot.x, 0.047, spot.z);
        disc.material = color;
        disc.isPickable = false;
        flatText(`${pad.id}-spot-number-${spot.number}`, String(spot.number), 0.7, 0.35, spot.x, spot.z, facing + Math.PI, "#071525", 210);
      });

      // Solid railing with an ENTER opening (towards the gate) and an EXIT opening (far side).
      const R = pad.radius + L.railingGap;
      const arcs = [
        [facing + L.entranceOpening / 2, facing + Math.PI - L.exitOpening / 2],
        [facing + Math.PI + L.exitOpening / 2, facing + Math.PI * 2 - L.entranceOpening / 2],
      ];
      arcs.forEach(([from, to], arcIndex) => {
        const segments = 5;
        for (let i = 0; i < segments; i += 1) {
          const a0 = from + ((to - from) * i) / segments;
          const a1 = from + ((to - from) * (i + 1)) / segments;
          const mid = (a0 + a1) / 2;
          const chord = 2 * R * Math.sin((a1 - a0) / 2);
          const rail = solid(createBox(scene, `${pad.id}-rail-${arcIndex}-${i}`, { width: chord + 0.04, height: 1.0, depth: 0.08 },
            V(pad.x + R * Math.sin(mid), 0.5, pad.z + R * Math.cos(mid)), frame));
          rail.rotation.y = mid;
          const top = createBox(scene, `${pad.id}-rail-light-${arcIndex}-${i}`, { width: chord + 0.04, height: 0.05, depth: 0.12 },
            V(pad.x + R * Math.sin(mid), 1.03, pad.z + R * Math.cos(mid)), color);
          top.rotation.y = mid;
        }
      });
      // ENTER / EXIT floor labels just outside each opening.
      const outside = R + 0.75;
      flatText(`${pad.id}-enter`, "ENTER", 1.3, 0.5, pad.x + Math.sin(facing) * outside, pad.z + Math.cos(facing) * outside,
        facing + Math.PI, "#9ff2b8", 150);
      const exit = LaunchQueue.exitPoint(pad);
      flatText(`${pad.id}-exit`, "EXIT", 1.1, 0.45, exit.x, exit.z, facing + Math.PI, "#ffd166", 150); // read when walking out
      // Platform name and capacity on the floor between ENTER and the standing positions.
      const label = pad.playable ? "SOLO" : pad.title;
      const capacity = `${pad.crew} ASTRONAUT${pad.crew > 1 ? "S" : ""}`;
      const labelAt = pad.radius + L.railingGap + 1.55;
      flatText(`${pad.id}-floor-title`, label, 2.4, 1.2, pad.x + Math.sin(facing) * labelAt, pad.z + Math.cos(facing) * labelAt,
        facing + Math.PI, pad.playable ? "#f2a900" : "#bfe9ff", label.length > 6 ? 84 : 120, capacity);

      // Overhead sign: capacity, queue count and countdown, readable from both sides.
      const displayPos = V(pad.x, 4.1, pad.z);
      const texture = GraphicsQuality.createTextTexture(`${pad.id}-display`, 1040, 420, scene, 1.5);
      const material = new BABYLON.StandardMaterial(`${pad.id}-display-material`, scene);
      material.diffuseTexture = texture; material.emissiveTexture = texture;
      material.emissiveColor = new BABYLON.Color3(0.82, 0.9, 1); material.disableLighting = true;
      [0, Math.PI].forEach((turn, side) => {
        const panel = BABYLON.MeshBuilder.CreatePlane(`${pad.id}-display-${side}`, { width: 2.8, height: 1.13 }, scene);
        panel.material = material;
        panel.position = displayPos.add(V(Math.sin(facing) * (side ? -0.03 : 0.03), 0, Math.cos(facing) * (side ? -0.03 : 0.03)));
        panel.rotation.y = facing + Math.PI + turn;
        panel.isPickable = false;
      });
      createBox(scene, `${pad.id}-display-back`, { width: 2.9, height: 1.2, depth: 0.04 }, displayPos, materials.dark).rotation.y = facing;
      hangFromCeiling(pad.id, displayPos, 1.1);
      displays.set(pad.id, { pad, texture });
    });

    function draw(status) {
      const entry = displays.get(status.id);
      if (!entry) return;
      const { pad, texture } = entry;
      const c = texture.getContext();
      const accent = pad.playable ? "#f2a900" : "#4cc9f0";
      c.fillStyle = "#071525"; c.fillRect(0, 0, 1040, 420);
      c.strokeStyle = accent; c.lineWidth = 12; c.strokeRect(10, 10, 1020, 400);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#f8fbff"; c.font = "800 84px Arial, Helvetica, sans-serif";
      c.fillText(`${pad.title} · ${pad.crew} ASTRONAUT${pad.crew > 1 ? "S" : ""}`, 520, 82);
      c.fillStyle = "#bdefff"; c.font = "700 50px Arial, Helvetica, sans-serif";
      c.fillText(`IN QUEUE ${status.queued}/${pad.crew}`, 520, 170);
      const counting = status.remaining !== null && !/CANNOT|LAUNCHING/.test(status.line);
      if (counting) {
        c.fillStyle = "#ffd166"; c.font = "800 120px Arial, Helvetica, sans-serif";
        c.fillText(`${Math.ceil(status.remaining)}`, 520, 285);
      } else {
        c.fillStyle = /CANNOT/.test(status.line) ? "#ff9f9f" : pad.playable ? "#9ff2b8" : "#9fb4c8";
        c.font = `800 ${status.line.length > 30 ? 36 : 54}px Arial, Helvetica, sans-serif`;
        c.fillText(status.line, 520, 285);
      }
      c.fillStyle = "#9fb4c8"; c.font = "600 34px Arial, Helvetica, sans-serif";
      c.fillText(pad.playable ? "20-SECOND COUNTDOWN · SOLO MISSION" : "MULTIPLAYER IN DEVELOPMENT", 520, 370);
      texture.update();
    }

    return { draw };
  }

  const CROUCH_KEYS = ["ControlLeft", "ControlRight", "KeyC"];

  function create(engine, canvas, callbacks = {}) {
    const scene = new BABYLON.Scene(engine);
    // NASA-inspired training-centre palette: white panels, dark blue, grey,
    // soft cyan accents and red only as a thin stripe / welcome sign.
    scene.clearColor = BABYLON.Color4.FromHexString("#14181dff");
    scene.collisionsEnabled = true;
    scene.gravity = new BABYLON.Vector3(0, -0.24, 0);
    scene.ambientColor = new BABYLON.Color3(0.2, 0.21, 0.23);
    scene.imageProcessingConfiguration.contrast = 1.15;
    scene.imageProcessingConfiguration.exposure = 1.05;
    scene.skipPointerMovePicking = true;

    const materials = {
      floor: createMaterial(scene, "floor", "#8b949c", 0.18, 0.42),
      floorLight: createMaterial(scene, "floor-light", "#5d6670", 0.2, 0.45),
      wall: createMaterial(scene, "wall", "#dce3e8", 0.08, 0.72),
      dark: createMaterial(scene, "structure", "#2b3138", 0.6, 0.35),
      blue: createMaterial(scene, "nasa-blue", "#0b3d91", 0.2, 0.5),
      red: createMaterial(scene, "accent-red", "#b52b35", 0.22, 0.45),
      desk: createMaterial(scene, "desk", "#314254", 0.45, 0.38),
      suit: createMaterial(scene, "suit", "#e6e8e7", 0.05, 0.68),
      visor: createMaterial(scene, "visor", "#b97926", 0.76, 0.14),
    };

    const emissive = new BABYLON.StandardMaterial("light-strips", scene);
    emissive.diffuseColor = BABYLON.Color3.FromHexString("#dff4ff");
    emissive.emissiveColor = BABYLON.Color3.FromHexString("#cfeeff");

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
    const astronautView = AstronautView.create(scene, camera, {
      eyeHeight: 1.75,
      gravity: JumpPhysics.GRAVITY.earth, // 9.81 m/s^2 at Johnson Space Center
      walkSpeed: 0.24,
      sprintSpeed: 0.48,
      onStandBlocked: () => callbacks.onStandBlocked?.(),
      getGroundHeight: () => 0,
    });

    const fillLight = new BABYLON.HemisphericLight("lobby-fill", new BABYLON.Vector3(0, 1, 0), scene);
    fillLight.intensity = 0.55;
    fillLight.groundColor = new BABYLON.Color3(0.16, 0.17, 0.19);
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

    // Wall finish (flush, no collision): dark-blue lower band, thin red pinstripe,
    // cyan trim line and vertical panel seams, like a mission-centre corridor.
    const seam = createMaterial(scene, "wall-seam", "#aab4bd", 0.1, 0.6);
    const trim = new BABYLON.StandardMaterial("wall-cyan-trim", scene);
    trim.emissiveColor = BABYLON.Color3.FromHexString("#4cc9f0").scale(0.6);
    trim.disableLighting = true;
    [-1, 1].forEach((side) => {
      const x = side * 19.66;
      createBox(scene, `wall-band-${side}`, { width: 0.06, height: 1.2, depth: 59.4 }, new BABYLON.Vector3(x, 0.6, 0), materials.blue);
      createBox(scene, `wall-pinstripe-${side}`, { width: 0.065, height: 0.07, depth: 59.4 }, new BABYLON.Vector3(x, 1.3, 0), materials.red);
      createBox(scene, `wall-trim-${side}`, { width: 0.065, height: 0.04, depth: 59.4 }, new BABYLON.Vector3(x, 6.9, 0), trim);
      for (let z = -28; z <= 28; z += 4) {
        createBox(scene, `wall-seam-${side}-${z}`, { width: 0.07, height: 5.5, depth: 0.05 }, new BABYLON.Vector3(x, 4.1, z), seam);
      }
    });
    [-30, 30].forEach((z) => {
      const face = z < 0 ? 0.33 : -0.33;
      [-1, 1].forEach((side) => {
        createBox(scene, `end-wall-band-${z}-${side}`, { width: 15.4, height: 1.2, depth: 0.06 }, new BABYLON.Vector3(side * 12.25, 0.6, z + face), materials.blue);
        createBox(scene, `end-wall-pinstripe-${z}-${side}`, { width: 15.4, height: 0.07, depth: 0.065 }, new BABYLON.Vector3(side * 12.25, 1.3, z + face), materials.red);
      });
    });

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

    createLabel(scene, "WELCOME — MISSION TRAINING CENTER", 12, 1.25, new BABYLON.Vector3(0, 6.25, -29.62), new BABYLON.Vector3(0, Math.PI, 0), { accent: "#ef3e42" });
    createSignPanel(scene, "MISSION BRIEFING", 8.5, 1, new BABYLON.Vector3(0, 6.15, -7), BABYLON.Vector3.Zero(), { accent: "#4cc9f0" }, materials.dark);
    // Area signs on the side walls (readable from the central walkway).
    createLabel(scene, "ASTRONAUT TRAINING", 7, 0.9, new BABYLON.Vector3(-19.62, 5.3, -18), new BABYLON.Vector3(0, -Math.PI / 2, 0), { accent: "#4cc9f0", background: "#0b1d33" });
    createLabel(scene, "MISSION OPERATIONS", 7, 0.9, new BABYLON.Vector3(19.62, 5.3, -18), new BABYLON.Vector3(0, Math.PI / 2, 0), { accent: "#4cc9f0", background: "#0b1d33" });
    createLabel(scene, "SUIT PREPARATION", 6, 0.8, new BABYLON.Vector3(-16.1, 6.5, 10), new BABYLON.Vector3(0, -Math.atan2(16.1, 34), 0));
    const launchSignPosition = new BABYLON.Vector3(12.8, 5.8, 13);
    const launchSignRotation = new BABYLON.Vector3(0, Math.atan2(12.8, 37), 0);
    // Arrow corrected: from here the LAUNCH PREP gate is to the reader's LEFT (was "→").
    const equipmentSign = LaunchQueue.LAYOUT.signs.find((sign) => sign.id === "sign-equipment");
    createSignPanel(scene, equipmentSign.text, 5.5, 0.9, launchSignPosition, launchSignRotation, { accent: "#f2a900" }, materials.dark);
    const launchSignWidthDirection = new BABYLON.Vector3(Math.cos(launchSignRotation.y), 0, -Math.sin(launchSignRotation.y));
    [-1, 1].forEach((side) => {
      createBox(
        scene,
        `launch-sign-hanger-${side}`,
        { width: 0.12, height: 1.55, depth: 0.12 },
        launchSignPosition.add(launchSignWidthDirection.scale(side * 2.55)).add(new BABYLON.Vector3(0, 1.22, 0)),
        materials.dark
      );
    });

    const briefingPlatform = BABYLON.MeshBuilder.CreateCylinder("briefing-platform", { diameter: 14, height: 0.22, tessellation: 48 }, scene);
    briefingPlatform.position = new BABYLON.Vector3(0, 0.12, -4);
    briefingPlatform.material = materials.blue;
    briefingPlatform.metadata = { standable: true }; // a low step you can walk up onto
    const briefingTable = BABYLON.MeshBuilder.CreateCylinder("briefing-table", { diameter: 7.5, height: 1.05, tessellation: 48 }, scene);
    briefingTable.scaling.z = 0.58;
    briefingTable.position = new BABYLON.Vector3(0, 1.05, -4);
    briefingTable.material = materials.desk;
    briefingTable.checkCollisions = true;
    shadows.addShadowCaster(briefingTable);
    const holoBase = BABYLON.MeshBuilder.CreateCylinder("mission-display-base", { diameter: 2.4, height: 0.35, tessellation: 32 }, scene);
    holoBase.position = new BABYLON.Vector3(0, 1.76, -4);
    holoBase.material = materials.dark;
    holoBase.checkCollisions = true; // the exhibit base is solid; the hologram above it is not
    const holo = BABYLON.MeshBuilder.CreateSphere("mission-hologram", { diameter: 1.65, segments: 28 }, scene);
    holo.position = new BABYLON.Vector3(0, 3.1, -4);
    const marsMaterial = new BABYLON.StandardMaterial("mission-mars-material", scene);
    marsMaterial.diffuseTexture = createMarsTexture(scene);
    marsMaterial.emissiveColor = new BABYLON.Color3(0.26, 0.1, 0.055);
    marsMaterial.specularColor = new BABYLON.Color3(0.3, 0.5, 0.62);
    marsMaterial.specularPower = 36;
    holo.material = marsMaterial;

    const hologramTrim = new BABYLON.StandardMaterial("mission-hologram-trim", scene);
    hologramTrim.diffuseColor = new BABYLON.Color3(0.14, 0.7, 0.95);
    hologramTrim.emissiveColor = new BABYLON.Color3(0.08, 0.5, 0.82);
    hologramTrim.disableLighting = true;
    const holoRing = BABYLON.MeshBuilder.CreateTorus("mission-hologram-orbit", { diameter: 2.16, thickness: 0.035, tessellation: 48 }, scene);
    holoRing.position.copyFrom(holo.position);
    holoRing.rotation.x = 0.58;
    const holoRing2 = BABYLON.MeshBuilder.CreateTorus("mission-hologram-orbit-secondary", { diameter: 2.32, thickness: 0.018, tessellation: 48 }, scene);
    holoRing2.position.copyFrom(holo.position);
    holoRing2.rotation.x = 1.12;
    holoRing2.rotation.y = 0.35;
    holoRing.material = hologramTrim;
    holoRing2.material = hologramTrim;
    const holoBaseRing = BABYLON.MeshBuilder.CreateTorus("mission-display-emitter-ring", { diameter: 2.25, thickness: 0.045, tessellation: 40 }, scene);
    holoBaseRing.position = new BABYLON.Vector3(0, 1.98, -4);
    holoBaseRing.material = hologramTrim;

    scene.onBeforeRenderObservable.add(() => {
      const animationRatio = scene.getAnimationRatio();
      holo.rotation.y += 0.008 * animationRatio;
      holoRing.rotation.y += 0.003 * animationRatio;
      holoRing2.rotation.y -= 0.002 * animationRatio;
    });
    // Briefing chairs around the Mars exhibit (previously plain dark cubes):
    // pedestal, seat and backrest facing the table, one invisible solid collider.
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const cx = Math.sin(angle) * 5.5;
      const cz = -4 + Math.cos(angle) * 3.65;
      const face = Math.atan2(-cx, -4 - cz); // towards the table centre
      const chair = new BABYLON.TransformNode(`briefing-chair-${angle.toFixed(2)}`, scene);
      chair.position = new BABYLON.Vector3(cx, 0, cz);
      chair.rotation.y = face;
      const piece = (name, mesh, material, x, y, z) => {
        mesh.parent = chair; mesh.position = new BABYLON.Vector3(x, y, z); mesh.material = material; shadows.addShadowCaster(mesh); return mesh;
      };
      piece("pedestal", BABYLON.MeshBuilder.CreateCylinder(`chair-pedestal-${angle}`, { diameter: 0.14, height: 0.42, tessellation: 12 }, scene), materials.dark, 0, 0.26, 0);
      piece("foot", BABYLON.MeshBuilder.CreateCylinder(`chair-foot-${angle}`, { diameter: 0.6, height: 0.05, tessellation: 20 }, scene), materials.dark, 0, 0.03, 0);
      piece("seat", BABYLON.MeshBuilder.CreateBox(`chair-seat-${angle}`, { width: 0.7, height: 0.12, depth: 0.66 }, scene), materials.blue, 0, 0.52, 0);
      piece("back", BABYLON.MeshBuilder.CreateBox(`chair-back-${angle}`, { width: 0.7, height: 0.72, depth: 0.1 }, scene), materials.blue, 0, 0.92, -0.3);
      piece("trim", BABYLON.MeshBuilder.CreateBox(`chair-trim-${angle}`, { width: 0.72, height: 0.05, depth: 0.12 }, scene), materials.wall, 0, 1.3, -0.3);
      const collider = BABYLON.MeshBuilder.CreateBox(`chair-collider-${angle}`, { width: 0.78, height: 1.3, depth: 0.78 }, scene);
      collider.parent = chair; collider.position = new BABYLON.Vector3(0, 0.65, -0.02);
      collider.isVisible = false; collider.isPickable = false; collider.checkCollisions = true;
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
    createLabel(scene, "FLIGHT EQUIPMENT", 5.5, 0.75, new BABYLON.Vector3(13.8, 2.55, 15.15), new BABYLON.Vector3(0, Math.atan2(13.8, 39.15), 0));

    const interactions = [];
    createTerminal(scene, "mission-terminal", "MISSION INFO", new BABYLON.Vector3(8, 0, 2), materials.blue, materials.dark, emissive, interactions, callbacks.onMissionTerminal);
    createTerminal(scene, "class-shop-terminal", "CLASS SHOP", new BABYLON.Vector3(-8, 0, 2), materials.red, materials.dark, emissive, interactions, callbacks.onClassShop);
    createTerminal(scene, "supply-shop-terminal", "SUPPLY SHOP", new BABYLON.Vector3(8, 0, 14), materials.blue, materials.dark, emissive, interactions, callbacks.onSupplyShop);
    // LAUNCH PREP: walk onto a crew pad to join a mission (replaces the launch terminal).
    const launchPrep = createLaunchPrep(scene, materials, emissive, shadows);
    const queue = LaunchQueue.create({
      onChange(snapshot) {
        snapshot.pads.forEach((pad) => launchPrep.draw(pad));
        callbacks.onQueueChange?.(snapshot);
      },
      onLaunch(padId) { callbacks.onLaunchPad?.(padId); },
    });
    queue.snapshot().pads.forEach((pad) => launchPrep.draw(pad));

    createBox(scene, "launch-door-left", { width: 3.6, height: 6, depth: 0.45 }, new BABYLON.Vector3(-2, 3, 29.45), materials.dark, true);
    createBox(scene, "launch-door-right", { width: 3.6, height: 6, depth: 0.45 }, new BABYLON.Vector3(2, 3, 29.45), materials.dark, true);
    ["CREW ACCESS", "SUIT CHECK", "FLIGHT DECK"].forEach((text, index) => {
      createLabel(scene, text, 4.3, 0.58, new BABYLON.Vector3(16.1, 5.1 - index * 0.9, 21), new BABYLON.Vector3(0, 0.35, 0), { accent: index === 0 ? "#f2a900" : "#4cc9f0" });
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
    scene.onBeforeRenderObservable.add(() => {
      if (!controlsEnabled) return; // menus / cutscene: queue state is kept, countdown paused
      const feet = astronautView.feet;
      queue.setPlayerPad(LaunchQueue.padAt(feet.x, feet.z));
      queue.tick(Math.min(0.25, engine.getDeltaTime() / 1000 || 0));
    });

    /** Leave Queue: steps the astronaut out through the platform's EXIT, which empties the queue. */
    function leaveQueue() {
      const pad = LaunchQueue.padById(queue.padId);
      if (!pad || queue.launched) return false;
      const exit = LaunchQueue.exitPoint(pad);
      astronautView.setFeetPosition(exit.x, exit.z);
      queue.leave();
      return true;
    }

    function onKeyDown(event) {
      // Space: jump (not while typing; controls are disabled in menus and cutscenes).
      if (event.code === "Space") {
        const typing = event.target?.closest?.("input, textarea, select, [contenteditable='true']");
        if (controlsEnabled && !typing) {
          event.preventDefault(); // no page scroll / button activation
          if (!event.repeat) astronautView.jump();
        }
      }
      if (event.code === "KeyV" && controlsEnabled && !event.repeat) {
        astronautView.toggleMode();
      }
      // Crouch: Ctrl, or C (Ctrl+W closes the browser tab on Windows/Chromebooks).
      if (CROUCH_KEYS.includes(event.code) && controlsEnabled) {
        astronautView.setCrouched(true);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        sprinting = true;
        astronautView.setSprinting(true);
      }
      if (event.code === "KeyE" && nearestInteraction && controlsEnabled) {
        nearestInteraction.onInteract?.();
      }
    }

    function onKeyUp(event) {
      if (CROUCH_KEYS.includes(event.code)) {
        astronautView.setCrouched(false);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        sprinting = false;
        astronautView.setSprinting(false);
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

    // Graphics quality (visual only). Glow is limited to the light-strip
    // meshes so signs and text are never bloomed into unreadability.
    let glowLayer = null;
    function applyGraphics(preset) {
      shadows.getShadowMap().resize(preset.shadowMapSize.lobby);
      shadows.useBlurExponentialShadowMap = preset.shadowFiltering !== "low";
      shadows.useExponentialShadowMap = preset.shadowFiltering === "low";
      shadows.blurKernel = preset.shadowFiltering === "high" ? 24 : 20;
      if (preset.glow && !glowLayer) {
        glowLayer = new BABYLON.GlowLayer("lobby-light-glow", scene, { mainTextureRatio: 0.5, blurKernelSize: 32 });
        glowLayer.intensity = 0.45;
        scene.meshes.filter((mesh) => mesh.material === emissive).forEach((mesh) => glowLayer.addIncludedOnlyMesh(mesh));
      } else if (!preset.glow && glowLayer) {
        glowLayer.dispose();
        glowLayer = null;
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
      queue,
      leaveQueue,
      get astronautFeet() { return astronautView.feet; },
      get astronaut() { return astronautView; },
      teleport: (x, z) => astronautView.setFeetPosition(x, z),
      applyGraphics,
      dispose,
      get sprinting() { return sprinting; },
    };
  }

  root.LobbyScene = Object.freeze({ create });
})(globalThis);
