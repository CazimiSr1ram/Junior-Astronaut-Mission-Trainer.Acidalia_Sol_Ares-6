"use strict";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });

// --- Graphics quality (visual only) -----------------------------------------
// The old setting, setHardwareScalingLevel(max(1, dpr / 1.5)), rendered BELOW
// the canvas size on Retina screens (0.75x CSS pixels at DPR 2), which made
// the game blurry. Resolution now comes from the chosen preset (or Auto).
const graphicsStorage = (() => { try { return window.localStorage; } catch (error) { return null; } })();
let graphicsLevel = GraphicsQuality.load(graphicsStorage);
let graphicsDpr = window.devicePixelRatio || 1;
let autoResolution = GraphicsQuality.createAutoController(graphicsDpr);

function graphicsPixelRatio() {
  return graphicsLevel === "auto" ? autoResolution.pixelRatio : GraphicsQuality.pixelRatioFor(graphicsLevel, graphicsDpr);
}

function applyGraphicsResolution() {
  // setHardwareScalingLevel also resizes the drawing buffer; no restart needed.
  engine.setHardwareScalingLevel(GraphicsQuality.hardwareScalingFor(graphicsPixelRatio()));
}

function applyGraphicsToScenes() {
  const preset = GraphicsQuality.presetFor(graphicsLevel);
  lobby?.applyGraphics?.(preset);
  marsScene?.applyGraphics?.(preset);
}

function setGraphicsLevel(level) {
  graphicsLevel = GraphicsQuality.normalizeLevel(level);
  autoResolution = GraphicsQuality.createAutoController(graphicsDpr);
  applyGraphicsResolution();
  applyGraphicsToScenes();
  GraphicsQuality.save(graphicsStorage, graphicsLevel);
  renderGraphicsInfo();
  return graphicsLevel;
}

let fpsAverage = 60;
function renderGraphicsInfo() {
  const info = document.getElementById("graphicsInfo");
  if (!info) return;
  const ratio = graphicsPixelRatio();
  const mode = graphicsLevel === "auto" ? "Auto (adjusts to your frame rate)" : GraphicsQuality.PRESETS[graphicsLevel].label;
  info.textContent = `${mode} · rendering ${engine.getRenderWidth()}×${engine.getRenderHeight()} `
    + `(${ratio.toFixed(2)}× CSS pixels, screen ${graphicsDpr}×) · ${Math.round(fpsAverage)} FPS`;
}
applyGraphicsResolution();
const missionState = MissionModel.createMissionState();
// Developer tools are switched on only by the server (JAMT_DEV_TOOLS=1).
const DEV_TOOLS = document.body.dataset.devTools === "true";
// Mission time starts on arrival on Mars, never in the lobby or launch cutscene.
const missionClock = MissionClock.create(missionState, MissionModel, { devTools: DEV_TOOLS });
const mainMenu = document.getElementById("mainMenu");
const lobbyHud = document.getElementById("lobbyHud");
const controlsHint = document.getElementById("controlsHint");
const interactionHint = document.getElementById("interactionHint");
const interactionHintText = document.getElementById("interactionHintText");
const locationType = document.getElementById("locationType");
const locationDisplay = document.getElementById("locationDisplay");
const missionPanel = document.getElementById("missionPanel");
const classShopElement = document.getElementById("classShopModal");
const classShopModal = new bootstrap.Modal(classShopElement);
const supplyShopModal = new bootstrap.Modal(document.getElementById("supplyShopModal"));
const missionTerminalModal = new bootstrap.Modal(document.getElementById("missionTerminalModal"));
const settingsModalElement = document.getElementById("settingsModal");
const settingsModal = new bootstrap.Modal(settingsModalElement);
const classShopList = document.getElementById("classShopList");
const classShopNotice = document.getElementById("classShopNotice");
const classShopBalances = document.getElementById("classShopBalances");
const supplyShopBalances = document.getElementById("supplyShopBalances");
const testingRewardButton = document.getElementById("testingRewardButton");
const solarBalance = document.getElementById("solarBalance");
const heliumBalance = document.getElementById("heliumBalance");
const currentClassDisplay = document.getElementById("currentClassDisplay");
const classBonusDisplay = document.getElementById("classBonusDisplay");
const shopStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem() { throw new Error("Browser storage is unavailable."); },
      setItem() { throw new Error("Browser storage is unavailable."); },
    };
  }
})();
const shop = ShopModel.create(shopStorage);
const classData = ShopModel.CLASSES;
let classShopMessage = shop.notice;
let selectedClass = "Intern";
let gameStarted = false;
let modalOpen = false;
let lobby;
let marsScene = null;
let activeScene = null;
let launchSequence;
let hadPointerLock = false;
let endingShown = false;
let restingTransition = false;
let restFadeUntil = 0;

function setGameplayControls(enabled) {
  const shouldEnable = enabled && gameStarted && !modalOpen && !endingShown && !restingTransition;
  if (activeScene === marsScene?.scene) {
    marsScene.setControlsEnabled(shouldEnable);
  } else {
    lobby?.setControlsEnabled(shouldEnable);
  }
}

function showModal(modal) {
  if (restingTransition) return;
  modalOpen = true;
  setGameplayControls(false);
  document.exitPointerLock?.();
  modal.show();
}

function updateShopBalances() {
  const balance = shop.state;
  solarBalance.textContent = String(balance.solar);
  heliumBalance.textContent = String(balance.helium);
  classShopBalances.textContent = `${balance.solar} Solar Cells · ${balance.helium} Helium-3`;
  supplyShopBalances.textContent = `${balance.solar} Solar Cells · ${balance.helium} Helium-3`;
}

function setClassShopMessage(message) {
  classShopMessage = message;
  classShopNotice.textContent = message;
  classShopNotice.classList.toggle("d-none", !message);
  classShopNotice.classList.toggle("alert-danger", Boolean(message && /unable|could not/i.test(message)));
  classShopNotice.classList.toggle("alert-info", !message || !/unable|could not/i.test(message));
}

function classPriceText(price) {
  const costs = [];
  if (price.solar) costs.push(`${price.solar} Solar Cells`);
  if (price.helium) costs.push(`${price.helium} Helium-3`);
  return costs.join(" + ");
}

function renderClassShop() {
  const balance = shop.state;
  classShopList.replaceChildren();

  [["Intern", null], ...Object.entries(classData)].forEach(([name, price]) => {
    const owned = name === "Intern" || balance.owned.includes(name);
    const affordable = !price ||
      (balance.solar >= price.solar && balance.helium >= price.helium);
    const item = document.createElement("article");
    item.className = "shop-item class-shop-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = name;
    const description = document.createElement("small");
    const definition = ClassBonuses.getClass(name);
    description.textContent = price
      ? `${definition.summary} ${definition.pending ? `Pending: ${definition.pending}` : "Active in game."}`
      : `${definition.summary} Always available.`;
    details.append(title, description);
    const priceLabel = document.createElement("span");
    priceLabel.className = "shop-price";
    priceLabel.textContent = price ? classPriceText(price) : "Free";
    const action = document.createElement("button");
    action.type = "button";
    action.className = `btn ${owned ? "btn-outline-info" : "btn-primary"}`;
    action.textContent = selectedClass === name ? "Equipped" : owned ? "Equip" : "Buy";
    action.disabled = selectedClass === name || (!owned && !affordable);
    action.addEventListener("click", () => {
      if (owned) {
        const equipped = equipClass(name);
        setClassShopMessage(equipped.message);
      } else {
        const result = shop.buy(name);
        setClassShopMessage(result.message);
      }
      updateShopBalances();
      renderClassShop();
    });
    item.append(details, priceLabel, action);
    classShopList.append(item);
  });

  testingRewardButton.disabled = balance.rewardClaimed;
  testingRewardButton.textContent = balance.rewardClaimed
    ? "Test reward claimed"
    : "Claim test reward";
  setClassShopMessage(classShopMessage);
  updateShopBalances();
}

/**
 * Equips an owned class (Intern is always owned). One class at a time, so its
 * bonus replaces the previous one instead of stacking. Locked once on Mars.
 */
function equipClass(name) {
  if (!shop.canEquip(name)) return { ok: false, message: `${name} must be purchased before it can be equipped.` };
  if (marsScene) return { ok: false, message: "Your class is locked for this mission once you have landed." };
  selectedClass = name;
  ClassBonuses.applyPassiveBonuses(missionState, MissionModel, [selectedClass]);
  renderClassHud();
  const definition = ClassBonuses.getClass(name);
  return { ok: true, message: `${name} equipped. ${definition.pending ? `Bonus pending: ${definition.pending}` : definition.summary}` };
}

function renderClassHud() {
  currentClassDisplay.textContent = selectedClass;
  const definition = ClassBonuses.getClass(selectedClass);
  classBonusDisplay.textContent = definition.pending ? `${definition.summary} (pending)` : definition.summary;
  classBonusDisplay.title = ClassBonuses.describe(selectedClass);
}

function enterTrainingLobby() {
  if (gameStarted) return;
  missionState.characterPreset = document.querySelector('input[name="characterPreset"]:checked').value;
  lobby.astronaut.setAppearance(missionState.characterPreset);
  selectedClass = "Intern";
  ClassBonuses.applyPassiveBonuses(missionState, MissionModel, [selectedClass]);
  renderClassHud();
  mainMenu.classList.add("is-hidden");
  lobbyHud.classList.remove("d-none");
  controlsHint.classList.remove("d-none");
  gameStarted = true;
  setGameplayControls(true);
  canvas.focus();
}

// On-screen queue panel while standing on a LAUNCH PREP pad.
function renderLaunchQueue(snapshot) {
  const panel = document.getElementById("launchQueuePanel");
  const pad = snapshot.padId ? snapshot.pads.find((candidate) => candidate.id === snapshot.padId) : null;
  panel.classList.toggle("d-none", !pad || activeScene !== lobby?.scene);
  if (!pad) return;
  panel.classList.toggle("multiplayer", !pad.playable);
  panel.classList.toggle("blocked", snapshot.blocked);
  document.getElementById("launchQueueTitle").textContent =
    `${pad.title} · ${pad.crew} astronaut${pad.crew > 1 ? "s" : ""} · in queue ${pad.queued}/${pad.crew}`;
  document.getElementById("launchQueueLine").textContent = snapshot.launched ? "Launching…"
    : !pad.playable ? "Multiplayer Coming Soon"
      : snapshot.blocked ? "Cannot launch right now"
        : `Launch in ${Math.ceil(snapshot.remaining ?? 0)}`;
  document.getElementById("launchQueueHint").textContent = snapshot.launched ? ""
    : `${pad.detail} Walk off the platform, press X or use Leave Queue.`;
  document.getElementById("leaveQueueButton").hidden = snapshot.launched;
}

function beginLaunchSequence() {
  if (!gameStarted || launchSequence.running || activeScene !== lobby.scene) return;
  modalOpen = true;
  setGameplayControls(false);
  document.exitPointerLock?.();
  launchSequence.start(selectedClass);
  document.getElementById("launchQueuePanel").classList.add("d-none");
}

const marsTerminalModal = new bootstrap.Modal(document.getElementById("marsTerminalModal"));
const marsTerminalTitle = document.getElementById("marsTerminalTitle");
const marsTerminalReadout = document.getElementById("marsTerminalReadout");
const marsTerminalNote = document.getElementById("marsTerminalNote");
const safeZoneBadge = document.getElementById("safeZoneBadge");

// ---------------------------------------------------------------------------
// Mission 1: Establish the Mars Base (logic in mission-one.js).
// ---------------------------------------------------------------------------
const marsTerminalActions = document.getElementById("marsTerminalActions");
const terminalLearnMore = document.createElement("details");
terminalLearnMore.hidden = true;
terminalLearnMore.append(Object.assign(document.createElement("summary"), { textContent: "Learn More" }), document.createElement("p"));
document.getElementById("marsTerminalNote").after(terminalLearnMore);
let activeMarsPanel = null;
let airlockDirection = "enter";
let airlockFeedback = "";
let airlockLastCountdown = null;
document.querySelector("#marsTerminalModal .modal-dialog").classList.add("modal-dialog-scrollable");
document.getElementById("marsTerminalModal").addEventListener("hide.bs.modal", (event) => {
  if (activeMarsPanel === "habitat" && habitatSystems.chamber()?.side === "chamber" && !missionState.missionComplete) {
    event.preventDefault();
    marsTerminalNote.textContent = "Finish the airlock steps before closing this panel.";
  }
});
const objectiveTracker = document.getElementById("objectiveTracker");
const objectiveList = document.getElementById("objectiveList");
const objectiveStatus = document.getElementById("objectiveStatus");
const objectiveHeading = document.getElementById("objectiveHeading");
const commsLog = document.getElementById("commsLog");
const missionOne = MissionOne.create(missionState);
const habitatSystems = HabitatSystems.create(missionState);
const researchMissions = ResearchMissions.create(missionState, MissionModel);
// Field exploration and science (save-ready progress in missionState.exploration).
const exploration = ExplorationData.create(missionState);
const suitWarning = document.createElement("div");
suitWarning.className = "alert alert-danger position-fixed top-0 start-50 translate-middle-x mt-2";
suitWarning.style.zIndex = "1090";
suitWarning.setAttribute("role", "alert");
suitWarning.hidden = true;
document.body.append(suitWarning);
const eva = EvaIntegration.create(missionState, {
  onPressureEmergency(critical) {
    suitWarning.hidden = !critical;
    suitWarning.textContent = "Suit pressure emergency! Stop your EVA and get to safe shelter now.";
    if (critical) {
      if (rest.active) rest.cancel();
      say([{ speaker: "Suit safety", text: suitWarning.textContent }]);
    }
  },
  onChange() { if (marsScene) updateExposure(); },
});
// Suit readiness from the co-developer's suit controller (via the EVA adapter),
// item by item so a failed suit check can name the reason. Uses the adapter's
// own safety rules; with no controller connected the readings are pending and
// only the suit/helmet flags apply (as before).
MissionOne.setSuitSafetyCheck(() => MissionOne.suitVerdictFromReadings(eva.read()));
function cabinStatus() {
  const position = marsScene?.astronautPosition;
  const inHabitat = position && marsScene.insideHabitat(position.x, position.z);
  return HabitatSystems.atmosphere(missionState, inHabitat ? missionState.systems.habitat : missionOne.progress);
}
function researchEnvironment() {
  const position = marsScene?.astronautPosition;
  const inside = marsEnv().insideCabin || position && marsScene.insideHabitat(position.x, position.z) && habitatState()?.constructed;
  return { safeCabin: Boolean(inside && cabinStatus().safe), suitSafe: MissionOne.isSuitProtecting(missionOne.progress),
    atTerminal: marsScene?.nearInteraction("lander-mission-terminal") === true,
    atEquipment: marsScene?.nearInteraction("solar-equipment") === true };
}
MissionModel.observeTime(missionState, (seconds) => {
  missionOne.tick(seconds, marsEnv()).forEach(handleMissionResult);
  if (TempHabitat.advanceConstruction(missionState, seconds).completed) {
    say([{ speaker: "Flight plan", text: "Temporary habitat assembled and pressurised from its own air tanks. Its airlock, sleeping pods and storage are ready. The lander remains a safe shelter too." }]);
  }
  habitatSystems.tick(seconds);
  researchMissions.tick(seconds, researchEnvironment());
});
let lastPanelKey = "";

const restOverlay = document.getElementById("restOverlay");
const restMessage = document.getElementById("restMessage");
const reducedRestMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const habitatState = () => missionState.systems.habitat;
function restPlace(bedId) {
  const place = marsScene?.bedContext(bedId) || {};
  const habitat = place.cabin === "habitat";
  // Judge the air of the bed's own cabin, so the refusal names the exact
  // missing requirement (pressure, or power/life support) instead of a
  // generic warning. Only a real suit emergency uses the urgent message.
  const air = HabitatSystems.atmosphere(missionState, (habitat ? habitatState() : missionOne.progress) || {});
  const lifeSupportOn = habitat ? habitatState()?.lifeSupport === true : missionOne.progress.powerOn;
  return { ...place,
    completed: habitat ? habitatState()?.constructed === true : true,
    pressurized: habitat ? habitatState()?.pressurized === true : missionOne.progress.cabin === "pressurized" && !missionOne.progress.hatchOpen,
    lifeSupport: lifeSupportOn && (air.pressure !== "Safe" || air.safe),
    criticalEmergency: eva.read().critical === true,
  };
}
const rest = RestSystem.create(missionState, MissionModel, missionClock, {
  place: restPlace,
  onSleep(session) {
    restingTransition = true;
    hadPointerLock = false;
    setGameplayControls(false);
    document.exitPointerLock?.();
    restOverlay.hidden = false;
    restMessage.textContent = session.night ? "Sleeping until morning..." : "Resting...";
    restOverlay.classList.remove("is-sunrise");
    requestAnimationFrame(() => restOverlay.classList.add("is-dark"));
    restFadeUntil = performance.now() + (reducedRestMotion() ? 0 : 300);
  },
  onElapsed(seconds) {
    updateExposure();
  },
  onWake(result) {
    restMessage.textContent = result.message;
    if (result.night && result.message.startsWith("Good morning")) restOverlay.classList.add("is-sunrise");
    say([{ speaker: "Flight plan", text: result.message }]);
    renderMissionState();
    syncMissionWorld();
    setTimeout(() => {
      restOverlay.classList.remove("is-dark");
      setTimeout(() => {
        restOverlay.hidden = true;
        restingTransition = false;
        setGameplayControls(true);
        canvas.focus(); // Mouse look resumes on the next canvas click if pointer lock was released.
      }, reducedRestMotion() ? 0 : 250);
    }, reducedRestMotion() ? 150 : 650);
  },
});

function openBed(bedId) {
  activeMarsPanel = "bed";
  terminalLearnMore.hidden = true;
  const night = MissionModel.getMissionClock(missionState).phase === "night";
  const reason = rest.reason(bedId);
  marsTerminalTitle.textContent = "Crew Rest";
  marsTerminalReadout.replaceChildren();
  marsTerminalNote.textContent = reason || (night
    ? "Sleep until sunrise. Supplies keep running; critical alerts will wake you. All active crew must sleep to speed up the night."
    : "Rest briefly to recover fatigue. Mission time and life-support costs continue normally.");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = night ? "Sleep until morning" : "Rest briefly";
  button.disabled = Boolean(reason);
  button.addEventListener("click", () => {
    button.disabled = true;
    updateExposure();
    const result = rest.begin(bedId);
    if (result.ok) marsTerminalModal.hide();
    else { marsTerminalNote.textContent = result.message; button.disabled = false; }
  });
  marsTerminalActions.replaceChildren(button);
  showModal(marsTerminalModal);
}

function marsEnv() {
  if (!marsScene) return { insideCabin: false, onSurface: false };
  const position = marsScene.astronautPosition;
  const h = missionState.systems.habitat;
  const a = h?.airlock;
  const habitatSafe = Boolean(h?.constructed && marsScene.insideHabitat(position.x, position.z)
    && a?.side !== "chamber" && !a?.outerOpen && HabitatSystems.atmosphere(missionState, h).safe);
  return {
    habitatSafe,
    insideCabin: marsScene.lander.isInsideCabin(position.x, position.z),
    onSurface: marsScene.lander.floorHeightAt(position.x, position.z) === null,
    clearOfHatch: marsScene.lander.isClearOfHatch(position.x, position.z),
    atHatchOutside: marsScene.lander.isAtHatchOutside(position.x, position.z),
  };
}

function hatchStatus() {
  const progress = missionOne.progress;
  if (progress.cabin === "depressurizing" || progress.cabin === "repressurizing") return "cycling";
  return progress.hatchOpen ? "open" : "closed";
}

/** Airlock prompt: "Enter airlock" from outside, "Airlock controls" inside, with hatch status. */
function airlockPrompt() {
  const status = { open: "hatch open", cycling: `cabin ${cabinText()}`, closed: `hatch closed, cabin ${cabinText()}` }[hatchStatus()];
  return `${marsEnv().insideCabin ? "Airlock controls" : "Enter airlock"} (${status})`;
}

// Unprotected exposure: in an unpressurised place (outside, or a cabin that is
// not closed and pressurised) without a sealed EVA suit. Cabin pressure and
// suit protection are separate states; Mission 1 completion grants nothing.
const exposureWarning = document.getElementById("exposureWarning");
let exposureWarned = false;

function updateExposure() {
  const progress = missionOne.progress;
  const env = marsEnv();
  const position = marsScene?.astronautPosition;
  const safeHabitat = position && marsScene.insideHabitat(position.x, position.z)
    && habitatState()?.constructed && habitatState()?.pressurized;
  const chamber = habitatSystems.chamber();
  const safeChamber = chamber?.side === "chamber" && chamber.pressure === "safe" && !chamber.outerOpen;
  const pressurisedHere = chamber?.side === "chamber" ? safeChamber
    : safeHabitat || env.insideCabin && progress.cabin === "pressurized" && !progress.hatchOpen;
  const unprotected = !pressurisedHere && !MissionOne.isSuitProtecting(progress);
  MissionModel.setExposure(missionState, unprotected);
  exposureWarning.classList.toggle("d-none", !unprotected);
  if (unprotected && !exposureWarned) {
    say([{ speaker: "Flight plan", text: "DANGER: no pressure protection. Get back into the pressurised cabin or seal your EVA helmet now." }]);
  }
  exposureWarned = unprotected;
}

const ACTIVE_EFFECT_LABELS = Object.freeze({
  oxygenProduction: "oxygen production", oxygenConsumption: "oxygen use", waterRecycling: "water recycling",
  waterConsumption: "water use", powerConsumption: "power use", greenhouseProduction: "greenhouse output",
  missionProgress: "mission progress",
});

/** Ongoing rate effects of one emergency, e.g. "oxygen production 0%". */
function emergencyEffectsText(emergencyId) {
  const modifiers = (missionState.rateModifiers || {})[emergencyId] || {};
  return Object.entries(modifiers)
    .filter(([key, value]) => value !== 1 && ACTIVE_EFFECT_LABELS[key])
    .map(([key, value]) => `${ACTIVE_EFFECT_LABELS[key]} ${Math.round(value * 100)}%`)
    .join(", ");
}

function say(lines) {
  (lines || []).forEach(({ speaker, text }) => {
    const item = document.createElement("li");
    item.className = `comms-line speaker-${speaker.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const who = document.createElement("strong");
    who.textContent = `${speaker}: `;
    const message = document.createElement("span");
    message.textContent = text;
    item.append(who, message);
    commsLog.append(item);
    window.setTimeout(() => item.classList.add("is-fading"), 14000);
    window.setTimeout(() => item.remove(), 15000);
  });
  while (commsLog.children.length > 4) commsLog.firstElementChild.remove();
}

function cabinText() {
  const progress = missionOne.progress;
  if (progress.cabin === "depressurizing") return `depressurising ${Math.ceil(progress.cycleRemaining)} s`;
  if (progress.cabin === "repressurizing") return `repressurising ${Math.ceil(progress.cycleRemaining)} s`;
  return progress.cabin === "pressurized" ? "pressurised" : "depressurised";
}

function renderObjectives(justCompleted = null) {
  const progress = missionOne.progress;
  objectiveHeading.textContent = progress.status === "complete" ? "Mission 1 complete" : "Mission 1: Establish the Mars Base";
  objectiveList.replaceChildren(...MissionOne.OBJECTIVES.map((objective, index) => {
    const item = document.createElement("li");
    const done = missionOne.isDone(objective.id);
    item.className = done ? "is-done" : index === progress.current ? "is-current" : "";
    if (objective.id === justCompleted) item.classList.add("just-completed");
    let text = objective.title;
    if (objective.id === "survey") {
      const count = MissionOne.SURVEY_MARKERS.filter((marker) => progress.markers[marker.id]).length;
      text += ` (${count}/${MissionOne.SURVEY_MARKERS.length})`;
    }
    item.textContent = text;
    if (index === progress.current && progress.status === "active") {
      const hint = document.createElement("small");
      hint.textContent = objective.hint;
      item.append(hint);
    }
    return item;
  }));
  const suit = progress.suitOn ? `on, helmet ${progress.helmetOn ? "sealed" : "OFF"}` : "stowed";
  objectiveStatus.textContent = `Suit ${suit} · Cabin ${cabinText()} · Hatch ${progress.hatchOpen ? "open" : "closed"}`;

  // After Mission 1: what comes next, standing orders and any recovery tasks.
  const extras = [];
  const next = missionState.progression && missionState.progression.next;
  if (progress.status === "complete" && next) {
    extras.push(["next-mission", "Mission 2 and the Mission 3 preparation checklist are available at the Mission Terminal."]);
    extras.push(["", "Standing orders: keep oxygen, water, food and power above 0% until Sol 90 and respond to alerts (R)."]);
  }
  Object.entries(ResearchMissions.STEPS).forEach(([id, steps]) => {
    const p = missionState.missions?.[id];
    if (p) extras.push(["recovery-task", `${id === "oxygenEmergency" ? "Mission 2" : "Mission 3"}: ${p.status === "complete" ? "Reported" : steps[p.step]}`]);
  });
  const field = exploration.objectives();
  if (progress.status === "complete" || field.some((objective) => objective.done > 0)) {
    const [sites, collected, analysed, salvage] = field;
    extras.push(["field-science", `Field exploration: sites ${sites.done}/${sites.total} · samples ${collected.done}/${collected.total} collected, ${analysed.done} analysed · salvage ${salvage.done}/${salvage.total}`]);
  }
  MissionModel.getActiveAlerts(missionState).forEach((alert) => {
    const emergency = MissionModel.EMERGENCY_CONFIG[alert.emergencyId];
    if (alert.status === "stabilized" && emergency.persistsUntilRepaired) {
      extras.push(["recovery-task", `Recovery task: repair the ${emergency.system} (press R).`]);
    }
  });
  document.getElementById("objectiveExtras").replaceChildren(...extras.map(([className, text]) =>
    Object.assign(document.createElement("p"), { className, textContent: text })));
}

function syncMissionWorld() {
  if (!marsScene) return;
  const progress = missionOne.progress;
  const lander = marsScene.lander;
  marsScene.astronaut.setAppearance(missionState.characterPreset || "male");
  marsScene.astronaut.setEvaEquipped(progress.suitOn);
  lander.setDoorOpen(progress.hatchOpen);
  lander.setHatchStatus(hatchStatus());
  marsScene.refreshInteraction();
  lander.setPowerOn(progress.powerOn);
  lander.setSuitStowed(!progress.suitOn);
  MissionOne.SURVEY_MARKERS.forEach((marker) => marsScene.setSurveyMarkerInspected(marker.id, Boolean(progress.markers[marker.id])));
  // Redraw the 3D panel screens only when their text changes.
  const panelKey = [cabinText(), progress.hatchOpen, progress.powerOn, Math.round(missionState.resources.power),
    Math.round(missionState.resources.batteryReserve), missionOne.cabinPressureKpa().toFixed(1)].join("|");
  if (panelKey === lastPanelKey) return;
  lastPanelKey = panelKey;
  lander.setPanel("pressure", "CABIN PRESSURE", [
    `${missionOne.cabinPressureKpa().toFixed(1)} kPa (simulated)`,
    `Cabin ${cabinText()}`,
    `Hatch ${progress.hatchOpen ? "OPEN" : "closed"}`,
  ], progress.cabin === "pressurized" && !progress.hatchOpen ? "#31c8ff" : "#f2a900");
  lander.setPanel("power", "MAIN POWER", progress.powerOn
    ? ["ON", `Power ${Math.round(missionState.resources.power)}%`, `Battery ${Math.round(missionState.resources.batteryReserve)}%`]
    : ["OFF - emergency lighting", "Press E to activate"], progress.powerOn ? "#5de2a5" : "#f2a900");
}

function grantMissionReward() {
  const outcome = missionOne.claimReward(shop);
  say([{ speaker: "Flight plan", text: outcome.message }]);
  updateShopBalances();
}

function handleMissionResult(result) {
  if (!result) return;
  say(result.lines);
  renderObjectives(result.completed);
  if (result.missionComplete) grantMissionReward();
  syncMissionWorld();
  marsScene?.refreshInteraction();
}

function greenhouseText() {
  const status = MissionModel.getGreenhouseStatus(missionState);
  if (status.producing) return `Producing (${Math.round(missionState.rates.greenhouseProduction * 100)}% output)`;
  const reasons = [!status.operational && "equipment failure", !status.powered && "no power", !status.watered && "no water"].filter(Boolean);
  return `Stopped: ${reasons.join(", ")}`;
}

function rowsOf(pairs) {
  return pairs.map(([name, value]) => [name, typeof value === "number" ? `${Math.round(value)}%` : value]);
}

function researchActions() {
  return Object.keys(ResearchMissions.STEPS).map((id, index) => {
    const p = missionState.missions?.[id];
    return { label: p ? `Mission ${index + 2}: ${p.status === "complete" ? "Reported" : ResearchMissions.STEPS[id][p.step]}` : `Start Mission ${index + 2}`,
      enabled: !missionState.missionComplete && p?.status !== "complete" && (p || missionState.missions?.[index === 0 ? "establishBase" : "oxygenEmergency"]?.status === "complete"),
      reason: "Finish the previous mission first. Use R for the existing emergency choices.",
      run: () => p ? researchMissions.check(id, researchEnvironment()) : researchMissions.start(id) };
  });
}

function habitatConstructionPanel() {
  const stage = TempHabitat.stage(missionState);
  const status = TempHabitat.constructionStatus(missionState, missionOne.status === "complete");
  const percent = Math.round(TempHabitat.progress(missionState) * 100);
  return {
    title: "Temporary Habitat",
    rows: [
      ["Status", stage === "building" ? `Assembling… ${percent}%` : "Packed on its cargo pallet"],
      ["Supplies used", TempHabitat.CONSTRUCTION.kit],
      ["Base resources", "None: oxygen, water, food and power are not used to build it"],
      ["Safe shelter meanwhile", "The lander cabin (bunks and airlock)"],
    ],
    note: stage === "building"
      ? "Assembly is under way. Watch it inflate; the airlock opens when it is finished."
      : "The crew assemble this inflatable habitat after Mission 1. Until then, rest and shelter in the lander.",
    actions: [{
      label: "Assemble Temporary Habitat", enabled: status.available, reason: status.reason, close: true,
      run: () => {
        const result = TempHabitat.startConstruction(missionState, { missionOneComplete: missionOne.status === "complete" });
        return { ok: result.ok, lines: [{ speaker: "Flight plan", text: result.message }] };
      },
    }],
  };
}

function habitatEntryPrompt() {
  const stage = TempHabitat.stage(missionState);
  if (stage === "built") return "Temporary habitat airlock";
  if (stage === "building") return `Assembling habitat… ${Math.round(TempHabitat.progress(missionState) * 100)}%`;
  return missionOne.status === "complete" ? "Assemble Temporary Habitat" : "Habitat cargo pallet (unlocks after Mission 1)";
}

function habitatPanel() {
  if (TempHabitat.stage(missionState) !== "built") return habitatConstructionPanel();
  const a = habitatSystems.chamber();
  const status = habitatSystems.status;
  // Same rule as the lander airlock: suit on, helmet sealed, suit systems safe
  // AND the explicit suit check passed since the suit was last put on.
  const env = { suitSafe: MissionOne.isSuitProtecting(missionOne.progress) && missionOne.progress.suitChecked === true,
    insideHabitat: marsScene.insideHabitat(marsScene.astronautPosition.x, marsScene.astronautPosition.z) };
  const labels = { openOuter: "Open outer door", enter: "Step into airlock", closeOuter: "Close and seal outer door", fill: "Refill airlock with air", verify: "Check the air is safe", openInner: "Open inner door", toHabitat: "Enter habitat and close inner door", closeInner: "Close and seal inner door", vent: "Let air out of airlock", toMars: "Step onto Mars and close outer door" };
  return { title: "Habitat Airlock", rows: [...status.rows,
    ["Outer door", a?.outerOpen ? "Open" : "Sealed"], ["Inner door", a?.innerOpen ? "Open" : "Sealed"],
    ["Airlock", a ? `${a.side} · ${a.remaining ? `${a.remaining.toFixed(1)} seconds remaining` : a.pressure + " pressure"}` : "Construction pending"]],
    note: a ? "Entry: close outer → refill → check air → open inner. Exit: close inner → check suit → let air out → open outer. This panel simulates the chamber; finish entering or leaving before closing it." : "Construction is not available yet. The dedicated airlock stays locked; use the lander.",
    details: status.details + " Airlock cycles use 5 mission seconds and normal survival costs. Gas recovery and pumping costs are pending balance approval.",
    actions: Object.entries(labels).map(([action, label]) => {
      const preview = HabitatSystems.create(JSON.parse(JSON.stringify(missionState))).act(action, env);
      return { label, enabled: preview.ok, reason: preview.ok ? null : preview.lines[0].text,
        run: () => {
          const result = habitatSystems.act(action, env);
          if (result.ok && action === "toHabitat") marsScene.enterHabitat();
          if (result.ok && action === "toMars") marsScene.leaveHabitat();
          updateExposure();
          return result;
        } };
    }) };
}

function renderGuidedAirlock() {
  const a = habitatSystems.chamber();
  const p = missionOne.progress;
  const suit = { on: p.suitOn, helmet: p.helmetOn, checked: p.suitChecked,
    safe: MissionOne.isSuitProtecting(p), ready: MissionOne.isSuitProtecting(p) && p.suitChecked };
  const guide = AirlockGuide.next(a, airlockDirection, suit);
  const env = { suitSafe: suit.ready, insideHabitat: marsScene.insideHabitat(marsScene.astronautPosition.x, marsScene.astronautPosition.z) };
  let enabled = Boolean(guide.action), reason = guide.reason;
  if (guide.action && !["suitOn", "sealHelmet", "suitCheck"].includes(guide.action)) {
    const preview = HabitatSystems.create(JSON.parse(JSON.stringify(missionState))).act(guide.action, env);
    if (!preview.ok) { enabled = false; reason = preview.lines[0].text; }
  }
  if (guide.action === "suitOn" && !missionOne.isSafeEnvironment(marsEnv())) { enabled = false; reason = "The habitat needs safe air and working life support first."; }
  if (guide.action === "sealHelmet" && !missionOne.isSafeEnvironment(marsEnv())) { enabled = false; reason = "Get to a safe cabin before adjusting your helmet."; }
  if (guide.action === "suitCheck") {
    const availability = missionOne.suitCheckAvailability();
    if (!availability.enabled) { enabled = false; reason = availability.reason; }
  }
  marsTerminalTitle.textContent = airlockDirection === "enter" ? "Entering the habitat" : "Leaving for Mars";
  marsTerminalReadout.replaceChildren();
  marsTerminalActions.replaceChildren();
  marsTerminalActions.classList.add("guided-airlock");
  const progress = document.createElement("div");
  progress.className = "airlock-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Airlock steps");
  progress.setAttribute("aria-valuemin", "1"); progress.setAttribute("aria-valuemax", "4");
  progress.setAttribute("aria-valuenow", String(guide.step));
  progress.textContent = `STEP ${guide.step} OF 4  ${[1, 2, 3, 4].map((n) => n <= guide.step ? "●" : "○").join("  ")}`;
  const instruction = document.createElement("p"); instruction.className = "airlock-instruction";
  instruction.textContent = `${guide.icon || "⏳"}  ${guide.instruction}`;
  marsTerminalActions.append(progress, instruction);
  if (guide.waiting) {
    const wait = document.createElement("p"); wait.className = "airlock-wait";
    const seconds = Math.ceil(a.remaining);
    wait.setAttribute("role", "status"); wait.textContent = `Please wait · ${seconds} second${seconds === 1 ? "" : "s"}`;
    marsTerminalActions.append(wait);
  } else {
    const button = document.createElement("button"); button.type = "button";
    button.className = "btn btn-primary btn-lg airlock-primary"; button.textContent = guide.label;
    button.disabled = !enabled;
    button.addEventListener("click", () => {
      let result;
      if (guide.action === "suitOn") result = missionOne.donSuit(marsEnv());
      else if (guide.action === "sealHelmet") result = missionOne.toggleHelmet(marsEnv());
      else if (guide.action === "suitCheck") result = missionOne.suitCheck();
      else result = habitatSystems.act(guide.action, { suitSafe: MissionOne.isSuitProtecting(p) && p.suitChecked, insideHabitat: marsEnv().habitatSafe });
      if (result.ok && guide.action === "toHabitat") marsScene.enterHabitat();
      if (result.ok && guide.action === "toMars") marsScene.leaveHabitat();
      airlockFeedback = result.ok ? "✓ Great job! Step complete." : result.lines?.map((line) => line.text).join(" ") || "Please check your suit and try again.";
      handleMissionResult(result); updateExposure();
      if (result.ok && ["toHabitat", "toMars"].includes(guide.action)) {
        marsTerminalModal.hide();
      } else {
        renderMarsPanel("habitat");
        marsTerminalActions.querySelector("button:not(:disabled)")?.focus();
      }
    });
    marsTerminalActions.append(button);
  }
  if (reason) { const message = document.createElement("p"); message.className = "airlock-reason"; message.textContent = reason; marsTerminalActions.append(message); }
  const why = document.createElement("details"); why.className = "airlock-explanation";
  const summary = document.createElement("summary"); summary.textContent = "How does this work?";
  const explanation = document.createElement("p"); explanation.textContent = guide.why;
  const details = document.createElement("p"); details.textContent = "This is a simplified simulation. Pressure and life support use the game's existing systems; some real atmosphere measurements are not simulated.";
  why.append(summary, explanation, details); marsTerminalActions.append(why);
  marsTerminalNote.textContent = airlockFeedback;
  terminalLearnMore.hidden = true;
}

// Science analysis terminal at the Abandoned Equipment Site: analyse collected
// samples, see salvage materials and the science log. Separate from the
// Mission Terminal and the research missions (Missions 2 and 3).
function scienceLabPanel() {
  const ex = exploration.state;
  const waiting = ExplorationData.SAMPLES.filter((sample) => exploration.isCollected(sample.id) && !exploration.isAnalysed(sample.id));
  const log = exploration.scienceLog();
  const m = exploration.materials;
  return {
    title: "Science Analysis Terminal",
    rows: [
      ["Sites discovered", `${ex.discovered.length} / ${ExplorationData.LOCATIONS.length}`],
      ["Samples collected", `${ex.collected.length} / ${ExplorationData.SAMPLES.length}`],
      ["Samples analysed", `${ex.analysed.length} / ${ExplorationData.SAMPLES.length}`],
      ["Salvage caches", `${ex.salvaged.length} / ${ExplorationData.CACHES.length}`],
      ["Salvage materials", `Metal ${m.metal} · Polymer ${m.polymer} · Electronics ${m.electronics} · Ceramic ${m.ceramic}`],
    ],
    note: waiting.length
      ? "Choose a collected sample to analyse. Results are added to the science log. This terminal and the equipment site are fictional game equipment, not real NASA hardware."
      : "No samples are waiting. Collect samples at the exploration sites (look for the orange flags), then bring them here. Salvage materials are kept for future crafting and are not spent yet.",
    details: log.length
      ? `Science log: ${log.map((entry) => `${entry.title}: ${entry.text}`).join(" | ")}`
      : "Science log: empty. Discover sites and analyse samples to add entries.",
    actions: waiting.map((sample) => ({
      label: `Analyse ${ExplorationData.SAMPLE_TYPES[sample.type].label} (${sample.id})`,
      enabled: true,
      run: () => {
        const result = exploration.analyseSample(sample.id);
        return { ok: result.ok, lines: [{ speaker: "Science log", text: result.message }] };
      },
    })),
  };
}

function handleExplorationInteraction(interaction) {
  if (interaction.exploration === "terminal") { openMarsStation("scienceLab"); return; }
  const result = interaction.exploration === "sample" ? exploration.collectSample(interaction.targetId)
    : exploration.recoverCache(interaction.targetId);
  marsScene.exploration.sync(exploration);
  handleMissionResult({ ok: result.ok, lines: [{ speaker: result.ok ? "Field science" : "Flight plan", text: result.message }] });
}

/** Discovery notifications: checked a few times a second while the player can move. */
function updateExplorationDiscovery() {
  const position = marsScene.astronautPosition;
  const found = exploration.discoverNear(position.x, position.z).filter((result) => result.ok);
  if (!found.length) return;
  found.forEach((result) => showMovementNotice(`Discovered: ${result.location.name}`));
  handleMissionResult({ lines: found.map((result) => ({ speaker: "Discovery", text: result.message })) });
}

// Each lander station: live readings plus action buttons (disabled with a reason when not available).
function marsPanel(kind) {
  const env = marsEnv();
  const progress = missionOne.progress;
  const r = missionState.resources;
  const current = missionOne.currentObjective()?.id;
  const step = (id, label, run, extra = {}) => ({
    label, run,
    enabled: extra.enabled ?? current === id,
    reason: extra.reason ?? (missionOne.isDone(id) ? "Already completed." : "Complete the earlier objectives first."),
    close: extra.close,
  });
  switch (kind) {
    case "habitat": return habitatPanel();
    case "habitatLifeSupport": {
      const status = habitatSystems.status;
      return {
        title: "Temporary Habitat · Life Support",
        rows: status.rows,
        note: "The temporary habitat runs on the base's shared supplies. It does not make oxygen, water, food or power of its own.",
        details: status.details,
        actions: [],
      };
    }
    case "rover": {
      const on = MarsRover.isPowered(missionState);
      const toggle = (next) => () => {
        const result = MarsRover.setPowered(missionState, next);
        marsScene.rover.showPower(MarsRover.isPowered(missionState));
        return { ok: result.ok, lines: [{ speaker: "Rover", text: result.message }] };
      };
      return {
        title: "Robotic Rover",
        rows: MarsRover.statusRows(missionState),
        note: "A robotic science rover parked by the base. Power it on to light its indicators and run its mast camera and rotating sensor. It cannot be driven, and it does not use the base's oxygen, water, food or power.",
        actions: [
          { label: "Power ON", enabled: !on, reason: "The rover is already on.", run: toggle(true) },
          { label: "Power OFF", enabled: on, reason: "The rover is already off.", run: toggle(false) },
        ],
      };
    }
    case "scienceLab": return scienceLabPanel();
    case "habitatStorage":
      return {
        title: "Temporary Habitat · Storage",
        rows: rowsOf([["Food", r.food], ["Water reserve", r.waterReserve], ["Oxygen reserve", r.oxygenReserve], ["Battery reserve", r.batteryReserve]]),
        note: "Shared base storage: the same supplies as the lander. Nothing extra is stored here, and nothing is taken by looking.",
        actions: [],
      };
    case "equipment": return { title: "Outdoor Equipment & Solar Panels", rows: [["Power", `${r.power.toFixed(1)}%`], ["Storm", missionState.emergencies.dustStorm?.status || "Not started"]],
      note: "Securing and inspecting equipment are recorded checklist actions. Equipment damage and repair bonuses are not implemented. Return to shelter before the storm.", actions: researchActions().slice(1) };
    case "lifeSupport":
      return {
        title: "Oxygen & Supplies Terminal",
        rows: rowsOf([["Oxygen", r.oxygen], ["Oxygen reserve", r.oxygenReserve], ["Water", r.water], ["Water reserve", r.waterReserve],
          ["Food", r.food], ["Power", r.power], ["Battery reserve", r.batteryReserve]]),
        note: "Readings come from the shared mission state. Suit refills need the co-developer's suit connection and stored oxygen.",
        actions: [step("lifeSupport", "Run life-support check", () => missionOne.checkLifeSupport())],
      };
    case "pressure":
      return {
        title: "Cabin Pressure Panel",
        rows: cabinStatus().rows,
        note: "Check pressure, oxygen and life support together. A full oxygen gauge alone does not prove the air is safe.",
        details: cabinStatus().details + ` Lander pressure reading: ${missionOne.cabinPressureKpa().toFixed(1)} kPa (simulation).`,
        actions: [step("pressure", "Verify pressure and oxygen", () => missionOne.verifyPressure())],
      };
    case "power":
      return {
        title: "Main Power Panel",
        rows: rowsOf([["Main power", progress.powerOn ? "ON" : "OFF"], ["Power", r.power], ["Battery reserve", r.batteryReserve]]),
        note: "Until main power is on, the cabin runs on dim emergency lighting.",
        actions: [
          step("power", "Activate main power", () => missionOne.activatePower(), {
            enabled: current === "power" && !progress.powerOn,
            reason: progress.powerOn ? "Main power is on." : undefined,
          }),
          step("power", "Inspect power readings", () => missionOne.inspectPower(), {
            enabled: current === "power" && progress.powerOn,
            reason: missionOne.isDone("power") ? "Already completed." : !progress.powerOn ? "Activate main power first." : undefined,
          }),
        ],
      };
    case "supplies":
      return {
        title: "Supply Locker",
        rows: rowsOf([["Water", r.water], ["Water reserve", r.waterReserve], ["Water recycler", `${Math.round(missionState.rates.waterRecycling * 100)}% efficiency`],
          ["Food", r.food], ["Greenhouse", greenhouseText()]]),
        note: "Values come from the shared mission state. The greenhouse only grows food while it is working and has both power and water.",
        actions: [step("supplies", "Log water and food check", () => missionOne.checkSupplies())],
      };
    case "suit":
      return {
        title: "EVA Suit Locker",
        rows: [["Suit", progress.suitOn ? "Worn" : "Stowed"], ["Helmet", progress.suitOn ? (progress.helmetOn ? "Sealed" : "Off") : "-"],
          ["Suit check", !progress.suitOn ? "-" : progress.suitChecked ? "Passed — ready for EVA" : "Needed before EVA"],
          ...[["Oxygen tank", "oxygenPercent"], ["Pressure", "pressureStatus"], ["CO₂", "co2Status"], ["Integrity", "integrityPercent"], ["Battery", "batteryPercent"], ["Leaks", "leakStatus"]].map(([label, key]) => [label, eva.read()[key] == null ? "Pending — suit integration" : String(eva.read()[key]) + (key.endsWith("Percent") ? "%" : "")])],
        note: eva.read().connected ? "All suit systems must be safe for EVA. Refills transfer stored oxygen; they do not repair leaks or pressure failures." : "Detailed suit telemetry is pending. Existing suit/helmet protection is a simulation until the co-developer connects the suit controller.",
        actions: [
          { label: "Refill suit from stored oxygen", enabled: eva.read().connected, reason: "Waiting for the co-developer's suit controller.", run: () => {
            const result = eva.refill({ atStation: marsScene.nearInteraction("lander-suit-locker"), safe: missionOne.isSafeEnvironment(marsEnv()), operational: progress.powerOn });
            return { ok: result.ok, lines: [{ speaker: "Suit station", text: result.message }] };
          } },
          step("suit", "Put on EVA suit", () => missionOne.donSuit(marsEnv()), {
            enabled: !progress.suitOn && (current === "suit" || missionOne.isDone("suit")),
            reason: progress.suitOn ? "Already wearing the suit." : undefined,
          }),
          // Reusable before every EVA, also after Mission 1 (the objective itself is recorded once).
          step("suit", "Run EVA suit check", () => missionOne.suitCheck(), {
            enabled: missionOne.suitCheckAvailability().enabled,
            reason: missionOne.suitCheckAvailability().reason,
          }),
          step("suit", "Take off EVA suit", () => missionOne.removeSuit(marsEnv()), {
            enabled: progress.suitOn && missionOne.isSafeEnvironment(env),
            reason: !progress.suitOn ? "Not wearing the suit." : "Only inside the closed, pressurised cabin.",
          }),
        ],
      };
    case "airlock":
      return {
        title: "Airlock Controls",
        rows: [["Cabin", cabinText()], ["Cabin pressure", `${missionOne.cabinPressureKpa().toFixed(1)} kPa (simulated)`],
          ["Hatch", progress.hatchOpen ? "Open" : "Closed"],
          ["Your suit", progress.suitOn ? (progress.helmetOn ? "On, helmet sealed" : "On, helmet OFF") : "Not worn"]],
        note: "This lander has no separate airlock chamber: the whole cabin is depressurised before the hatch opens, as in the Apollo Lunar Module. Simplified for training.",
        actions: missionOne.airlockOptions(env).map((option) => ({
          label: option.label, enabled: option.enabled, reason: option.reason,
          run: () => missionOne.airlock(option.action, marsEnv()), close: true,
        })),
      };
    default: {
      const sent = (missionState.reports || []).length;
      return {
        title: "Mission Terminal",
        rows: [["Sol", `${missionState.sol} / ${missionState.maxSol}`], ["Phase", MissionModel.getMissionClock(missionState).phase],
          ["Crew health", `${Math.round(r.crewHealth)}%`],
          ["Active emergencies", Object.entries(missionState.emergencies).filter(([, e]) => e.status === "active").map(([key]) => key).join(", ") || "None"],
          ["Mission 1 objectives", `${Object.keys(progress.completed).length} / ${MissionOne.OBJECTIVES.length}`],
          ["Reports sent", String(sent)]],
        note: progress.report === "transmitting" ? "Report transmitting… waiting for Mission Control." : "Reports go to Mission Control on Earth.",
        actions: [step("report", "Submit first mission report", () => missionOne.submitReport(marsEnv()), {
          enabled: current === "report" && progress.report !== "transmitting",
          reason: missionOne.isDone("report") ? "First report already sent." : progress.report === "transmitting" ? "Transmitting…" : undefined,
          close: true,
        }), ...researchActions()],
      };
    }
  }
}

function renderMarsPanel(kind) {
  activeMarsPanel = kind;
  marsTerminalActions.classList.remove("guided-airlock");
  if (kind === "habitat" && TempHabitat.stage(missionState) === "built") { renderGuidedAirlock(); return; }
  const panel = marsPanel(kind);
  marsTerminalTitle.textContent = panel.title;
  marsTerminalReadout.replaceChildren(...panel.rows.flatMap(([name, value]) => {
    const term = document.createElement("dt");
    term.textContent = name;
    const detail = document.createElement("dd");
    detail.textContent = value;
    return [term, detail];
  }));
  marsTerminalNote.textContent = panel.note;
  terminalLearnMore.hidden = !panel.details;
  terminalLearnMore.querySelector("p").textContent = panel.details || "";
  marsTerminalActions.replaceChildren(...panel.actions.map((action) => {
    const wrapper = document.createElement("div");
    wrapper.className = "terminal-action";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm ${action.enabled ? "btn-primary" : "btn-outline-secondary"}`;
    button.textContent = action.label;
    button.disabled = !action.enabled;
    button.addEventListener("click", () => {
      const result = action.run();
      handleMissionResult(result);
      if (action.close && result.ok) marsTerminalModal.hide();
      else renderMarsPanel(kind);
    });
    wrapper.append(button);
    if (!action.enabled && action.reason) {
      const reason = document.createElement("small");
      reason.textContent = action.reason;
      wrapper.append(reason);
    }
    return wrapper;
  }));
}

function openMarsStation(kind) {
  renderMarsPanel(kind);
  showModal(marsTerminalModal);
}

const STATION_BY_INTERACTION = Object.freeze({
  "lander-supply-terminal": "lifeSupport",
  "lander-pressure-panel": "pressure",
  "lander-power-panel": "power",
  "lander-supply-locker": "supplies",
  "lander-suit-locker": "suit",
  "lander-airlock": "airlock",
  "lander-mission-terminal": "report",
  "habitat-life-support": "habitatLifeSupport",
  "habitat-storage": "habitatStorage",
});

// Short movement notices (e.g. no room to stand up), shown in the lobby and on Mars.
const movementNotice = document.getElementById("movementNotice");
let movementNoticeTimer = null;
function showMovementNotice(text) {
  movementNotice.textContent = text;
  movementNotice.classList.remove("d-none");
  clearTimeout(movementNoticeTimer);
  movementNoticeTimer = setTimeout(() => movementNotice.classList.add("d-none"), 2000);
}
const STAND_BLOCKED_TEXT = "Not enough headroom to stand up. Move out from under the obstacle.";

const marsCallbacks = {
  onStandBlocked() { showMovementNotice(STAND_BLOCKED_TEXT); },
  onInteractionChange(interaction) {
    interactionHint.classList.toggle("d-none", !interaction);
    interactionHint.querySelector("kbd").hidden = Boolean(interaction?.bed);
    if (interaction) {
      // Beds: "Press E to Rest" by day, "Press E to Sleep" at night (sleeps until morning).
      const night = MissionModel.getMissionClock(missionState).phase === "night";
      interactionHintText.textContent = interaction.id === "lander-airlock" ? airlockPrompt()
        : interaction.id === "habitat-entry" ? habitatEntryPrompt()
        : interaction.bed ? (night ? "Press E to Sleep" : "Press E to Rest") : interaction.label;
    }
  },
  onInteract(id, interaction) {
    if (restingTransition) return;
    if (interaction?.bed) openBed(id);
    else if (id === "habitat-entry") {
      airlockDirection = "enter"; airlockFeedback = "";
      openMarsStation("habitat");
    } else if (id === "habitat-exit") {
      airlockDirection = "exit"; airlockFeedback = "";
      habitatSystems.act("approachInside", { insideHabitat: true });
      openMarsStation("habitat");
    } else if (id === "solar-equipment") {
      openMarsStation("equipment");
    } else if (interaction?.exploration) handleExplorationInteraction(interaction);
    else if (interaction?.rover) openMarsStation("rover"); // one E press = one rover panel
    else if (interaction?.surveyMarker) handleMissionResult(missionOne.inspectMarker(id));
    else if (interaction?.info) say([{ speaker: "Science log", text: interaction.info }]);
    else if (STATION_BY_INTERACTION[id]) openMarsStation(STATION_BY_INTERACTION[id]);
  },
  onShelterBreachBlocked() {
    say([{ speaker: "Flight plan", text: "Blocked: you can only enter or leave the cabin through the open hatch." }]);
  },
  onSafeZoneChange(safe) {
    safeZoneBadge.classList.toggle("d-none", !safe);
    locationDisplay.textContent = safe ? "Lander · Home Base" : "Mars Surface";
  },
};

function arriveOnMars() {
  if (!marsScene) {
    marsScene = MarsScene.create(engine, canvas, marsCallbacks, { surveyMarkers: MissionOne.SURVEY_MARKERS });
    marsScene.applyGraphics(GraphicsQuality.presetFor(graphicsLevel));
    marsScene.scene.shadowsEnabled = document.getElementById("shadowsToggle").checked;
    marsScene.exploration.sync(exploration); // reflect saved progress (collected samples, opened caches)
  }
  lobby.setControlsEnabled(false);
  activeScene = marsScene.scene;
  // The temporary habitat arrives packed on a cargo pallet; the crew assemble
  // it after Mission 1 ("Assemble Temporary Habitat" at the pallet).
  missionClock.start();
  locationType.textContent = "MISSION LOCATION";
  locationDisplay.textContent = marsScene.inSafeZone ? "Lander · Home Base" : "Mars Surface";
  safeZoneBadge.classList.toggle("d-none", !marsScene.inSafeZone);
  missionPanel.classList.remove("d-none");
  objectiveTracker.classList.remove("d-none");
  document.getElementById("recoveryControls").classList.remove("d-none");
  document.body.classList.add("mars-active");
  if (missionOne.status === "inactive") handleMissionResult(missionOne.start());
  else syncMissionWorld();
  modalOpen = false;
  setGameplayControls(true);
  canvas.focus();
}

function startClassShop() {
  renderClassShop();
  showModal(classShopModal);
}

lobby = LobbyScene.create(engine, canvas, {
  onStandBlocked() { showMovementNotice(STAND_BLOCKED_TEXT); },
  onInteractionChange(interaction) {
    interactionHint.classList.toggle("d-none", !interaction);
    if (interaction) interactionHintText.textContent = `Use ${interaction.label}`;
  },
  onMissionTerminal() { showModal(missionTerminalModal); },
  onClassShop: startClassShop,
  onSupplyShop() {
    updateShopBalances();
    showModal(supplyShopModal);
  },
  // Walk-on launch pads (LAUNCH PREP). Only the SOLO pad starts a mission;
  // multiplayer pads never launch (no networking yet).
  onLaunchPad(padId) {
    const pad = LaunchQueue.padById(padId);
    if (!pad || !pad.playable || pad.crew !== 1) { lobby.queue.reset(); return; }
    if (launchSequence.running) return; // the cutscene can only start once
    beginLaunchSequence();
    if (!launchSequence.running) lobby.queue.reset();
  },
  onQueueChange: renderLaunchQueue,
});
lobby.setControlsEnabled(false);
activeScene = lobby.scene;
lobby.applyGraphics(GraphicsQuality.presetFor(graphicsLevel));
launchSequence = LaunchSequence.create(arriveOnMars);
updateShopBalances();
setClassShopMessage(classShopMessage);

document.querySelectorAll(".modal").forEach((element) => {
  element.addEventListener("shown.bs.modal", () => {
    modalOpen = true;
    setGameplayControls(false);
  });
  element.addEventListener("hidden.bs.modal", () => {
    modalOpen = document.querySelector(".modal.show") !== null;
    setGameplayControls(!modalOpen);
  });
});

document.getElementById("soloMissionButton").addEventListener("click", enterTrainingLobby);
testingRewardButton.addEventListener("click", () => {
  const result = shop.reward();
  setClassShopMessage(result.message);
  renderClassShop();
});

canvas.addEventListener("click", () => {
  if (gameStarted && !modalOpen && !restingTransition && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    hadPointerLock = true;
  } else if (hadPointerLock && gameStarted && !modalOpen && !endingShown) {
    hadPointerLock = false;
    showModal(settingsModal);
  }
});
window.addEventListener("keydown", (event) => {
  if (restingTransition) {
    if (event.code === "Escape") rest.cancel();
    return;
  }
  if (event.code === "Escape" && gameStarted && !endingShown && !document.querySelector(".modal.show")) showModal(settingsModal);
  // H seals or removes the EVA helmet (blocked outside the closed, pressurised cabin).
  if (event.code === "KeyH" && !event.repeat && gameStarted && !modalOpen && !endingShown && !restingTransition && marsScene && activeScene === marsScene.scene) {
    handleMissionResult(missionOne.toggleHelmet(marsEnv()));
  }
});
// Space never scrolls the page or re-presses a focused button during play
// (jumping itself is handled by the active scene). Menus keep normal Space.
window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !gameStarted || modalOpen) return;
  if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
}, { capture: true });

document.getElementById("leaveQueueButton").addEventListener("click", () => {
  lobby.leaveQueue();
  canvas.focus();
});

// X leaves the LAUNCH PREP queue (steps the astronaut off the pad).
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyX" || event.repeat || !gameStarted || modalOpen || activeScene !== lobby.scene) return;
  lobby.leaveQueue();
});
document.getElementById("lookSensitivity").addEventListener("input", (event) => {
  const camera = activeScene === marsScene?.scene ? marsScene.camera : lobby.camera;
  camera.angularSensibility = Number(event.target.value);
});
document.getElementById("shadowsToggle").addEventListener("change", (event) => {
  [lobby?.scene, marsScene?.scene].forEach((scene) => { if (scene) scene.shadowsEnabled = event.target.checked; });
});
const graphicsSelect = document.getElementById("graphicsQuality");
graphicsSelect.value = graphicsLevel;
graphicsSelect.addEventListener("change", (event) => setGraphicsLevel(event.target.value));
let graphicsInfoTimer = null;
settingsModalElement.addEventListener("shown.bs.modal", () => {
  renderGraphicsInfo();
  graphicsInfoTimer = setInterval(renderGraphicsInfo, 1000);
});
settingsModalElement.addEventListener("hidden.bs.modal", () => clearInterval(graphicsInfoTimer));

// Mars lighting follows the shared mission clock and dust-storm emergency.
// ?marsTime=<seconds 0-90 | morning | noon | evening | dusk | night> overrides the clock for testing.
const MARS_TIME_PRESETS = Object.freeze({ morning: 3, noon: 30, evening: 56, dusk: 62, night: 75 });
let marsTimeOverride = parseMarsTime(new URLSearchParams(window.location.search).get("marsTime"));

function parseMarsTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Object.hasOwn(MARS_TIME_PRESETS, value)) return MARS_TIME_PRESETS[value];
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MissionModel.SOL_CYCLE.totalSeconds) : null;
}

function marsEnvironmentInput() {
  return {
    elapsedSeconds: marsTimeOverride ?? missionState.elapsedSeconds,
    daySeconds: MissionModel.SOL_CYCLE.daySeconds,
    nightSeconds: MissionModel.SOL_CYCLE.nightSeconds,
    // Storm visuals last until the storm has passed (active or stabilised).
    dustStorm: Boolean(missionState.emergencies.dustStorm) && missionState.emergencies.dustStorm.status !== "resolved",
  };
}

let lastFrameTime = performance.now();
const HABITAT_AIRLOCK_MAX_FRAME_SECONDS = 1;
let lastMissionHudRender = 0;
let lastMissionWorldSync = 0;

engine.runRenderLoop(() => {
  const now = performance.now();
  const realSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  // The clock pauses while any panel/modal (pause menu, emergencies, terminals) is open.
  missionClock.setPaused(modalOpen || document.hidden || restingTransition);
  if (marsScene && activeScene === marsScene.scene) eva.notifyChanged();
  if (!document.hidden && activeMarsPanel === "habitat" && document.getElementById("marsTerminalModal").classList.contains("show") && habitatSystems.chamber()?.remaining > 0) {
    // Real elapsed time, so a 5 s cycle takes ~5 s even at low frame rates
    // (capped at 1 s per frame to ignore stalls such as a tab switch).
    missionClock.advanceActivityTime(Math.min(realSeconds, HABITAT_AIRLOCK_MAX_FRAME_SECONDS));
    updateExposure();
    const countdown = Math.ceil(habitatSystems.chamber().remaining);
    if (countdown !== airlockLastCountdown) {
      airlockLastCountdown = countdown;
      renderMarsPanel("habitat");
    }
    renderMissionState();
  }
  if (rest.active && !document.hidden && now >= restFadeUntil) rest.tick(realSeconds);
  if (missionClock.tick(realSeconds) && now - lastMissionHudRender > 250) {
    lastMissionHudRender = now;
    renderMissionState();
  }
  if (missionState.missionComplete && gameStarted && !endingShown) showMissionEnding();
  if (marsScene && activeScene === marsScene.scene) {
    marsScene.setEnvironment(marsEnvironmentInput());
    marsScene.setHabitatStage(TempHabitat.stage(missionState), TempHabitat.progress(missionState));
    marsScene.rover.showPower(MarsRover.isPowered(missionState));
    // Mission 1 timed steps (cabin cycles, report reply) pause with the rest of the game.
    if (!modalOpen && !document.hidden && !restingTransition) {
      if (!endingShown) updateExposure();
      if (now - lastMissionWorldSync > 250) {
        lastMissionWorldSync = now;
        updateExplorationDiscovery();
        renderObjectives();
        syncMissionWorld();
      }
    }
  }
  activeScene.render();
  if (!document.hidden && realSeconds > 0 && realSeconds < 0.25) {
    fpsAverage += (1 / realSeconds - fpsAverage) * 0.05;
    if (graphicsLevel === "auto" && autoResolution.sample(realSeconds) !== null) applyGraphicsResolution();
  }
});
window.addEventListener("resize", () => {
  // Moving the window between a Retina and a standard display changes the DPR.
  const dpr = window.devicePixelRatio || 1;
  if (dpr !== graphicsDpr) {
    graphicsDpr = dpr;
    autoResolution = GraphicsQuality.createAutoController(graphicsDpr);
    applyGraphicsResolution();
  } else {
    engine.resize();
  }
});

const resourceDisplays = {
  oxygen: document.getElementById("oxygenDisplay"), water: document.getElementById("waterDisplay"),
  food: document.getElementById("foodDisplay"), power: document.getElementById("powerDisplay"),
  batteryReserve: document.getElementById("batteryReserveDisplay"), oxygenReserve: document.getElementById("oxygenReserveDisplay"),
  waterReserve: document.getElementById("waterReserveDisplay"), crewHealth: document.getElementById("crewHealthDisplay"),
  crewComfort: document.getElementById("crewComfortDisplay"),
};
const emergencyModal = new bootstrap.Modal(document.getElementById("emergencyModal"));
const emergencyContent = document.getElementById("emergencyContent");
const emergencyTitle = document.getElementById("emergencyTitle");
const emergencyLevel = document.getElementById("emergencyLevel");
const emergencyDialogue = document.getElementById("emergencyDialogue");
const emergencyAlertNote = document.getElementById("emergencyAlertNote");
const emergencyPrompt = document.getElementById("emergencyPrompt");
const emergencyChoices = document.getElementById("emergencyChoices");
const emergencyResult = document.getElementById("emergencyResult");
const emergencyClose = document.getElementById("emergencyClose");
const emergencyBanner = document.getElementById("emergencyBanner");
const RESOURCE_NAMES = Object.freeze({
  oxygen: "Oxygen", oxygenReserve: "Oxygen reserve", water: "Water", waterReserve: "Water reserve",
  food: "Food", power: "Power", batteryReserve: "Battery reserve", crewHealth: "Crew health", crewComfort: "Crew comfort",
});
let openEmergencyId = null;
let lastDecision = null;
const missionControlMessages = {};

function renderMissionState() {
  const phase = MissionModel.getMissionClock(missionState).phase;
  document.getElementById("solDisplay").textContent =
    `Sol ${missionState.sol} / ${missionState.maxSol} · ${phase === "complete" ? (missionState.failure ? "Mission failed" : "Mission over") : phase === "day" ? "Day" : "Night"}`;
  Object.entries(resourceDisplays).forEach(([resource, element]) => { element.textContent = `${Math.round(missionState.resources[resource])}%`; });
  document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
    button.disabled = Boolean(missionState.emergencies[button.dataset.triggerEmergency]);
  });
  renderEmergencyBanner();
}

function formatSols(seconds) {
  return String(Math.round((seconds / MissionModel.SOL_CYCLE.totalSeconds) * 100) / 100);
}

function formatDuration(seconds) {
  const total = Math.ceil(seconds);
  return total >= 60 ? `${Math.floor(total / 60)} min ${total % 60} s` : `${total} s`;
}

function resourceChanges(before, after, declared = {}) {
  return Object.keys(RESOURCE_NAMES)
    .filter((key) => Math.abs(after[key] - before[key]) >= 0.05)
    .map((key) => {
      let text = `${RESOURCE_NAMES[key]} ${Math.round(before[key] * 10) / 10}% → ${Math.round(after[key] * 10) / 10}%`;
      const intended = declared[key] || 0;
      if (intended > 0 && after[key] - before[key] < intended - 0.05 && after[key] >= 99.95) {
        text += " (capped at 100%; the rest is lost)";
      }
      return text;
    });
}

function dialogueItem(speaker, text, className = "") {
  const item = document.createElement("li");
  item.className = `speaker-${speaker.toLowerCase().replace(/[^a-z]+/g, "-")} ${className}`.trim();
  const who = document.createElement("strong");
  who.textContent = `${speaker}: `;
  item.append(who, document.createTextNode(text));
  return item;
}

function emergencyStatusLine(emergencyId) {
  const emergency = MissionModel.EMERGENCY_CONFIG[emergencyId];
  const alert = MissionModel.getEmergencyAlert(missionState, emergencyId);
  if (!alert) return "Resolved.";
  const timing = alert.secondsLeft !== null ? ` Passes in ${formatDuration(alert.secondsLeft)}.` : "";
  if (alert.status === "stabilized") {
    return emergency.persistsUntilRepaired
      ? `Stabilised, but the ${emergency.system} is still offline. Repair it when you can.`
      : `Response in place.${timing}`;
  }
  return `${RESOURCE_NAMES[alert.resource]} is at ${Math.round(alert.value)}%.${timing}`;
}

function renderEmergency(emergencyId, decision = lastDecision) {
  openEmergencyId = emergencyId;
  const emergency = MissionModel.EMERGENCY_CONFIG[emergencyId];
  const emergencyState = missionState.emergencies[emergencyId];
  const alert = MissionModel.getEmergencyAlert(missionState, emergencyId);
  const level = alert ? alert.level : "normal";
  emergencyTitle.textContent = emergency.title;
  emergencyLevel.textContent = alert ? MissionModel.ALERT_LEVELS[level].label.toUpperCase() : "RESOLVED";
  emergencyLevel.className = `alert-level-badge level-${level}`;
  emergencyContent.className = `modal-content bg-dark text-white emergency-modal level-${level}`;
  emergencyAlertNote.textContent = level === "codeBlack" ? EmergencyConfig.CODE_BLACK_NOTE : "";
  emergencyAlertNote.classList.toggle("d-none", level !== "codeBlack");

  emergencyDialogue.replaceChildren(
    ...emergency.briefing.map((text) => dialogueItem("Flight plan", text)),
    dialogueItem("Flight plan", emergencyStatusLine(emergencyId)),
  );
  const control = missionControlMessages[emergencyId];
  if (control) emergencyDialogue.append(dialogueItem("Mission Control", control.text, control.arrived ? "" : "pending"));

  const available = MissionModel.getAvailableChoices(missionState, emergencyId);
  emergencyPrompt.textContent = emergencyState.status === "active"
    ? "Choose a response. Each response can only be used once."
    : available.length ? "Only the repair is still available." : "No further action is available.";
  emergencyChoices.replaceChildren(...Object.entries(emergency.choices).map(([choiceId, choice]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emergency-choice";
    const title = document.createElement("strong");
    title.textContent = choice.label;
    const risk = document.createElement("span");
    risk.className = "risk";
    risk.textContent = choice.risk;
    button.append(title, risk);
    if (available.includes(choiceId)) {
      const repairSpeed = ClassBonuses.getBonuses(selectedClass).repairSpeed;
      const preview = MissionModel.previewEmergencyChoice(missionState, emergencyId, choiceId, { repairSpeed });
      const list = document.createElement("ul");
      const lines = resourceChanges(preview.before, preview.after, choice.resources);
      if (preview.secondsSimulated) lines.unshift(`Takes ${formatSols(preview.secondsSimulated)} sols; supplies are used meanwhile`);
      if (preview.status === "stabilized" && emergency.persistsUntilRepaired) lines.push(`The ${emergency.system} stays offline`);
      list.replaceChildren(...lines.map((text) => Object.assign(document.createElement("li"), { textContent: `Predicted: ${text}` })));
      if (preview.secondsSimulated && repairSpeed > 1) {
        list.prepend(Object.assign(document.createElement("li"), {
          textContent: `${selectedClass} bonus: repair ${Math.round((repairSpeed - 1) * 100)}% faster`,
        }));
      }
      button.append(list);
      button.addEventListener("click", () => resolveEmergency(emergencyId, choiceId));
    } else {
      button.disabled = true;
      const reason = document.createElement("span");
      reason.className = "reason";
      reason.textContent = emergencyState.choices.includes(choiceId) ? "Already used."
        : emergencyState.status === "resolved" ? "Emergency resolved."
          : emergencyState.status === "stabilized" && !emergency.persistsUntilRepaired ? "Your response is in place; wait for it to pass."
            : emergencyState.status === "stabilized" && !choice.time ? "Only a repair can follow your first response." : "Not available.";
      button.append(reason);
    }
    return button;
  }));

  emergencyResult.classList.toggle("d-none", !decision);
  if (decision) {
    emergencyResult.replaceChildren(
      Object.assign(document.createElement("strong"), { textContent: decision.result }),
      ...decision.changes.map((text) => Object.assign(document.createElement("div"), { textContent: text })),
    );
  }
  emergencyClose.classList.toggle("d-none", emergencyState.status === "active");
}

function openEmergency(emergencyId) {
  lastDecision = null;
  renderEmergency(emergencyId);
  if (!document.getElementById("emergencyModal").classList.contains("show")) showModal(emergencyModal);
}

function resolveEmergency(emergencyId, choiceId) {
  const solBefore = missionState.sol;
  const elapsedBefore = missionState.elapsedSeconds;
  const before = { ...missionState.resources };
  const outcome = MissionModel.resolveEmergency(missionState, emergencyId, choiceId, {
    repairSpeed: ClassBonuses.getBonuses(selectedClass).repairSpeed,
  });
  if (!outcome.applied) return outcome;
  missionClock.recordExternalJump(solBefore, elapsedBefore, `Emergency decision: ${emergencyId} → ${choiceId}`);
  const choice = MissionModel.EMERGENCY_CONFIG[emergencyId].choices[choiceId];
  const changes = resourceChanges(before, missionState.resources, choice.resources);
  if (outcome.secondsSimulated) changes.unshift(`Time passed: ${formatSols(outcome.secondsSimulated)} sols (now Sol ${missionState.sol}).`);
  if (outcome.missionComplete) changes.push("The mission reached Sol 90 during the repair.");
  lastDecision = { result: outcome.result, changes };
  renderEmergency(emergencyId);
  renderMissionState();
  return outcome;
}

function triggerEmergency(emergencyId) {
  const emergency = MissionModel.EMERGENCY_CONFIG[emergencyId];
  if (!emergency || !MissionModel.triggerEmergency(missionState, emergencyId)) return false;
  // Mission Control is on Earth: its reply arrives after the (compressed) signal delay.
  missionControlMessages[emergencyId] = { arrived: false, text: "Message incoming from Earth (signal delay)…" };
  window.setTimeout(() => {
    missionControlMessages[emergencyId] = {
      arrived: true,
      text: "Alarm received on Earth. Our messages take minutes to reach you, so act on your onboard checklist and the predicted outcomes.",
    };
    if (openEmergencyId === emergencyId && document.getElementById("emergencyModal").classList.contains("show")) {
      renderEmergency(emergencyId);
    }
  }, EmergencyConfig.MISSION_CONTROL_DELAY_SECONDS * 1000);
  renderMissionState();
  openEmergency(emergencyId);
  return true;
}

function renderEmergencyBanner() {
  const alerts = MissionModel.getActiveAlerts(missionState);
  emergencyBanner.classList.toggle("d-none", alerts.length === 0 || !gameStarted);
  emergencyBanner.replaceChildren(...alerts.slice(0, 3).map((alert) => {
    const row = document.createElement("div");
    row.className = "banner-row";
    const badge = document.createElement("span");
    badge.className = `alert-level-badge level-${alert.level}`;
    badge.textContent = MissionModel.ALERT_LEVELS[alert.level].label.toUpperCase();
    const text = document.createElement("span");
    const timing = alert.secondsLeft !== null ? ` · passes in ${formatDuration(alert.secondsLeft)}` : "";
    const action = MissionModel.getAvailableChoices(missionState, alert.emergencyId).length ? " · press R to respond" : "";
    const effects = emergencyEffectsText(alert.emergencyId);
    text.textContent = `${MissionModel.EMERGENCY_CONFIG[alert.emergencyId].title} · ${RESOURCE_NAMES[alert.resource]} ${Math.round(alert.value)}%${effects ? ` · ${effects}` : ""}${timing}${action}`;
    row.append(badge, text);
    return row;
  }));
}

document.getElementById("emergencyModal").addEventListener("hidden.bs.modal", () => { openEmergencyId = null; });
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyR" || event.repeat || !gameStarted || modalOpen || endingShown || restingTransition) return;
  const alert = MissionModel.getActiveAlerts(missionState)[0];
  if (alert) openEmergency(alert.emergencyId);
});

document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
  button.addEventListener("click", () => triggerEmergency(button.dataset.triggerEmergency));
});

// ---------------------------------------------------------------------------
// Mission ending (success or failure) and restart.
// ---------------------------------------------------------------------------
function fillReadout(element, rows) {
  element.replaceChildren(...rows.flatMap(([name, value]) => [
    Object.assign(document.createElement("dt"), { textContent: name }),
    Object.assign(document.createElement("dd"), { textContent: value }),
  ]));
}

function showMissionEnding() {
  endingShown = true;
  document.querySelectorAll(".modal.show").forEach((element) => bootstrap.Modal.getInstance(element)?.hide());
  modalOpen = true;
  setGameplayControls(false);
  document.exitPointerLock?.();
  interactionHint.classList.add("d-none");

  const result = MissionOutcome.evaluate(missionState, MissionModel.EMERGENCY_CONFIG);
  const report = result.report;
  const ending = document.getElementById("missionEnding");
  ending.dataset.outcome = result.status;
  document.getElementById("endingTitle").textContent = result.headline;
  document.getElementById("endingReasons").replaceChildren(
    ...result.reasons.map((reason) => Object.assign(document.createElement("li"), { textContent: reason })),
  );
  document.getElementById("endingDialogue").replaceChildren(...result.dialogue.map((line) => dialogueItem(line.speaker, line.text)));
  fillReadout(document.getElementById("endingSummary"), [
    ["Sols survived", `${report.solsSurvived} / ${report.maxSol}`],
    ["Class", selectedClass],
    ["Missions completed", `${report.missionsCompleted} / ${report.missions.length}`],
    ...report.missions.map((mission) => [mission.title, `${mission.objectivesDone} / ${mission.objectivesTotal} objectives`]),
    ["Emergencies handled", `${report.emergenciesHandled} / ${report.emergencies.length}`],
  ]);
  fillReadout(document.getElementById("endingResources"),
    ["oxygen", "water", "food", "power", "crewHealth"].map((key) => [RESOURCE_NAMES[key], `${Math.round(report.resources[key])}%`]));
  const emergencies = document.getElementById("endingEmergencies");
  emergencies.replaceChildren(...(report.emergencies.length ? report.emergencies.map((emergency) => {
    const labels = emergency.choices.map((id) => MissionModel.EMERGENCY_CONFIG[emergency.id].choices[id].label);
    return Object.assign(document.createElement("li"), {
      textContent: `${emergency.title}: ${emergency.status}${labels.length ? ` (${labels.join(" → ")})` : ""}`,
    });
  }) : [Object.assign(document.createElement("li"), { textContent: "None" })]));
  fillReadout(document.getElementById("endingScience"), [
    ["Survey markers inspected", `${report.science.surveyMarkers} / ${report.science.surveyMarkersTotal}`],
    ["Mission reports sent", String(report.science.reportsSent)],
    ["Exploration sites discovered", `${report.science.sitesDiscovered} / ${report.science.sitesTotal}`],
    ["Field samples analysed", `${report.science.samplesAnalysed} / ${report.science.samplesTotal}`],
  ]);

  const rewards = [];
  if (missionOne.progress.rewardGranted) {
    rewards.push(`Mission 1 reward (+${ShopModel.MISSION_REWARDS["establish-base"].solar} Solar Cells) was handled when the base was established; it is paid once per save.`);
  }
  if (result.status === "success") {
    rewards.push(MissionOutcome.claimSuccessReward(missionState, shop, MissionModel.EMERGENCY_CONFIG).message);
    updateShopBalances();
  } else {
    rewards.push("No currency is awarded for an unsuccessful mission.");
  }
  document.getElementById("endingRewards").textContent = rewards.join(" ");
  ending.hidden = false;
  ending.querySelector(".ending-card").scrollTop = 0;
  document.getElementById("restartMissionButton").focus({ preventScroll: true });
}

// Restart: reload the page. Purchases and rewards live in browser storage and
// are untouched; the mission state starts fresh at Johnson Space Center.
document.getElementById("restartMissionButton").addEventListener("click", () => window.location.reload());

// Safe recovery if the astronaut gets stuck: back inside the lander. Position only;
// it completes no objectives, gives no rewards and does not change cabin or suit state.
document.getElementById("recoverButton").addEventListener("click", () => {
  if (!marsScene) return;
  const outcome = marsScene.recoverToLander();
  document.getElementById("recoverMessage").textContent = outcome.message;
});

window.missionTrainer = Object.freeze({
  suitIntegration: Object.freeze({ register: eva.register, notifyChanged: eva.notifyChanged }),
  state: missionState, triggerEmergency, resolveEmergency, lobby, shop, marsSceneFactory: MarsScene,
  startLaunchSequence: beginLaunchSequence,
  get activeScene() { return activeScene; },
  get marsScene() { return marsScene; },
  get selectedClass() { return selectedClass; },
  equipClass,
  get missionClock() { return missionClock.snapshot(); },
  get missionOutcome() { return MissionOutcome.evaluate(missionState, MissionModel.EMERGENCY_CONFIG); },
  graphics: Object.freeze({
    get level() { return graphicsLevel; },
    setLevel: setGraphicsLevel,
    get pixelRatio() { return graphicsPixelRatio(); },
    get renderSize() { return [engine.getRenderWidth(), engine.getRenderHeight()]; },
    get fps() { return fpsAverage; },
  }),
  setMarsTimeOverride(value) {
    marsTimeOverride = parseMarsTime(value === null ? null : String(value));
    return marsTimeOverride;
  },
});
if (DEV_TOOLS) {
  window.missionTrainerDev = Object.freeze({ clock: missionClock, render: renderMissionState, missionOne, marsEnv });
}
renderMissionState();
const requestedEmergency = new URLSearchParams(window.location.search).get("emergency");
if (requestedEmergency) triggerEmergency(requestedEmergency);
