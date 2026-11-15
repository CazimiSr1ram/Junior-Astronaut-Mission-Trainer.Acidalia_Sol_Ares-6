/* Checklist progression only. Emergency choices and all balance stay in MissionModel. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResearchMissions = api;
})(globalThis, function () {
  "use strict";
  const STEPS = {
    oxygenEmergency: ["Stabilise oxygen", "Repair the generator (use existing emergency choices)", "Confirm oxygen production", "Check cabin atmosphere", "Send report to Earth"],
    dustStormMission: ["Secure outdoor equipment before the storm", "Choose and review the power plan", "Check battery reserves", "Stay sheltered until the storm passes", "Inspect solar panels after the storm", "Send report to Earth"],
  };
  function create(state, model) {
    const result = (ok, text) => ({ ok, lines: [{ speaker: "Mission Control", text }] });
    const now = () => (state.sol - 1) * model.SOL_CYCLE.totalSeconds + state.elapsedSeconds;
    function start(id) {
      if (state.missionComplete || !STEPS[id]) return result(false, "This mission cannot start now.");
      const prerequisite = id === "oxygenEmergency" ? "establishBase" : "oxygenEmergency";
      if (state.missions?.[prerequisite]?.status !== "complete") return result(false, "Finish and report the previous mission first.");
      if (state.missions[id]) return result(false, "This mission has already started.");
      if (id === "dustStormMission" && state.emergencies.dustStorm) return result(false, "This drill needs preparation before a storm. Start it in a fresh run before triggering the dust storm.");
      state.missions[id] = { status: "active", step: 0, checks: [], shelteredSeconds: 0, outsideSeconds: 0 };
      if (id === "oxygenEmergency" && !state.emergencies.oxygenFailure) model.triggerEmergency(state, "oxygenFailure");
      return result(true, id === "oxygenEmergency" ? "Oxygen generator fault. Check supplies; use backup oxygen or reduce activity if needed. Press R for the three existing choices."
        : "Prepare for dust. Secure the equipment before the storm; then return to shelter.");
    }
    function check(id, env) {
      const p = state.missions?.[id];
      if (!p || p.status !== "active" || state.missionComplete) return result(false, "Start an active mission first.");
      const oxygen = state.emergencies.oxygenFailure;
      const storm = state.emergencies.dustStorm;
      if (id === "dustStormMission" && p.step === 0 && storm) {
        if (!env.safeCabin) return result(false, "The storm arrived before preparation. Go to shelter now; do not secure equipment in danger.");
        p.missedPreparation = true;
        p.step = 1;
        return result(true, "Preparation was missed and has been recorded. Review your power plan from shelter.");
      }
      let blocked;
      if (id === "oxygenEmergency") {
        switch (p.step) {
          case 0: blocked = !env.safeCabin || state.resources.oxygen <= model.RESOURCE_WARNING_THRESHOLD
            ? "Get to safe shelter and stabilise oxygen. Backup tanks or reduced activity may help; a direct repair is also allowed when supplies are safe." : null; break;
          case 1: blocked = oxygen?.status !== "resolved" || !oxygen.choices.includes("repairGenerator") ? "Repair the generator using the existing emergency panel (R). Backup oxygen alone does not repair it." : null; break;
          case 2: blocked = state.rates.oxygenProduction <= 0 || state.resources.power <= 0 ? "Oxygen production has not resumed. Check power and generator status." : null; break;
          case 3: blocked = !env.safeCabin ? "Check pressure, oxygen and working life support inside the cabin first." : null; break;
          case 4: blocked = !env.safeCabin || !env.atTerminal ? "Send the report from the mission terminal in a safe cabin." : null; break;
        }
      } else {
        switch (p.step) {
          case 0: blocked = !env.atEquipment || !env.suitSafe || storm && storm.status !== "resolved" ? "Use the outdoor equipment station with a safe suit before the storm arrives." : null; break;
          case 1:
            if (!env.safeCabin) blocked = "Return to shelter before starting or reviewing the storm drill.";
            else if (!storm) { model.triggerEmergency(state, "dustStorm"); return result(false, "Storm started. Press R to choose a power plan, then review it here. Conserving power helps protect reserves."); }
            else if (!storm.choice) blocked = "Choose one of the existing storm responses (R) first.";
            break;
          case 2: blocked = !env.safeCabin ? "Monitor battery reserves from shelter." : null; break;
          case 3: blocked = !env.safeCabin || storm?.status !== "resolved" || p.shelteredSeconds <= 0 ? "Stay in a safe cabin while the storm passes. Check your supplies." : null; break;
          case 4: blocked = storm?.status !== "resolved" || !env.atEquipment || !env.suitSafe ? "Wait for the storm to end, then inspect the solar panels with a safe suit." : null; break;
          case 5: blocked = !env.safeCabin || !env.atTerminal ? "Return to the mission terminal to send your report." : null; break;
        }
      }
      if (blocked) return result(false, blocked);
      const powerNote = id === "dustStormMission" && p.step === 1 && storm?.choice === "normalOperations"
        ? "Normal operations use extra electricity. Watch your reserves closely. " : "";
      p.checks.push({ step: p.step, at: now(), oxygen: state.resources.oxygen, power: state.resources.power, batteryReserve: state.resources.batteryReserve, stormChoice: storm?.choice || null });
      p.step++;
      if (p.step === STEPS[id].length) {
        p.status = "complete";
        (state.reports ||= []).push({ mission: id, sol: state.sol, elapsedSeconds: state.elapsedSeconds, transmission: "simulated" });
        return result(true, "Report sent to Earth (simulated). Mission checklist complete. No extra resource bonus awarded.");
      }
      return result(true, `${powerNote}Check recorded. Next: ${STEPS[id][p.step]}.`);
    }
    function tick(seconds, env) {
      const p = state.missions?.dustStormMission;
      if (!p || p.status !== "active" || !Number.isFinite(seconds) || seconds <= 0) return;
      const storm = state.emergencies.dustStorm;
      if (storm && storm.status !== "resolved") p[env.safeCabin ? "shelteredSeconds" : "outsideSeconds"] += seconds;
    }
    return { start, check, tick, steps: STEPS };
  }
  return { create, STEPS };
});
