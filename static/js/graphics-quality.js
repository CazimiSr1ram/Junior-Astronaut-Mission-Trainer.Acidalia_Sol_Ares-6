/*
 * Graphics quality: rendering resolution, shadow quality and optional effects.
 *
 * Presets: Low, Medium, High and Auto. Auto starts from Medium settings and
 * adjusts the rendering resolution to the measured frame rate, so slower
 * school laptops stay smooth while fast machines render sharper.
 *
 * Resolution is expressed as a pixel ratio: rendered pixels per CSS pixel.
 * Babylon's hardware scaling level is its inverse (level > 1 renders BELOW
 * the canvas size, which is what made the game blurry on Retina screens).
 *
 * Purely visual: nothing here changes gameplay, timing or collisions.
 *
 * Exposes GraphicsQuality in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GraphicsQuality = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "jamt.graphics.v1";
  const LEVELS = Object.freeze(["auto", "low", "medium", "high"]);

  const PRESETS = Object.freeze({
    low: Object.freeze({
      label: "Low",
      // Render at (up to) CSS resolution, slightly reduced for weak GPUs.
      maxPixelRatio: 1,
      renderScale: 0.85,
      shadowMapSize: Object.freeze({ mars: 1024, lobby: 512 }),
      shadowFiltering: "low",
      glow: false,
      dustScale: 0.5,
    }),
    medium: Object.freeze({
      label: "Medium",
      maxPixelRatio: 1.5,
      renderScale: 1,
      // Medium keeps the shadow settings the game shipped with.
      shadowMapSize: Object.freeze({ mars: 2048, lobby: 1024 }),
      shadowFiltering: "medium",
      glow: false,
      dustScale: 1,
    }),
    high: Object.freeze({
      label: "High",
      maxPixelRatio: 2,
      renderScale: 1,
      shadowMapSize: Object.freeze({ mars: 4096, lobby: 2048 }),
      shadowFiltering: "high",
      // Soft halo on the lobby light strips only (never on text signs).
      glow: true,
      dustScale: 1,
    }),
  });

  // Auto mode: adapt resolution between these pixel ratios using frame rate.
  const AUTO = Object.freeze({
    base: "medium",
    minPixelRatio: 0.75,
    maxPixelRatio: 2,
    step: 0.25,
    lowFps: 45,         // average below this (over a window) -> lower resolution
    highFps: 57,        // average above this for a longer window -> raise it
    downWindow: 2,      // seconds of samples before stepping down
    upWindow: 6,        // seconds of good frames before stepping up
    cooldown: 3,        // seconds to wait after any change
    maxFrameGap: 0.25,  // ignore frames longer than this (tab hidden, modal, GC)
  });

  function normalizeLevel(level) {
    return LEVELS.includes(level) ? level : "auto";
  }

  /** Rendered pixels per CSS pixel for a fixed preset on this display. */
  function pixelRatioFor(level, devicePixelRatio) {
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const preset = PRESETS[level] || PRESETS.medium;
    return Math.min(dpr, preset.maxPixelRatio) * preset.renderScale;
  }

  /** Babylon hardware scaling level for a pixel ratio (its inverse). */
  function hardwareScalingFor(pixelRatio) {
    return 1 / pixelRatio;
  }

  /** Settings applied to scenes for a level (Auto uses its base preset). */
  function presetFor(level) {
    return PRESETS[normalizeLevel(level) === "auto" ? AUTO.base : level];
  }

  /**
   * Auto resolution controller. Feed it frame times; it returns a new pixel
   * ratio when the resolution should change, otherwise null.
   */
  function createAutoController(devicePixelRatio) {
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const ceiling = Math.max(AUTO.minPixelRatio, Math.min(dpr, AUTO.maxPixelRatio));
    let pixelRatio = Math.min(ceiling, PRESETS[AUTO.base].maxPixelRatio);
    let windowTime = 0;
    let windowFrames = 0;
    let goodTime = 0;
    let cooldown = AUTO.cooldown;

    function change(next) {
      const clamped = Math.round(Math.min(ceiling, Math.max(AUTO.minPixelRatio, next)) * 100) / 100;
      windowTime = 0;
      windowFrames = 0;
      goodTime = 0;
      cooldown = AUTO.cooldown;
      if (clamped === pixelRatio) return null;
      pixelRatio = clamped;
      return pixelRatio;
    }

    function sample(frameSeconds) {
      if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > AUTO.maxFrameGap) return null;
      if (cooldown > 0) {
        cooldown -= frameSeconds;
        return null;
      }
      windowTime += frameSeconds;
      windowFrames += 1;
      if (windowTime < AUTO.downWindow) return null;
      const fps = windowFrames / windowTime;
      windowTime = 0;
      windowFrames = 0;
      if (fps < AUTO.lowFps && pixelRatio > AUTO.minPixelRatio) return change(pixelRatio - AUTO.step);
      if (fps >= AUTO.highFps) {
        goodTime += AUTO.downWindow;
        if (goodTime >= AUTO.upWindow && pixelRatio < ceiling) return change(pixelRatio + AUTO.step);
      } else {
        goodTime = 0;
      }
      return null;
    }

    return {
      sample,
      get pixelRatio() { return pixelRatio; },
      get ceiling() { return ceiling; },
    };
  }

  function load(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      return normalizeLevel(raw ? JSON.parse(raw).level : "auto");
    } catch (error) {
      return "auto";
    }
  }

  function save(storage, level) {
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify({ level: normalizeLevel(level) }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sharp text texture for signs and screens (browser only).
   *
   * Creates a DynamicTexture `scale` times larger than the logical size, with
   * mipmaps, trilinear and anisotropic filtering, and pre-scales its 2D
   * context so existing drawing code keeps using logical coordinates.
   * Mipmaps stop text shimmering and breaking up when seen from a distance.
   */
  function createTextTexture(name, logicalWidth, logicalHeight, scene, scale = 1.5) {
    const B = globalThis.BABYLON;
    const texture = new B.DynamicTexture(
      name,
      { width: Math.round(logicalWidth * scale), height: Math.round(logicalHeight * scale) },
      scene,
      true,
      B.Texture.TRILINEAR_SAMPLINGMODE
    );
    texture.anisotropicFilteringLevel = 8;
    texture.wrapU = B.Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    texture.getContext().scale(scale, scale);
    return texture;
  }

  return Object.freeze({
    STORAGE_KEY,
    LEVELS,
    PRESETS,
    AUTO,
    normalizeLevel,
    pixelRatioFor,
    hardwareScalingFor,
    presetFor,
    createAutoController,
    load,
    save,
    createTextTexture,
  });
});
