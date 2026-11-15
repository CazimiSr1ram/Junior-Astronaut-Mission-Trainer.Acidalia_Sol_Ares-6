"use strict";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
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

function setGameplayControls(enabled) {
  const shouldEnable = enabled && gameStarted && !modalOpen && !endingShown;
  if (activeScene === marsScene?.scene) {
    marsScene.setControlsEnabled(shouldEnable);
  } else {
    lobby?.setControlsEnabled(shouldEnable);
  }
}

function showModal(modal) {
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

function beginLaunchSequence() {
  if (!gameStarted || launchSequence.running || activeScene !== lobby.scene) return;
  modalOpen = true;
  setGameplayControls(false);
  document.exitPointerLock?.();
  launchSequence.start(selectedClass);
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
const objectiveTracker = document.getElementById("objectiveTracker");
const objectiveList = document.getElementById("objectiveList");
const objectiveStatus = document.getElementById("objectiveStatus");
const objectiveHeading = document.getElementById("objectiveHeading");
const commsLog = document.getElementById("commsLog");
const missionOne = MissionOne.create(missionState);
let lastPanelKey = "";

function marsEnv() {
  if (!marsScene) return { insideCabin: false, onSurface: false };
  const position = marsScene.astronautPosition;
  return {
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
  const pressurisedHere = env.insideCabin && progress.cabin === "pressurized" && !progress.hatchOpen;
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
    extras.push(["next-mission", `Next: ${next.title} — coming soon.`]);
    extras.push(["", "Standing orders: keep oxygen, water, food and power above 0% until Sol 90 and respond to alerts (R)."]);
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
    case "lifeSupport":
      return {
        title: "Oxygen & Supplies Terminal",
        rows: rowsOf([["Oxygen", r.oxygen], ["Oxygen reserve", r.oxygenReserve], ["Water", r.water], ["Water reserve", r.waterReserve],
          ["Food", r.food], ["Power", r.power], ["Battery reserve", r.batteryReserve]]),
        note: "Readings come from the shared mission state. Resupply and suit refills are not implemented yet.",
        actions: [step("lifeSupport", "Run life-support check", () => missionOne.checkLifeSupport())],
      };
    case "pressure":
      return {
        title: "Cabin Pressure Panel",
        rows: [["Cabin pressure", `${missionOne.cabinPressureKpa().toFixed(1)} kPa (simulated)`], ["Cabin", cabinText()],
          ["Hatch", progress.hatchOpen ? "Open" : "Closed"], ["Habitat oxygen supply", `${Math.round(r.oxygen)}%`],
          ["Mars surface", "about 0.6 kPa, mostly CO₂"]],
        note: "Earth's sea-level pressure is about 101 kPa. The simulated cabin uses that value.",
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
          ["Suit oxygen", "100% (simulated)"], ["Suit integrity", "100% (simulated)"]],
        note: "Suit oxygen and integrity are fixed placeholders until suit systems are added. Press H to seal or remove the helmet.",
        actions: [
          step("suit", "Put on EVA suit", () => missionOne.donSuit(marsEnv()), {
            enabled: !progress.suitOn && (current === "suit" || missionOne.isDone("suit")),
            reason: progress.suitOn ? "Already wearing the suit." : undefined,
          }),
          step("suit", "Run suit check", () => missionOne.suitCheck(), {
            enabled: current === "suit" && progress.suitOn,
            reason: missionOne.isDone("suit") ? "Already completed." : !progress.suitOn ? "Put on the suit first." : undefined,
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
        })],
      };
    }
  }
}

function renderMarsPanel(kind) {
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
});

const marsCallbacks = {
  onInteractionChange(interaction) {
    interactionHint.classList.toggle("d-none", !interaction);
    if (interaction) interactionHintText.textContent = interaction.id === "lander-airlock" ? airlockPrompt() : interaction.label;
  },
  onInteract(id, interaction) {
    if (interaction?.surveyMarker) handleMissionResult(missionOne.inspectMarker(id));
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
  }
  lobby.setControlsEnabled(false);
  activeScene = marsScene.scene;
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
  onLaunchTerminal: beginLaunchSequence,
});
lobby.setControlsEnabled(false);
activeScene = lobby.scene;
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
  if (gameStarted && !modalOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
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
  if (event.code === "Escape" && gameStarted && !endingShown && !document.querySelector(".modal.show")) showModal(settingsModal);
  // H seals or removes the EVA helmet (blocked outside the closed, pressurised cabin).
  if (event.code === "KeyH" && !event.repeat && gameStarted && !modalOpen && !endingShown && marsScene && activeScene === marsScene.scene) {
    handleMissionResult(missionOne.toggleHelmet(marsEnv()));
  }
});
document.getElementById("lookSensitivity").addEventListener("input", (event) => {
  const camera = activeScene === marsScene?.scene ? marsScene.camera : lobby.camera;
  camera.angularSensibility = Number(event.target.value);
});
document.getElementById("shadowsToggle").addEventListener("change", (event) => {
  activeScene.shadowsEnabled = event.target.checked;
});

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
let lastMissionHudRender = 0;
let lastMissionWorldSync = 0;

engine.runRenderLoop(() => {
  const now = performance.now();
  const realSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  // The clock pauses while any panel/modal (pause menu, emergencies, terminals) is open.
  missionClock.setPaused(modalOpen || document.hidden);
  if (missionClock.tick(realSeconds) && now - lastMissionHudRender > 250) {
    lastMissionHudRender = now;
    renderMissionState();
  }
  if (missionState.missionComplete && gameStarted && !endingShown) showMissionEnding();
  if (marsScene && activeScene === marsScene.scene) {
    marsScene.setEnvironment(marsEnvironmentInput());
    // Mission 1 timed steps (cabin cycles, report reply) pause with the rest of the game.
    if (!modalOpen && !document.hidden) {
      missionOne.tick(Math.min(realSeconds, 0.25), marsEnv()).forEach(handleMissionResult);
      if (!endingShown) updateExposure();
      if (now - lastMissionWorldSync > 250) {
        lastMissionWorldSync = now;
        renderObjectives();
        syncMissionWorld();
      }
    }
  }
  activeScene.render();
});
window.addEventListener("resize", () => engine.resize());

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
const askAridalButton = document.getElementById("askAridalButton");
const aridalReply = document.getElementById("aridalReply");
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
  aridalReply.classList.add("d-none");
  aridalReply.textContent = "";
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
      text: "Alarm received on Earth. Our messages take minutes to reach you, so act on your onboard checklist and Aridal's guidance.",
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

// Onboard AI guidance: immediate, advisory only. Game outcomes are calculated
// by the mission system, never by the AI reply.
askAridalButton.addEventListener("click", async () => {
  if (!openEmergencyId) return;
  const emergency = MissionModel.EMERGENCY_CONFIG[openEmergencyId];
  const alert = MissionModel.getEmergencyAlert(missionState, openEmergencyId);
  const available = MissionModel.getAvailableChoices(missionState, openEmergencyId);
  const r = missionState.resources;
  const question = [
    `Emergency: ${emergency.title} (game alert level: ${alert ? MissionModel.ALERT_LEVELS[alert.level].label : "resolved"}).`,
    `Situation: ${emergency.briefing.join(" ")}`,
    `Resources: oxygen ${Math.round(r.oxygen)}%, water ${Math.round(r.water)}%, food ${Math.round(r.food)}%, power ${Math.round(r.power)}%, oxygen reserve ${Math.round(r.oxygenReserve)}%, water reserve ${Math.round(r.waterReserve)}%, battery reserve ${Math.round(r.batteryReserve)}%.`,
    `Options: ${available.map((id) => `${emergency.choices[id].label} (${emergency.choices[id].risk})`).join(" ")}`,
    "Which option would you choose and why? Answer in two or three short sentences.",
  ].join("\n");
  askAridalButton.disabled = true;
  aridalReply.classList.remove("d-none");
  aridalReply.textContent = "Aridal is thinking…";
  try {
    const response = await fetch("/api/aridal/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question }),
    });
    const data = await response.json();
    aridalReply.textContent = `Aridal (onboard AI, advisory only — check the predicted outcomes): ${data.reply || data.error || "No reply."}`;
  } catch {
    aridalReply.textContent = "Aridal could not be reached. Use the predicted outcomes on each option.";
  } finally {
    askAridalButton.disabled = false;
  }
});

document.getElementById("emergencyModal").addEventListener("hidden.bs.modal", () => { openEmergencyId = null; });
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyR" || event.repeat || !gameStarted || modalOpen || endingShown) return;
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
  state: missionState, triggerEmergency, resolveEmergency, lobby, shop, marsSceneFactory: MarsScene,
  startLaunchSequence: beginLaunchSequence,
  get activeScene() { return activeScene; },
  get marsScene() { return marsScene; },
  get selectedClass() { return selectedClass; },
  equipClass,
  get missionClock() { return missionClock.snapshot(); },
  get missionOutcome() { return MissionOutcome.evaluate(missionState, MissionModel.EMERGENCY_CONFIG); },
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