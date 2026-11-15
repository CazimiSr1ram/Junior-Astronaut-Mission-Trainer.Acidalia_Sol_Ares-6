"use strict";

// Jumping, gravity, grounded detection and landing (vertical movement).

const assert = require("assert");
const JumpPhysics = require("../static/js/jump-physics.js");

const { GRAVITY, DEFAULTS } = JumpPhysics;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const FRAME = 1 / 60;

/** Simulates a jump on flat ground; returns { apex, airTime }. */
function simulateJump(gravity) {
  const body = JumpPhysics.createVerticalBody({ gravity });
  body.place(0);
  assert.strictEqual(body.requestJump(), true);
  let apex = 0, time = 0;
  for (let i = 0; i < 1000; i += 1) {
    const r = body.step(FRAME, 0);
    time += FRAME;
    apex = Math.max(apex, r.y);
    if (r.landed) break;
  }
  return { apex, airTime: time, body };
}

// Gravity values and expected jump arcs (Earth vs Mars).
{
  assert.strictEqual(GRAVITY.earth, 9.81);
  assert.strictEqual(GRAVITY.mars, 3.71);
  const earth = simulateJump(GRAVITY.earth);
  const mars = simulateJump(GRAVITY.mars);
  close(earth.apex, JumpPhysics.apexHeight(GRAVITY.earth), 0.02, "Earth apex");
  close(mars.apex, JumpPhysics.apexHeight(GRAVITY.mars), 0.02, "Mars apex");
  assert.ok(earth.apex > 0.45 && earth.apex < 0.6, `Earth jump ~0.5 m (${earth.apex.toFixed(2)})`);
  assert.ok(mars.apex > 1.2 && mars.apex < 1.5, `Mars jump ~1.4 m (${mars.apex.toFixed(2)})`);
  close(mars.apex / earth.apex, GRAVITY.earth / GRAVITY.mars, 0.05, "same take-off speed goes 2.6x higher on Mars");
  close(earth.airTime, JumpPhysics.airTime(GRAVITY.earth), 2 * FRAME, "Earth air time");
  close(mars.airTime, JumpPhysics.airTime(GRAVITY.mars), 2 * FRAME, "Mars air time");
  assert.strictEqual(earth.body.grounded, true, "landed again");
  assert.strictEqual(earth.body.y, 0);
}

// Only when grounded: no double jump, no mid-air jump, no queued spam.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.earth });
  body.place(0);
  assert.strictEqual(body.requestJump(), true);
  assert.strictEqual(body.requestJump(), false, "second press before take-off is ignored");
  body.step(FRAME, 0);
  assert.strictEqual(body.grounded, false);
  for (let i = 0; i < 10; i += 1) {
    assert.strictEqual(body.requestJump(), false, "no mid-air jump");
    body.step(FRAME, 0);
  }
  const apex = simulateJump(GRAVITY.earth).apex;
  let peak = body.y;
  for (let i = 0; i < 200 && !body.grounded; i += 1) { body.requestJump(); peak = Math.max(peak, body.step(FRAME, 0).y); }
  assert.ok(peak <= apex + 0.01, "pressing in the air never adds height");
  assert.strictEqual(body.grounded, true);
  assert.strictEqual(body.requestJump(), true, "can jump again after landing");
}

// Crouch interaction: no jumping while crouched.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.mars });
  body.place(0);
  assert.strictEqual(body.requestJump({ crouched: true }), false);
  body.step(FRAME, 0);
  assert.strictEqual(body.y, 0);
  assert.strictEqual(body.grounded, true);
}

// Ceilings: the head stops at a low ceiling and the astronaut falls back down.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.mars });
  body.place(0);
  body.requestJump();
  let bonked = false, maxY = 0;
  for (let i = 0; i < 400 && !(i > 1 && body.grounded); i += 1) {
    const r = body.step(FRAME, 0, { maxFeetY: 0.3 });
    bonked = bonked || r.bonked;
    maxY = Math.max(maxY, r.y);
  }
  assert.ok(bonked, "hit the ceiling");
  assert.ok(maxY <= 0.3 + 1e-9, `never passes the ceiling (${maxY})`);
  assert.strictEqual(body.grounded, true, "comes back down");
}

// Grounded on terrain: follows slopes and ramps without bouncing; small steps up/down.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.mars });
  body.place(0);
  // 45-degree downhill: 0.1 m sideways and 0.1 m down per frame (sprinting down a slope).
  for (let i = 1; i <= 30; i += 1) {
    const r = body.step(FRAME, -0.1 * i, { horizontalDistance: 0.1 });
    assert.strictEqual(r.fell, false, "stays on a 45° slope");
    assert.strictEqual(body.grounded, true);
  }
  close(body.y, -3, 1e-9, "followed the slope down");
  // Uphill and a 0.3 m step up are followed.
  body.step(FRAME, -2.9, { horizontalDistance: 0.1 });
  body.step(FRAME, -2.6, { horizontalDistance: 0.05 });
  close(body.y, -2.6, 1e-9, "stepped up 0.3 m");
}

// Walking off an edge: falls (no snap down a 1 m ledge) and lands on the lower ground.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.earth });
  body.place(1.0); // standing on a 1 m crate
  const r = body.step(FRAME, 0, { horizontalDistance: 0.05 });
  assert.strictEqual(r.fell, true, "walked off the crate");
  assert.strictEqual(body.grounded, false);
  assert.ok(body.y > 0.9, "does not teleport down");
  let landed = false;
  for (let i = 0; i < 100 && !landed; i += 1) landed = body.step(FRAME, 0).landed;
  assert.ok(landed);
  assert.strictEqual(body.y, 0);
}

// Jumping onto a low solid object (e.g. a 0.7 m crate on Mars) and landing on top of it.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.mars });
  body.place(0);
  body.requestJump();
  let onTop = false;
  for (let i = 0; i < 200; i += 1) {
    // After 0.3 s the astronaut has moved over the crate: support becomes its top.
    const support = i * FRAME > 0.3 ? 0.7 : 0;
    const r = body.step(FRAME, support);
    if (r.landed) { onTop = support === 0.7; break; }
  }
  assert.ok(onTop, "landed on top of the crate");
  close(body.y, 0.7, 1e-9, "standing on the crate");
  // A 0.7 m crate is too high to step onto on Earth without jumping.
  const earth = JumpPhysics.createVerticalBody({ gravity: GRAVITY.earth });
  earth.place(0);
  earth.step(FRAME, 0.7, { horizontalDistance: 0.05 });
  assert.strictEqual(earth.y, 0.7, "raised support directly under the feet is stood on (teleport safety)");
  assert.ok(DEFAULTS.stepUp < 0.7, "but 0.7 m is above the automatic step-up height");
}

// Robustness: invalid frames change nothing; long frames are capped.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.earth });
  body.place(0);
  body.requestJump();
  body.step(NaN, 0); body.step(-1, 0); body.step(FRAME, NaN);
  assert.strictEqual(body.grounded, true, "jump not consumed by invalid frames");
  body.step(5, 0); // a 5 s stall is treated as 0.1 s
  assert.strictEqual(body.grounded, false, "still in the air after a capped long frame");
  assert.throws(() => JumpPhysics.createVerticalBody({ gravity: 0 }), RangeError);
}

// A jump pressed just before a menu opens is dropped (cancelJump), not performed later.
{
  const body = JumpPhysics.createVerticalBody({ gravity: GRAVITY.earth });
  body.place(0);
  assert.strictEqual(body.requestJump(), true);
  body.cancelJump();
  for (let i = 0; i < 30; i += 1) body.step(FRAME, 0);
  assert.strictEqual(body.y, 0);
  assert.strictEqual(body.grounded, true, "no jump after cancel");
}

console.log("jump-physics tests passed");
