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
templates/index.html   Main menu, class UI, lobby HUD and preserved mission UI
static/css/style.css   Responsive game overlays and interface styling
static/js/game.js      Application flow, UI and preserved mission systems
static/js/lobby-scene.js  Procedural training-centre lobby and interactions
static/js/mars-scene.js   Preserved Mars scene factory for a later launch phase
static/js/mission-state.js  Resources and scientific emergencies
```

## Lobby controls

- `W`, `A`, `S`, `D`: move
- Mouse: look around
- `Shift`: sprint
- `E`: use a nearby terminal
- `Escape`: pause and open settings

Solo Mission opens crew-role selection and then enters the Johnson Space
Center-inspired training lobby. Multiplayer is visibly marked unavailable. The
launch terminal currently opens the Phase 1 transition placeholder; it does not
start the preserved Mars scene yet.
