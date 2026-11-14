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

function setGameplayControls(enabled) {
  const shouldEnable = enabled && gameStarted && !modalOpen;
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
    description.textContent = price
      ? `${price.specialty} · Bonus not implemented yet`
      : "Starting class · Always available";
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
        selectedClass = name;
        currentClassDisplay.textContent = selectedClass;
        setClassShopMessage(`${name} equipped. Specialist bonuses are not implemented yet.`);
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

function enterTrainingLobby() {
  if (gameStarted) return;
  selectedClass = "Intern";
  currentClassDisplay.textContent = selectedClass;
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

// Placeholder lander terminals: read-only views of the existing mission state.
function openLanderTerminal(id) {
  const resources = missionState.resources;
  const rows = id === "lander-supply-terminal"
    ? [["Oxygen", resources.oxygen], ["Oxygen reserve", resources.oxygenReserve], ["Water", resources.water],
      ["Water reserve", resources.waterReserve], ["Food", resources.food], ["Power", resources.power],
      ["Battery reserve", resources.batteryReserve]].map(([name, value]) => [name, `${Math.round(value)}%`])
    : [["Sol", `${missionState.sol} / ${missionState.maxSol}`], ["Phase", MissionModel.getMissionClock(missionState).phase],
      ["Crew health", `${Math.round(resources.crewHealth)}%`],
      ["Active emergencies", Object.entries(missionState.emergencies).filter(([, e]) => e.status === "active").map(([key]) => key).join(", ") || "None"]];
  marsTerminalTitle.textContent = id === "lander-supply-terminal" ? "Oxygen & Supplies Terminal" : "Mission Terminal";
  marsTerminalReadout.replaceChildren(...rows.flatMap(([name, value]) => {
    const term = document.createElement("dt");
    term.textContent = name;
    const detail = document.createElement("dd");
    detail.textContent = value;
    return [term, detail];
  }));
  marsTerminalNote.textContent = id === "lander-supply-terminal"
    ? "Placeholder terminal: shows current life-support levels only. Resupply and suit oxygen refills are not implemented yet."
    : "Placeholder terminal: shows current mission status only. Mission objectives and Earth reports are not implemented yet.";
  showModal(marsTerminalModal);
}

const marsCallbacks = {
  onInteractionChange(interaction) {
    interactionHint.classList.toggle("d-none", !interaction);
    if (interaction) interactionHintText.textContent = interaction.label;
  },
  onInteract(id) {
    if (id === "lander-supply-terminal" || id === "lander-mission-terminal") openLanderTerminal(id);
  },
  onSafeZoneChange(safe) {
    safeZoneBadge.classList.toggle("d-none", !safe);
    locationDisplay.textContent = safe ? "Lander · Home Base" : "Mars Surface";
  },
};

function arriveOnMars() {
  if (!marsScene) {
    marsScene = MarsScene.create(engine, canvas, marsCallbacks);
  }
  lobby.setControlsEnabled(false);
  activeScene = marsScene.scene;
  missionClock.start();
  locationType.textContent = "MISSION LOCATION";
  locationDisplay.textContent = marsScene.inSafeZone ? "Lander · Home Base" : "Mars Surface";
  safeZoneBadge.classList.toggle("d-none", !marsScene.inSafeZone);
  missionPanel.classList.remove("d-none");
  document.body.classList.add("mars-active");
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
  } else if (hadPointerLock && gameStarted && !modalOpen) {
    hadPointerLock = false;
    showModal(settingsModal);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && gameStarted && !document.querySelector(".modal.show")) showModal(settingsModal);
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
    dustStorm: missionState.emergencies.dustStorm?.status === "active",
  };
}

let lastFrameTime = performance.now();
let lastMissionHudRender = 0;

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
  if (marsScene && activeScene === marsScene.scene) marsScene.setEnvironment(marsEnvironmentInput());
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
const emergencyTitle = document.getElementById("emergencyTitle");
const emergencyChoices = document.getElementById("emergencyChoices");
const emergencyResult = document.getElementById("emergencyResult");
const emergencyClose = document.getElementById("emergencyClose");

function renderMissionState() {
  const phase = MissionModel.getMissionClock(missionState).phase;
  document.getElementById("solDisplay").textContent =
    `Sol ${missionState.sol} / ${missionState.maxSol} · ${phase === "complete" ? "Mission complete" : phase === "day" ? "Day" : "Night"}`;
  Object.entries(resourceDisplays).forEach(([resource, element]) => { element.textContent = `${Math.round(missionState.resources[resource])}%`; });
  document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
    button.disabled = Boolean(missionState.emergencies[button.dataset.triggerEmergency]);
  });
}

function resolveEmergency(emergencyId, choiceId) {
  const solBefore = missionState.sol;
  const elapsedBefore = missionState.elapsedSeconds;
  const outcome = MissionModel.resolveEmergency(missionState, emergencyId, choiceId);
  if (!outcome.applied) return outcome;
  missionClock.recordExternalJump(solBefore, elapsedBefore, `Emergency decision: ${emergencyId} → ${choiceId}`);
  emergencyChoices.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  emergencyResult.textContent = outcome.result;
  emergencyResult.classList.remove("d-none");
  emergencyClose.classList.remove("d-none");
  renderMissionState();
  return outcome;
}

function triggerEmergency(emergencyId) {
  const emergency = MissionModel.EMERGENCY_CONFIG[emergencyId];
  if (!emergency || !MissionModel.triggerEmergency(missionState, emergencyId)) return false;
  emergencyTitle.textContent = emergency.title;
  emergencyChoices.replaceChildren();
  emergencyResult.classList.add("d-none");
  emergencyResult.textContent = "";
  emergencyClose.classList.add("d-none");
  Object.entries(emergency.choices).forEach(([choiceId, choice]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-light text-start";
    button.textContent = choice.label;
    button.addEventListener("click", () => resolveEmergency(emergencyId, choiceId), { once: true });
    emergencyChoices.appendChild(button);
  });
  renderMissionState();
  showModal(emergencyModal);
  return true;
}

document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
  button.addEventListener("click", () => triggerEmergency(button.dataset.triggerEmergency));
});

window.missionTrainer = Object.freeze({
  state: missionState, triggerEmergency, resolveEmergency, lobby, shop, marsSceneFactory: MarsScene,
  startLaunchSequence: beginLaunchSequence,
  get activeScene() { return activeScene; },
  get marsScene() { return marsScene; },
  get selectedClass() { return selectedClass; },
  get missionClock() { return missionClock.snapshot(); },
  setMarsTimeOverride(value) {
    marsTimeOverride = parseMarsTime(value === null ? null : String(value));
    return marsTimeOverride;
  },
});
if (DEV_TOOLS) {
  window.missionTrainerDev = Object.freeze({ clock: missionClock, render: renderMissionState });
}
renderMissionState();
const requestedEmergency = new URLSearchParams(window.location.search).get("emergency");
if (requestedEmergency) triggerEmergency(requestedEmergency);