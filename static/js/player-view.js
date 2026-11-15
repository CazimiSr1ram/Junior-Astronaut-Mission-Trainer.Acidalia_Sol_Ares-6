(function (root) {
  "use strict";

  function create(scene, camera, options = {}) {
    const standingEllipsoid = camera.ellipsoid?.clone();
    const standingEllipsoidOffset = camera.ellipsoidOffset?.clone();
    const standingEyeHeight = options.eyeHeight ?? camera.position.y;
    // Crouching: eye height 1.10 m (was derived from the collision ellipsoid,
    // which only lowered the view ~0.3 m and made crouching hard to notice).
    const crouchedEyeHeight = Math.min(options.crouchedEyeHeight ?? 1.1, standingEyeHeight);
    const crouchSeconds = options.crouchSeconds ?? 0.2;
    // Body top while crouched: eye height plus the top of the helmet.
    const crouchedBodyTop = crouchedEyeHeight + 0.15;
    const crouchedEllipsoidY = Math.min((crouchedBodyTop - 0.05) / 2, standingEllipsoid?.y ?? 0.6);
    // Movement speeds live here so crouching can slow the astronaut down.
    const walkSpeed = options.walkSpeed ?? camera.speed;
    const sprintSpeed = options.sprintSpeed ?? walkSpeed * 2;
    const crouchSpeedFactor = options.crouchSpeedFactor ?? 0.5;
    const onStandBlocked = typeof options.onStandBlocked === "function" ? options.onStandBlocked : null;
    // Jumping / gravity (m/s^2): Earth 9.81 in the lobby, Mars 3.71 on Mars.
    const gravity = options.gravity ?? JumpPhysics.GRAVITY.earth;
    const jumpSpeed = options.jumpSpeed ?? JumpPhysics.DEFAULTS.jumpSpeed;
    // Third-person camera: further back, a little above head height and over
    // the right shoulder, so the astronaut no longer fills the middle of the view.
    const followDistance = options.followDistance ?? 4.4;
    const followHeight = options.followHeight ?? 0.85;
    const shoulderOffset = options.shoulderOffset ?? 0.45;
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
      const texture = GraphicsQuality.createTextTexture(`${name}-texture`, 512, 256, scene, 1);
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

    function capsule(name, radius, height, position, material) {
      const mesh = BABYLON.MeshBuilder.CreateCapsule(name, { radius, height, tessellation: 14, subdivisions: 2 }, scene);
      mesh.parent = rootNode;
      mesh.position = new BABYLON.Vector3(...position);
      mesh.material = material;
      return mesh;
    }
    capsule("astronaut-torso", 0.32, 0.86, [0, 1.03, 0], suit).scaling.z = 0.62;
    box("astronaut-backpack", { width: 0.48, height: 0.7, depth: 0.24 }, [0, 1.12, -0.3], suit);
    box("astronaut-backpack-top", { width: 0.4, height: 0.08, depth: 0.2 }, [0, 1.5, -0.3], joints);
    box("astronaut-backpack-panel", { width: 0.34, height: 0.46, depth: 0.025 }, [0, 1.08, -0.42], joints);
    nasaPatch("astronaut-nasa-back-patch", [0, 1.1, -0.437], Math.PI, 0.31, 0.17, true);
    nasaPatch("astronaut-nasa-chest-patch", [0, 1.03, 0.197], 0, 0.3, 0.15);
    sphere("astronaut-helmet", 0.5, [0, 1.64, 0.02], suit);
    sphere("astronaut-visor", 0.38, [0, 1.65, 0.22], visor).scaling.z = 0.36;
    // Neck ring and a coloured helmet band, so the helmet does not read as a plain ball from behind.
    const neckRing = BABYLON.MeshBuilder.CreateTorus("astronaut-neck-ring", { diameter: 0.4, thickness: 0.07, tessellation: 24 }, scene);
    neckRing.parent = rootNode; neckRing.position = new BABYLON.Vector3(0, 1.42, 0.01); neckRing.material = joints;
    const helmetBand = BABYLON.MeshBuilder.CreateTorus("astronaut-helmet-band", { diameter: 0.5, thickness: 0.035, tessellation: 32 }, scene);
    helmetBand.parent = rootNode; helmetBand.position = new BABYLON.Vector3(0, 1.64, 0.02); helmetBand.rotation.x = Math.PI / 2; helmetBand.rotation.y = Math.PI / 2;
    helmetBand.material = joints;
    capsule("astronaut-left-leg", 0.115, 0.62, [-0.16, 0.44, 0], suit);
    capsule("astronaut-right-leg", 0.115, 0.62, [0.16, 0.44, 0], suit);
    box("astronaut-left-boot", { width: 0.25, height: 0.16, depth: 0.34 }, [-0.17, 0.08, 0.04], joints);
    box("astronaut-right-boot", { width: 0.25, height: 0.16, depth: 0.34 }, [0.17, 0.08, 0.04], joints);
    const leftArm = capsule("astronaut-left-arm", 0.1, 0.66, [-0.42, 1.04, 0], suit);
    leftArm.rotation.z = -0.12;
    const rightArm = capsule("astronaut-right-arm", 0.1, 0.66, [0.42, 1.04, 0], suit);
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

    // Vertical movement (jump, fall, land) for ground-following scenes.
    const vertical = JumpPhysics.createVerticalBody({ gravity, jumpSpeed });
    vertical.place(rootNode.position.y);

    let mode = "first-person";
    // crouchRequested: the player is holding the crouch key.
    // crouched: the collision body is in its crouched (short) shape.
    // crouchBlend: 0 standing .. 1 crouched, eased over crouchSeconds; drives
    // the eye height (first- and third-person) and the body animation.
    let crouchRequested = false;
    let crouched = false;
    let crouchBlend = 0;
    let sprinting = false;
    let standBlocked = false;
    let expectedCameraPosition = camera.position.clone();

    function smooth(t) {
      return t * t * (3 - 2 * t);
    }

    function eyeHeight() {
      return standingEyeHeight + (crouchedEyeHeight - standingEyeHeight) * smooth(crouchBlend);
    }

    // Third-person camera boom. A ray from the astronaut's head towards the
    // desired camera position finds walls, ceilings and solid (collidable)
    // objects; the camera snaps closer when blocked and eases back out when clear.
    const cameraMargin = options.cameraCollisionMargin ?? 0.45;
    const cameraReturnSeconds = options.cameraReturnSeconds ?? 0.35;
    const hideModelWithin = options.hideModelWithin ?? 1.3;
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
      const right = new BABYLON.Vector3(forward.z, 0, -forward.x); // camera right on the ground plane
      const offset = forward.scale(-followDistance).addInPlace(right.scale(shoulderOffset));
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

    /** Holding the crouch key requests a crouch; releasing it requests standing up. */
    function setCrouched(nextCrouched) {
      crouchRequested = Boolean(nextCrouched);
      updateCrouchState();
    }

    function setSprinting(nextSprinting) {
      sprinting = Boolean(nextSprinting);
      updateSpeed();
    }

    function updateSpeed() {
      // Crouch-walking is slower and cannot be combined with sprinting.
      camera.speed = crouched ? walkSpeed * crouchSpeedFactor : (sprinting ? sprintSpeed : walkSpeed);
    }

    // Collision shape: changed at once when crouching (smaller is always safe),
    // and when standing only after the headroom check has passed.
    function applyBodyShape(nextCrouched) {
      crouched = nextCrouched;
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
          ? new BABYLON.Vector3(standingEllipsoidOffset.x, Math.min(crouchedEllipsoidY, standingEllipsoidOffset.y), standingEllipsoidOffset.z)
          : standingEllipsoidOffset.clone();
      }
      updateSpeed();
    }

    // Headroom: vertical rays from the top of the crouched body to the top of
    // the standing body (plus a margin), at the centre and around the body edge.
    const headroomRay = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Up(), 1);
    const standingBodyTop = bodyHalfHeight * 2 + bodyClearance;
    function hasHeadroom() {
      const feet = rootNode.position;
      const from = feet.y + crouchedBodyTop - 0.1;
      headroomRay.length = Math.max(0.05, standingBodyTop - (crouchedBodyTop - 0.1) + 0.05);
      const r = bodyRadius * 0.75;
      const offsets = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
      return offsets.every(([dx, dz]) => {
        headroomRay.origin.set(feet.x + dx, from, feet.z + dz);
        const hit = scene.pickWithRay(headroomRay, isCameraBlocker);
        return !(hit && hit.hit);
      });
    }

    function updateCrouchState() {
      if (crouchRequested) {
        standBlocked = false;
        if (!crouched) applyBodyShape(true);
        return;
      }
      if (!crouched) return;
      if (hasHeadroom()) {
        standBlocked = false;
        applyBodyShape(false);
      } else if (!standBlocked) {
        // Stay crouched; tell the player once per attempt.
        standBlocked = true;
        onStandBlocked?.();
      }
    }

    function updateCrouchAnimation() {
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 0.016);
      const target = crouched ? 1 : 0;
      if (crouchBlend !== target) {
        const step = dt / crouchSeconds;
        crouchBlend = target > crouchBlend ? Math.min(target, crouchBlend + step) : Math.max(target, crouchBlend - step);
      }
      // Third-person body: same crouch pose as before (58% height), now eased.
      rootNode.scaling.y = 1 - 0.42 * smooth(crouchBlend);
    }

    // --- Support and ceilings for jumping ------------------------------------------
    // Support = walkable ground (terrain, lander floor, ramp) or the top of a
    // low object marked metadata.standable (crates, boulders, low platforms).
    const supportRay = new BABYLON.Ray(BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, -1, 0), 1);
    const ceilingRay = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Up(), 3);
    function isStandable(mesh) {
      return mesh.isEnabled() && mesh.metadata?.standable === true && !mesh.isDescendantOf(rootNode);
    }
    function supportHeight(x, z) {
      const ground = getGroundHeight(x, z);
      const fromY = vertical.y + JumpPhysics.DEFAULTS.stepUp + 0.02;
      if (fromY <= ground) return ground;
      supportRay.origin.set(x, fromY, z);
      supportRay.length = fromY - ground + 0.05;
      let top = ground;
      (scene.multiPickWithRay(supportRay, isStandable) || []).forEach((hit) => {
        if (!hit.hit || !hit.pickedPoint) return;
        const normal = hit.getNormal(true);
        if (normal && normal.y < 0.6) return; // only upward-facing tops
        top = Math.max(top, hit.pickedPoint.y);
      });
      return top;
    }
    function bodyTop() {
      return crouched ? Math.min(crouchedEllipsoidY, bodyHalfHeight) * 2 + bodyClearance : bodyHalfHeight * 2 + bodyClearance;
    }
    /** Highest the feet may rise before the head meets a solid ceiling. */
    function maxFeetY(x, z) {
      const top = bodyTop();
      ceilingRay.origin.set(x, vertical.y + top - 0.05, z);
      ceilingRay.length = 3;
      const hit = scene.pickWithRay(ceilingRay, isCameraBlocker);
      return hit && hit.hit ? hit.pickedPoint.y - top - 0.02 : Infinity;
    }
    function stepVertical(horizontalDistance) {
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 0);
      const x = rootNode.position.x, z = rootNode.position.z;
      vertical.step(dt, supportHeight(x, z), { horizontalDistance, maxFeetY: maxFeetY(x, z) });
      rootNode.position.y = vertical.y;
    }

    /** Space: jump (only when standing on something and not crouched). */
    function jump() {
      if (!getGroundHeight) return false;
      return vertical.requestJump({ crouched: crouched || crouchRequested });
    }

    /** Moves the astronaut's feet towards (x, z), blocked by collidable geometry. Returns the distance moved. */
    function moveFeetTo(x, z) {
      const from = rootNode.position.clone();
      const next = constrainMove ? constrainMove(from.x, from.z, x, z) : { x, z };
      bodyCollider.position.copyFrom(from);
      bodyCollider.computeWorldMatrix(true);
      bodyCollider.moveWithCollisions(new BABYLON.Vector3(next.x - from.x, 0, next.z - from.z));
      const nx = bodyCollider.position.x;
      const nz = bodyCollider.position.z;
      rootNode.position.set(nx, from.y, nz); // height is handled by stepVertical()
      return Math.hypot(nx - from.x, nz - from.z);
    }

    /** Places the astronaut at (x, z) directly (used for safe recovery), keeping the view mode. */
    function setFeetPosition(x, z) {
      // Drop leftover camera momentum (UniversalCamera inertia) so the
      // astronaut stays exactly where they were placed instead of sliding on.
      camera.cameraDirection?.setAll(0);
      rootNode.position.set(x, getGroundHeight ? getGroundHeight(x, z) : 0, z);
      vertical.place(rootNode.position.y);
      if (mode === "first-person") {
        camera.position.set(x, rootNode.position.y + eyeHeight(), z);
      } else {
        placeCameraBehindAstronaut(true);
      }
      syncExpectedPosition();
    }

    function followTerrain() {
      if (mode === "first-person") {
        stepVertical(moveFeetTo(camera.position.x, camera.position.z));
        camera.position.set(rootNode.position.x, rootNode.position.y + eyeHeight(), rootNode.position.z);
      } else {
        const delta = camera.position.subtract(expectedCameraPosition);
        stepVertical(moveFeetTo(rootNode.position.x + delta.x, rootNode.position.z + delta.z));
        placeCameraBehindAstronaut();
        const minimumY = getGroundHeight(camera.position.x, camera.position.z) + cameraGroundClearance;
        if (camera.position.y < minimumY) camera.position.y = minimumY;
        syncExpectedPosition();
      }
      rootNode.rotation.y = camera.rotation.y;
    }

    scene.onBeforeRenderObservable.add(() => {
      // Keep trying to stand up (with the headroom check) after the key is released.
      if (!crouchRequested && crouched) updateCrouchState();
      updateCrouchAnimation();
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
      setSprinting,
      jump,
      /** True while standing on the ground or an object (not jumping or falling). */
      get grounded() { return vertical.grounded; },
      get verticalSpeed() { return vertical.vy; },
      get gravity() { return gravity; },
      get mode() { return mode; },
      get crouched() { return crouched; },
      get crouchRequested() { return crouchRequested; },
      /** Current eye height above the feet (eases between standing and crouched). */
      get eyeHeight() { return eyeHeight(); },
      get standBlocked() { return standBlocked; },
      /** Current third-person camera distance from the head (metres). */
      get cameraBoomDistance() { return boomFraction * Math.hypot(followDistance, followHeight, shoulderOffset); },
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
