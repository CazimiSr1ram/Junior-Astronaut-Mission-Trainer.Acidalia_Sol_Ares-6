"use strict";

const assert = require("assert");
const GraphicsQuality = require("../static/js/graphics-quality.js");

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

// Retina (DPR 2): no preset renders below CSS resolution except Low's mild
// reduction; the old formula max(1, dpr / 1.5) gave 0.75x CSS pixels.
{
  const old = 1 / Math.max(1, 2 / 1.5);
  close(old, 0.75, "old formula on Retina");
  close(GraphicsQuality.pixelRatioFor("low", 2), 0.85, "low on Retina");
  close(GraphicsQuality.pixelRatioFor("medium", 2), 1.5, "medium on Retina");
  close(GraphicsQuality.pixelRatioFor("high", 2), 2, "high on Retina");
  assert.ok(GraphicsQuality.pixelRatioFor("low", 2) > old, "even Low is sharper than before on Retina");
}

// Standard display (DPR 1): presets never exceed the screen's own resolution.
{
  close(GraphicsQuality.pixelRatioFor("medium", 1), 1, "medium on DPR 1");
  close(GraphicsQuality.pixelRatioFor("high", 1), 1, "high on DPR 1");
  close(GraphicsQuality.pixelRatioFor("low", 1), 0.85, "low on DPR 1");
  // High-DPI phones/tablets (DPR 3) are capped so they are not overloaded.
  close(GraphicsQuality.pixelRatioFor("high", 3), 2, "high capped at 2x");
  close(GraphicsQuality.pixelRatioFor("medium", undefined), 1, "unknown DPR treated as 1");
  close(GraphicsQuality.hardwareScalingFor(2), 0.5, "scaling level is the inverse ratio");
}

// Presets: Medium keeps the original shadow settings; High adds glow; Auto uses Medium.
{
  const { low, medium, high } = GraphicsQuality.PRESETS;
  assert.deepStrictEqual({ ...medium.shadowMapSize }, { mars: 2048, lobby: 1024 });
  assert.strictEqual(medium.shadowFiltering, "medium");
  assert.ok(low.shadowMapSize.mars < medium.shadowMapSize.mars && medium.shadowMapSize.mars < high.shadowMapSize.mars);
  assert.strictEqual(low.glow, false);
  assert.strictEqual(medium.glow, false);
  assert.strictEqual(high.glow, true);
  assert.strictEqual(GraphicsQuality.presetFor("auto"), medium);
  assert.strictEqual(GraphicsQuality.presetFor("nonsense"), medium);
  assert.strictEqual(GraphicsQuality.normalizeLevel("ultra"), "auto");
}

function feed(controller, fps, seconds) {
  const changes = [];
  for (let t = 0; t < seconds; t += 1 / fps) {
    const next = controller.sample(1 / fps);
    if (next !== null) changes.push(next);
  }
  return changes;
}

// Auto: slow frame rates lower the resolution step by step, down to a floor.
{
  const auto = GraphicsQuality.createAutoController(2);
  close(auto.pixelRatio, 1.5, "auto starts at the medium ratio");
  const changes = feed(auto, 30, 60);
  assert.ok(changes.length >= 2, "steps down repeatedly while slow");
  assert.ok(changes.every((value, i) => i === 0 || value < changes[i - 1]), "only steps down while slow");
  close(auto.pixelRatio, GraphicsQuality.AUTO.minPixelRatio, "stops at the floor");
}

// Auto: fast frame rates raise resolution up to the screen (max 2x), not beyond.
{
  const auto = GraphicsQuality.createAutoController(2);
  feed(auto, 30, 20); // drop first
  const lowered = auto.pixelRatio;
  feed(auto, 60, 120);
  assert.ok(auto.pixelRatio > lowered, "recovers when the frame rate is good");
  close(auto.pixelRatio, 2, "rises to the Retina ceiling");
  const standard = GraphicsQuality.createAutoController(1);
  close(standard.pixelRatio, 1, "DPR 1 starts at 1x");
  feed(standard, 60, 120);
  close(standard.pixelRatio, 1, "never renders above the screen resolution");
}

// Auto: a brief stutter (one slow window) after good frames changes one step only,
// and paused/hidden gaps (huge frame times) are ignored.
{
  const auto = GraphicsQuality.createAutoController(2);
  assert.strictEqual(auto.sample(5), null, "huge gaps ignored");
  assert.strictEqual(auto.sample(-1), null, "invalid samples ignored");
  feed(auto, 60, 10);
  const before = auto.pixelRatio;
  const changes = feed(auto, 40, 2.5);
  assert.ok(changes.length <= 1, "at most one step for a short stutter");
  assert.ok(auto.pixelRatio >= before - GraphicsQuality.AUTO.step - 1e-9);
}

// Storage: remembers the choice and survives broken storage.
{
  let saved = null;
  const storage = { getItem: () => saved, setItem: (key, value) => { assert.strictEqual(key, GraphicsQuality.STORAGE_KEY); saved = value; } };
  assert.strictEqual(GraphicsQuality.load(storage), "auto", "defaults to auto");
  assert.ok(GraphicsQuality.save(storage, "high"));
  assert.strictEqual(GraphicsQuality.load(storage), "high");
  saved = "{not json";
  assert.strictEqual(GraphicsQuality.load(storage), "auto", "corrupt value falls back to auto");
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.strictEqual(GraphicsQuality.load(throwing), "auto");
  assert.strictEqual(GraphicsQuality.save(throwing, "low"), false);
  assert.strictEqual(GraphicsQuality.load(null), "auto");
}

console.log("graphics-quality tests passed");
