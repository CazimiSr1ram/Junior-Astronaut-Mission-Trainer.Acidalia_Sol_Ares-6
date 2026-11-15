/*
 * LAUNCH PREP crew queue platforms (physical mission selection in the lobby).
 *
 * The player joins a mission by WALKING onto a platform's standing zone:
 *   1. the zone is detected from the astronaut's feet (padAt)
 *   2. the player is registered in that queue only (never two at once)
 *   3. a 20-second countdown starts automatically
 *   4. walking off (or Leave Queue) empties the queue and resets the countdown
 *   5. at zero the crew launches - but only if that crew mode has a working
 *      game session. Today that is SOLO only: multiplayer pads show that
 *      networking is in development, never start a solo game and never invent
 *      other astronauts. `remoteCrew` / `isModeAvailable` are the hooks a future
 *      networking layer would use.
 *
 * The countdown only advances while the lobby ticks it (controls enabled), so
 * it pauses in menus and cutscenes. Launch fires once.
 *
 * Also holds the LAUNCH PREP layout (platforms, standing positions, openings,
 * gate and directional signs) so it can be tested without Babylon.js.
 *
 * Exposes LaunchQueue in the browser and module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LaunchQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const freezeDeep = (value) => {
    Object.values(value).forEach((child) => { if (child && typeof child === "object") freezeDeep(child); });
    return Object.freeze(value);
  };

  const COUNTDOWN_SECONDS = 20;

  // Lobby coordinates (metres). The hall runs from the entrance (z = -30) to
  // the launch doors (z = +30). LAUNCH PREP is the fenced area behind the gate.
  const LAYOUT = freezeDeep({
    gate: { x: 0, z: 18, halfWidth: 3.2 },
    barrierZ: 18,
    pads: [
      // SOLO stands right in front of the gate; crew platforms form an arc behind it.
      { id: "pad-duo", crew: 2, title: "DUO", playable: false, x: -13.4, z: 24.5, radius: 1.6 },
      { id: "pad-trio", crew: 3, title: "TRIO", playable: false, x: -7.6, z: 25.4, radius: 1.8 },
      { id: "pad-solo", crew: 1, title: "SOLO", playable: true, x: 0, z: 22.7, radius: 1.5 },
      { id: "pad-squad", crew: 4, title: "SQUAD", playable: false, x: 7.6, z: 25.4, radius: 2.0 },
      { id: "pad-full-crew", crew: 5, title: "FULL CREW", playable: false, x: 14.2, z: 24.5, radius: 2.2 },
    ],
    railingGap: 0.35,          // railing sits this far outside the platform edge
    entranceOpening: 1.9,      // radians open towards the gate (ENTER)
    exitOpening: 1.3,          // radians open on the far side (EXIT)
    spotRadius: 0.42,          // numbered standing position markers
    // Directional signs. rotationY follows Babylon planes: the readable side
    // faces (-sin y, 0, -cos y); the reader looks along (sin y, 0, cos y).
    signs: [
      { id: "sign-entrance", text: "LAUNCH PREP  ↑  STRAIGHT AHEAD", arrow: "up", x: 0, y: 5.2, z: -21, rotationY: 0, width: 9, height: 0.9 },
      { id: "sign-hologram", text: "LAUNCH PREP  ↑", arrow: "up", x: 0, y: 5.3, z: 7, rotationY: 0, width: 5.5, height: 0.9 },
      { id: "sign-equipment", text: "←  LAUNCH PREP", arrow: "left", x: 12.8, y: 5.8, z: 13, rotationY: Math.atan2(12.8, 37), width: 5.5, height: 0.9 },
      { id: "sign-gate", text: "LAUNCH PREP", arrow: null, x: 0, y: 4.15, z: 17.9, rotationY: 0, width: 5.6, height: 0.8 },
      { id: "sign-gate-exit", text: "EXIT TO LOBBY", arrow: null, x: 0, y: 4.15, z: 18.1, rotationY: Math.PI, width: 5.6, height: 0.8 },
    ],
  });

  function padById(id) {
    return LAYOUT.pads.find((pad) => pad.id === id) || null;
  }

  /** The platform whose standing zone contains the point, or null. */
  function padAt(x, z) {
    const hit = LAYOUT.pads.find((pad) => Math.hypot(x - pad.x, z - pad.z) <= pad.radius);
    return hit ? hit.id : null;
  }

  /** Direction from a platform towards the gate (radians, Babylon y-rotation convention). */
  function facingGate(pad) {
    return Math.atan2(LAYOUT.gate.x - pad.x, LAYOUT.gate.z - pad.z);
  }

  /** Numbered standing positions (world x/z), position 1 nearest the entrance. */
  function standingSpots(pad) {
    if (pad.crew === 1) return [{ number: 1, x: pad.x, z: pad.z }];
    const ring = pad.radius - 0.6;
    const start = facingGate(pad);
    return Array.from({ length: pad.crew }, (_, i) => {
      const a = start + (Math.PI * 2 * i) / pad.crew + Math.PI / pad.crew;
      return { number: i + 1, x: pad.x + ring * Math.sin(a), z: pad.z + ring * Math.cos(a) };
    });
  }

  /** Where Leave Queue puts the astronaut: just outside the platform's EXIT opening. */
  function exitPoint(pad) {
    const away = facingGate(pad) + Math.PI;
    const out = pad.radius + LAYOUT.railingGap + 0.9;
    return { x: pad.x + Math.sin(away) * out, z: pad.z + Math.cos(away) * out };
  }

  /** Direction of the gate as seen by someone reading a sign: "up", "left" or "right". */
  function arrowToward(sign, target = LAYOUT.gate) {
    const s = Math.sin(sign.rotationY), c = Math.cos(sign.rotationY);
    const gx = target.x - sign.x, gz = target.z - sign.z;
    const forward = gx * s + gz * c;      // along the reader's view
    const right = gx * c - gz * s;        // to the reader's right
    const angle = Math.atan2(right, forward) * 180 / Math.PI;
    if (Math.abs(angle) <= 35) return "up";
    return angle < 0 ? "left" : "right";
  }

  function create(options = {}) {
    const countdownSeconds = options.countdownSeconds ?? COUNTDOWN_SECONDS;
    // A crew mode can launch only with a working game session (SOLO today).
    const isModeAvailable = typeof options.isModeAvailable === "function" ? options.isModeAvailable : (pad) => pad.playable === true;
    let padId = null;          // the ONE platform the local player is queued on
    let remaining = null;      // countdown seconds while someone is queued
    let launched = false;
    let blocked = false;       // countdown finished but the mode has no session
    const remoteCrew = {};     // future networking: padId -> other players (unused; nothing is faked)

    function crewOn(id) {
      return (id === padId ? 1 : 0) + (remoteCrew[id] || 0);
    }

    function statusOf(pad) {
      const queued = crewOn(pad.id);
      const mine = pad.id === padId;
      const base = { queued, remaining: mine && remaining !== null ? Math.max(0, remaining) : null };
      if (!queued) {
        return { ...base, line: pad.playable ? "STEP ON TO JOIN" : "MULTIPLAYER IN DEVELOPMENT",
          detail: pad.playable ? `${countdownSeconds}-second countdown when you join` : "Online crews are not available yet." };
      }
      if (mine && launched) return { ...base, line: "LAUNCHING", detail: "" };
      if (mine && blocked) {
        return { ...base, line: "CANNOT LAUNCH: MULTIPLAYER IN DEVELOPMENT",
          detail: "This crew mode has no online session yet. Leave the queue and use SOLO." };
      }
      return { ...base, line: `LAUNCH IN ${Math.ceil(remaining)}`,
        detail: pad.playable ? "Walk off or use Leave Queue to cancel." : "Multiplayer is in development: this crew cannot launch yet." };
    }

    function snapshot() {
      return {
        padId, launched, blocked,
        remaining: remaining === null ? null : Math.max(0, remaining),
        pads: LAYOUT.pads.map((pad) => ({ id: pad.id, title: pad.title, crew: pad.crew, playable: pad.playable, ...statusOf(pad) })),
      };
    }

    function changed() { options.onChange?.(snapshot()); }

    /** Call with the platform under the player (or null) whenever it may have changed. */
    function setPlayerPad(nextPadId) {
      if (launched) return;
      const next = nextPadId && padById(nextPadId) ? nextPadId : null;
      if (next === padId) return;
      // Leave the previous queue first: a player is never on two platforms.
      // The previous queue is now empty, so its countdown resets.
      padId = next;
      blocked = false;
      remaining = padId ? countdownSeconds : null;
      changed();
    }

    /** Advances the countdown; only call while the player can act (controls enabled). */
    function tick(seconds) {
      if (launched || blocked || remaining === null || !Number.isFinite(seconds) || seconds <= 0) return;
      const before = Math.ceil(remaining);
      remaining -= seconds;
      if (remaining > 1e-9) {
        if (Math.ceil(remaining) !== before) changed();
        return;
      }
      remaining = 0;
      const pad = padById(padId);
      if (pad && isModeAvailable(pad) && crewOn(pad.id) >= pad.crew) {
        launched = true;
        changed();
        options.onLaunch?.(padId);
      } else {
        blocked = true; // no session: never start a (solo) game from this platform
        changed();
      }
    }

    /** Clears everything (e.g. if the launch could not start). */
    function reset() {
      padId = null;
      remaining = null;
      launched = false;
      blocked = false;
      changed();
    }

    return {
      setPlayerPad, tick, reset, snapshot,
      leave: () => setPlayerPad(null),
      get padId() { return padId; },
      get counting() { return remaining !== null && !launched && !blocked; },
      get launched() { return launched; },
      get blocked() { return blocked; },
    };
  }

  return Object.freeze({ COUNTDOWN_SECONDS, LAYOUT, padById, padAt, facingGate, standingSpots, exitPoint, arrowToward, create });
});
