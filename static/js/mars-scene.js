(function (root) {
  "use strict";

  function create(engine, canvas) {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.65, 0.33, 0.22, 1);

    const camera = new BABYLON.UniversalCamera(
      "astronautCamera",
      new BABYLON.Vector3(0, 2, -12),
      scene
    );
    camera.setTarget(new BABYLON.Vector3(0, 1, 0));
    camera.attachControl(canvas, true);
    camera.speed = 0.3;
    camera.keysUp.push(87);
    camera.keysDown.push(83);
    camera.keysLeft.push(65);
    camera.keysRight.push(68);

    const sun = new BABYLON.HemisphericLight(
      "sun",
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
    sun.intensity = 1.2;

    const ground = BABYLON.MeshBuilder.CreateGround(
      "marsTerrain",
      { width: 120, height: 120 },
      scene
    );
    const marsMaterial = new BABYLON.StandardMaterial("marsSoil", scene);
    marsMaterial.diffuseColor = new BABYLON.Color3(0.56, 0.23, 0.13);
    ground.material = marsMaterial;

    const habitat = BABYLON.MeshBuilder.CreateCylinder(
      "marsHabitat",
      { diameter: 8, height: 4, tessellation: 32 },
      scene
    );
    habitat.position = new BABYLON.Vector3(0, 2, 12);
    const habitatMaterial = new BABYLON.StandardMaterial("habitatPaint", scene);
    habitatMaterial.diffuseColor = new BABYLON.Color3(0.82, 0.84, 0.88);
    habitat.material = habitatMaterial;

    scene.collisionsEnabled = true;
    camera.checkCollisions = true;
    camera.applyGravity = true;
    camera.ellipsoid = new BABYLON.Vector3(0.5, 1, 0.5);
    scene.gravity = new BABYLON.Vector3(0, -0.15, 0);
    ground.checkCollisions = true;
    habitat.checkCollisions = true;

    const astronautView = AstronautView.create(scene, camera, { eyeHeight: 2 });
    let controlsEnabled = true;

    function onKeyDown(event) {
      if (event.code === "KeyV" && controlsEnabled && !event.repeat) astronautView.toggleMode();
      if ((event.code === "ControlLeft" || event.code === "ControlRight") && controlsEnabled) astronautView.setCrouched(true);
    }

    function onKeyUp(event) {
      if (event.code === "ControlLeft" || event.code === "ControlRight") astronautView.setCrouched(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function setControlsEnabled(enabled) {
      controlsEnabled = enabled;
      if (enabled) camera.attachControl(canvas, true);
      else {
        astronautView.setCrouched(false);
        camera.detachControl();
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
      dispose,
    };
  }

  root.MarsScene = Object.freeze({ create });
})(globalThis);
