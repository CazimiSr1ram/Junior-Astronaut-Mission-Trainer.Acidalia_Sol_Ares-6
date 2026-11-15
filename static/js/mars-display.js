/* A 3D planet rendered by a private camera into the flat Mars monitor. */
(function (root) {
  "use strict";
  const LAYER = 0x10000000;
  const ASPECT = 4.75 / 2.7;
  const SOURCE = "/static/assets/textures/mars/nasa-viking-mars.jpg";
  function create(scene, screen, overlayTexture) {
    const B = BABYLON;
    // The private geometry sits far outside the playable area and is excluded
    // from the lobby camera. Only the RTT's explicit render list can show it.
    const center = new B.Vector3(10000, 0, 0);
    const camera = new B.FreeCamera("mars-monitor-camera", center.add(new B.Vector3(0, 0, -7)), scene);
    camera.setTarget(center); camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -1.6 * ASPECT; camera.orthoRight = 1.6 * ASPECT;
    camera.orthoTop = 1.6; camera.orthoBottom = -1.6;
    camera.minZ = 0.1; camera.maxZ = 20; camera.layerMask = LAYER;
    const lobbyCamera = scene.activeCamera;
    lobbyCamera.layerMask &= ~LAYER;
    const planet = B.MeshBuilder.CreateSphere("mars-monitor-planet", { diameter: 2.12, segments: 40 }, scene);
    planet.position.copyFrom(center); planet.layerMask = LAYER; planet.isPickable = false;
    planet.scaling.y = 0.994; // Mars is very slightly oblate.
    const surface = new B.StandardMaterial("mars-monitor-surface", scene);
    surface.diffuseTexture = new B.Texture(SOURCE, scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE);
    surface.diffuseTexture.anisotropicFilteringLevel = 2;
    surface.specularColor = B.Color3.Black(); surface.ambientColor = new B.Color3(0.2, 0.13, 0.1);
    planet.material = surface;
    const light = new B.DirectionalLight("mars-monitor-sun", new B.Vector3(0.55, -0.35, 1), scene);
    light.layerMask = LAYER; light.intensity = 1.35; light.includedOnlyMeshes = [planet];
    const ambient = new B.HemisphericLight("mars-monitor-fill", new B.Vector3(0, 1, 0), scene);
    ambient.layerMask = LAYER; ambient.intensity = 0.32; ambient.includedOnlyMeshes = [planet];
    // Separate shader halo uses the same private camera, not lobby geometry.
    B.Effect.ShadersStore.marsMonitorVertexShader = `precision highp float;
      attribute vec3 position; attribute vec3 normal; uniform mat4 world; uniform mat4 worldViewProjection;
      varying vec3 n; varying vec3 p; void main(){ n=normalize(mat3(world)*normal); p=(world*vec4(position,1.)).xyz; gl_Position=worldViewProjection*vec4(position,1.); }`;
    B.Effect.ShadersStore.marsMonitorFragmentShader = `precision highp float;
      varying vec3 n; varying vec3 p; uniform vec3 cameraPosition;
      void main(){ float rim=pow(1.-max(0.,dot(normalize(n),normalize(cameraPosition-p))),2.7); gl_FragColor=vec4(.48,.68,1.,rim*.27); }`;
    const halo = B.MeshBuilder.CreateSphere("mars-monitor-atmosphere", { diameter: 2.19, segments: 40 }, scene);
    halo.position.copyFrom(center); halo.scaling.y = 0.994; halo.layerMask = LAYER; halo.isPickable = false;
    const haloMaterial = new B.ShaderMaterial("mars-monitor-halo", scene, "marsMonitor", {
      attributes: ["position", "normal"], uniforms: ["world", "worldViewProjection", "cameraPosition"], needAlphaBlending: true,
    });
    haloMaterial.setVector3("cameraPosition", camera.position); halo.material = haloMaterial;
    const target = new B.RenderTargetTexture("mars-monitor-render-target", { width: 1024, height: 576 }, scene, false);
    target.activeCamera = camera; target.renderList = [planet, halo];
    target.clearColor = new B.Color4(0.012, 0.035, 0.073, 1);
    target.ignoreCameraViewport = true;
    scene.customRenderTargets.push(target);
    screen.material.diffuseTexture = target; screen.material.emissiveTexture = target;
    screen.material.emissiveColor = B.Color3.White();
    // Flat transparent annotation remains inside the display, above the RTT.
    const overlayMaterial = new B.StandardMaterial("mars-monitor-label-material", scene);
    overlayTexture.hasAlpha = true; overlayMaterial.diffuseTexture = overlayTexture;
    overlayMaterial.emissiveTexture = overlayTexture; overlayMaterial.emissiveColor = B.Color3.White();
    overlayMaterial.opacityTexture = overlayTexture; overlayMaterial.disableLighting = true;
    const overlay = B.MeshBuilder.CreatePlane("mars-monitor-labels", { width: 4.75, height: 2.7 }, scene);
    overlay.parent = screen.parent; overlay.position.z = -0.165; overlay.isPickable = false; overlay.material = overlayMaterial;
    const observer = scene.onBeforeRenderObservable.add(() => {
      planet.rotation.y += Math.min(scene.getEngine().getDeltaTime() / 1000 || 0, 0.1) * 0.12;
    });
    function applyGraphics(preset) {
      const width = preset.shadowFiltering === "low" ? 512 : preset.shadowFiltering === "high" ? 1536 : 1024;
      target.resize({ width, height: Math.round(width / ASPECT) });
      target.refreshRate = preset.shadowFiltering === "low" ? 2 : 1;
    }
    function dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      const index = scene.customRenderTargets.indexOf(target);
      if (index >= 0) scene.customRenderTargets.splice(index, 1);
      target.dispose(); camera.dispose(); light.dispose(); ambient.dispose();
      planet.dispose(); halo.dispose(); overlay.dispose();
      surface.dispose(true, true); haloMaterial.dispose(); overlayMaterial.dispose();
    }
    return { applyGraphics, dispose, target, planet, camera, halo };
  }
  root.MarsDisplay = Object.freeze({ create, ASPECT, SOURCE, LAYER });
})(globalThis);
