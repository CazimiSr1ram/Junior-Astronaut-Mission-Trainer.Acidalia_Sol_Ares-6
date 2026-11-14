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

Emergency balancing values and their resource/rate effects are configured in
`static/js/mission-state.js`. Each emergency can be resolved only once.

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
or Scientist. Prices are placeholders and specialist bonuses are not implemented.
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
