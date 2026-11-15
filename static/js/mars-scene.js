(function (root) {
  "use strict";

  // Procedural Mars-like surface. The terrain is generated (see mars-terrain.js);
  // it is not NASA elevation data and is not presented as a real location.

  const WALK_SPEED = 0.3;
  const SPRINT_SPEED = 0.6;
  const EYE_HEIGHT = 1.75;
  const CROUCH_KEYS = ["ControlLeft", "ControlRight", "KeyC"];
  const SHADOW_EXTENT = 60;

  function v3(x, y, z) {
    return new BABYLON.Vector3(x, y, z);
  }

  function color3(rgb) {
    return new BABYLON.Color3(rgb[0], rgb[1], rgb[2]);
  }

  function pbr(scene, name, rgb, roughness, metallic = 0) {
    const material = new BABYLON.PBRMaterial(name, scene);
    material.albedoColor = color3(rgb);
    material.roughness = roughness;
    material.metallic = metallic;
    return material;
  }

  function rawTexture(scene, data, size) {
    const texture = BABYLON.RawTexture.CreateRGBATexture(
      data, size, size, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 8;
    return texture;
  }

  function createTerrainMesh(scene, terrain, soil) {
    const data = terrain.buildMeshData();
    const normals = new Float32Array(data.positions.length);
    BABYLON.VertexData.ComputeNormals(data.positions, data.indices, normals);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = data.positions;
    vertexData.indices = data.indices;
    vertexData.normals = normals;
    vertexData.uvs = data.uvs;
    vertexData.colors = data.colors;
    const mesh = new BABYLON.Mesh("marsTerrain", scene);
    vertexData.applyToMesh(mesh, false);

    const material = new BABYLON.PBRMaterial("marsSoil", scene);
    material.albedoColor = BABYLON.Color3.White();
    material.albedoTexture = rawTexture(scene, soil.albedo, soil.size);
    material.bumpTexture = rawTexture(scene, soil.normal, soil.size);
    material.bumpTexture.level = 0.9;
    material.metallic = 0;
    material.roughness = 0.96;
    material.environmentIntensity = 0;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }

  function createRockSource(scene, name, variant, subdivisions, material) {
    const mesh = BABYLON.MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions, flat: true }, scene);
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const squashY = variant === 2 ? 0.5 : 0.78;
    const stretchZ = variant === 1 ? 1.25 : 1;
    for (let i = 0; i < positions.length; i += 3) {
      const k = MarsTerrain.rockDisplacement(positions[i], positions[i + 1], positions[i + 2], variant);
      positions[i] *= k;
      positions[i + 1] *= k * squashY;
      positions[i + 2] *= k * stretchZ;
    }
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, mesh.getIndices(), normals);
    mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    mesh.refreshBoundingInfo();
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  function rockMatrix(rock) {
    return BABYLON.Matrix.Compose(
      v3(rock.scale, rock.scale * rock.stretchY, rock.scale),
      BABYLON.Quaternion.FromEulerAngles(rock.tiltX, rock.rotationY, rock.tiltZ),
      v3(rock.x, rock.y, rock.z)
    );
  }

  function createRocks(scene, terrain, materials, shadows) {
    const scatter = MarsTerrain.scatterRocks(terrain);

    // Small rocks: one draw call per variant via thin instances, no collisions.
    [0, 1, 2].forEach((variant) => {
      const rocks = scatter.small.filter((rock) => rock.variant === variant);
      const source = createRockSource(scene, `marsRockSmall${variant}`, variant, 1, materials.rocks[variant]);
      const buffer = new Float32Array(rocks.length * 16);
      rocks.forEach((rock, index) => rockMatrix(rock).copyToArray(buffer, index * 16));
      source.thinInstanceSetBuffer("matrix", buffer, 16, true);
      source.thinInstanceRefreshBoundingInfo(false);
      source.receiveShadows = true;
    });

    // Boulders and formations: mesh instances with collisions and shadows.
    const sources = [0, 1, 2].map((variant) =>
      createRockSource(scene, `marsBoulder${variant}`, variant, 2, materials.rocks[variant]));
    const used = [false, false, false];
    scatter.boulders.forEach((rock, index) => {
      let mesh;
      if (!used[rock.variant]) {
        mesh = sources[rock.variant];
        used[rock.variant] = true;
      } else {
        mesh = sources[rock.variant].createInstance(`marsBoulder-${index}`);
      }
      mesh.position.set(rock.x, rock.y, rock.z);
      mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(rock.tiltX, rock.rotationY, rock.tiltZ);
      mesh.scaling.set(rock.scale, rock.scale * rock.stretchY, rock.scale);
      mesh.checkCollisions = true;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    });
    sources.forEach((source, variant) => {
      if (!used[variant]) source.setEnabled(false);
      source.receiveShadows = true;
      shadows.addShadowCaster(source);
    });
    return { small: scatter.small.length, boulders: scatter.boulders.length };
  }

  function createBase(scene, terrain, materials, shadows) {
    const layout = MarsTerrain.BASE_LAYOUT;
    const sites = {};

    function ground(site) {
      return terrain.heightAt(site.x, site.z);
    }

    function part(mesh, material, position, { collide = false, caster = true } = {}) {
      mesh.material = material;
      mesh.position.copyFrom(position);
      mesh.checkCollisions = collide;
      mesh.receiveShadows = true;
      if (caster) shadows.addShadowCaster(mesh);
      return mesh;
    }

    function collider(name, size, position) {
      const box = BABYLON.MeshBuilder.CreateBox(name, size, scene);
      box.position.copyFrom(position);
      box.isVisible = false;
      box.isPickable = false;
      box.checkCollisions = true;
      return box;
    }

    // Habitat: temporary inflatable crew shelter (temp-habitat.js). Visuals and
    // layout only; airlock/atmosphere stay in habitat-systems.js and resting in
    // rest-system.js. Swap for the final .glb habitat by replacing TempHabitat.create.
    {
      const site = layout.habitat;
      const y = ground(site);
      const center = v3(site.x, y, site.z);
      const temp = TempHabitat.create(scene, center, { shadows, frame: materials.frame, accent: materials.accent });
      const entry = temp.interactions.find((item) => item.id === "habitat-entry");
      sites.habitat = { mesh: temp.collider, position: center, interactionPoint: entry.position.clone(), interactions: temp.interactions, podsReady: temp.podsReady, setStage: temp.setStage };
    }

    // Greenhouse: translucent tunnel with planter beds.
    {
      const site = layout.greenhouse;
      const y = ground(site);
      const tunnel = BABYLON.MeshBuilder.CreateCylinder("marsGreenhouse", {
        diameter: 6, height: 12, tessellation: 32, arc: 0.5, enclose: false,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      }, scene);
      // Half-cylinder: roll puts the axis along x, pitch turns the open side down.
      tunnel.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      part(tunnel, materials.glass, v3(site.x, y, site.z), { caster: false });
      for (let rib = -6; rib <= 6; rib += 2) {
        const arch = BABYLON.MeshBuilder.CreateTorus(`marsGreenhouseRib${rib}`, { diameter: 6, thickness: 0.14, tessellation: 32 }, scene);
        arch.rotation.z = Math.PI / 2;
        part(arch, materials.frame, v3(site.x + rib, y, site.z));
      }
      [-1, 1].forEach((side) => {
        part(BABYLON.MeshBuilder.CreateBox(`marsGreenhouseBed${side}`, { width: 10.5, height: 0.6, depth: 1.2 }, scene),
          materials.planter, v3(site.x, y + 0.3, site.z + side * 1.4), { caster: false });
        part(BABYLON.MeshBuilder.CreateBox(`marsGreenhousePlants${side}`, { width: 10, height: 0.35, depth: 1 }, scene),
          materials.plants, v3(site.x, y + 0.75, site.z + side * 1.4), { caster: false });
      });
      collider("marsGreenhouseCollider", { width: 12, height: 3, depth: 6 }, v3(site.x, y + 1.5, site.z));
      sites.greenhouse = { mesh: tunnel, position: v3(site.x, y, site.z), interactionPoint: v3(site.x + 6.8, y + 1.5, site.z) };
    }

    // Solar array: three rows of tilted panels on legs.
    {
      const site = layout.solarArray;
      const y = ground(site);
      const anchor = new BABYLON.TransformNode("marsSolarArray", scene);
      anchor.position.set(site.x, y, site.z);
      for (let row = -1; row <= 1; row += 1) {
        for (let col = -1.5; col <= 1.5; col += 1) {
          const panel = BABYLON.MeshBuilder.CreateBox(`marsSolarPanel-${row}-${col}`, { width: 3, height: 0.08, depth: 1.8 }, scene);
          part(panel, materials.solar, v3(site.x + col * 3.2, y + 1.3, site.z + row * 4));
          panel.rotation.x = -0.45; // tilted towards the southern sun (-z)
          const leg = BABYLON.MeshBuilder.CreateCylinder(`marsSolarLeg-${row}-${col}`, { diameter: 0.12, height: 1.3 }, scene);
          part(leg, materials.frame, v3(site.x + col * 3.2, y + 0.65, site.z + row * 4), { caster: false });
        }
        collider(`marsSolarCollider-${row}`, { width: 13, height: 1.8, depth: 1.8 }, v3(site.x, y + 0.9, site.z + row * 4));
      }
      sites.solarArray = { mesh: anchor, position: v3(site.x, y, site.z), interactionPoint: v3(site.x - 8, y + 1.5, site.z) };
    }

    // Research station: lab module, instrument mast and sample tripod.
    {
      const site = layout.researchStation;
      const y = ground(site);
      const lab = part(BABYLON.MeshBuilder.CreateBox("marsResearchStation", { width: 5, height: 3, depth: 4 }, scene),
        materials.hull, v3(site.x, y + 1.5, site.z), { collide: true });
      part(BABYLON.MeshBuilder.CreateBox("marsResearchStripe", { width: 5.02, height: 0.3, depth: 4.02 }, scene),
        materials.accent, v3(site.x, y + 2.4, site.z), { caster: false });
      part(BABYLON.MeshBuilder.CreateCylinder("marsResearchMast", { diameter: 0.15, height: 4 }, scene),
        materials.frame, v3(site.x + 1.8, y + 5, site.z + 1.2));
      part(BABYLON.MeshBuilder.CreateSphere("marsWeatherSensor", { diameter: 0.5, segments: 12 }, scene),
        materials.accent, v3(site.x + 1.8, y + 7.1, site.z + 1.2), { caster: false });
      sites.researchStation = { mesh: lab, position: v3(site.x, y, site.z), interactionPoint: v3(site.x + 3.3, y + 1.5, site.z) };
    }

    // Communications dish.
    {
      const site = layout.commsDish;
      const y = ground(site);
      const mast = part(BABYLON.MeshBuilder.CreateCylinder("marsCommsMast", { diameter: 0.5, height: 3 }, scene),
        materials.frame, v3(site.x, y + 1.5, site.z), { collide: true });
      const dish = BABYLON.MeshBuilder.CreateSphere("marsCommsDish", {
        diameter: 4, slice: 0.3, segments: 24, sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      }, scene);
      part(dish, materials.hull, v3(site.x, y + 3.4, site.z));
      dish.rotation.x = Math.PI * 0.72;
      sites.commsDish = { mesh: mast, position: v3(site.x, y, site.z), interactionPoint: v3(site.x - 2.5, y + 1.5, site.z) };
    }

    // Static base structures never move. (The temporary habitat is excluded: it
    // is packed, inflates while being assembled and then stands still.)
    scene.meshes.forEach((mesh) => {
      if (/^mars(Greenhouse|Solar|Research|Weather|Comms)/.test(mesh.name)) mesh.freezeWorldMatrix();
    });
    return sites;
  }

  function createSky(scene) {
    const texture = new BABYLON.DynamicTexture("marsSkyTexture", { width: 512, height: 256 }, scene, false);
    const material = new BABYLON.StandardMaterial("marsSky", scene);
    material.emissiveTexture = texture;
    material.diffuseColor = BABYLON.Color3.Black();
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.fogEnabled = false;
    const dome = BABYLON.MeshBuilder.CreateSphere("marsSkyDome", { diameter: 1800, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    dome.material = material;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;

    // Stars are a point cloud on the dome so they stay crisp at any resolution.
    const random = MarsTerrain.mulberry32(777);
    const starPositions = [];
    const starColors = [];
    for (let i = 0; i < 900; i += 1) {
      const azimuth = random() * Math.PI * 2;
      const elevation = Math.asin(0.05 + random() * 0.95);
      const brightness = 0.35 + random() ** 2 * 0.65;
      starPositions.push(Math.cos(elevation) * Math.cos(azimuth) * 850, Math.sin(elevation) * 850, Math.cos(elevation) * Math.sin(azimuth) * 850);
      starColors.push(brightness, brightness * 0.97, brightness * 0.92, 1);
    }
    const starField = new BABYLON.Mesh("marsStars", scene);
    const starData = new BABYLON.VertexData();
    starData.positions = starPositions;
    starData.colors = starColors;
    starData.indices = Array.from({ length: starPositions.length / 3 }, (_, index) => index);
    starData.applyToMesh(starField);
    const starMaterial = new BABYLON.StandardMaterial("marsStarMaterial", scene);
    starMaterial.emissiveColor = BABYLON.Color3.White();
    starMaterial.disableLighting = true;
    starMaterial.pointsCloud = true;
    starMaterial.pointSize = 1.6;
    starMaterial.fogEnabled = false;
    starField.material = starMaterial;
    starField.infiniteDistance = true;
    starField.isPickable = false;
    starField.applyFog = false;
    let lastKey = "";

    function css(rgb, alpha = 1) {
      return `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${alpha})`;
    }

    function update(env) {
      starMaterial.alpha = env.starVisibility;
      starField.setEnabled(env.starVisibility > 0.02);
      const key = [...env.skyZenith, ...env.skyHorizon].map((v) => v.toFixed(2)).join(",");
      if (key === lastKey) return;
      lastKey = key;
      const ctx = texture.getContext();
      // Texture v=0 is the top of the canvas; on the sphere that maps to the zenith.
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, css(env.skyZenith));
      gradient.addColorStop(0.42, css(env.skyHorizon.map((v, i) => (v + env.skyZenith[i]) / 2)));
      gradient.addColorStop(0.5, css(env.skyHorizon));
      gradient.addColorStop(1, css(env.skyHorizon.map((v) => v * 0.7)));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 512, 256);
      texture.update(false);
    }

    return { dome, update };
  }

  function createSunDisc(scene) {
    const texture = new BABYLON.DynamicTexture("marsSunTexture", { width: 128, height: 128 }, scene, false);
    const ctx = texture.getContext();
    const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "rgba(255,250,240,1)");
    glow.addColorStop(0.08, "rgba(255,245,230,1)");
    glow.addColorStop(0.16, "rgba(255,220,190,0.35)");
    glow.addColorStop(1, "rgba(255,200,160,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);
    texture.hasAlpha = true;
    texture.update(false);
    const material = new BABYLON.StandardMaterial("marsSunMaterial", scene);
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.fogEnabled = false;
    const disc = BABYLON.MeshBuilder.CreatePlane("marsSunDisc", { size: 90 }, scene);
    disc.material = material;
    disc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    disc.infiniteDistance = true;
    disc.isPickable = false;
    disc.applyFog = false;
    return { disc, material };
  }

  function createDust(scene) {
    const texture = new BABYLON.DynamicTexture("marsDustParticle", { width: 64, height: 64 }, scene, false);
    const ctx = texture.getContext();
    const puff = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    puff.addColorStop(0, "rgba(255,255,255,0.9)");
    puff.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = puff;
    ctx.fillRect(0, 0, 64, 64);
    texture.hasAlpha = true;
    texture.update(false);
    const emitter = v3(0, 0, 0);
    const particles = new BABYLON.ParticleSystem("marsDustStorm", 3000, scene);
    particles.particleTexture = texture;
    particles.emitter = emitter;
    particles.minEmitBox = v3(-35, -1, -35);
    particles.maxEmitBox = v3(35, 12, 35);
    particles.color1 = new BABYLON.Color4(0.8, 0.55, 0.34, 0.32);
    particles.color2 = new BABYLON.Color4(0.66, 0.42, 0.26, 0.22);
    particles.colorDead = new BABYLON.Color4(0.6, 0.4, 0.25, 0);
    particles.minSize = 0.4;
    particles.maxSize = 1.8;
    particles.minLifeTime = 2.5;
    particles.maxLifeTime = 5;
    particles.direction1 = v3(10, -0.4, 4);
    particles.direction2 = v3(16, 1, 7);
    particles.minEmitPower = 1;
    particles.maxEmitPower = 2;
    particles.updateSpeed = 0.02;
    particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    particles.emitRate = 0;
    particles.start();
    return { particles, emitter };
  }

  // Survey beacons for missions: tripod + glowing beacon + floating label.
  function createSurveyMarkers(scene, terrain, markers, shadows) {
    const handles = {};
    const interactions = markers.map((marker) => {
      const y = terrain.heightAt(marker.x, marker.z);
      const node = new BABYLON.TransformNode(`marsSurvey-${marker.id}`, scene);
      node.position.set(marker.x, y, marker.z);
      const legMaterial = pbr(scene, `marsSurveyLeg-${marker.id}`, [0.55, 0.57, 0.6], 0.4, 0.6);
      for (let i = 0; i < 3; i += 1) {
        const angle = (i * Math.PI * 2) / 3;
        const leg = BABYLON.MeshBuilder.CreateCylinder(`marsSurveyLeg-${marker.id}-${i}`, { diameter: 0.06, height: 1.3 }, scene);
        leg.parent = node;
        leg.position.set(Math.cos(angle) * 0.25, 0.62, Math.sin(angle) * 0.25);
        leg.rotation.set(Math.sin(angle) * 0.35, 0, -Math.cos(angle) * 0.35);
        leg.material = legMaterial;
        leg.isPickable = false;
      }
      const beaconMaterial = new BABYLON.StandardMaterial(`marsSurveyBeacon-${marker.id}`, scene);
      beaconMaterial.diffuseColor = new BABYLON.Color3(1, 0.45, 0.08);
      beaconMaterial.emissiveColor = new BABYLON.Color3(1, 0.42, 0.05);
      const beacon = BABYLON.MeshBuilder.CreateSphere(`marsSurveyBeaconMesh-${marker.id}`, { diameter: 0.32, segments: 12 }, scene);
      beacon.parent = node;
      beacon.position.y = 1.35;
      beacon.material = beaconMaterial;
      beacon.isPickable = false;
      shadows.addShadowCaster(beacon);

      const texture = GraphicsQuality.createTextTexture(`marsSurveyLabel-${marker.id}`, 512, 128, scene, 2);
      const ctx = texture.getContext();
      ctx.fillStyle = "#071525";
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = "#f2a900";
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, 502, 118);
      ctx.fillStyle = "#f8fbff";
      ctx.font = "600 64px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(marker.label, 256, 68);
      texture.update();
      const labelMaterial = new BABYLON.StandardMaterial(`marsSurveyLabelMaterial-${marker.id}`, scene);
      labelMaterial.diffuseTexture = texture;
      labelMaterial.emissiveTexture = texture;
      labelMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.8, 0.8);
      labelMaterial.disableLighting = true;
      labelMaterial.backFaceCulling = false;
      const sign = BABYLON.MeshBuilder.CreatePlane(`marsSurveySign-${marker.id}`, { width: 1.2, height: 0.3 }, scene);
      sign.parent = node;
      sign.position.y = 1.9;
      sign.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
      sign.material = labelMaterial;
      sign.isPickable = false;

      handles[marker.id] = (inspected) => {
        const color = inspected ? new BABYLON.Color3(0.15, 0.95, 0.4) : new BABYLON.Color3(1, 0.42, 0.05);
        beaconMaterial.emissiveColor = color;
        beaconMaterial.diffuseColor = color;
      };
      return { id: marker.id, label: `Inspect ${marker.label}`, position: v3(marker.x, y + 1.4, marker.z), radius: 2.4, surveyMarker: true };
    });
    return { interactions, setInspected: (id, inspected) => handles[id]?.(inspected) };
  }

  function blendEnvironment(current, target, k) {
    if (!current) return JSON.parse(JSON.stringify(target));
    Object.keys(target).forEach((key) => {
      const value = target[key];
      if (typeof value === "number") current[key] += (value - current[key]) * k;
      else if (Array.isArray(value)) value.forEach((v, i) => { current[key][i] += (v - current[key][i]) * k; });
      else current[key] = value;
    });
    return current;
  }

  function create(engine, canvas, callbacks = {}, options = {}) {
    const scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;
    scene.skipPointerMovePicking = true;
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.imageProcessingConfiguration.contrast = 1.12;
    scene.imageProcessingConfiguration.exposure = 1.05;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;

    const terrain = MarsTerrain.createTerrain();
    const soil = MarsTerrain.generateSoilTextures();

    // Camera is positioned at the lander spawn once the lander has been built.
    const camera = new BABYLON.UniversalCamera("astronautCamera", v3(0, EYE_HEIGHT, 0), scene);
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.maxZ = 2500;
    camera.speed = WALK_SPEED;
    camera.inertia = 0.72;
    camera.angularSensibility = 3600;
    camera.keysUp = [87];
    camera.keysDown = [83];
    camera.keysLeft = [65];
    camera.keysRight = [68];
    camera.checkCollisions = true;
    camera.applyGravity = false; // ground-following is handled by AstronautView + terrain
    camera.ellipsoid = v3(0.45, 0.85, 0.45);
    camera.ellipsoidOffset = v3(0, 0, 0);

    const sun = new BABYLON.DirectionalLight("sun", v3(-0.3, -0.8, 0.4), scene);
    sun.autoUpdateExtends = false;
    sun.autoCalcShadowZBounds = false;
    sun.orthoLeft = -SHADOW_EXTENT;
    sun.orthoRight = SHADOW_EXTENT;
    sun.orthoTop = SHADOW_EXTENT;
    sun.orthoBottom = -SHADOW_EXTENT;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 600;
    sun.specular = new BABYLON.Color3(0.3, 0.27, 0.24);
    const skyFill = new BABYLON.HemisphericLight("skyFill", v3(0, 1, 0), scene);
    skyFill.specular = BABYLON.Color3.Black();
    const helmetLamp = new BABYLON.SpotLight("helmetLamp", camera.position.clone(), v3(0, 0, 1), 1.05, 2, scene);
    helmetLamp.diffuse = new BABYLON.Color3(1, 0.96, 0.9);
    helmetLamp.range = 45;
    helmetLamp.intensity = 0;

    const shadows = new BABYLON.ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0015;
    shadows.normalBias = 0.02;

    // Graphics quality (visual only): shadow resolution/filtering and dust density.
    let dustScale = 1;
    const SHADOW_FILTERING = {
      low: BABYLON.ShadowGenerator.QUALITY_LOW,
      medium: BABYLON.ShadowGenerator.QUALITY_MEDIUM,
      high: BABYLON.ShadowGenerator.QUALITY_HIGH,
    };
    function applyGraphics(preset) {
      shadows.getShadowMap().resize(preset.shadowMapSize.mars);
      shadows.filteringQuality = SHADOW_FILTERING[preset.shadowFiltering] ?? BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      dustScale = preset.dustScale;
    }

    const materials = {
      hull: pbr(scene, "marsHull", [0.86, 0.87, 0.89], 0.45, 0.05),
      frame: pbr(scene, "marsFrame", [0.5, 0.52, 0.55], 0.4, 0.7),
      accent: pbr(scene, "marsAccent", [0.75, 0.12, 0.14], 0.5, 0.1),
      solar: pbr(scene, "marsSolarCells", [0.04, 0.07, 0.16], 0.22, 0.4),
      planter: pbr(scene, "marsPlanter", [0.25, 0.18, 0.13], 0.9),
      plants: pbr(scene, "marsPlants", [0.2, 0.5, 0.18], 0.75),
      padMarking: pbr(scene, "marsPadMarking", [0.6, 0.45, 0.35], 0.9),
      glass: pbr(scene, "marsGreenhouseGlass", [0.75, 0.9, 0.85], 0.1, 0.1),
      rocks: [
        pbr(scene, "marsRockRust", [0.42, 0.24, 0.16], 0.88),
        pbr(scene, "marsRockBasalt", [0.25, 0.18, 0.15], 0.82),
        pbr(scene, "marsRockDusty", [0.55, 0.35, 0.23], 0.92),
      ],
    };
    materials.glass.alpha = 0.42;
    materials.glass.emissiveColor = new BABYLON.Color3(0.05, 0.08, 0.07);
    materials.plants.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.02);
    materials.rocks.forEach((material) => {
      material.bumpTexture = rawTexture(scene, soil.normal, soil.size);
      material.bumpTexture.level = 0.6;
      material.environmentIntensity = 0;
    });
    Object.values(materials).flat().forEach((material) => { material.maxSimultaneousLights = 3; });

    const terrainMesh = createTerrainMesh(scene, terrain, soil);
    terrainMesh.material.maxSimultaneousLights = 3;
    const rockCounts = createRocks(scene, terrain, materials, shadows);
    const sites = createBase(scene, terrain, materials, shadows);
    const lander = MarsLander.create(scene, {
      position: MarsTerrain.BASE_LAYOUT.lander,
      heightAt: terrain.heightAt,
      materials,
      shadows,
    });
    const surveyMarkers = createSurveyMarkers(scene, terrain, options.surveyMarkers || [], shadows);
    const interactions = [...lander.interactions, ...surveyMarkers.interactions];
    const hp = sites.habitat.position;
    const insideHabitat = (x, z) => Math.hypot(x - hp.x, z - hp.z) < TempHabitat.LAYOUT.interiorRadius;
    interactions.push(
      { id: "solar-equipment", label: "Secure equipment / inspect solar panels", position: sites.solarArray.interactionPoint, radius: 2.4 },
      ...sites.habitat.interactions,
      // Imported landmark props (crater, abandoned equipment): info points only.
      ...MarsProps.interactions(terrain),
      // Temporary parked rover (not operational): info points only.
      ...MarsRover.interactions(terrain),
    );
    const rover = MarsRover.create(scene, terrain, { shadows });
    // Place the imported landmark models on the existing terrain (async; solid, no
    // effect on ground height or walking rules).
    let propsPlaced = null;
    const propsReady = MarsProps.create(scene, terrain, { shadows }).then((placed) => { propsPlaced = placed; return placed; });
    sites.lander = {
      mesh: lander.root,
      position: lander.safeZone.center.clone(),
      interactionPoint: lander.interactions[0].position.clone(),
    };

    // Walkable surface = lander floor/ramp where present, otherwise terrain.
    function groundHeightAt(x, z) {
      if (insideHabitat(x, z)) return hp.y + TempHabitat.LAYOUT.floorHeight;
      const floor = lander.floorHeightAt(x, z);
      const ground = terrain.heightAt(x, z);
      return floor === null ? ground : Math.max(floor, ground);
    }

    camera.position.set(lander.spawn.position.x, lander.spawn.position.y + EYE_HEIGHT, lander.spawn.position.z);
    camera.setTarget(lander.spawn.lookAt);
    const sky = createSky(scene);
    const sunDisc = createSunDisc(scene);
    const dust = createDust(scene);

    const astronautView = AstronautView.create(scene, camera, {
      eyeHeight: EYE_HEIGHT,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      onStandBlocked: () => callbacks.onStandBlocked?.(),
      getGroundHeight: groundHeightAt,
      constrainMove: terrain.constrainMove,
    });
    const astronautNode = scene.getTransformNodeByName("astronaut");
    astronautNode?.getChildMeshes().forEach((mesh) => {
      shadows.addShadowCaster(mesh);
      if (mesh.material) mesh.material.maxSimultaneousLights = 3;
    });

    let controlsEnabled = true;
    let nearestInteraction = null;
    let inSafeZone = null;

    // Shelter guard: the cabin may only be entered or left through the open
    // hatch. If the astronaut ever crosses the cabin boundary any other way (a
    // physics glitch), they are put back where they were.
    let lastFeet = astronautView.feet;
    let lastInside = lander.isInsideCabin(lastFeet.x, lastFeet.z);

    function guardShelter() {
      const feet = astronautView.feet;
      const inside = lander.isInsideCabin(feet.x, feet.z);
      if (inside !== lastInside) {
        const throughOpenHatch = lander.doorOpen
          && (lander.isInDoorway(feet.x, feet.z) || lander.isInDoorway(lastFeet.x, lastFeet.z));
        if (!throughOpenHatch) {
          astronautView.setFeetPosition(lastFeet.x, lastFeet.z);
          callbacks.onShelterBreachBlocked?.(lastInside);
          return;
        }
      }
      const crossed = inside !== lastInside;
      lastFeet = feet;
      lastInside = inside;
      // The airlock prompt reads "Airlock controls" inside and "Enter airlock"
      // outside; refresh it when stepping across the threshold while still in
      // reach of the same panel.
      if (crossed && nearestInteraction) callbacks.onInteractionChange?.(nearestInteraction);
    }

    /** Moves the astronaut to (x, z) on purpose (recovery, tests); resets the guard. */
    function teleportAstronaut(x, z) {
      astronautView.setFeetPosition(x, z);
      lastFeet = astronautView.feet;
      lastInside = lander.isInsideCabin(lastFeet.x, lastFeet.z);
      if (nearestInteraction) callbacks.onInteractionChange?.(nearestInteraction);
    }

    /**
     * Limited unstuck: moves the astronaut to the nearest verified safe spot on
     * the SAME side of the hull they were last validly on (inside -> cabin
     * floor, outside -> foot of the ramp). It never moves anyone from outside
     * into the cabin, so it cannot bypass the airlock. Once per 30 seconds.
     */
    const UNSTUCK_COOLDOWN_MS = 30000;
    let lastUnstuckAt = -Infinity;
    function recoverToLander() {
      const feet = astronautView.feet;
      if (Math.hypot(feet.x - lander.safeZone.center.x, feet.z - lander.safeZone.center.z) > 15) {
        return { ok: false, message: "Unstuck is only available near the lander." };
      }
      const now = performance.now();
      if (now - lastUnstuckAt < UNSTUCK_COOLDOWN_MS) {
        return { ok: false, message: `Unstuck was just used. Try again in ${Math.ceil((UNSTUCK_COOLDOWN_MS - (now - lastUnstuckAt)) / 1000)} s.` };
      }
      lastUnstuckAt = now;
      if (lastInside) {
        teleportAstronaut(lander.spawn.position.x, lander.spawn.position.z);
        camera.setTarget(lander.spawn.lookAt);
        return { ok: true, side: "inside", message: "Moved to a safe spot on the cabin floor." };
      }
      const point = lander.exteriorSafePoint;
      teleportAstronaut(point.x, point.z);
      camera.setTarget(lander.interactions[0].position);
      return { ok: true, side: "outside", message: "Moved to a safe spot outside, at the foot of the ramp. Use the airlock to get back in." };
    }

    function updateInteractionAndZone() {
      const position = astronautView.position;
      let nearest = null;
      if (controlsEnabled) {
        let best = Infinity;
        interactions.forEach((interaction) => {
          const distance = BABYLON.Vector3.Distance(position, interaction.position);
          if (distance < interaction.radius && distance < best) {
            nearest = interaction;
            best = distance;
          }
        });
      }
      if (nearest !== nearestInteraction) {
        nearestInteraction = nearest;
        callbacks.onInteractionChange?.(nearest);
      }
      const safe = lander.isInSafeZone(position.x, position.z);
      if (safe !== inSafeZone) {
        inSafeZone = safe;
        callbacks.onSafeZoneChange?.(safe);
      }
    }

    function interact() {
      if (!controlsEnabled || !nearestInteraction) return;
      const interaction = nearestInteraction;
      if (interaction.onInteract) interaction.onInteract();
      callbacks.onInteract?.(interaction.id, interaction);
      // Labels such as "Open/Close airlock" change after use.
      callbacks.onInteractionChange?.(interaction);
    }

    let environmentInput = { elapsedSeconds: 0, daySeconds: 60, nightSeconds: 30, dustStorm: false };
    let dustLevel = 0;
    let environment = null;
    const shadowFocus = v3(0, 0, 0);

    function setEnvironment(input = {}) {
      environmentInput = { ...environmentInput, ...input };
    }

    function applyEnvironment(deltaSeconds) {
      const k = 1 - Math.exp(-deltaSeconds / 0.8);
      const dustTarget = environmentInput.dustStorm ? 1 : 0;
      dustLevel += (dustTarget - dustLevel) * (1 - Math.exp(-deltaSeconds / 2.5));
      const target = MarsTerrain.computeEnvironment({
        elapsedSeconds: environmentInput.elapsedSeconds,
        daySeconds: environmentInput.daySeconds,
        nightSeconds: environmentInput.nightSeconds,
        dust: dustLevel,
      });
      environment = blendEnvironment(environment, target, environment ? k : 1);
      const env = environment;
      const direction = v3(...env.sunDirection).normalize();
      sun.direction.copyFrom(direction);
      sun.intensity = env.sunIntensity;
      sun.diffuse = color3(env.sunColor);
      skyFill.intensity = env.ambientIntensity;
      skyFill.diffuse = color3(env.ambientSkyColor);
      skyFill.groundColor = color3(env.ambientGroundColor);
      scene.fogColor = color3(env.fogColor);
      scene.fogDensity = env.fogDensity;
      scene.clearColor = new BABYLON.Color4(env.skyHorizon[0], env.skyHorizon[1], env.skyHorizon[2], 1);
      sky.update(env);
      sunDisc.disc.position.copyFrom(direction.scale(-780));
      sunDisc.material.alpha = BABYLON.Scalar.Clamp(env.daylight * (1 - env.dust * 0.95) * (env.elevation > -2 ? 1 : 0), 0, 1);
      dust.particles.emitRate = Math.round(env.dust * 1400 * dustScale);
      helmetLamp.intensity = env.helmetLamp * 2.2;
    }

    scene.onBeforeRenderObservable.add(() => {
      const deltaSeconds = Math.min(1, engine.getDeltaTime() / 1000 || 0.016);
      applyEnvironment(deltaSeconds);
      // Shadow frustum follows the astronaut, snapped to reduce shimmering.
      const focus = camera.position;
      shadowFocus.set(Math.round(focus.x / 4) * 4, terrain.heightAt(focus.x, focus.z), Math.round(focus.z / 4) * 4);
      sun.position.copyFrom(shadowFocus.subtract(sun.direction.scale(300)));
      helmetLamp.position.copyFrom(camera.position);
      helmetLamp.direction.copyFrom(camera.getDirection(BABYLON.Axis.Z));
      dust.emitter.copyFrom(camera.position);
      guardShelter();
      updateInteractionAndZone();
    });
    applyEnvironment(1);

    function onKeyDown(event) {
      if (event.code === "KeyV" && controlsEnabled && !event.repeat) astronautView.toggleMode();
      // Crouch: Ctrl, or C (Ctrl+W closes the browser tab on Windows/Chromebooks).
      if (CROUCH_KEYS.includes(event.code) && controlsEnabled) astronautView.setCrouched(true);
      if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && controlsEnabled) astronautView.setSprinting(true);
      if (event.code === "KeyE" && !event.repeat) interact();
    }

    function onKeyUp(event) {
      if (CROUCH_KEYS.includes(event.code)) astronautView.setCrouched(false);
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") astronautView.setSprinting(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function setControlsEnabled(enabled) {
      controlsEnabled = enabled;
      if (enabled) camera.attachControl(canvas, true);
      else {
        // Release crouch/sprint input; the astronaut stands up only where there is headroom.
        astronautView.setCrouched(false);
        astronautView.setSprinting(false);
        camera.detachControl();
        camera.cameraDirection?.setAll(0);
        camera.cameraRotation?.setAll(0);
        if (nearestInteraction) {
          nearestInteraction = null;
          callbacks.onInteractionChange?.(null);
        }
      }
    }

    function bedContext(id) {
      const bed = interactions.find((item) => item.id === id && item.bed);
      const feet = astronautView.feet;
      const inside = bed?.bed === "lander" ? lander.isInsideCabin(feet.x, feet.z) : insideHabitat(feet.x, feet.z);
      // Conservatively overlap the standing body with local collider bounds.
      // Unlike a ray, this also catches a body embedded in a solid object.
      const corners = [];
      for (const x of [-0.4, 0.4]) for (const y of [0.08, 1.7]) for (const z of [-0.4, 0.4]) {
        corners.push(feet.add(v3(x, y, z)));
      }
      const obstructed = scene.meshes.some((mesh) => {
        if (!mesh.checkCollisions || !mesh.isEnabled() || mesh.name === "marsHabitat" || mesh === terrainMesh) return false;
        mesh.computeWorldMatrix(true);
        const inverse = mesh.getWorldMatrix().clone().invert();
        const bounds = mesh.getBoundingInfo().boundingBox;
        const local = corners.map((corner) => BABYLON.Vector3.TransformCoordinates(corner, inverse));
        return ["x", "y", "z"].every((axis) => Math.max(...local.map((p) => p[axis])) > bounds.minimum[axis]
          && Math.min(...local.map((p) => p[axis])) < bounds.maximum[axis]);
      });
      return { inside: Boolean(bed && inside), obstructed,
        accessible: Boolean(bed && BABYLON.Vector3.Distance(astronautView.position, bed.position) < bed.radius),
        cabin: bed?.bed };
    }

    function dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      scene.dispose();
    }

    return {
      scene,
      camera,
      terrain,
      sites,
      lander,
      bedContext,
      insideHabitat,
      enterHabitat() { teleportAstronaut(hp.x, hp.z - 2.3); camera.setTarget(v3(hp.x + 1.3, hp.y + 1.7, hp.z + 2.4)); },
      leaveHabitat() { teleportAstronaut(sites.habitat.interactionPoint.x, sites.habitat.interactionPoint.z); },
      interact,
      groundHeightAt,
      get nearestInteraction() { return nearestInteraction; },
      nearInteraction(id) {
        const target = interactions.find((item) => item.id === id);
        return Boolean(target && BABYLON.Vector3.Distance(astronautView.position, target.position) < target.radius);
      },
      setSurveyMarkerInspected: surveyMarkers.setInspected,
      /** Imported model status: { pods: [..], props: { crater, equipmentSite } } once loaded. */
      modelsReady: () => Promise.all([sites.habitat.podsReady, propsReady]).then(([pods, props]) => ({ pods, props })),
      get propsPlaced() { return propsPlaced; },
      /** Temporary habitat visuals: "packed" | "building" (with progress 0..1) | "built". */
      setHabitatStage: (stage, progress) => sites.habitat.setStage(stage, progress),
      rover,
      applyGraphics,
      teleportAstronaut,
      recoverToLander,
      get astronautFeet() { return astronautView.feet; },
      /** Re-announce the current interaction (e.g. after its label changed). */
      refreshInteraction() { callbacks.onInteractionChange?.(nearestInteraction); },
      get inSafeZone() { return inSafeZone; },
      setControlsEnabled,
      setEnvironment,
      toggleCameraView: astronautView.toggleMode,
      setCameraView: astronautView.setMode,
      get cameraView() { return astronautView.mode; },
      get environment() { return environment; },
      get astronautPosition() { return astronautView.position; },
      get cameraBoomDistance() { return astronautView.cameraBoomDistance; },
      stats() {
        return {
          terrainVertices: terrainMesh.getTotalVertices(),
          terrainTriangles: terrainMesh.getTotalIndices() / 3,
          smallRocks: rockCounts.small,
          boulders: rockCounts.boulders,
          craters: terrain.craters.length,
          activeMeshes: scene.getActiveMeshes().length,
          fps: Math.round(engine.getFps()),
        };
      },
      dispose,
    };
  }

  root.MarsScene = Object.freeze({ create });
})(globalThis);
