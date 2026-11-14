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
const classModalElement = document.getElementById("classSelectionModal");
const classModal = new bootstrap.Modal(classModalElement);
const missionTerminalModal = new bootstrap.Modal(document.getElementById("missionTerminalModal"));
const launchModal = new bootstrap.Modal(document.getElementById("launchModal"));
const settingsModalElement = document.getElementById("settingsModal");
const settingsModal = new bootstrap.Modal(settingsModalElement);
let selectedClass = "Intern";
let gameStarted = false;
let modalOpen = false;
let lobby;
let hadPointerLock = false;

function setLobbyControls(enabled) {
  lobby?.setControlsEnabled(enabled && gameStarted && !modalOpen);
}

function showModal(modal) {
  modalOpen = true;
  setLobbyControls(false);
  document.exitPointerLock?.();
  modal.show();
}

lobby = LobbyScene.create(engine, canvas, {
  onInteractionChange(interaction) {
    interactionHint.classList.toggle("d-none", !interaction);
    if (interaction) interactionHintText.textContent = `Use ${interaction.label}`;
  },
  onMissionTerminal() { showModal(missionTerminalModal); },
  onRoleTerminal() { showModal(classModal); },
  onLaunchTerminal() { showModal(launchModal); },
});
lobby.setControlsEnabled(false);

document.querySelectorAll(".modal").forEach((element) => {
  element.addEventListener("shown.bs.modal", () => {
    modalOpen = true;
    setLobbyControls(false);
  });
  element.addEventListener("hidden.bs.modal", () => {
    modalOpen = document.querySelector(".modal.show") !== null;
    setLobbyControls(!modalOpen);
  });
});

document.getElementById("soloMissionButton").addEventListener("click", () => showModal(classModal));
document.querySelectorAll("[data-class]").forEach((card) => {
  card.addEventListener("click", () => {
    selectedClass = card.dataset.class;
    document.querySelectorAll("[data-class]").forEach((candidate) => {
      const selected = candidate === card;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-checked", String(selected));
    });
  });
});

document.getElementById("beginTrainingButton").addEventListener("click", () => {
  document.getElementById("currentClassDisplay").textContent = selectedClass;
  mainMenu.classList.add("is-hidden");
  lobbyHud.classList.remove("d-none");
  controlsHint.classList.remove("d-none");
  gameStarted = true;
  classModal.hide();
  canvas.focus();
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
  lobby.camera.angularSensibility = Number(event.target.value);
});
document.getElementById("shadowsToggle").addEventListener("change", (event) => {
  lobby.scene.shadowsEnabled = event.target.checked;
});

engine.runRenderLoop(() => lobby.scene.render());
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
  state: missionState, triggerEmergency, resolveEmergency, lobby, marsSceneFactory: MarsScene,
  get selectedClass() { return selectedClass; },
});
renderMissionState();
const requestedEmergency = new URLSearchParams(window.location.search).get("emergency");
if (requestedEmergency) triggerEmergency(requestedEmergency);
