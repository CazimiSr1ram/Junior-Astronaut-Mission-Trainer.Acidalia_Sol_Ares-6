/*
 * Vertical movement for the astronaut: gravity, jumping and landing.
 *
 * Pure logic (no Babylon.js), used by player-view.js, which still does all
 * horizontal movement and collisions. Each frame player-view passes the height
 * of the surface under the feet ("support") and the highest the feet may rise
 * before the head would hit a ceiling; this module returns the new feet height.
 *
 *   - jump only when grounded (no double / mid-air jumps), not while crouched
 *   - gravity per world: Earth 9.81 m/s^2, Mars 3.71 m/s^2 (same take-off speed,
 *     so the same jump goes about 2.6x higher on Mars)
 *   - while grounded the feet follow terrain, ramps and small steps; walking
 *     off a real edge makes the astronaut fall; landing stops the fall
 *
 * Exposes JumpPhysics in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JumpPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GRAVITY = Object.freeze({ earth: 9.81, mars: 3.71 }); // m/s^2
  const DEFAULTS = Object.freeze({
    jumpSpeed: 3.2,       // m/s take-off: ~0.52 m on Earth, ~1.38 m on Mars
    stepUp: 0.35,         // highest ledge followed without jumping (m)
    stepDown: 0.3,        // drop followed without falling, plus slope allowance
    slopeSnap: 1.1,       // extra drop allowed per metre walked (keeps feet on 45° slopes)
    substep: 1 / 120,     // integration step (s)
    maxFrame: 0.1,        // ignore longer frames (tab switches, stalls)
  });

  function apexHeight(gravity, jumpSpeed = DEFAULTS.jumpSpeed) {
    return (jumpSpeed * jumpSpeed) / (2 * gravity);
  }

  function airTime(gravity, jumpSpeed = DEFAULTS.jumpSpeed) {
    return (2 * jumpSpeed) / gravity;
  }

  function createVerticalBody(options = {}) {
    const gravity = options.gravity ?? GRAVITY.earth;
    const jumpSpeed = options.jumpSpeed ?? DEFAULTS.jumpSpeed;
    const stepUp = options.stepUp ?? DEFAULTS.stepUp;
    const stepDown = options.stepDown ?? DEFAULTS.stepDown;
    const slopeSnap = options.slopeSnap ?? DEFAULTS.slopeSnap;
    if (!(gravity > 0)) throw new RangeError("Gravity must be positive.");

    let y = options.y ?? 0;
    let vy = 0;
    let grounded = true;
    let jumpQueued = false;

    /** Puts the feet on a surface (spawn, teleport). */
    function place(supportY) {
      y = supportY;
      vy = 0;
      grounded = true;
      jumpQueued = false;
    }

    /**
     * Asks for a jump. Accepted only when standing on something and not
     * crouched; the take-off happens on the next step(). Returns whether accepted.
     */
    /** Drops a jump that was pressed but has not taken off yet (menus opening, cutscenes). */
    function cancelJump() {
      jumpQueued = false;
    }

    function requestJump({ crouched = false } = {}) {
      if (!grounded || crouched || jumpQueued) return false;
      jumpQueued = true;
      return true;
    }

    /**
     * Advances by dt seconds.
     *   supportY: highest walkable surface under the feet (ground or standable object)
     *   horizontalDistance: how far the feet moved sideways this frame
     *   maxFeetY: highest the feet may go before the head meets a ceiling
     * Returns { y, jumped, landed, bonked, fell }.
     */
    function step(dt, supportY, { horizontalDistance = 0, maxFeetY = Infinity } = {}) {
      const result = { y, jumped: false, landed: false, bonked: false, fell: false };
      if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(supportY)) return result;
      const frame = Math.min(dt, DEFAULTS.maxFrame);

      if (jumpQueued && grounded) {
        vy = jumpSpeed;
        grounded = false;
        result.jumped = true;
      }
      jumpQueued = false;

      if (grounded) {
        if (supportY > y + stepUp) {
          // Raised ground right under the feet (e.g. after a teleport): stand on it.
          y = supportY;
          vy = 0;
        } else if (supportY >= y - (stepDown + Math.max(0, horizontalDistance) * slopeSnap)) {
          // Follow terrain, ramps and small steps up or down.
          y = supportY;
          vy = 0;
        } else {
          // Walked off an edge: start falling.
          grounded = false;
          vy = 0;
          result.fell = true;
        }
      }

      if (!grounded) {
        let remaining = frame;
        while (remaining > 1e-9) {
          const h = Math.min(remaining, DEFAULTS.substep);
          vy -= gravity * h;
          let next = y + vy * h;
          if (next > maxFeetY) {
            next = Math.max(y, maxFeetY);
            if (vy > 0) vy = 0;
            result.bonked = true;
          }
          if (next <= supportY) {
            y = supportY;
            vy = 0;
            grounded = true;
            result.landed = true;
            break;
          }
          y = next;
          remaining -= h;
        }
      }
      result.y = y;
      return result;
    }

    return {
      place, requestJump, cancelJump, step,
      get y() { return y; },
      get vy() { return vy; },
      get grounded() { return grounded; },
      get gravity() { return gravity; },
      get jumpSpeed() { return jumpSpeed; },
    };
  }

  return Object.freeze({ GRAVITY, DEFAULTS, apexHeight, airTime, createVerticalBody });
});
