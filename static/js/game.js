
const canvas = document.getElementById("renderCanvas");
const missionState = MissionModel.createMissionState();

const engine = new BABYLON.Engine(canvas, true);

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.65, 0.33, 0.22, 1);

// Camera
const camera = new BABYLON.UniversalCamera(
  "astronautCamera",
  new BABYLON.Vector3(0, 2, -12),
  scene
);

camera.setTarget(new BABYLON.Vector3(0, 1, 0));
camera.attachControl(canvas, true);
camera.speed = 0.3;
camera.keysUp.push(87);
camera.keysDown.push(83);
camera.keysLeft.push(65);
camera.keysRight.push(68);

// Lighting
const sun = new BABYLON.HemisphericLight(
  "sun",
  new BABYLON.Vector3(0, 1, 0),
  scene
);
sun.intensity = 1.2;

// Martian ground
const ground = BABYLON.MeshBuilder.CreateGround(
  "marsTerrain",
  { width: 120, height: 120 },
  scene
);

const marsMaterial = new BABYLON.StandardMaterial("marsSoil", scene);
marsMaterial.diffuseColor = new BABYLON.Color3(0.56, 0.23, 0.13);
ground.material = marsMaterial;

// Simple habitat
const habitat = BABYLON.MeshBuilder.CreateCylinder(
  "marsHabitat",
  { diameter: 8, height: 4, tessellation: 32 },
  scene
);

habitat.position = new BABYLON.Vector3(0, 2, 12);

const habitatMaterial = new BABYLON.StandardMaterial("habitatPaint", scene);
habitatMaterial.diffuseColor = new BABYLON.Color3(0.82, 0.84, 0.88);
habitat.material = habitatMaterial;

// Basic collisions and gravity
scene.collisionsEnabled = true;
camera.checkCollisions = true;
camera.applyGravity = true;
camera.ellipsoid = new BABYLON.Vector3(0.5, 1, 0.5);
scene.gravity = new BABYLON.Vector3(0, -0.15, 0);
ground.checkCollisions = true;
habitat.checkCollisions = true;

// Render loop
engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});

const resourceDisplays = {
  oxygen: document.getElementById("oxygenDisplay"),
  water: document.getElementById("waterDisplay"),
  food: document.getElementById("foodDisplay"),
  power: document.getElementById("powerDisplay"),
  batteryReserve: document.getElementById("batteryReserveDisplay"),
  oxygenReserve: document.getElementById("oxygenReserveDisplay"),
  waterReserve: document.getElementById("waterReserveDisplay"),
  crewHealth: document.getElementById("crewHealthDisplay"),
  crewComfort: document.getElementById("crewComfortDisplay"),
};

const emergencyModalElement = document.getElementById("emergencyModal");
const emergencyModal = new bootstrap.Modal(emergencyModalElement);
const emergencyTitle = document.getElementById("emergencyTitle");
const emergencyChoices = document.getElementById("emergencyChoices");
const emergencyResult = document.getElementById("emergencyResult");
const emergencyClose = document.getElementById("emergencyClose");

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function renderMissionState() {
  document.getElementById("solDisplay").textContent = `Sol ${missionState.sol} / ${missionState.maxSol}`;
  Object.entries(resourceDisplays).forEach(([resource, element]) => {
    element.textContent = formatPercent(missionState.resources[resource]);
  });

  document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
    const emergencyState = missionState.emergencies[button.dataset.triggerEmergency];
    button.disabled = Boolean(emergencyState);
  });
}

function resolveEmergency(emergencyId, choiceId) {
  const outcome = MissionModel.resolveEmergency(missionState, emergencyId, choiceId);
  if (!outcome.applied) {
    return;
  }

  emergencyChoices.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  emergencyResult.textContent = outcome.result;
  emergencyResult.classList.remove("d-none");
  emergencyClose.classList.remove("d-none");
  renderMissionState();
}

function triggerEmergency(emergencyId) {
  const emergency = MissionModel.EMERGENCY_CONFIG[emergencyId];
  if (!emergency || !MissionModel.triggerEmergency(missionState, emergencyId)) {
    return false;
  }

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
  emergencyModal.show();
  return true;
}

document.querySelectorAll("[data-trigger-emergency]").forEach((button) => {
  button.addEventListener("click", () => triggerEmergency(button.dataset.triggerEmergency));
});

window.missionTrainer = Object.freeze({
  state: missionState,
  triggerEmergency,
  resolveEmergency,
});

renderMissionState();

const requestedEmergency = new URLSearchParams(window.location.search).get("emergency");
if (requestedEmergency) {
  triggerEmergency(requestedEmergency);
}
