"use strict";
// Development-only showcase: timeline sanity and gating (never served to ordinary players).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Demo = require("../static/js/demo-mode.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

assert.equal(Demo.LABEL, "Accelerated scripted gameplay demonstration");
assert.ok(Demo.TOTAL_SECONDS >= 24 && Demo.TOTAL_SECONDS <= 26, "about 25 seconds, under the 30-second limit");
assert.equal(Demo.SCENES[0].at, 0);
Demo.SCENES.forEach((scene, index) => {
  assert.ok(scene.id && scene.title, `scene ${index} has an id and a title`);
  if (scene.id !== "closing") assert.ok(scene.note && scene.title.length <= 40, `${scene.id}: short title with a note`);
  if (index) assert.ok(scene.at > Demo.SCENES[index - 1].at, `${scene.id} starts after the previous scene`);
  assert.ok(scene.at < Demo.TOTAL_SECONDS, `${scene.id} starts before the end`);
});
const ids = Demo.SCENES.map((scene) => scene.id);
assert.deepStrictEqual(ids, ["centre", "launch", "mars", "eva", "habitat", "rover", "racer", "closing"]);
// The requested timeline: centre 0-4 s, launch 4-8, Mars 8-11, EVA and Mission 1 11-16, habitat 16-21, technology 21-25.
const at = Object.fromEntries(Demo.SCENES.map((scene) => [scene.id, scene.at]));
assert.deepStrictEqual([at.centre, at.launch, at.mars, at.eva, at.habitat, at.rover], [0, 4, 8, 11, 16, 21]);
assert.equal(Demo.CLOSING, "Junior Astronaut Mission Trainer — Learn. Explore. Survive.");
assert.equal(Demo.SCENES[Demo.SCENES.length - 1].title, Demo.CLOSING);
// Nothing unimplemented is advertised.
Demo.SCENES.forEach((scene) => assert.doesNotMatch(`${scene.title} ${scene.note}`, /Mission [2-5]|multiplayer|driv(e|ing) the/i));
// The two vehicles are never presented as the same thing, and neither as drivable.
const rover = Demo.SCENES.find((scene) => scene.id === "rover"), racer = Demo.SCENES.find((scene) => scene.id === "racer");
assert.match(rover.title, /Robotic science rover/);
assert.match(racer.title, /Mars Racer exhibit/);
assert.match(racer.note, /Stationary/i);
[rover, racer].forEach((scene) => assert.match(scene.note, /not drivable/i, `${scene.id} is labelled not drivable`));

// Gating: served only with JAMT_DEMO=1, active only on ?demo=1, off by default.
const app = read("app.py"), page = read("templates/index.html"), script = read("static/js/demo-mode.js");
assert.match(app, /DEMO_ENABLED = os\.environ\.get\("JAMT_DEMO"\) == "1"/);
assert.match(app, /demo_mode=DEMO_ENABLED/);
const includes = page.split("\n").filter((line) => line.includes("demo-mode"));
assert.equal(includes.length, 2, "one stylesheet and one script include");
includes.forEach((line) => assert.match(line, /\{% if demo_mode %\}.*\{% endif %\}/, "demo files are only served in demo builds"));
assert.match(script, /get\("demo"\) !== "1"\) return;/, "the script does nothing without ?demo=1");
assert.ok(!read("static/js/game.js").includes("DemoShowcase"), "normal game code does not depend on the demo");
// The cutscene keeps its normal 2.2 s stages unless the showcase shortens them.
assert.match(read("static/js/launch-sequence.js"), /DEFAULT_STAGE_DURATION = 2200/);
console.log("Demo mode tests passed: 25 s timeline, scene order, vehicle labels and gating.");
