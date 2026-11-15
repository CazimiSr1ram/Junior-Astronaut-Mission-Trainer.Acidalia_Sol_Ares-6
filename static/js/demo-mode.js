/* Development-only scripted showcase for screen recording.
 *
 * Served only when the server runs with JAMT_DEMO=1 and active only on
 * /?demo=1. Ordinary players never receive this file. It drives the REAL
 * scenes with the same functions the game's own keys and buttons call
 * (E-key interactions, panel buttons, mission steps). Waiting times are
 * shortened with the mission clock's own activity-time advance, so resources
 * and timed steps are simulated, not skipped. Nothing here changes game rules.
 *
 * To remove: delete this file, static/css/demo-mode.css and
 * tests/demo-mode.test.js, plus the two `demo_mode` lines in
 * templates/index.html and the JAMT_DEMO lines in app.py.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DemoShowcase = api;
})(globalThis, function () {
  "use strict";
  const LABEL = "Accelerated scripted gameplay demonstration";
  const CLOSING = "Junior Astronaut Mission Trainer — Learn. Explore. Survive.";
  const TOTAL_SECONDS = 25;
  // Scene start times (real seconds from Start Demo) and on-screen titles.
  const SCENES = Object.freeze([
    { id: "centre", at: 0, title: "NASA Training Centre", note: "Choose your astronaut · rotating Earth and Mars displays" },
    { id: "launch", at: 4, title: "Launch and landing", note: "The game's launch cutscene · accelerated" },
    { id: "mars", at: 8, title: "Mars surface", note: "Real terrain · survival HUD · lander life-support checks" },
    { id: "eva", at: 11, title: "EVA and Mission 1", note: "Suit check · airlock · Mars-gravity jump · survey · report" },
    { id: "habitat", at: 16, title: "Temporary habitat", note: "Accelerated construction · guided airlock · sleeping pods" },
    { id: "rover", at: 21, title: "Robotic science rover", note: "Working systems: power, lights and sensors · not drivable" },
    { id: "racer", at: 22.6, title: "Mars Racer exhibit", note: "Stationary model · not drivable" },
    { id: "closing", at: 23.8, title: CLOSING, note: "" },
  ].map(Object.freeze));
  return Object.freeze({ LABEL, CLOSING, TOTAL_SECONDS, SCENES });
});

(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
  const { LABEL, CLOSING, TOTAL_SECONDS, SCENES } = globalThis.DemoShowcase;

  // --- Saved data: the demo must not leave rewards or settings behind -------
  const storage = (() => { try { return window.localStorage; } catch (error) { return null; } })();
  const savedKeys = () => (storage ? Object.keys(storage).filter((key) => key.startsWith("jamt.")) : []);
  const snapshot = new Map(savedKeys().map((key) => [key, storage.getItem(key)]));
  function restoreSavedData() {
    if (!storage) return;
    savedKeys().forEach((key) => { if (!snapshot.has(key)) storage.removeItem(key); });
    snapshot.forEach((value, key) => storage.setItem(key, value));
  }
  window.addEventListener("pagehide", restoreSavedData);

  // --- Overlay ---------------------------------------------------------------
  document.body.classList.add("demo-mode");
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const overlay = el("div", "demo-overlay");
  overlay.id = "demoShowcase";
  const shield = el("div", "demo-shield");
  const label = el("div", "demo-label", LABEL);
  const titleBox = el("div", "demo-title");
  const titleStep = el("span", "demo-title-step");
  const titleText = el("strong", "demo-title-text");
  const titleNote = el("span", "demo-title-note");
  titleBox.append(titleStep, titleText, titleNote);
  const closing = el("div", "demo-closing");
  const [closingName, closingLine] = CLOSING.split(" — ");
  closing.append(el("strong", "", closingName), el("span", "", closingLine));
  closing.hidden = true;
  const card = el("div", "demo-card");
  const cardHeading = el("h2", "", "Mission Trainer showcase");
  const cardText = el("p", "demo-card-text");
  const cardFrame = el("p", "demo-card-frame");
  const cardButtons = el("div", "demo-card-buttons");
  card.append(cardHeading, cardText, cardFrame, cardButtons);
  overlay.append(shield, label, titleBox, closing, card);
  document.body.append(overlay);
  const button = (text, className, onClick) => {
    const node = el("button", `btn ${className}`, text);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };

  function describeFrame() {
    const w = window.innerWidth, h = window.innerHeight;
    const wide = Math.abs(w / h - 16 / 9) < 0.02;
    cardFrame.textContent = `Window ${w} × ${h} · ${wide ? "16:9 ✓ ready to record" : "not 16:9 yet — resize to 1280 × 720 or 1920 × 1080 for a clean recording"}`;
    cardFrame.classList.toggle("is-ok", wide);
  }
  window.addEventListener("resize", describeFrame);

  // --- Keep the player's input out of the scripted run -------------------------
  const swallow = (event) => {
    if (overlay.contains(event.target)) return;
    event.stopImmediatePropagation();
    if (event.type !== "keyup") event.preventDefault();
  };
  ["keydown", "keyup", "keypress"].forEach((type) => window.addEventListener(type, swallow, true));

  // --- Small helpers --------------------------------------------------------------
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = (count) => new Promise((resolve) => {
    const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  let startedAt = 0;
  const until = async (seconds) => {
    const wait = startedAt + seconds * 1000 - performance.now();
    if (wait > 0) await sleep(wait);
  };
  const skipped = [];

  /** Advances real mission time (resources, timed steps) in small chunks. */
  async function advance(gameSeconds, overMs) {
    const steps = Math.max(1, Math.round(overMs / 50));
    for (let i = 0; i < steps; i++) {
      missionClock.advanceActivityTime(gameSeconds / steps);
      await sleep(overMs / steps);
    }
  }

  /**
   * A cut to a new standing position, facing (lookX, lookZ). The game's own
   * camera views are used: "third-person" shows the astronaut, "first-person"
   * gives a clear look at an object.
   */
  async function place(view, x, z, lookX, lookZ, mode = "third-person") {
    view.setCameraView("first-person"); // the astronaut turns with the camera in this view
    (view.teleportAstronaut || view.teleport)(x, z);
    view.camera.rotation.y = Math.atan2(lookX - x, lookZ - z);
    view.camera.rotation.x = mode === "first-person" ? 0.02 : 0.1;
    await frames(2);
    if (mode !== "first-person") view.setCameraView("third-person");
    await frames(2);
  }

  /** A slow look around the real Mars scene from above the base; the astronaut is not moved. */
  async function surfaceTour(ms) {
    const B = BABYLON, scene = marsScene.scene, main = marsScene.camera;
    const base = marsScene.lander.spawn.position;
    const tour = new B.UniversalCamera("demo-tour-camera", B.Vector3.Zero(), scene);
    tour.fov = main.fov; tour.minZ = main.minZ; tour.maxZ = main.maxZ;
    const began = performance.now();
    const aim = () => {
      const t = (performance.now() - began) / 1000, angle = 2.45 + t * 0.22, radius = 30;
      const x = base.x + Math.sin(angle) * radius, z = base.z + Math.cos(angle) * radius;
      tour.position.set(x, marsScene.groundHeightAt(x, z) + 7.5, z);
      tour.setTarget(new B.Vector3(base.x, base.y + 2.5, base.z + 9));
    };
    aim();
    const observer = scene.onBeforeRenderObservable.add(aim);
    scene.activeCamera = tour;
    try { await sleep(ms); } finally {
      scene.onBeforeRenderObservable.remove(observer);
      scene.activeCamera = main;
      tour.dispose();
    }
  }

  const terminalShown = () => document.getElementById("marsTerminalModal").classList.contains("show");
  async function waitFor(test, timeoutMs = 1500) {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      if (test()) return true;
      await sleep(40);
    }
    return Boolean(test());
  }
  /** Presses the game's own E interaction once the expected prompt is active. */
  async function interactWith(id) {
    if (!(await waitFor(() => marsScene.nearestInteraction?.id === id))) return false;
    marsScene.interact();
    return true;
  }
  /** E at a station, then wait until its panel is actually on screen. */
  async function openPanel(id) {
    return (await interactWith(id)) && waitFor(terminalShown, 1000);
  }
  function clickAction(text) {
    const target = [...document.querySelectorAll("#marsTerminalActions button")]
      .find((node) => node.textContent.trim().startsWith(text));
    if (!target || target.disabled) return false;
    target.click();
    return true;
  }
  async function closeTerminal() {
    if (terminalShown()) marsTerminalModal.hide();
    await waitFor(() => !terminalShown(), 800);
    await frames(2);
  }
  const step = (result) => { handleMissionResult(result); return Boolean(result && result.ok); };

  // --- Scenes: each returns true when everything it shows really happened -------
  const scenes = {
    async centre() {
      const choice = document.querySelector('input[name="characterPreset"][value="female"]');
      if (!choice) return false;
      await sleep(450);
      choice.click(); // the menu's own astronaut choice
      choice.closest("fieldset")?.classList.add("demo-focus");
      await sleep(550);
      document.getElementById("soloMissionButton").click(); // "Enter Training Center"
      if (!gameStarted) return false;
      await place(lobby, -5.5, -12, -13.8, -12); // the rotating Earth display
      await sleep(950);
      await place(lobby, 5.5, -12, 13.8, -12); // the rotating Mars display
      await sleep(950);
      const pad = LaunchQueue.padById("pad-solo");
      await place(lobby, pad.x, pad.z, pad.x, pad.z - 10);
      return waitFor(() => lobby.queue.padId === "pad-solo", 900);
    },

    async launch() {
      launchSequence.setStageDuration(800); // all four real stages, shortened (default 2.2 s each)
      beginLaunchSequence(); // the countdown's own launch call, without the 20 s wait
      if (!launchSequence.running) return false;
      return waitFor(() => Boolean(marsScene) && activeScene === marsScene.scene, 6000);
    },

    async mars() {
      if (!marsScene) return false;
      await surfaceTour(1500);
      const spawn = marsScene.lander.spawn.position, outside = marsScene.lander.exteriorSafePoint;
      await place(marsScene, spawn.x, spawn.z, outside.x, outside.z, "first-person"); // in the cabin, facing the hatch
      for (const action of ["checkLifeSupport", "verifyPressure", "activatePower", "inspectPower", "checkSupplies"]) {
        if (!step(missionOne[action]())) return false;
        await sleep(170);
      }
      return missionOne.isDone("supplies");
    },

    async eva() {
      if (!missionOne.isDone("supplies")) return false;
      const locker = marsScene.lander.interactions.find((item) => item.id === "lander-suit-locker");
      const spawn = marsScene.lander.spawn.position, outside = marsScene.lander.exteriorSafePoint;
      await place(marsScene, locker.position.x, locker.position.z, 2 * locker.position.x - spawn.x, 2 * locker.position.z - spawn.z, "first-person");
      if (!(await openPanel("lander-suit-locker"))) return false;
      await sleep(200);
      if (!clickAction("Put on EVA suit")) return false;
      await sleep(250);
      if (!terminalShown() && !(await openPanel("lander-suit-locker"))) return false;
      if (!clickAction("Run EVA suit check")) return false;
      await sleep(300);
      await closeTerminal();
      if (!missionOne.progress.helmetOn) step(missionOne.toggleHelmet(marsEnv())); // the H key
      if (!(missionOne.isDone("suit") && missionOne.progress.suitChecked && missionOne.protected)) return false;

      // Airlock: the cabin is depressurised before the hatch can open.
      await place(marsScene, spawn.x, spawn.z, outside.x, outside.z, "first-person");
      if (!step(missionOne.airlock("depressurize", marsEnv()))) return false;
      await advance(5.1, 300);
      if (!step(missionOne.airlock("open", marsEnv()))) return false;
      await sleep(200);
      await place(marsScene, outside.x, outside.z, 2 * outside.x - spawn.x, 2 * outside.z - spawn.z);
      await advance(0.3, 100); // "Boots on the surface"
      marsScene.astronaut.jump(); // the Space key: a real jump in Mars gravity
      await sleep(250);
      await waitFor(() => Math.abs(marsScene.astronautFeet.y - marsScene.groundHeightAt(marsScene.astronautFeet.x, marsScene.astronautFeet.z)) < 0.02, 2200);
      for (const marker of MissionOne.SURVEY_MARKERS) {
        await place(marsScene, marker.x, marker.z + 1.7, marker.x, marker.z);
        if (!(await interactWith(marker.id))) return false;
        await sleep(220);
      }
      await place(marsScene, spawn.x, spawn.z, outside.x, outside.z, "first-person");
      if (!step(missionOne.airlock("close", marsEnv()))) return false;
      if (!step(missionOne.airlock("repressurize", marsEnv()))) return false;
      await advance(5.1, 250);
      if (!step(missionOne.submitReport(marsEnv()))) return false;
      await advance(3.1, 300);
      return missionOne.status === "complete";
    },

    async habitat() {
      if (missionOne.status !== "complete") return false;
      const hp = marsScene.sites.habitat.position;
      const entry = TempHabitat.LAYOUT.entry;
      await place(marsScene, hp.x + entry.x, hp.z + entry.z, hp.x, hp.z);
      if (!(await openPanel("habitat-entry"))) return false;
      await sleep(300);
      if (!clickAction("Assemble Temporary Habitat")) return false;
      await closeTerminal();
      await place(marsScene, hp.x - 5.5, hp.z - 10.5, hp.x, hp.z, "first-person");
      await advance(TempHabitat.CONSTRUCTION.seconds + 0.1, 1300);
      if (TempHabitat.stage(missionState) !== "built") return false;

      // Guided airlock: every step is clicked on the game's own panel.
      await place(marsScene, hp.x + entry.x, hp.z + entry.z, hp.x, hp.z);
      if (!(await openPanel("habitat-entry"))) return false;
      const deadline = performance.now() + 5000;
      while (terminalShown() && performance.now() < deadline) {
        const primary = document.querySelector("#marsTerminalModal .airlock-primary");
        if (primary && !primary.disabled) { primary.click(); await sleep(120); }
        else if (document.querySelector("#marsTerminalModal .airlock-wait")) {
          await advance(1, 100); // the 3 s pressure cycle, accelerated
          renderMarsPanel("habitat"); // the game's own panel refresh for the new pressure state
        } else break;
      }
      await closeTerminal();
      const feet = marsScene.astronautFeet;
      if (!marsScene.insideHabitat(feet.x, feet.z)) return false;
      const bed = TempHabitat.LAYOUT.beds[0];
      await place(marsScene, hp.x + bed.x + 1.45, hp.z + bed.z, hp.x + bed.x, hp.z + bed.z); // beside pod 1
      await sleep(350); // the "Press E to Rest / Sleep" prompt beside the pod
      if (!(await openPanel(bed.id))) return false;
      await sleep(500);
      await closeTerminal();
      return true;
    },

    async rover() {
      const point = MarsRover.interactions(marsScene.terrain).find((item) => item.id === "rover-inspect");
      const rover = marsScene.rover.root.position;
      await place(marsScene, point.position.x, point.position.z, rover.x, rover.z);
      if (!(await openPanel("rover-inspect"))) return false;
      await sleep(300);
      const powered = clickAction("Power ON"); // the rover panel's own button
      await sleep(200);
      await closeTerminal();
      // Step back for a clear look at the lit indicators and scanning sensor.
      await place(marsScene, rover.x + (point.position.x - rover.x) * 2.6, rover.z + (point.position.z - rover.z) * 2.6, rover.x, rover.z, "first-person");
      return powered && MarsRover.isPowered(missionState);
    },

    async racer() {
      const exhibit = marsScene.racerExhibit;
      if (!exhibit || exhibit.interaction.hidden) return false; // model not loaded: show nothing
      const point = exhibit.interaction.position, model = exhibit.root.position;
      await place(marsScene, point.x, point.z - 5.5, model.x, model.z, "first-person"); // the whole exhibit
      await sleep(400);
      await place(marsScene, point.x, point.z, model.x, model.z);
      return interactWith("mars-racer-exhibit"); // posts the exhibit's own "not drivable" note
    },

    async closing() {
      titleBox.hidden = true;
      closing.hidden = false;
      return true;
    },
  };

  function showScene(index) {
    const scene = SCENES[index];
    titleStep.textContent = `${index + 1} / ${SCENES.length - 1}`;
    titleText.textContent = scene.title;
    titleNote.textContent = scene.note;
    titleBox.classList.remove("is-skipped");
  }

  let measuredSeconds = 0;
  async function run() {
    overlay.classList.add("is-running");
    card.hidden = true;
    startedAt = performance.now();
    for (let i = 0; i < SCENES.length; i++) {
      await until(SCENES[i].at);
      if (SCENES[i].id !== "closing") showScene(i);
      let ok = false;
      try { ok = await scenes[SCENES[i].id](); } catch (error) { console.warn(`Demo scene "${SCENES[i].id}" skipped:`, error); }
      if (!ok) {
        skipped.push(SCENES[i].title);
        titleBox.classList.add("is-skipped");
        titleNote.textContent = "Not shown in this run";
        if (typeof marsTerminalModal !== "undefined" && terminalShown()) marsTerminalModal.hide();
        // The launch is the only way to Mars: without it, later scenes cannot be genuine.
        if (SCENES[i].id === "centre" || SCENES[i].id === "launch") { scenes.closing(); break; }
      }
    }
    await until(TOTAL_SECONDS);
    measuredSeconds = (performance.now() - startedAt) / 1000;
    overlay.dataset.seconds = measuredSeconds.toFixed(1);
    overlay.classList.add("is-complete"); // the 25 s sequence is over; the closing title stays for a clean last frame
    await sleep(2500);
    finish();
  }

  function finish() {
    restoreSavedData();
    overlay.classList.remove("is-running");
    overlay.classList.add("is-finished");
    cardHeading.textContent = "Demonstration complete";
    cardText.textContent = skipped.length
      ? `Sequence length ${measuredSeconds.toFixed(1)} s. Not shown in this run: ${skipped.join(", ")}.`
      : `All ${SCENES.length - 1} scenes ran with real game features in ${measuredSeconds.toFixed(1)} s.`;
    cardFrame.hidden = true;
    cardButtons.replaceChildren(
      button("Replay Demo", "btn-primary", () => { restoreSavedData(); window.location.reload(); }),
      button("Exit Demo", "btn-outline-light", () => { restoreSavedData(); window.location.assign(window.location.pathname); }),
    );
    card.hidden = false;
    cardButtons.firstChild.focus();
  }

  // --- Start card: wait as long as needed for the recorder -----------------------
  cardText.textContent = `${TOTAL_SECONDS}-second scripted run through real game scenes. Start your screen recorder, then press Start Demo.`;
  describeFrame();
  const start = button("Loading game…", "btn-primary btn-lg", () => { start.disabled = true; run(); });
  start.disabled = true;
  cardButtons.append(start, button("Exit Demo", "btn-outline-light", () => window.location.assign(window.location.pathname)));
  /**
   * Builds the Mars scene while the Start card waits, exactly as arriveOnMars()
   * would on landing, so the recording has no loading pause and every model is
   * ready. If this fails, the game builds the scene on arrival as usual.
   */
  async function prepareMars() {
    if (marsScene) return;
    marsScene = MarsScene.create(engine, canvas, marsCallbacks, { surveyMarkers: MissionOne.SURVEY_MARKERS });
    marsScene.applyGraphics(GraphicsQuality.presetFor(graphicsLevel));
    marsScene.scene.shadowsEnabled = document.getElementById("shadowsToggle").checked;
    marsScene.exploration.sync(exploration);
    marsScene.setControlsEnabled(false); // idle until the landing
    await Promise.race([
      Promise.all([marsScene.scene.whenReadyAsync(), marsScene.racerExhibit.ready, marsScene.modelsReady()]),
      sleep(20000),
    ]);
  }
  (async () => {
    await waitFor(() => document.readyState === "complete" && typeof lobby !== "undefined" && Boolean(lobby) && lobby.scene.isReady(), 60000);
    try { await prepareMars(); } catch (error) { console.warn("Demo: Mars will load on arrival instead.", error); }
    start.textContent = "Start Demo";
    start.disabled = false;
    start.focus();
  })();
})();
