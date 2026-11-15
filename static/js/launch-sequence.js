(function (root) {
  "use strict";

  const stages = [
    ["briefing", "Mission briefing", "Destination: Mars. Your crew assignment is confirmed; mission control is ready."],
    ["launch", "Launch from Earth", "Main engines are firing. The spacecraft is clearing the launch tower."],
    ["cruise", "Journey to Mars", "Cruise trajectory confirmed. Mars is in view; preparing for descent."],
    ["landing", "Landing on Mars", "Descent engines are slowing the spacecraft. Touchdown confirmed."],
  ];
  const DEFAULT_STAGE_DURATION = 2200;

  function create(onComplete) {
    const overlay = document.getElementById("launchSequence");
    const skip = document.getElementById("skipCutscene");
    const progress = document.getElementById("launchProgress");
    const progressBar = progress.parentElement;
    const stageSteps = [...overlay.querySelectorAll("[data-stage-step]")];
    let timer = null;
    let running = false;
    let stage = 0;
    let stageDuration = DEFAULT_STAGE_DURATION;

    function finish() {
      if (!running) return;
      running = false;
      clearTimeout(timer);
      onComplete();
      overlay.hidden = true;
    }

    function showStage() {
      if (!running) return;
      const [id, title, description] = stages[stage];
      const percentage = Math.round(((stage + 1) / stages.length) * 100);
      overlay.dataset.stage = id;
      document.getElementById("launchStage").textContent = `0${stage + 1} / 04`;
      document.getElementById("launchHeading").textContent = title;
      document.getElementById("launchDescription").textContent = description;
      progress.style.width = `${percentage}%`;
      progressBar.setAttribute("aria-valuenow", String(percentage));
      stageSteps.forEach((step, index) => {
        step.classList.toggle("is-current", index === stage);
        step.classList.toggle("is-complete", index < stage);
      });
      timer = setTimeout(() => {
        stage += 1;
        if (stage === stages.length) finish();
        else showStage();
      }, stageDuration);
    }

    skip.addEventListener("click", finish);

    return {
      start(role) {
        if (running) return;
        running = true;
        stage = 0;
        document.getElementById("launchRole").textContent = `Crew assignment: ${role}`;
        overlay.hidden = false;
        showStage();
        skip.focus();
      },
      get running() { return running; },
      /** Stage length in ms (default 2200). Only the recording showcase shortens it. */
      setStageDuration(ms) { stageDuration = Number.isFinite(ms) && ms >= 200 ? ms : DEFAULT_STAGE_DURATION; },
    };
  }

  root.LaunchSequence = Object.freeze({ create });
})(globalThis);
