# Junior Astronaut Mission Trainer

NASA Space Apps 2026 Mars survival and astronaut training simulator, built with
Flask, Bootstrap, and Babylon.js.

## Run on macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:7070> in a browser (`app.py` serves on port 7070).

Bootstrap and Babylon.js are currently loaded from CDNs, so the browser needs
an internet connection when the game page opens.

## Optional Aridal AI service

The game exposes `POST /api/aridal/chat`, which forwards mission questions to
an Aridal service running at `http://127.0.0.1:8080/api/chat`. Start that service
separately before using the endpoint. If it is unavailable, the Flask endpoint
returns a fallback response.

## Test mission emergencies

Use the three **Emergency tests** buttons in the mission dashboard, or open one
of these deterministic URLs:

```text
http://127.0.0.1:7070/?emergency=dustStorm
http://127.0.0.1:7070/?emergency=oxygenFailure
http://127.0.0.1:7070/?emergency=waterMalfunction
```

Emergency definitions, choice consequences and alert thresholds are configured
centrally in `static/js/emergency-config.js`. Each emergency can happen once per
mission, and each response can only be used once.

### Emergency gameplay

Each emergency opens a warning with an alert level, short briefing lines, and
three response cards. Every card lists its risks and a **predicted outcome**
calculated by running the real game logic on a copy of the mission state (so
the prediction always matches what will happen, including supplies used during
repairs and transfers that would be wasted at the 100% cap).

- **Oxygen generator failure** / **water recycler failure**: repairing takes
  2 sols on the mission clock. The other two responses stabilise the situation
  but leave the system broken; you can repair it later (press `R` or follow
  the banner).
- **Dust storm**: the response applies until the storm passes after
  `durationSols` (3 sols, a gameplay tuning value), then power use returns to normal.
- Effects from overlapping emergencies combine instead of overwriting each other,
  and are removed when the emergency ends.

Alert levels come from the lowest resource an emergency affects:
**Normal** (above 20%), **Critical** (20% or less) and **Code Black** (10% or
less). Code Black is a fictional game alert level, not an official NASA
classification. Thresholds are in `ALERT_THRESHOLDS`.

Mission Control replies arrive after a short simulated signal delay. The
**Ask Aridal** button asks the onboard Aridal AI for immediate advice through
`/api/aridal/chat`; its answer is advisory only and never changes game values.
If the Aridal service is not running, the button shows the fallback message.

The choice costs, rates, repair times and result texts are the project's
existing values. Briefing and risk texts only restate those values; no new
scientific claims were added. Researcher-approved explanations can be added to
the `briefing` lines in `emergency-config.js`.

Repair choices (`Repair generator`, `Repair recycler`) take two sols of real
simulated time: the repair cost is paid first, the broken system stays broken
while those 180 seconds are processed by `advanceMissionTime()` (resources,
fatigue, day/night, other active emergencies), and the system is restored when
the repair completes. A repair started late in the mission only simulates the
time left and then ends the mission. Resource values always stay within 0-100%.
`advanceMissionTime()` reports every nightfall, new sol and mission completion
to an optional `onEvent` hook for future reports, greenhouse growth and events.

## Project structure

```text
app.py                 Flask application and Aridal proxy
templates/index.html   Main menu, lobby HUD, class/supply shops and launch cutscene
static/css/style.css   Responsive overlays, shop panels and cutscene visuals
static/js/game.js      Lobby flow, shops, scene transition and preserved mission systems
static/js/lobby-scene.js  Procedural training-centre lobby and interactions
static/js/mars-scene.js   Mars surface scene activated after cutscene landing
static/js/mars-terrain.js Procedural terrain, rock scatter and day/night/dust lighting model
static/js/mars-lander.js  Temporary procedural lander / home base (replaceable by a .glb)
static/js/player-view.js  Shared astronaut model, view toggle and crouch behavior
static/js/launch-sequence.js  Four-stage launch, cruise and landing cutscene
static/js/shop-state.js  Local Solar Cells, Helium-3 and class purchase state
static/js/mission-state.js  Resources and scientific emergencies
static/js/mission-clock.js  Runs mission time from gameplay (start gate, pause, night skip, dev controls)
static/js/dev-panel.js      Developer-only mission clock panel (served only with JAMT_DEV_TOOLS=1)
```

## Lobby controls

- `W`, `A`, `S`, `D`: move
- Mouse: look around
- `Shift`: sprint
- Hold `Ctrl`: crouch
- `V`: switch between first-person and third-person view
- `E`: use a nearby terminal
- `Escape`: pause and open settings

Solo Mission enters the Johnson Space Center-inspired lobby immediately as Intern.
The astronaut wears a NASA-marked suit in third-person view.
Use the Class Shop terminal to buy and equip Commander, Engineer, Medic, Botanist
or Scientist. Prices are placeholders. Class bonuses are defined in
`static/js/class-bonuses.js` and shown in the HUD role chip:

| Class | Bonus | Status |
|---|---|---|
| Intern | None (default, can do every task) | - |
| Engineer | Emergency repairs 40% faster (repair speed x1.4, e.g. 2 sols -> 1.43 sols) | Active |
| Botanist | Greenhouse food production x1.3 | Active |
| Commander | Oxygen, water and power use -10% while any emergency is unresolved (applied once, however many overlap) | Active |
| Medic | Medical treatment 40% faster | Pending: no medical treatment yet |
| Scientist | Research tasks 40% faster | Pending: no research tasks yet |

Only purchased classes can be equipped, one at a time, and the class is locked
once you land. Bonuses never stack: re-equipping replaces the class effect, and
for future crews `combineTeamBonuses()` takes the best value of each bonus, not
a product. Run `node tests/class-bonuses.test.js` for the class tests.
The separate Supply Shop is a preview catalogue; supply purchases are disabled.

Solar Cells (common), Helium-3 (rare), class ownership and the testing reward claim
are saved in browser local storage (`jamt.shops.v1`). Saves are specific to the
browser and site address/port. Each session starts as Intern; owned classes can
be equipped for free. The class shop offers a one-time testing reward of 150 Solar
Cells and 2 Helium-3, clearly marked as a test-only grant. Run
`node tests/shops.test.js` to test affordability, purchases and saving.

Multiplayer is visibly marked unavailable. The
launch terminal starts a short four-stage cutscene: mission briefing, Earth launch,
journey to Mars and landing. Skip Cutscene goes directly to the existing Mars scene.
Both paths preserve mission state; the Mars dashboard and movement become active
after arrival. Cutscene visuals and transitions use local CSS without extra downloads.

## Mars surface (Phase 1)

The Mars scene is built only after the launch cutscene (or Skip Cutscene); the
game always starts in the Johnson Space Center-inspired lobby.

**The terrain is procedurally generated.** It is Mars-like, not NASA elevation
data, and it does not represent a real Martian location. It is deterministic
(seeded), so every player sees the same landscape.

- 720 m × 720 m heightfield (3 m grid, 58k vertices) with rolling hills,
  ridgelines, a dry channel, 30 simple craters with raised rims and rising
  highlands that frame a ~300 m walkable radius.
- A perfectly flat 45 m landing zone holds the base: lander, habitat, greenhouse,
  solar array, research station and comms dish, all seated on the ground.
- 2,400 small rocks (thin instances, one draw call per variant) plus 85 collidable
  boulders and rock formations (mesh instances).
- Procedural soil texture and normal map, vertex-coloured dust/rock/crater tints,
  PBR materials and sun shadows that follow the astronaut.
- The astronaut follows the ground exactly; slopes steeper than 45° can't be
  climbed and the play area edge is clamped.
- Lighting follows the mission clock: day (sun rises in the east, crosses the
  southern sky), bluish dusk, dark night with stars and a helmet lamp. An active
  **Dust storm** emergency adds dust particles, thick haze and dims the sun.

Lighting follows the running mission clock (see below). To preview a specific
time of day without waiting:

```text
http://127.0.0.1:7070/?marsTime=noon      (also: morning, evening, dusk, night, or 0-90 seconds)
```

or, in the browser console after landing: `missionTrainer.setMarsTimeOverride('night')`
(`null` returns to the mission clock).

## Temporary lander / home base

`static/js/mars-lander.js` builds a **placeholder** lander from Babylon.js
primitives until the final `.glb` model is ready. It is the player's spawn point
and home base:

- Octagonal crew cabin on a descent stage, landing legs and footpads, ascent
  stage, antenna, external storage bay with crates, interior bunks and lockers.
- Walkable cabin floor reached through an airlock vestibule and a ramp.
- `E` near the airlock opens/closes the door (the closed door blocks movement).
- **Supply Terminal** and **Mission Terminal** (labelled, inside the cabin) open
  read-only placeholders showing current mission-state values. Resupply, suit
  refills, objectives and Earth reports are **not implemented yet**.
- Within 10 m of the lander the HUD shows **Lander · Home Base** with a
  **BASE AREA** badge. This is a location marker only: the lander does not yet
  protect against oxygen loss, radiation or other hazards.

To replace it with a model later, keep the object returned by
`MarsLander.create()` (`spawn`, `floorHeightAt`, `interactions`, `isInSafeZone`,
`setDoorOpen`, `root`) and swap the geometry.

In third-person view the camera moves closer automatically when walls,
ceilings or solid objects are in the way (e.g. inside the lander) and eases back
to its normal distance outside. If it gets within 1 m, the astronaut model is
hidden so the view is not blocked.

Run the terrain tests with `node tests/mars-terrain.test.js`.

## Mission 1: Establish the Mars Base

Starts automatically when you arrive on Mars (inside the lander). The tracker on
the right lists the objectives; each one needs a player action (walk up, press
`E`, use the panel buttons). They must be done in order:

1. **Inspect life support** at the Supply Terminal (right wall).
2. **Verify cabin pressure and oxygen** at the Cabin Pressure panel (right of the hatch).
3. **Activate and inspect main power** at the Main Power panel (left of the hatch).
   Cabin lights brighten when power comes on.
4. **Check water recycling and food** at the Supply Locker (back right).
5. **Put on the EVA suit and run the suit check** at the EVA Suit locker (back left).
6. **Use the airlock**: at the hatch, depressurise the cabin (5 s), open the
   hatch and walk down the ramp onto Mars.
7. **Inspect the landing area**: press `E` at the three orange survey beacons
   (they turn green).
8. **Return and report**: go inside, close the hatch, repressurise (5 s), then
   submit the report at the Mission Terminal. Mission Control replies after a
   shortened signal delay (real Earth-Mars signals take about 3-22 minutes each way).

Safety rules: the hatch only opens after depressurising, which needs the suit
on and helmet sealed. `H` seals or removes the helmet, and the helmet and suit can
only come off inside the closed, pressurised cabin. Like the Apollo Lunar Module,
this lander has no separate airlock chamber: the whole cabin is depressurised.
The checklist is a simplified training procedure, not an official NASA procedure.
Pressures shown are simulated (cabin 101.3 kPa, Mars surface about 0.6 kPa).

Completing the mission awards **50 Solar Cells once per browser save** (the
amount is fixed in `shop-state.js`). Progress is stored on the mission state
(`missions.establishBase`) and the report in `reports`; it is not saved between
page loads, so a new session replays the mission without a second reward.
Suit oxygen and integrity are shown as fixed placeholders until suit systems exist.

Run `node tests/mission-one.test.js` for the mission tests.

### Shelter safety and EVA protection

- **Body collision:** the astronaut's own collision body (not the camera) is
  moved against walls, the hatch and objects in both first- and third-person,
  so walking, sprinting, crouching or switching view cannot pass through a
  closed hatch. The third-person camera never moves the player.
- **Shelter guard:** the cabin can only be entered or left through the open
  hatch. If the astronaut ever crosses the cabin boundary any other way, they
  are put back where they were and told why.
- **Getting back in:** at the hatch from outside the prompt reads *Enter
  airlock* with the hatch status. If the hatch is closed, use the exterior panel
  to depressurise the (empty) cabin, open the hatch, step inside, close it and
  repressurise; the helmet and suit stay locked until the cabin is pressurised.
  Lamps beside the hatch show green (open), amber (cycling) or red (closed).
- **Stuck?** Pause (Esc) and use *Move to the nearest safe spot*: near the
  lander only, once every 30 s. It keeps you on the side of the hull you were
  last validly on (cabin floor, or the foot of the ramp outside), so it never
  moves an astronaut from outside into the cabin or bypasses the airlock.
- **EVA protection is separate from cabin pressure.** Depressurising needs the
  suit on, helmet sealed and a suit check since putting it on; the hatch only
  opens when depressurised. Completing Mission 1 grants no protection.
- **Unprotected exposure:** anywhere unpressurised (outside, or a cabin that is
  not closed and pressurised) without a sealed suit shows a red DANGER warning
  and crew health falls by `EXPOSURE_HEALTH_LOSS_PER_SOL` (gameplay tuning in
  `balance-config.js`, ~30 game seconds from full health). It is processed in
  the mission time loop, so repairs and time skips cannot avoid it.
- The co-developer's EVA suit module can plug in through
  `MissionOne.isSuitProtecting()`, the single protection check.

After Mission 1 the tracker shows **Mission 2: Oxygen Emergency — coming
soon** with standing orders, and recovery tasks for any broken system. Run
`node tests/eva-safety.test.js` for these tests.

## Mission success and failure

Survival balance and the success/failure rules are in
`static/js/balance-config.js`. **All of those numbers are gameplay tuning, not
scientific data**, chosen so a well-run base roughly breaks even, and should be
reviewed by the project researcher:

| Per sol | Value |
|---|---|
| Power | solar +9 (daytime only), use 8 |
| Oxygen | make 7, use 7 |
| Water | recycle 6.6, use 7 |
| Food | greenhouse 4, crew eats 5 |

- **Failure:** while oxygen, water, food or power is at 0%, crew health falls
  (oxygen 60, water 20, food 10, power 15 per sol, added together) and recovers
  5 per sol once nothing is empty. The mission fails only when crew health
  reaches 0, so a resource that briefly runs out (for example power overnight)
  can be recovered from. Failure is checked inside the authoritative time loop,
  so emergency repairs and developer skips stop at the failure.
- **Success:** reach the end of Sol 90 with the crew alive, every life-support
  resource above 0%, and Mission 1 (base checks, landing-site survey and first
  report) complete. Otherwise the ending is "Mission incomplete".
- **Ending screen:** success or failure headline and reasons, Mission Control and
  astronaut lines, and a final report (sols survived, missions, emergencies,
  final resources, science).
- **Rewards:** success pays **100 Solar Cells + 1 Helium-3 once per browser save**
  (`mission-success` in `shop-state.js`); failure pays nothing.
- **Restart** reloads the game at Johnson Space Center with a fresh mission;
  purchases and earned currency in browser storage are kept.

**Greenhouse:** food is grown (4 per sol, x1.3 for a Botanist) only while the
greenhouse equipment works and the base has both power and water. If either
runs out, growth stops for exactly that time; the crew still eats 5 per sol.
Growth does not depend on daylight: with power available, artificial lighting
is assumed, so food grows at the same rate by night and by day.
The greenhouse does not use extra power or water of its own (simplified,
rate-based; no crop stages). A greenhouse equipment failure can be set in the
model (`setGreenhouseOperational`), but no in-game event triggers it yet.

An Intern with no emergencies finishes with roughly oxygen 100%, water 64%,
food 10% and power near 100%; food is the tight resource (Botanists help).

Run `node tests/mission-outcome.test.js` for the success/failure tests.

## Mission clock

- Mission time starts when the crew arrives on Mars (after the cutscene or Skip
  Cutscene). It does not run in the Johnson Space Center lobby or during the launch.
- Each sol is exactly 90 seconds: 60 s day + 30 s night (`MissionModel.SOL_CYCLE`).
- The clock pauses while any panel is open (pause/settings, emergencies,
  terminals) or the browser tab is hidden. Frame gaps longer than 0.25 s are
  dropped instead of jumping time forward.
- At night, if every crew member is asleep, the rest of the night is skipped;
  resources and fatigue are still simulated for the skipped time.
- The mission panel shows `Sol N / 90 · Day|Night`.

Not implemented yet: a player-facing sleep control, Earth mission reports and
networked multiplayer. The night-skip rule is tested with 1, 2 and 5 crew at
the model level only.

## Developer tools (never enable for a public demo)

Start the server with the developer flag to get the mission clock debug panel:

```bash
JAMT_DEV_TOOLS=1 python app.py
```

The panel (bottom right, `F9` to hide) shows sol, phase, seconds elapsed in the
sol, seconds to the next phase, net resource change per sol, rate multipliers,
crew and sleeping counts, the last sol skip and its reason, and the report
deadline (shown as not implemented). Controls: time scale ×1/×2/×5/×10/×30, skip
to next phase, +1 / +5 sols and toggle your own sleep. Skips simulate resource
use; the controls never touch Solar Cells, Helium-3 or class purchases.

Without the flag, the panel markup and script are not served and the clock's
acceleration methods do not exist. Solo mode runs in the browser, so a
determined user could still modify their own local game; server-enforced
authority arrives with multiplayer (Phase 4).

Run `node tests/mission-clock.test.js` for the clock tests.
