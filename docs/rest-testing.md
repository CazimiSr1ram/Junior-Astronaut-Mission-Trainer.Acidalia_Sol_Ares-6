# Bed rest and sleep verification

Run on macOS from the project directory:

```sh
source .venv/bin/activate
JAMT_DEV_TOOLS=1 flask --app app run --port 5059
```

Open `http://127.0.0.1:5059`. Enter the lobby, launch (or skip the launch cutscene), and complete the lander checks through activating main power. Keep the cabin pressurised and hatch shut. Both bunks at the back of the lander have a **Press E to Rest** interaction in the aisle.

1. **Daytime:** press E beside either bunk and select **Rest briefly**. A short fade should finish in about four seconds including transitions. Check fatigue decreases, the clock advances only three mission seconds, and WASD/mouse/view controls work afterward. Click the canvas to recapture the mouse if needed. Near sunset, rest is shortened to end before nightfall.
2. **Nighttime:** wait for night, or use the developer clock's phase advance while awake. Select **Sleep until morning** at a bunk. Expect a dark fade, sleep message, sunrise colour, and **Good morning! Sol X**. The next night must run normally until you choose to sleep again.
3. **Safety:** try a bunk with main power off or after depressurising the cabin. The rest button must be disabled with an explanation. Critical emergency/resource alerts also block rest. Safe noncritical emergencies do not. Outside, there is no usable bed. Escape cancels an active rest; it does not cancel elapsed resource costs.
4. **Habitat:** its entrance must say construction is required. Completing Mission 1 does **not** unlock it. This is intentional: there is no construction feature yet. The interior bed and sealed entrance/exit hooks are prepared for a future `missionState.systems.habitat` with explicit `constructed`, `pressurized`, and `lifeSupport` booleans. No production path sets these flags in this change. Automated scene tests exercise the prepared bed without unlocking it in gameplay.
5. **Controls regressions:** move, use Settings → Unstuck, and verify there is no leftover slide. Cross the open lander hatch slowly; its hint must switch between inside airlock controls and outside entry even while the same terminal remains nearby. Check crouch and both camera views before and after rest.
6. **Reduced motion:** enable macOS Reduce Motion (or emulate `prefers-reduced-motion: reduce` in browser developer tools). The fades should become immediate; time/resource effects must be unchanged.
7. **Ending:** with developer tools, advance to the final night and sleep. The existing mission result must appear at Sol 90; it must never advance to Sol 91 or grant missing objectives.

Automated checks:

```sh
for file in tests/*.test.js; do node "$file" || break; done
# Optional: use a local copy of the Babylon.js build served by the application.
BABYLON_TEST_MODULE=/path/to/babylon.js node tests/rest-scene.integration.js
```

The Babylon integration test uses NullEngine and stubbed texture painting. It exercises actual meshes, bed reachability, obstruction checks, input detachment/reattachment, teleport momentum, and hatch-threshold hints. It does not validate rendered pixels, visual fade quality, pointer-lock browser permissions, or laptop frame rate.

Rest balancing is in `RestSystem.CONFIG`. Resource/production/fatigue rates remain in the existing mission model and balance configuration. Night advancement runs in at most 0.25 mission-second segments, with safety checks before and after each segment. Existing report timers run for the same elapsed mission time. No reporting-deadline system currently exists; future deadlines/triggers must be wired into the same elapsed-time/event hooks. Networking is not implemented: acceleration checks only the existing crew records, excluding explicitly disconnected/inactive members, and creates no extra players.
