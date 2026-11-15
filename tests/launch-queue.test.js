"use strict";

// LAUNCH PREP queue platforms: physical, walk-on mission selection.

const assert = require("assert");
const LaunchQueue = require("../static/js/launch-queue.js");

const { LAYOUT, COUNTDOWN_SECONDS } = LaunchQueue;
const run = (queue, seconds, step = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += step) queue.tick(step); };
const pad = (id) => LaunchQueue.padById(id);

// Five platforms with names and capacities; only SOLO has a working game session.
{
  assert.strictEqual(COUNTDOWN_SECONDS, 20);
  assert.deepStrictEqual(LAYOUT.pads.map((p) => [p.title, p.crew]).sort((a, b) => a[1] - b[1]),
    [["SOLO", 1], ["DUO", 2], ["TRIO", 3], ["SQUAD", 4], ["FULL CREW", 5]]);
  assert.deepStrictEqual(LAYOUT.pads.filter((p) => p.playable).map((p) => p.id), ["pad-solo"]);
}

// Layout: platforms fit the hall, keep walkways, and each has numbered standing positions.
{
  LAYOUT.pads.forEach((a, i) => {
    const outer = a.radius + LAYOUT.railingGap + 0.1;
    assert.ok(Math.abs(a.x) + outer < 18.6, `${a.id} clear of the side walls and pillars`);
    assert.ok(a.z - outer > LAYOUT.barrierZ + 1.2, `${a.id} leaves walking room behind the gate`);
    assert.ok(a.z + outer < 29.2, `${a.id} clear of the back wall`);
    LAYOUT.pads.slice(i + 1).forEach((b) => {
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - (a.radius + b.radius + 2 * (LAYOUT.railingGap + 0.1));
      assert.ok(gap > 1.0, `${a.id} and ${b.id} have a walkway between them (${gap.toFixed(2)} m)`);
    });
    const spots = LaunchQueue.standingSpots(a);
    assert.deepStrictEqual(spots.map((s) => s.number), Array.from({ length: a.crew }, (_, k) => k + 1), `${a.id}: positions 1..${a.crew}`);
    spots.forEach((s, k) => {
      assert.ok(Math.hypot(s.x - a.x, s.z - a.z) + LAYOUT.spotRadius <= a.radius + 1e-9, `${a.id} position ${s.number} is on the platform`);
      spots.slice(k + 1).forEach((t) => assert.ok(Math.hypot(s.x - t.x, s.z - t.z) >= 2 * LAYOUT.spotRadius, "positions do not overlap"));
      assert.strictEqual(LaunchQueue.padAt(s.x, s.z), a.id, "standing on a numbered position is inside the standing zone");
    });
    // EXIT point is outside the platform and inside the hall.
    const exit = LaunchQueue.exitPoint(a);
    assert.strictEqual(LaunchQueue.padAt(exit.x, exit.z), null, `${a.id}: exit leads off the platform`);
    assert.ok(Math.abs(exit.x) < 18.7 && exit.z < 29.2 && exit.z > LAYOUT.barrierZ, `${a.id}: exit stays inside LAUNCH PREP`);
  });
  assert.strictEqual(LaunchQueue.padAt(0, 22.7), "pad-solo", "solo platform detection");
  assert.strictEqual(LaunchQueue.padAt(0, 20), null, "the walkway in front is not a platform");
}

// SOLO: joining starts a countdown of exactly 20 seconds; launches once at zero.
{
  const launches = [];
  const queue = LaunchQueue.create({ onLaunch: (id) => launches.push(id) });
  queue.setPlayerPad("pad-solo");
  assert.strictEqual(queue.snapshot().remaining, 20);
  assert.match(queue.snapshot().pads.find((p) => p.id === "pad-solo").line, /LAUNCH IN 20/);
  run(queue, 19.9);
  assert.deepStrictEqual(launches, [], "nothing at 19.9 s");
  queue.tick(0.1);
  assert.deepStrictEqual(launches, ["pad-solo"], "launches at exactly 20 s");
  run(queue, 30);
  queue.setPlayerPad(null);
  queue.setPlayerPad("pad-solo");
  assert.deepStrictEqual(launches, ["pad-solo"], "launches once only");
}

// Leaving (queue empty) cancels and resets; rejoining starts again from 20.
{
  const launches = [];
  const queue = LaunchQueue.create({ onLaunch: (id) => launches.push(id) });
  queue.setPlayerPad("pad-solo");
  run(queue, 12);
  assert.ok(Math.abs(queue.snapshot().remaining - 8) < 1e-6);
  queue.leave();
  assert.strictEqual(queue.snapshot().remaining, null, "countdown reset when the queue is empty");
  assert.strictEqual(queue.snapshot().pads.find((p) => p.id === "pad-solo").queued, 0);
  run(queue, 30);
  assert.deepStrictEqual(launches, [], "no launch after leaving");
  queue.setPlayerPad("pad-solo");
  assert.strictEqual(queue.snapshot().remaining, 20, "rejoining restarts the full 20 s");
}

// One player, one queue: moving to another platform leaves the first (which resets).
{
  const queue = LaunchQueue.create();
  queue.setPlayerPad("pad-solo");
  run(queue, 7);
  queue.setPlayerPad("pad-trio");
  const snap = queue.snapshot();
  assert.strictEqual(snap.padId, "pad-trio");
  assert.strictEqual(snap.pads.filter((p) => p.queued > 0).length, 1, "queued on exactly one platform");
  assert.strictEqual(snap.pads.find((p) => p.id === "pad-solo").remaining, null, "solo countdown cleared");
  assert.strictEqual(snap.remaining, 20, "new platform starts its own fresh countdown");
}

// Multiplayer platforms: countdown runs, but at zero nothing launches - no fake crew, no solo game.
{
  const launches = [];
  const queue = LaunchQueue.create({ onLaunch: (id) => launches.push(id) });
  ["pad-duo", "pad-trio", "pad-squad", "pad-full-crew"].forEach((id) => {
    queue.setPlayerPad(id);
    const status = queue.snapshot().pads.find((p) => p.id === id);
    assert.strictEqual(status.queued, 1, `${id}: only the real local player is counted`);
    assert.strictEqual(queue.snapshot().remaining, 20, `${id}: 20 s countdown starts`);
    run(queue, 21);
    assert.strictEqual(queue.blocked, true, `${id}: blocked at zero`);
    assert.match(queue.snapshot().pads.find((p) => p.id === id).line, /CANNOT LAUNCH: MULTIPLAYER IN DEVELOPMENT/);
    run(queue, 30);
    assert.strictEqual(queue.blocked, true, "stays blocked (no restart loop)");
    queue.leave();
    assert.strictEqual(queue.blocked, false, "leaving clears the block");
  });
  assert.deepStrictEqual(launches, [], "multiplayer platforms never start a game");
  queue.snapshot().pads.filter((p) => !p.playable).forEach((p) => assert.strictEqual(p.line, "MULTIPLAYER IN DEVELOPMENT"));
}

// Future networking hook: a mode only launches when it reports a working session.
{
  const launches = [];
  const queue = LaunchQueue.create({ onLaunch: (id) => launches.push(id), isModeAvailable: () => false });
  queue.setPlayerPad("pad-solo");
  run(queue, 21);
  assert.deepStrictEqual(launches, [], "no session -> no launch, even for SOLO");
  assert.strictEqual(queue.blocked, true);
}

// The countdown only advances when ticked (menus/cutscenes stop ticking); bad ticks are ignored.
{
  const queue = LaunchQueue.create();
  queue.setPlayerPad("pad-solo");
  queue.tick(0); queue.tick(-1); queue.tick(NaN);
  assert.strictEqual(queue.snapshot().remaining, 20);
  queue.reset();
  assert.strictEqual(queue.padId, null);
  assert.strictEqual(queue.launched, false);
}

// Directional signs point at the LAUNCH PREP gate (the old "→" sign pointed the wrong way).
{
  LAYOUT.signs.filter((sign) => sign.arrow).forEach((sign) => {
    assert.strictEqual(LaunchQueue.arrowToward(sign), sign.arrow, `${sign.id}: arrow "${sign.arrow}" points at the gate`);
    const glyph = { up: "↑", left: "←", right: "→" }[sign.arrow];
    assert.ok(sign.text.includes(glyph), `${sign.id}: text shows ${glyph}`);
  });
  assert.strictEqual(LaunchQueue.arrowToward(LAYOUT.signs.find((s) => s.id === "sign-equipment")), "left");
  // The gate signs face out (LAUNCH PREP) and in (EXIT TO LOBBY).
  const outward = LAYOUT.signs.find((s) => s.id === "sign-gate");
  const inward = LAYOUT.signs.find((s) => s.id === "sign-gate-exit");
  assert.ok(Math.cos(outward.rotationY) > 0.99, "LAUNCH PREP readable when walking in");
  assert.ok(Math.cos(inward.rotationY) < -0.99, "EXIT TO LOBBY readable when walking out");
}

console.log("launch-queue tests passed");
