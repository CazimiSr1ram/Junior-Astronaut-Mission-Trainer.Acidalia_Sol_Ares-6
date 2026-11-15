/*
 * Model asset manifest and loader (Babylon.js glTF loader).
 *
 * `available` reflects the files actually present in static/assets/models
 * (checked on 15 Nov 2026; rover and exploration models added the same day). Missing models are listed so they can be added
 * later without code changes: export the .glb to the listed path and set
 * `available: true`. Nothing tries to load a missing model.
 *
 * Exposes ModelAssets in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ModelAssets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROOT = "/static/assets/models/";
  const MANIFEST = Object.freeze({
    pods: Object.freeze({ folder: `${ROOT}habitat/`, file: "Pods.glb", available: true }),
    habitat: Object.freeze({ folder: `${ROOT}habitat/`, file: "mars-habitat.glb", available: false, note: "Final habitat: not exported yet." }),
    rover: Object.freeze({ folder: `${ROOT}rover/`, file: "mars-rover.glb", available: true }),
    racerExhibit: Object.freeze({ folder: `${ROOT}rover/`, file: "mars-racer-omega-ultimate.glb", available: true }),
    crater: Object.freeze({ folder: `${ROOT}terrain/`, file: "Mars_Impact_Crater.glb", available: true }),
    equipmentSite: Object.freeze({ folder: `${ROOT}terrain/`, file: "Mars_Abandoned_Equipment_Site.glb", available: true }),
    layeredHills: Object.freeze({ folder: `${ROOT}terrain/`, file: "layered-hills.glb", available: true, used: false,
      note: "Superseded by explorationHillsVisual (the handoff's curved hills, placed at the edge of the play area)." }),
    // Exploration handoff package (15 Nov 2026). The package's crater model is not used (broken
    // double transform; the Impact Crater is the procedural crater) and its abandoned equipment
    // site is the same model as equipmentSite above.
    explorationRockFormation: Object.freeze({ folder: `${ROOT}exploration/`, file: "Layered_Rock_Formation_Babylon.glb", available: true }),
    explorationMeteoriteField: Object.freeze({ folder: `${ROOT}exploration/`, file: "Meteorite_Field_Babylon.glb", available: true }),
    explorationHillsVisual: Object.freeze({ folder: `${ROOT}exploration/`, file: "Layered_Hills_Curved_Visual.glb", available: true, used: false,
      note: "Compared and not used: 92k triangles, no normals, one grey material, a floating skirt and loose scrap. The collider below is drawn instead." }),
    explorationHillsCollider: Object.freeze({ folder: `${ROOT}exploration/`, file: "Layered_Hills_Curved_Collider.glb", available: true,
      note: "5.6k triangles: the solid and visible Layered Hills." }),
    explorationBeacon: Object.freeze({ folder: `${ROOT}exploration/`, file: "Exploration_Beacon.glb", available: true }),
    explorationCrater: Object.freeze({ folder: `${ROOT}exploration/`, file: "Mars_Impact_Crater_Babylon.glb", available: true, used: false,
      note: "Not used: baked metre vertices plus a x8, Y/Z-swapped node matrix give a 130 m upright shell; its collider is a filled mound." }),
  });

  const loaded = {};

  function loaderReady() {
    const B = globalThis.BABYLON;
    return Boolean(B && B.SceneLoader && B.SceneLoader.IsPluginForExtensionAvailable && B.SceneLoader.IsPluginForExtensionAvailable(".glb"));
  }

  /**
   * Loads a manifest model into `scene`. Resolves to the Babylon import result,
   * or null when the model is missing, the loader is unavailable or loading
   * fails (the caller keeps its placeholder). Records the outcome in `status`.
   */
  async function load(scene, key) {
    const entry = MANIFEST[key];
    if (!entry || !entry.available) { loaded[key] = "missing"; return null; }
    if (!loaderReady()) { loaded[key] = "no-loader"; return null; }
    try {
      const result = await globalThis.BABYLON.SceneLoader.ImportMeshAsync("", entry.folder, entry.file, scene);
      loaded[key] = "loaded";
      return result;
    } catch (error) {
      loaded[key] = "failed";
      console.warn(`Model ${entry.file} could not be loaded; keeping the placeholder.`, error && error.message);
      return null;
    }
  }

  return Object.freeze({ MANIFEST, load, loaderReady, get status() { return { ...loaded }; } });
});
