/*
 * Mission 1: Establish the Mars Base (game logic only, no Babylon.js).
 *
 * A strict, sequential training checklist. Every objective is completed by a
 * player action; nothing completes automatically except detecting that the
 * player has physically walked outside, and the simulated Earth reply to the
 * report. Progress is stored on the shared mission state
 * (missionState.missions.establishBase) and reports in missionState.reports.
 *
 * This is a simplified training procedure for a game. It is not an official
 * NASA operating procedure. The lander has no separate airlock chamber, so the
 * whole cabin is depressurised before the hatch opens, as the Apollo Lunar
 * Module cabin was for its moonwalks.
 *
 * Exposes MissionOne in the browser and module.exports in Node for tests.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.MissionOne = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MISSION_ID = "establish-base";
  const CABIN_CYCLE_SECONDS = 5; // compressed depressurise / repressurise time
  const REPORT_DELAY_SECONDS = 3; // compressed Earth-Mars round trip for gameplay

  const OBJECTIVES = Object.freeze([
    { id: "lifeSupport", title: "Inspect the lander's life-support status", hint: "Use the Supply Terminal on the right-hand wall." },
    { id: "pressure", title: "Verify cabin pressure and oxygen levels", hint: "Use the Cabin Pressure panel to the right of the hatch." },
    { id: "power", title: "Activate and inspect the main power system", hint: "Use the Main Power panel to the left of the hatch." },
    { id: "supplies", title: "Check water recycling and food supplies", hint: "Use the Supply Locker at the back right." },
    { id: "suit", title: "Put on a functioning EVA suit", hint: "Use the EVA Suit locker at the back left." },
    { id: "egress", title: "Use the airlock to exit onto Mars", hint: "At the hatch: depressurise the cabin, open the hatch, then walk down the ramp." },
    { id: "survey", title: "Inspect the landing area (3 survey markers)", hint: "Walk to each orange beacon around the lander and press E." },
    { id: "report", title: "Return to the lander and submit the first mission report", hint: "Go inside, close the hatch, repressurise, then use the Mission Terminal." },
  ].map((objective) => Object.freeze(objective)));

  // Beacons placed around the lander on the flat landing zone (world x/z).
  const SURVEY_MARKERS = Object.freeze([
    Object.freeze({ id: "survey-a", label: "SURVEY A", x: -13, z: -38 }),
    Object.freeze({ id: "survey-b", label: "SURVEY B", x: 13, z: -37 }),
    Object.freeze({ id: "survey-c", label: "SURVEY C", x: 3, z: -46 }),
  ]);

  // Reference values shown on panels. Pressures are labelled as simulated.
  const FACTS = Object.freeze({
    cabinPressureKpa: 101.3, // Earth sea-level equivalent used for the simulated cabin
    marsSurfacePressureKpa: 0.6, // Mars average surface pressure is about 0.6 kPa
  });

  // Next mission in the campaign. Not implemented yet: shown as "coming soon".
  const NEXT_MISSION = Object.freeze({ id: "oxygenEmergency", title: "Mission 2: Oxygen Emergency", status: "coming-soon" });

  const line = (speaker, text) => ({ speaker, text });

  /**
   * Single integration point for EVA suit protection. Today the suit state is
   * the Mission 1 suit flags; the co-developer's EVA suit module can replace
   * this check (e.g. adding suit oxygen and integrity) without other changes.
   */
  function isSuitProtecting(progress) {
    return Boolean(progress && progress.suitOn && progress.helmetOn);
  }
  const PLAN = "Flight plan";
  const YOU = "You";
  const CONTROL = "Mission Control";

  function createProgress() {
    return {
      status: "inactive",
      current: 0,
      completed: {},
      powerOn: false,
      suitOn: false,
      helmetOn: false,
      suitChecked: false, // suit check passed since the suit was last put on
      cabin: "pressurized", // pressurized | depressurizing | depressurized | repressurizing
      cycleRemaining: 0,
      hatchOpen: false,
      markers: {},
      report: "none", // none | transmitting | acknowledged
      reportRemaining: 0,
      rewardGranted: false,
    };
  }

  function create(missionState) {
    if (!missionState.missions) missionState.missions = {};
    if (!missionState.reports) missionState.reports = [];
    if (!missionState.missions.establishBase) missionState.missions.establishBase = createProgress();
    const p = missionState.missions.establishBase;

    function result(ok, lines, extra = {}) {
      return { ok, lines, completed: null, ...extra };
    }

    function currentObjective() {
      return OBJECTIVES[p.current] || null;
    }

    function isCurrent(id) {
      return p.status === "active" && currentObjective()?.id === id;
    }

    function isDone(id) {
      return Boolean(p.completed[id]);
    }

    function blockedBy(id) {
      if (p.status === "inactive") return result(false, [line(PLAN, "Mission 1 has not started yet.")]);
      const index = OBJECTIVES.findIndex((objective) => objective.id === id);
      if (index > p.current && p.status === "active") {
        return result(false, [line(PLAN, `First: ${currentObjective().title}.`)]);
      }
      return null;
    }

    function complete(id, lines) {
      if (!isCurrent(id)) return result(true, lines);
      p.completed[id] = { sol: missionState.sol, elapsedSeconds: missionState.elapsedSeconds };
      p.current += 1;
      const next = currentObjective();
      const extra = [line(PLAN, `Objective complete: ${OBJECTIVES[p.current - 1].title}.`)];
      if (next) extra.push(line(PLAN, `Next: ${next.title}. ${next.hint}`));
      else {
        p.status = "complete";
        recordProgression();
        extra.push(line(PLAN, `Mission 1 complete. Next: ${NEXT_MISSION.title} (coming soon).`));
        extra.push(line(PLAN, "Until then: keep the base running to Sol 90, keep oxygen, water, food and power above 0, and respond to alerts (R)."));
      }
      return { ok: true, lines: [...lines, ...extra], completed: id, missionComplete: !next };
    }

    /** Updates the campaign progression on the shared mission state (idempotent). */
    function recordProgression() {
      const progression = missionState.progression || { completed: [], next: null };
      if (!progression.completed.includes("establishBase")) progression.completed.push("establishBase");
      progression.next = { ...NEXT_MISSION };
      missionState.progression = progression;
    }

    /** Safe to remove the helmet or suit: inside the closed, pressurised cabin. */
    function isSafeEnvironment(env) {
      return Boolean(env && env.insideCabin) && p.cabin === "pressurized" && !p.hatchOpen;
    }

    function start() {
      if (p.status !== "inactive") return result(false, []);
      p.status = "active";
      return result(true, [
        line(PLAN, "Touchdown confirmed. Mission 1: Establish the Mars Base."),
        line(PLAN, "This is a simplified training checklist, not an official NASA procedure."),
        line(PLAN, `First: ${OBJECTIVES[0].title}. ${OBJECTIVES[0].hint}`),
      ]);
    }

    function checkLifeSupport() {
      return blockedBy("lifeSupport") || complete("lifeSupport", [
        line(YOU, `Life support reads oxygen ${Math.round(missionState.resources.oxygen)}%, water ${Math.round(missionState.resources.water)}%, food ${Math.round(missionState.resources.food)}%, power ${Math.round(missionState.resources.power)}%.`),
      ]);
    }

    function cabinPressureKpa() {
      if (p.cabin === "pressurized") return FACTS.cabinPressureKpa;
      if (p.cabin === "depressurized") return FACTS.marsSurfacePressureKpa;
      const fraction = p.cycleRemaining / CABIN_CYCLE_SECONDS;
      const toward = p.cabin === "depressurizing" ? fraction : 1 - fraction;
      return FACTS.marsSurfacePressureKpa + (FACTS.cabinPressureKpa - FACTS.marsSurfacePressureKpa) * toward;
    }

    function verifyPressure() {
      const blocked = blockedBy("pressure");
      if (blocked) return blocked;
      if (p.cabin !== "pressurized" || p.hatchOpen) {
        return result(false, [line(PLAN, "The cabin is not pressurised. Close the hatch and repressurise first.")]);
      }
      const oxygen = missionState.resources.oxygen;
      const lines = [line(YOU, `Cabin pressure ${FACTS.cabinPressureKpa} kPa (simulated) and holding. Habitat oxygen supply ${Math.round(oxygen)}%.`)];
      if (oxygen <= 20) lines.push(line(PLAN, "Warning: oxygen supply is low. Consider using the oxygen reserve."));
      lines.push(line(PLAN, "Outside, Mars has only about 0.6 kPa of mostly carbon dioxide, so the hatch stays shut until you are suited."));
      return complete("pressure", lines);
    }

    function activatePower() {
      const blocked = blockedBy("power");
      if (blocked) return blocked;
      if (p.powerOn) return result(false, [line(PLAN, "Main power is already on.")]);
      p.powerOn = true;
      return result(true, [line(YOU, "Main power on. Cabin lights and systems are powering up."), line(PLAN, "Now inspect the power readings.")]);
    }

    function inspectPower() {
      const blocked = blockedBy("power");
      if (blocked) return blocked;
      if (!p.powerOn) return result(false, [line(PLAN, "Activate main power before inspecting it.")]);
      return complete("power", [
        line(YOU, `Power ${Math.round(missionState.resources.power)}%, battery reserve ${Math.round(missionState.resources.batteryReserve)}%.`),
      ]);
    }

    function checkSupplies() {
      return blockedBy("supplies") || complete("supplies", [
        line(YOU, `Water ${Math.round(missionState.resources.water)}% (reserve ${Math.round(missionState.resources.waterReserve)}%), recycler running at ${Math.round(missionState.rates.waterRecycling * 100)}%. Food ${Math.round(missionState.resources.food)}%.`),
      ]);
    }

    function donSuit(env) {
      const blocked = blockedBy("suit");
      if (blocked) return blocked;
      if (p.suitOn) return result(false, [line(PLAN, "You are already wearing the EVA suit.")]);
      if (!isSafeEnvironment(env)) return result(false, [line(PLAN, "Put the suit on inside the closed, pressurised cabin.")]);
      p.suitOn = true;
      p.helmetOn = true;
      p.suitChecked = false;
      return result(true, [line(YOU, "EVA suit on and helmet sealed."), line(PLAN, "Run the suit check before going outside.")]);
    }

    function suitCheck() {
      const blocked = blockedBy("suit");
      if (blocked) return blocked;
      if (!p.suitOn) return result(false, [line(PLAN, "Put on the EVA suit first.")]);
      if (!p.helmetOn) return result(false, [line(PLAN, "Seal your helmet (H) before the suit check.")]);
      p.suitChecked = true;
      return complete("suit", [line(YOU, "Suit check: helmet sealed, suit oxygen 100%, suit integrity 100% (simulated).")]);
    }

    function removeSuit(env) {
      if (!p.suitOn) return result(false, [line(PLAN, "You are not wearing the EVA suit.")]);
      if (!isSafeEnvironment(env)) {
        return result(false, [line(PLAN, "Unsafe: only remove the suit inside the closed, pressurised cabin.")]);
      }
      p.suitOn = false;
      p.helmetOn = false;
      p.suitChecked = false;
      return result(true, [line(YOU, "EVA suit removed and stowed.")]);
    }

    function toggleHelmet(env) {
      if (!p.suitOn) return result(false, [line(PLAN, "You are not wearing an EVA suit helmet.")]);
      if (p.helmetOn) {
        if (!isSafeEnvironment(env)) {
          return result(false, [line(PLAN, "Unsafe! The helmet stays sealed outside the closed, pressurised cabin.")], { blockedUnsafe: true });
        }
        p.helmetOn = false;
        return result(true, [line(YOU, "Helmet off. Cabin air is breathable.")]);
      }
      p.helmetOn = true;
      return result(true, [line(YOU, "Helmet sealed.")]);
    }

    // --- Airlock (whole-cabin depressurisation) ---------------------------------

    function airlockOptions(env) {
      const inside = Boolean(env && env.insideCabin);
      // The same whole-cabin airlock can be cycled from the exterior panel at
      // the hatch, so an astronaut outside can get back in (the cabin is empty).
      const atExteriorPanel = !inside && Boolean(env && env.atHatchOutside);
      const cycling = p.cabin === "depressurizing" || p.cabin === "repressurizing";
      const suited = isSuitProtecting(p);
      const ready = suited && p.suitChecked;
      return [
        {
          action: "depressurize",
          label: atExteriorPanel ? "Depressurise cabin (exterior panel)" : "Depressurise cabin",
          enabled: !cycling && p.cabin === "pressurized" && !p.hatchOpen && (inside || atExteriorPanel) && ready,
          reason: cycling ? "Cycle in progress."
            : p.cabin !== "pressurized" ? "Cabin is already depressurised."
              : p.hatchOpen ? "Hatch is open."
                : !inside && !atExteriorPanel ? "Stand at the hatch to use the airlock."
                  : !suited ? "SAFETY: put on the EVA suit and seal the helmet before depressurising."
                    : !p.suitChecked ? "SAFETY: run the suit check at the EVA suit locker first." : "",
        },
        {
          action: "open",
          label: "Open hatch",
          enabled: !cycling && p.cabin === "depressurized" && !p.hatchOpen,
          reason: p.cabin === "pressurized" ? "Depressurise the cabin before opening the hatch." : cycling ? "Wait for the cycle to finish." : p.hatchOpen ? "Hatch is open." : "",
        },
        {
          action: "close",
          label: "Close hatch",
          enabled: p.hatchOpen && inside && env.clearOfHatch !== false,
          reason: !p.hatchOpen ? "Hatch is closed." : !inside ? "Step inside the cabin first."
            : env.clearOfHatch === false ? "Step back from the hatch so it can close." : "",
        },
        {
          action: "repressurize",
          label: "Repressurise cabin",
          enabled: !cycling && p.cabin === "depressurized" && !p.hatchOpen && inside,
          reason: p.hatchOpen ? "Close the hatch first." : p.cabin !== "depressurized" ? "Cabin is not depressurised." : !inside ? "Step inside the cabin first." : "",
        },
      ];
    }

    function airlock(action, env) {
      const option = airlockOptions(env).find((candidate) => candidate.action === action);
      if (!option) throw new Error(`Unknown airlock action: ${action}`);
      if (!option.enabled) return result(false, [line(PLAN, option.reason || "Not available right now.")]);
      if (action === "depressurize") {
        p.cabin = "depressurizing";
        p.cycleRemaining = CABIN_CYCLE_SECONDS;
        return result(true, [line(YOU, env && env.insideCabin
          ? "Depressurising the cabin. Helmet sealed, suit pressure good."
          : "Depressurising the empty cabin from the exterior panel so the hatch can open.")]);
      }
      if (action === "open") {
        p.hatchOpen = true;
        return result(true, [line(YOU, "Hatch open."), ...(env && env.insideCabin ? [] : [
          line(PLAN, "Step inside, close the hatch and repressurise before removing your helmet."),
        ])]);
      }
      if (action === "close") {
        p.hatchOpen = false;
        return result(true, [line(YOU, "Hatch closed and latched."), line(PLAN, "Repressurise the cabin.")]);
      }
      p.cabin = "repressurizing";
      p.cycleRemaining = CABIN_CYCLE_SECONDS;
      return result(true, [line(YOU, "Repressurising the cabin.")]);
    }

    function inspectMarker(id) {
      const blocked = blockedBy("survey");
      if (blocked) return blocked;
      const marker = SURVEY_MARKERS.find((candidate) => candidate.id === id);
      if (!marker) throw new Error(`Unknown survey marker: ${id}`);
      if (p.markers[id]) return result(false, [line(PLAN, `${marker.label} already inspected.`)]);
      p.markers[id] = true;
      const count = SURVEY_MARKERS.filter((candidate) => p.markers[candidate.id]).length;
      const lines = [line(YOU, `${marker.label}: ground is firm and clear of hazards. Logged (${count}/${SURVEY_MARKERS.length}).`)];
      if (count < SURVEY_MARKERS.length) return result(true, lines, { marker: id });
      return { ...complete("survey", lines), marker: id };
    }

    function submitReport(env) {
      const blocked = blockedBy("report");
      if (blocked) return blocked;
      if (!isCurrent("report")) return result(false, [line(PLAN, "The first mission report has already been sent.")]);
      if (p.report === "transmitting") return result(false, [line(PLAN, "The report is already being transmitted.")]);
      if (!(env && env.insideCabin) || p.hatchOpen || p.cabin !== "pressurized") {
        return result(false, [line(PLAN, "Return inside, close the hatch and repressurise before sending the report.")]);
      }
      p.report = "transmitting";
      p.reportRemaining = REPORT_DELAY_SECONDS;
      missionState.reports.push({
        missionId: MISSION_ID,
        sol: missionState.sol,
        elapsedSeconds: missionState.elapsedSeconds,
        markersInspected: SURVEY_MARKERS.filter((candidate) => p.markers[candidate.id]).length,
      });
      return result(true, [
        line(YOU, "First mission report sent to Earth."),
        line(PLAN, "Radio signals take about 3 to 22 minutes each way between Mars and Earth. Here the wait is shortened to a few seconds."),
      ]);
    }

    /** Advance timed steps (cabin cycles, report reply) and detect egress. */
    function tick(seconds, env) {
      const out = [];
      if (p.cabin === "depressurizing" || p.cabin === "repressurizing") {
        p.cycleRemaining = Math.max(0, p.cycleRemaining - seconds);
        if (p.cycleRemaining === 0) {
          const depress = p.cabin === "depressurizing";
          p.cabin = depress ? "depressurized" : "pressurized";
          out.push(result(true, [line(PLAN, depress
            ? "Cabin depressurised to Mars ambient pressure. You may open the hatch."
            : "Cabin repressurised. It is safe to remove your helmet.")]));
        }
      }
      if (p.report === "transmitting") {
        p.reportRemaining = Math.max(0, p.reportRemaining - seconds);
        if (p.reportRemaining === 0) {
          p.report = "acknowledged";
          out.push(complete("report", [
            line(CONTROL, "Report received. Good work: the base is established. (Simulated reply.)"),
          ]));
        }
      }
      if (isCurrent("egress") && p.hatchOpen && env && env.onSurface) {
        out.push(complete("egress", [line(YOU, "Boots on the surface. Mars, here we are.")]));
      }
      return out;
    }

    /** Grants the Solar Cell reward once, through the shop (amount set by the shop). */
    function claimReward(shop) {
      if (p.status !== "complete") return { ok: false, message: "Mission 1 is not complete yet." };
      if (p.rewardGranted) return { ok: false, message: "Mission 1 reward already received." };
      const outcome = shop.claimMissionReward(MISSION_ID);
      if (outcome.ok || outcome.alreadyClaimed) p.rewardGranted = true;
      return outcome;
    }

    return {
      progress: p,
      start,
      checkLifeSupport,
      verifyPressure,
      activatePower,
      inspectPower,
      checkSupplies,
      donSuit,
      suitCheck,
      removeSuit,
      toggleHelmet,
      airlockOptions,
      airlock,
      inspectMarker,
      submitReport,
      tick,
      claimReward,
      isSafeEnvironment,
      get protected() { return isSuitProtecting(p); },
      cabinPressureKpa,
      currentObjective,
      isDone,
      get status() { return p.status; },
    };
  }

  return Object.freeze({
    MISSION_ID,
    OBJECTIVES,
    SURVEY_MARKERS,
    FACTS,
    NEXT_MISSION,
    isSuitProtecting,
    CABIN_CYCLE_SECONDS,
    REPORT_DELAY_SECONDS,
    create,
  });
});
