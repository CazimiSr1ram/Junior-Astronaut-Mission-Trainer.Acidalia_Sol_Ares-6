(function () {
  "use strict";

  // Developer-only mission clock panel. Served only when JAMT_DEV_TOOLS=1, and
  // inert unless game.js exposed window.missionTrainerDev (also dev-only).
  const dev = window.missionTrainerDev;
  const panel = document.getElementById("devPanel");
  if (!dev || !panel) return;

  const { clock } = dev;
  const PLAYER_ID = "player";
  const readout = document.getElementById("devClockReadout");
  const body = document.getElementById("devPanelBody");
  const toggle = document.getElementById("devPanelToggle");
  const scaleButtons = document.getElementById("devScaleButtons");
  const actionButtons = [...panel.querySelectorAll("[data-dev-action]")];

  function seconds(value) {
    return `${value.toFixed(1)} s`;
  }

  function signed(value) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  }

  function describeSkip(skip) {
    if (!skip) return "None yet";
    return `Sol ${skip.fromSol} ${seconds(skip.fromElapsedSeconds)} → Sol ${skip.toSol} ${seconds(skip.toElapsedSeconds)} `
      + `(${seconds(skip.seconds)}): ${skip.reason}`;
  }

  function render() {
    const s = clock.snapshot();
    const state = !s.started ? "Not started (lobby / cutscene)" : s.missionComplete ? (window.missionTrainer.state.failure ? "Mission failed" : "Mission over")
      : s.paused ? "Paused (panel open)" : "Running";
    const rates = Object.entries(s.ratesPerSol).map(([name, value]) => `${name} ${signed(value)}`).join(" · ");
    const multipliers = Object.entries(s.rateMultipliers)
      .filter(([, value]) => value !== 1).map(([name, value]) => `${name} ×${value}`).join(" · ") || "all ×1";
    const rows = [
      ["Clock", state],
      ["Sol", `${s.sol} / ${s.maxSol}`],
      ["Phase", s.phase === "day" ? "Day" : s.phase === "night" ? "Night" : "Complete"],
      ["Elapsed in sol", `${seconds(s.elapsedInSol)} / ${s.solSeconds} s`],
      ["Next phase in", seconds(s.secondsToNextPhase)],
      ["Sol cycle", `${s.daySeconds} s day + ${s.nightSeconds} s night`],
      ["Time scale", `×${s.timeScale}`],
      ["Real time running", seconds(s.realSecondsRunning)],
      ["Net change / sol (%)", rates],
      ["Rate multipliers", multipliers],
      ["Players connected", `${s.crewTotal} (solo; networked multiplayer not implemented)`],
      ["Players sleeping", `${s.crewAsleep} / ${s.crewTotal}`],
      ["Last sol skip", describeSkip(s.lastSkip)],
      ["Report deadline", "Not implemented (Earth mission reports are a Phase 5 feature)"],
    ];
    readout.replaceChildren(...rows.flatMap(([term, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }));
    scaleButtons.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.scale) === s.timeScale);
    });
    actionButtons.forEach((button) => { button.disabled = !s.started || s.missionComplete; });
  }

  clock.DEV_TIME_SCALES.forEach((scale) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-light";
    button.dataset.scale = String(scale);
    button.textContent = `×${scale}`;
    button.addEventListener("click", () => {
      clock.setTimeScale(scale);
      button.blur();
      render();
    });
    scaleButtons.appendChild(button);
  });

  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.devAction;
      if (action === "phase") clock.skipToNextPhase();
      else if (action === "sol1") clock.advanceSols(1);
      else if (action === "sol5") clock.advanceSols(5);
      else if (action === "sleep") {
        const me = window.missionTrainer.state.crew.find((member) => member.id === PLAYER_ID);
        if (me) clock.setCrewAsleep(PLAYER_ID, !me.isAsleep);
      }
      button.blur();
      dev.render();
      render();
    });
  });

  function setCollapsed(collapsed) {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  toggle.addEventListener("click", () => {
    setCollapsed(!body.hidden);
    toggle.blur();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "F9") {
      event.preventDefault();
      panel.hidden = !panel.hidden;
    }
  });

  render();
  window.setInterval(render, 250);
})();
