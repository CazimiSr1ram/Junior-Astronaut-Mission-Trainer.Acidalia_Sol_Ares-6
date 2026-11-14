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

Open <http://127.0.0.1:5000> in a browser.

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
http://127.0.0.1:5000/?emergency=dustStorm
http://127.0.0.1:5000/?emergency=oxygenFailure
http://127.0.0.1:5000/?emergency=waterMalfunction
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
static/js/player-view.js  Shared astronaut model, view toggle and crouch behavior
static/js/launch-sequence.js  Four-stage launch, cruise and landing cutscene
static/js/shop-state.js  Local Solar Cells, Helium-3 and class purchase state
static/js/mission-state.js  Resources and scientific emergencies
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
