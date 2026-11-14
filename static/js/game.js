"use strict";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
const missionState = MissionModel.createMissionState();
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

function arriveOnMars() {
  if (!marsScene) {
    marsScene = MarsScene.create(engine, canvas);
  }
  lobby.setControlsEnabled(false);
  activeScene = marsScene.scene;
  locationType.textContent = "MISSION LOCATION";
  locationDisplay.textContent = "Mars Surface";
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

engine.runRenderLoop(() => activeScene.render());
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
  document.getElementById("solDisplay").textContent = `Sol ${missionState.sol} / ${missionState.maxSol}`;
  Object.entries(resourceDisplays).forEach(([resource, element]) => { element.textContent = `${Math.round(missionState.resources[resource])}%`; });
  document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
    button.disabled = Boolean(missionState.emergencies[button.dataset.triggerEmergency]);
  });
}

function resolveEmergency(emergencyId, choiceId) {
  const outcome = MissionModel.resolveEmergency(missionState, emergencyId, choiceId);
  if (!outcome.applied) return outcome;
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
});
renderMissionState();
const requestedEmergency = new URLSearchParams(window.location.search).get("emergency");
if (requestedEmergency) triggerEmergency(requestedEmergency);
