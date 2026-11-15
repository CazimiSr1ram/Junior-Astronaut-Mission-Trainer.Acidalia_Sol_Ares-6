(function (root) {
  "use strict";

  function create(scene, camera, options = {}) {
    const standingEllipsoid = camera.ellipsoid?.clone();
    const standingEllipsoidOffset = camera.ellipsoidOffset?.clone();
    const standingEyeHeight = options.eyeHeight ?? camera.position.y;
    const crouchedEllipsoidY = Math.min(0.55, standingEllipsoid?.y ?? 0.55);
    const crouchedEyeHeight = options.crouchedEyeHeight ??
      standingEyeHeight - ((standingEllipsoid?.y ?? standingEyeHeight) - crouchedEllipsoidY);
    const followDistance = options.followDistance ?? 3.5;
    const followHeight = options.followHeight ?? 0.15;
    // Optional terrain hooks (Mars). Without them the flat-floor lobby behaviour is unchanged.
    const getGroundHeight = typeof options.getGroundHeight === "function" ? options.getGroundHeight : null;
    const constrainMove = typeof options.constrainMove === "function" ? options.constrainMove : null;
    const cameraGroundClearance = options.cameraGroundClearance ?? 0.6;
    const rootNode = new BABYLON.TransformNode("astronaut", scene);
    const suit = new BABYLON.StandardMaterial("astronaut-suit", scene);
    suit.diffuseColor = new BABYLON.Color3(0.82, 0.85, 0.87);
    const joints = new BABYLON.StandardMaterial("astronaut-joints", scene);
    joints.diffuseColor = new BABYLON.Color3(0.08, 0.2, 0.34);
    const accent = new BABYLON.StandardMaterial("astronaut-red-markings", scene);
    accent.diffuseColor = new BABYLON.Color3(0.76, 0.08, 0.16);
    const visor = new BABYLON.StandardMaterial("astronaut-visor", scene);
    visor.diffuseColor = new BABYLON.Color3(0.13, 0.35, 0.48);
    visor.emissiveColor = new BABYLON.Color3(0.025, 0.08, 0.12);

    function box(name, size, position, material) {
      const mesh = BABYLON.MeshBuilder.CreateBox(name, size, scene);
      mesh.parent = rootNode;
      mesh.position = new BABYLON.Vector3(...position);
      mesh.material = material;
      return mesh;
    }

    function sphere(name, diameter, position, material) {
      const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter, segments: 16 }, scene);
      mesh.parent = rootNode;
      mesh.position = new BABYLON.Vector3(...position);
      mesh.material = material;
      return mesh;
    }

    function nasaPatch(name, position, rotationY, width, height, reverseU = false) {
      const texture = new BABYLON.DynamicTexture(
        `${name}-texture`,
        { width: 512, height: 256 },
        scene,
        false
      );
      const context = texture.getContext();
      context.fillStyle = "#f4f6f7";
      context.fillRect(0, 0, 512, 256);
      context.strokeStyle = "#164b79";
      context.lineWidth = 12;
      context.strokeRect(6, 6, 500, 244);
      context.beginPath();
      context.ellipse(256, 130, 195, 54, -0.16, 0, Math.PI * 2);
      context.strokeStyle = "#c8102e";
      context.lineWidth = 12;
      context.stroke();
      context.fillStyle = "#c8102e";
      context.font = "italic bold 112px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("NASA", 256, 128);
      context.fillStyle = "#164b79";
      context.font = "bold 28px Arial";
      context.fillText("CREW", 256, 216);
      texture.update();
      if (reverseU) texture.uScale = -1;

      const material = new BABYLON.StandardMaterial(`${name}-material`, scene);
      material.diffuseTexture = texture;
      material.emissiveTexture = texture;
      material.emissiveColor = new BABYLON.Color3(0.24, 0.24, 0.24);
      material.backFaceCulling = false;
      const patch = BABYLON.MeshBuilder.CreatePlane(name, { width, height }, scene);
      patch.parent = rootNode;
      patch.position = new BABYLON.Vector3(...position);
      patch.rotation.y = rotationY;
      patch.material = material;
      return patch;
    }

    box("astronaut-torso", { width: 0.64, height: 0.74, depth: 0.38 }, [0, 1.02, 0], suit);
    box("astronaut-backpack", { width: 0.44, height: 0.62, depth: 0.22 }, [0, 1.08, -0.29], suit);
    box("astronaut-backpack-panel", { width: 0.34, height: 0.46, depth: 0.025 }, [0, 1.08, -0.42], joints);
    nasaPatch("astronaut-nasa-back-patch", [0, 1.1, -0.437], Math.PI, 0.31, 0.17, true);
    nasaPatch("astronaut-nasa-chest-patch", [0, 1.03, 0.197], 0, 0.3, 0.15);
    sphere("astronaut-helmet", 0.55, [0, 1.62, 0.02], suit);
    sphere("astronaut-visor", 0.4, [0, 1.63, 0.24], visor).scaling.z = 0.32;
    box("astronaut-left-leg", { width: 0.22, height: 0.55, depth: 0.25 }, [-0.17, 0.42, 0], suit);
    box("astronaut-right-leg", { width: 0.22, height: 0.55, depth: 0.25 }, [0.17, 0.42, 0], suit);
    box("astronaut-left-boot", { width: 0.25, height: 0.16, depth: 0.34 }, [-0.17, 0.08, 0.04], joints);
    box("astronaut-right-boot", { width: 0.25, height: 0.16, depth: 0.34 }, [0.17, 0.08, 0.04], joints);
    const leftArm = box("astronaut-left-arm", { width: 0.22, height: 0.67, depth: 0.25 }, [-0.45, 1.04, 0], suit);
    leftArm.rotation.z = -0.12;
    const rightArm = box("astronaut-right-arm", { width: 0.22, height: 0.67, depth: 0.25 }, [0.45, 1.04, 0], suit);
    rightArm.rotation.z = 0.12;
    rootNode.setEnabled(false);

    // Astronaut body collider (ground-following scenes). The BODY is what
    // collides with walls, the hatch and objects, in both first- and
    // third-person; the camera only follows it. The camera's own collisions are
    // switched off so a third-person camera can never move or block the player.
    const bodyRadius = standingEllipsoid ? standingEllipsoid.x : 0.45;
    const bodyHalfHeight = standingEllipsoid ? standingEllipsoid.y : 0.85;
    const bodyClearance = 0.05; // keeps the body just above the floor/ramp it stands on
    let bodyCollider = null;
    if (getGroundHeight) {
      bodyCollider = BABYLON.MeshBuilder.CreateBox("astronaut-body-collider", { size: 0.1 }, scene);
      bodyCollider.isVisible = false;
      bodyCollider.isPickable = false;
      bodyCollider.checkCollisions = false;
      bodyCollider.ellipsoid = new BABYLON.Vector3(bodyRadius, bodyHalfHeight, bodyRadius);
      bodyCollider.ellipsoidOffset = new BABYLON.Vector3(0, bodyHalfHeight + bodyClearance, 0);
      camera.checkCollisions = false;
      rootNode.position.set(camera.position.x, getGroundHeight(camera.position.x, camera.position.z), camera.position.z);
      camera.position.y = rootNode.position.y + standingEyeHeight;
    }

    let mode = "first-person";
    let crouched = false;
    let expectedCameraPosition = camera.position.clone();

    function eyeHeight() {
      return crouched ? crouchedEyeHeight : standingEyeHeight;
    }

    // Third-person camera boom. A ray from the astronaut's head towards the
    // desired camera position finds walls, ceilings and solid (collidable)
    // objects; the camera snaps closer when blocked and eases back out when clear.
    const cameraMargin = options.cameraCollisionMargin ?? 0.45;
    const cameraReturnSeconds = options.cameraReturnSeconds ?? 0.35;
    const hideModelWithin = options.hideModelWithin ?? 1.0;
    const minBoomFraction = 0.08;
    const boomRay = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Up(), 1);
    const modelMeshes = rootNode.getChildMeshes();
    let boomFraction = 1;
    let modelHidden = false;

    function isCameraBlocker(mesh) {
      return mesh.checkCollisions && mesh.isEnabled() && !mesh.isDescendantOf(rootNode);
    }

    function clearDistance(origin, direction, length) {
      boomRay.origin.copyFrom(origin);
      boomRay.direction.copyFrom(direction);
      boomRay.length = length + cameraMargin;
      const hit = scene.pickWithRay(boomRay, isCameraBlocker);
      return hit && hit.hit ? Math.max(0, hit.distance - cameraMargin) : length;
    }

    function setModelHidden(hidden) {
      if (hidden === modelHidden) return;
      modelHidden = hidden;
      modelMeshes.forEach((mesh) => { mesh.isVisible = !hidden; });
    }

    function placeCameraBehindAstronaut(immediate = false) {
      const forward = camera.getDirection(BABYLON.Axis.Z);
      forward.y = 0;
      forward.normalize();
      const head = rootNode.position.add(new BABYLON.Vector3(0, eyeHeight(), 0));
      const offset = forward.scale(-followDistance);
      offset.y = followHeight;
      const length = offset.length();
      const direction = offset.scale(1 / length);
      const target = Math.max(minBoomFraction, clearDistance(head, direction, length) / length);
      if (immediate || target < boomFraction) {
        boomFraction = target;
      } else {
        const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 0.016);
        boomFraction += (target - boomFraction) * (1 - Math.exp(-dt / cameraReturnSeconds));
      }
      camera.position.copyFrom(head).addInPlace(offset.scale(boomFraction));
      // Keep the camera under ceilings above the astronaut's head.
      const rise = camera.position.y - head.y;
      if (rise > 0) {
        const headroom = clearDistance(head, BABYLON.Vector3.Up(), rise);
        if (headroom < rise) camera.position.y = head.y + headroom;
      }
      setModelHidden(mode === "third-person" && length * boomFraction < hideModelWithin);
    }

    function syncExpectedPosition() {
      expectedCameraPosition.copyFrom(camera.position);
    }

    function setMode(nextMode) {
      if (nextMode !== "first-person" && nextMode !== "third-person") {
        throw new Error(`Unknown camera view: ${nextMode}`);
      }
      if (mode === nextMode) return mode;

      if (mode === "first-person") {
        rootNode.position.copyFrom(camera.position);
        rootNode.position.y -= eyeHeight();
      }
      mode = nextMode;
      rootNode.setEnabled(mode === "third-person");
      if (mode === "third-person") {
        placeCameraBehindAstronaut(true);
      } else {
        setModelHidden(false);
        camera.position.copyFrom(rootNode.position);
        camera.position.y += eyeHeight();
      }
      syncExpectedPosition();
      return mode;
    }

    function toggleMode() {
      return setMode(mode === "first-person" ? "third-person" : "first-person");
    }

    function setCrouched(nextCrouched) {
      if (crouched === nextCrouched) return;
      const previousEyeHeight = eyeHeight();
      crouched = nextCrouched;
      const heightDifference = eyeHeight() - previousEyeHeight;
      if (mode === "first-person") {
        camera.position.y += heightDifference;
      } else {
        placeCameraBehindAstronaut(true);
      }
      rootNode.scaling.y = crouched ? 0.58 : 1;
      if (bodyCollider) {
        const halfHeight = crouched ? Math.min(crouchedEllipsoidY, bodyHalfHeight) : bodyHalfHeight;
        bodyCollider.ellipsoid = new BABYLON.Vector3(bodyRadius, halfHeight, bodyRadius);
        bodyCollider.ellipsoidOffset = new BABYLON.Vector3(0, halfHeight + bodyClearance, 0);
      }
      if (standingEllipsoid) {
        camera.ellipsoid = crouched
          ? new BABYLON.Vector3(standingEllipsoid.x, crouchedEllipsoidY, standingEllipsoid.z)
          : standingEllipsoid.clone();
      }
      if (standingEllipsoidOffset) {
        camera.ellipsoidOffset = crouched
          ? new BABYLON.Vector3(standingEllipsoidOffset.x, Math.min(0.55, standingEllipsoidOffset.y), standingEllipsoidOffset.z)
          : standingEllipsoidOffset.clone();
      }
      syncExpectedPosition();
    }

    /** Moves the astronaut's feet towards (x, z), blocked by collidable geometry. */
    function moveFeetTo(x, z) {
      const from = rootNode.position;
      const next = constrainMove ? constrainMove(from.x, from.z, x, z) : { x, z };
      bodyCollider.position.copyFrom(from);
      bodyCollider.computeWorldMatrix(true);
      bodyCollider.moveWithCollisions(new BABYLON.Vector3(next.x - from.x, 0, next.z - from.z));
      const nx = bodyCollider.position.x;
      const nz = bodyCollider.position.z;
      rootNode.position.set(nx, getGroundHeight(nx, nz), nz);
    }

    /** Places the astronaut at (x, z) directly (used for safe recovery), keeping the view mode. */
    function setFeetPosition(x, z) {
      rootNode.position.set(x, getGroundHeight ? getGroundHeight(x, z) : 0, z);
      if (mode === "first-person") {
        camera.position.set(x, rootNode.position.y + eyeHeight(), z);
      } else {
        placeCameraBehindAstronaut(true);
      }
      syncExpectedPosition();
    }

    function followTerrain() {
      if (mode === "first-person") {
        moveFeetTo(camera.position.x, camera.position.z);
        camera.position.set(rootNode.position.x, rootNode.position.y + eyeHeight(), rootNode.position.z);
      } else {
        const delta = camera.position.subtract(expectedCameraPosition);
        moveFeetTo(rootNode.position.x + delta.x, rootNode.position.z + delta.z);
        placeCameraBehindAstronaut();
        const minimumY = getGroundHeight(camera.position.x, camera.position.z) + cameraGroundClearance;
        if (camera.position.y < minimumY) camera.position.y = minimumY;
        syncExpectedPosition();
      }
      rootNode.rotation.y = camera.rotation.y;
    }

    scene.onBeforeRenderObservable.add(() => {
      if (getGroundHeight) {
        followTerrain();
        return;
      }
      if (mode === "first-person") {
        rootNode.position.copyFrom(camera.position);
        rootNode.position.y = Math.max(0, rootNode.position.y - eyeHeight());
      } else {
        rootNode.position.addInPlace(camera.position.subtract(expectedCameraPosition));
        rootNode.position.y = Math.max(0, rootNode.position.y);
        placeCameraBehindAstronaut();
        syncExpectedPosition();
      }
      rootNode.rotation.y = camera.rotation.y;
    });

    return {
      setMode,
      toggleMode,
      setCrouched,
      get mode() { return mode; },
      get crouched() { return crouched; },
      /** Current third-person camera distance from the head (metres). */
      get cameraBoomDistance() { return boomFraction * Math.hypot(followDistance, followHeight); },
      get position() {
        return rootNode.position.add(new BABYLON.Vector3(0, eyeHeight(), 0));
      },
      /** Feet position (copy). */
      get feet() { return rootNode.position.clone(); },
      setFeetPosition,
    };
  }

  root.AstronautView = Object.freeze({ create });
})(globalThis);
