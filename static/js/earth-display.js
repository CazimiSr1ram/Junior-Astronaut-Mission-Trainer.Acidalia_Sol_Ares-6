/* Local NASA Blue Marble imagery; rotating sphere, lit terminator and thin atmosphere. */
(function (root) {
  "use strict";
  function create(scene, parent, onStatus = () => {}) {
    const B = BABYLON;
    B.Effect.ShadersStore.earthExhibitVertexShader = `precision highp float;
      attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
      uniform mat4 world; uniform mat4 worldViewProjection;
      varying vec3 n; varying vec3 p; varying vec2 texUV;
      void main(){ n=normalize(mat3(world)*normal); p=(world*vec4(position,1.)).xyz;
        texUV=uv; gl_Position=worldViewProjection*vec4(position,1.); }`;
    B.Effect.ShadersStore.earthExhibitFragmentShader = `precision highp float;
      varying vec3 n; varying vec3 p; varying vec2 texUV;
      uniform sampler2D earthMap; uniform sampler2D cloudMap;
      uniform vec3 sunDirection; uniform float cloudsReady; uniform float cloudDrift;
      void main(){ vec3 color=pow(texture2D(earthMap,texUV).rgb,vec3(2.2));
        float cloud=texture2D(cloudMap,vec2(fract(texUV.x+cloudDrift),texUV.y)).r*cloudsReady;
        color=mix(color,vec3(.95),smoothstep(.12,.9,cloud)*.92);
        float day=smoothstep(-.12,.35,dot(normalize(n),sunDirection));
        gl_FragColor=vec4(pow(color*(.018+day*1.15),vec3(1./2.2)),1.); }`;
    B.Effect.ShadersStore.earthAirFragmentShader = `precision highp float;
      varying vec3 n; varying vec3 p; varying vec2 texUV;
      uniform vec3 cameraPosition; uniform vec3 sunDirection;
      void main(){ float rim=pow(1.-max(0.,dot(normalize(n),normalize(cameraPosition-p))),3.);
        float day=.3+.7*max(0.,dot(normalize(n),sunDirection));
        gl_FragColor=vec4(.18,.58,1.,rim*.28*day); }`;
    const globe = B.MeshBuilder.CreateSphere("earth-globe", { diameter: 1.92, segments: 32 }, scene);
    globe.parent = parent; globe.position.set(0, -0.03, -1.16); globe.isPickable = false;
    const material = new B.ShaderMaterial("earth-globe-material", scene, "earthExhibit", {
      attributes: ["position", "normal", "uv"], uniforms: ["world", "worldViewProjection", "sunDirection", "cloudsReady", "cloudDrift"], samplers: ["earthMap", "cloudMap"],
    });
    let mapReady = false, cloudsReady = false;
    const status = () => onStatus(mapReady ? (cloudsReady ? "NASA BLUE MARBLE · CLOUD COMPOSITE" : "NASA BLUE MARBLE · CLOUDS LOADING") : "EARTH TEXTURE LOADING");
    const map = new B.Texture("/static/assets/textures/earth/bluemarble-2048.png", scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE,
      () => { mapReady = true; status(); }, () => onStatus("TEMPORARY GLOBE · EARTH TEXTURE UNAVAILABLE"));
    const clouds = new B.Texture("/static/assets/textures/earth/clouds-2048.jpg", scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE,
      () => { cloudsReady = true; material.setFloat("cloudsReady", 1); status(); }, () => onStatus("NASA BLUE MARBLE · CLOUD TEXTURE UNAVAILABLE"));
    map.anisotropicFilteringLevel = 2; clouds.anisotropicFilteringLevel = 2;
    material.setTexture("earthMap", map); material.setTexture("cloudMap", clouds);
    material.setFloat("cloudsReady", 0); material.setFloat("cloudDrift", 0);
    parent.computeWorldMatrix(true);
    const sun = B.Vector3.TransformNormal(new B.Vector3(-0.65, 0.5, -1), parent.getWorldMatrix()).normalize();
    material.setVector3("sunDirection", sun);
    globe.material = material;
    const air = B.MeshBuilder.CreateSphere("earth-atmosphere", { diameter: 1.97, segments: 32 }, scene);
    air.parent = parent; air.position.copyFrom(globe.position); air.isPickable = false;
    const airMaterial = new B.ShaderMaterial("earth-atmosphere-material", scene, { vertex: "earthExhibit", fragment: "earthAir" }, {
      attributes: ["position", "normal", "uv"], uniforms: ["world", "worldViewProjection", "cameraPosition", "sunDirection"], needAlphaBlending: true,
    });
    airMaterial.setVector3("sunDirection", sun); air.material = airMaterial;
    let seconds = 0;
    scene.onBeforeRenderObservable.add(() => {
      seconds += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000 || 0);
      globe.rotation.y = seconds * 0.035;
      material.setFloat("cloudDrift", seconds * 0.00035);
      airMaterial.setVector3("cameraPosition", scene.activeCamera.globalPosition);
    });
    status();
    return { globe, air, get ready() { return mapReady && cloudsReady; } };
  }
  root.EarthDisplay = Object.freeze({ create });
})(globalThis);
