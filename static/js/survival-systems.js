(function () {
  "use strict";

  const PLAYER_ID = "player";
  const RESOURCE_LABELS = Object.freeze({
    oxygen: "Oxygen",
    water: "Water",
    food: "Food",
    power: "Power",
  });
  const state = window.missionTrainer.state;
  const panel = document.getElementById("missionPanel");
  const solDisplay = document.getElementById("solDisplay");
  const phaseBadge = document.getElementById("phaseBadge");
  const phaseTimeDisplay = document.getElementById("phaseTimeDisplay");
  const solTimeDisplay = document.getElementById("solTimeDisplay");
  const resourceWarnings = document.getElementById("resourceWarnings");
  const fatigueDisplay = document.getElementById("fatigueDisplay");
  const fatigueBar = document.getElementById("fatigueBar");
  const fatigueProgress = fatigueBar.closest('[role="progressbar"]');
  const sleepToggleButton = document.getElementById("sleepToggleButton");
  const crewSleepStatus = document.getElementById("crewSleepStatus");
  const missionStatus = document.getElementById("missionStatus");
  const resourceCards = [...document.querySelectorAll("[data-resource-card]")];
  let intervalId = null;
  let lastFrameTime = 0;

  function formatTime(seconds) {
    const remaining = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(remaining / 60);
    const secondsInMinute = remaining % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secondsInMinute).padStart(2, "0")}`;
  }

  function renderWarnings() {
    resourceWarnings.replaceChildren();
    const warnings = MissionModel.getResourceWarnings(state);
    warnings.forEach(({ resource, value, severity }) => {
      const alert = document.createElement("div");
      alert.className = `alert alert-${severity === "critical" ? "danger" : "warning"} py-2 px-2 mb-2`;
      alert.setAttribute("role", "alert");
      alert.textContent = `${severity === "critical" ? "CRITICAL" : "WARNING"}: ${RESOURCE_LABELS[resource]} is ${Math.round(value)}%.`;
      resourceWarnings.appendChild(alert);
    });
  }

  function renderResources() {
    resourceCards.forEach((card) => {
      const resource = card.dataset.resourceCard;
      const value = state.resources[resource];
      const roundedValue = Math.round(value);
      const progress = card.querySelector('[role="progressbar"]');
      const bar = card.querySelector("[data-resource-bar]");
      card.querySelector("strong").textContent = `${value.toFixed(1)}%`;
      progress.setAttribute("aria-valuenow", String(roundedValue));
      bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
      bar.classList.toggle("bg-success", value > MissionModel.RESOURCE_WARNING_THRESHOLD);
      bar.classList.toggle(
        "bg-warning",
        value <= MissionModel.RESOURCE_WARNING_THRESHOLD
          && value > MissionModel.RESOURCE_CRITICAL_THRESHOLD,
      );
      bar.classList.toggle("bg-danger", value <= MissionModel.RESOURCE_CRITICAL_THRESHOLD);
    });
    renderWarnings();
  }

  function pause() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function render() {
    const clock = MissionModel.getMissionClock(state);
    const player = state.crew.find((member) => member.id === PLAYER_ID);
    const sleepingCount = state.crew.filter((member) => member.isAsleep).length;
    const fatigue = player ? player.fatigue : MissionModel.getAverageFatigue(state);
    solDisplay.textContent = `Sol ${state.sol} / ${state.maxSol}`;
    phaseBadge.textContent = clock.phase.toUpperCase();
    phaseBadge.className = `badge rounded-pill ${clock.phase === "day" ? "text-bg-warning" : "text-bg-primary"}`;
    phaseTimeDisplay.textContent = formatTime(clock.phaseTimeRemaining);
    solTimeDisplay.textContent = formatTime(clock.solTimeRemaining);
    sleepToggleButton.disabled = state.missionComplete || !player;
    sleepToggleButton.textContent = player && player.isAsleep ? "Wake up" : "Go to sleep";
    crewSleepStatus.textContent = `${player && player.isAsleep ? "You are asleep" : "You are awake"}. Sleeping crew: ${sleepingCount} / ${state.crew.length}`;
    fatigueDisplay.textContent = `${fatigue.toFixed(1)}%`;
    fatigueBar.style.width = `${fatigue}%`;
    fatigueBar.className = `progress-bar ${fatigue >= 90 ? "bg-danger" : fatigue >= 75 ? "bg-warning" : "bg-info"}`;
    fatigueProgress.setAttribute("aria-valuenow", String(Math.round(fatigue)));
    renderResources();

    if (state.missionComplete) {
      missionStatus.textContent = "The 90-sol mission is complete.";
      pause();
    }
  }

  function tick() {
    const now = performance.now();
    const elapsedSeconds = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    MissionModel.advanceMissionTime(state, elapsedSeconds);
    const clock = MissionModel.getMissionClock(state);
    if (clock.phase === "night" && MissionModel.areAllCrewAsleep(state)) {
      const result = MissionModel.skipRemainingNight(state);
      if (result.skipped) {
        missionStatus.textContent = `Night skipped (${result.secondsSkipped} seconds): all crew members are asleep.`;
      }
    }
    render();
  }

  function start() {
    if (intervalId !== null || state.missionComplete) return;
    lastFrameTime = performance.now();
    intervalId = window.setInterval(tick, 100);
    missionStatus.textContent = "Survival simulation active.";
    render();
  }

  document.getElementById("beginTrainingButton").addEventListener("click", () => {
    panel.classList.remove("d-none");
    start();
  });

  sleepToggleButton.addEventListener("click", () => {
    const player = state.crew.find((member) => member.id === PLAYER_ID);
    if (!player) {
      throw new Error("The current astronaut is missing from the mission crew.");
    }
    MissionModel.setCrewAsleep(state, PLAYER_ID, !player.isAsleep);
    const clock = MissionModel.getMissionClock(state);
    if (clock.phase === "night" && MissionModel.areAllCrewAsleep(state)) {
      const result = MissionModel.skipRemainingNight(state);
      if (result.skipped) {
        missionStatus.textContent = `Night skipped (${result.secondsSkipped} seconds): all crew members are asleep.`;
      }
    } else {
      missionStatus.textContent = player.isAsleep
        ? "You are asleep. Fatigue recovers while you rest."
        : "You are awake. Fatigue increases while you are active.";
    }
    render();
  });

  window.survivalSystems = Object.freeze({
    state,
    start,
    pause,
    setCrewMembers(crewIds) {
      MissionModel.setCrewMembers(state, crewIds);
      render();
    },
    setCrewAsleep(crewId, isAsleep) {
      const member = MissionModel.setCrewAsleep(state, crewId, isAsleep);
      const clock = MissionModel.getMissionClock(state);
      if (clock.phase === "night" && MissionModel.areAllCrewAsleep(state)) {
        const result = MissionModel.skipRemainingNight(state);
        if (result.skipped) {
          missionStatus.textContent = `Night skipped (${result.secondsSkipped} seconds): all crew members are asleep.`;
        }
      }
      render();
      return member;
    },
  });
  render();
})();
