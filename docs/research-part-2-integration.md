# Scientific Research Part 2 — integration notes

## Existing systems preserved

- The lander still depressurises its whole cabin. Mission 1 owns its hatch, cabin cycle, suit-worn and helmet flags.
- MissionModel remains the only resource and mission-time authority. A sol remains 60 seconds day + 30 seconds night. Sleeping still wakes at sunrise.
- All three oxygen and dust-storm choices, resource costs, production/consumption rates, greenhouse dependencies and Sol 90 ending are unchanged.
- Flask, Aridal, movement, crouching, graphics changes, shops and saves are retained. Aridal remains advisory.

## Habitat and status

`HabitatSystems` operates on `missionState.systems.habitat`; it does not create a second cabin/resource model. The future construction feature must set `constructed`, `pressurized`, and `lifeSupport`. Construction is still absent, so the habitat and bed remain locked in normal gameplay.

Once constructed, the entrance uses a two-door **panel simulation** rather than the old direct entry teleport. Both doors cannot open together. Entry requires sealing the outer door, filling the chamber, verifying available safety signals, and opening the inner door. Exit requires closing the inner door, a safe suit, venting, and opening the outer door. Final entry/exit moves the astronaut to the existing habitat/interior or exterior point. A physical walk-through airlock interior and door animations remain pending. While inside the simulated chamber, the panel stays open until the astronaut safely enters or exits. The lander procedure is untouched.

Cycles consume five mission seconds and the existing survival costs. Five seconds is compressed gameplay timing, **not a scientific measurement**. Pump energy and vented/recovered gas quantities are not simulated and need balance approval. Habitat atmosphere and airlock pressure are separate states; venting the chamber does not vent the habitat.

The pressure panel shows Safe/Low/Critical, shared oxygen supply, available electricity and life-support power. Missing CO₂ and temperature models say **Pending**, not fabricated numerical readings. Optional `co2Status`, `temperatureC`, and `temperatureStatus` fields can be supplied by future habitat subsystems. “Learn More” distinguishes stored oxygen percentage from oxygen concentration/partial pressure. The game's current safe-cabin check uses existing resource-warning thresholds and implemented signals; it is not certification of a real breathable atmosphere.

NASA's Quest crew lock is the compartment cycled between pressurised and depressurised states for EVA. Our simplified habitat procedure is inspired by that isolation principle, not an operational checklist. [NASA: Quest crew lock](https://www.nasa.gov/image-article/nasa-astronaut-anne-mcclain-works-inside-u-s-quest-airlock/)

Real life support manages pressure, oxygen, ventilation and other environmental functions; oxygen inventory alone does not establish atmospheric safety. [NASA: Environmental Control and Life Support Systems](https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/)

## Coordinate with the suit co-developer

No new suit controller, suit inventory, oxygen drain, leak simulation, damage or repair logic was added. Register the existing controller once, after the game has loaded:

```js
const disconnect = window.missionTrainer.suitIntegration.register({
  read: () => suitController.getTelemetry(),
  subscribe: (notify) => suitController.onChange(notify), // returns unsubscribe
  oxygenCapacityUnits: /* agreed capacity in shared oxygen-reserve points */,
  receiveOxygen: ({ units, oxygenPercent }) => {
    // Atomically set the existing controller's tank to oxygenPercent.
    // Return true only when the entire transfer succeeds.
    // On false/throw, leave the tank unchanged. Do not debit reserves here.
    return suitController.acceptRefill({ units, oxygenPercent });
  },
});
```

`read()` returns `{ oxygenPercent, pressureStatus, co2Status, integrityPercent, batteryPercent, leakStatus }`. Percentages are 0–100. Protected EVA requires nonzero oxygen, integrity and battery, `pressureStatus: "safe"`, `co2Status: "safe"`, and `leakStatus: "none"`, in addition to Mission 1's worn suit/sealed helmet. Missing telemetry fails the connected safety check. The controller must classify hazards; this adapter does not invent scientific pressure or CO₂ limits.

`pressureStatus: "critical"` or `"failed"`, or `leakStatus: "serious"`, immediately displays a persistent emergency alert and interrupts rest through the subscription. The render loop also polls as a fallback. The same protection check is used by lander egress, habitat exit and existing exposure damage. If subscriptions are unavailable, call `window.missionTrainer.suitIntegration.notifyChanged()` when telemetry changes. Coordinate the provider's lifecycle/disconnect behavior before deployment; without a provider the prototype deliberately retains its clearly labelled legacy suit/helmet simulation.

Refills are possible only at the nearby lander suit station with cabin pressure protection and main power. They debit `missionState.resources.oxygenReserve`, clamp to tank capacity and available reserves, and do not repair pressure/leak faults. **Agree the tank capacity ↔ reserve-point conversion and atomic refill callback with the co-developer before connecting it.** No physical kilograms or free reserve supply are assumed. The adapter owns reserve debits; the provider owns tank state.

Real suits provide pressure and oxygen, circulate air, and remove exhaled CO₂. This supports checking several systems rather than oxygen quantity alone. [NASA: Spacewalk Spacesuit Basics](https://www.nasa.gov/centers-and-facilities/johnson/spacewalk-spacesuit-basics/)

## Missions 2 and 3

After Mission 1, use the Mission Terminal to start Mission 2. It activates/reuses the existing oxygen emergency and records a recovery checklist: stabilise supply in shelter, repair, confirm production, verify available cabin safety signals, then report from the terminal. Backup oxygen and reduced activity remain the original emergency choices; neither substitutes for repair. Direct repair remains allowed if supplies are already safe. Use **R** for emergency responses. No new rewards or rates are introduced. Until construction exists, the safe lander is the mission's shelter.

Mission 3 is a preparation/checklist mission unlocked after Mission 2. Secure equipment at the solar array's interaction point before the storm, return to shelter, start the existing storm via the checklist, choose a power plan with R, record battery reserves, remain sheltered while it passes, then inspect the panels and report. Securing equipment is a recorded inspection action, not a simulated fastening/damage mechanic. The report records resource snapshots, chosen power response, sheltered/outside time, and missed preparation if a storm was triggered early. No new damage or resource bonus is implied. Start this drill before manually triggering a dust storm: an already-used storm cannot recur under the existing emergency model, and the UI explains that a fresh run is needed.

Reports for these checklists are recorded once in the existing `missionState.reports` with a simulated transmission label; no network delivery, new reporting deadline or rewards are fabricated. Mission 1 retains its simulated reply timer. Shared `MissionModel.observeTime` observers run once per elapsed segment for normal play, sleep and repairs; previews on cloned states do not run live observers. This avoids duplicate real-time timers or skipped mission processing. The original Sol 90 success conditions still require Mission 1, not these new optional training checklists.

## Proposals only — require approval before changing rates

**Greenhouse:** retain the existing water/power/equipment gates. Later, apply a bounded growth-efficiency multiplier (0–1) from light, temperature and water stress. Accumulate stress over elapsed mission time and recover gradually after repairs instead of instantly killing plants. Any efficiency curves, stress tolerance, recovery time or crop loss are gameplay balance choices requiring researcher review. Do not double-apply the Botanist bonus or existing emergency modifiers. None of this changes current production.

NASA's plant-growth hardware controls lighting and, in systems such as the Advanced Plant Habitat, environmental conditions including water, moisture and temperature. Crop-specific tolerance data should guide the later model. [NASA: Growing Plants in Space](https://www.nasa.gov/exploration-research-and-technology/growing-plants-in-space/)

**Dust/solar audit:** the current three-sol storm raises `powerConsumption` to 1.6. Its conservation and battery choices alter demand as before. Visual dust dims the scene, but `solarGeneration` remains 1; only the ordinary night/day cycle suppresses solar output. Reduced storm solar generation is **not** currently simulated.

Proposed initial balance: add `solarGeneration: 0.8` to the existing storm rate source, retaining it through choices and removing it when the storm ends. This means a 20% generation reduction for the storm duration, **not an immediate 20-point power loss**. At the existing base values, a full sol would generate 7.2 rather than 9 power points; unmitigated storm demand remains 12.8, giving −5.6 points/sol before caps or class effects. Over three full sols, this adds 5.4 points of loss versus today's storm. Conservation would still help. These are proposed game values, not NASA measurements; no power-rate change was applied.

Dust in the atmosphere can prevent sunlight from reaching solar panels and interrupt solar-powered operations. [NASA: Mars Report — Dust Storms on Mars](https://science.nasa.gov/resource/mars-report-dust-storms-on-mars/)

## Verification

Run `for file in tests/*.test.js; do node "$file" || break; done`. The new research suite covers door interlocks and cycles, real resource use during cycles, status labels, pressure/CO₂/battery/integrity failures, finite oxygen transfers, Mission 2 ordering, Mission 3 preparation and shelter timing, and observer behavior during sleep/repairs/previews. The existing fast Babylon NullEngine bed/control test remains available as documented in `rest-testing.md`.

For manual testing, run `JAMT_DEV_TOOLS=1 flask --app app run --port 5059`. Check the pressure panel's Learn More details, suit pending labels, Mission Terminal checklists, and solar-array interaction. Use a test provider to verify immediate pressure alerts and reserve debits; connect the real controller only after agreeing the contract above. A constructed habitat can be exercised in a test fixture, but normal gameplay must stay locked until actual construction is implemented. No lengthy headless browser test is needed for these logic checks; visual rendering, panel usability and live suit-controller integration still require a MacBook playtest.
