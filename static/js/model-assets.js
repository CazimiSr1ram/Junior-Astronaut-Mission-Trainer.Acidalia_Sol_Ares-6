/*
 * Model asset manifest and loader (Babylon.js glTF loader).
 *
 * `available` reflects the files actually present in static/assets/models
 * (checked on 15 Nov 2026). Missing models are listed so they can be added
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
    rover: Object.freeze({ folder: `${ROOT}rover/`, file: "mars-rover.glb", available: false, note: "Rover: only blender-source/rover-generator.py exists; no .glb export yet." }),
    crater: Object.freeze({ folder: `${ROOT}terrain/`, file: "Mars_Impact_Crater.glb", available: true }),
    equipmentSite: Object.freeze({ folder: `${ROOT}terrain/`, file: "Mars_Abandoned_Equipment_Site.glb", available: true }),
    layeredHills: Object.freeze({ folder: `${ROOT}terrain/`, file: "layered-hills.glb", available: true, used: false,
      note: "Not placed: 90k triangles; inside the play area it overlaps the procedural terrain, outside it is mostly hidden by fog." }),
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
