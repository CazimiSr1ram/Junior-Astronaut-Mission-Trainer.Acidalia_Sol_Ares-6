"use strict";

// Player-facing lobby UI: Mars-only mission briefing, no launch buttons, controls bar.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "templates", "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "static", "css", "style.css"), "utf8");
const section = (id) => {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `${id} exists`);
  return html.slice(start, html.indexOf("\n", start));
};

// Mars-only mission briefing: no Moon mission, no launch button in a menu.
{
  const briefing = section("missionTerminalModal");
  assert.match(briefing, /MARS-01/);
  assert.match(briefing, /90-sol/);
  assert.doesNotMatch(html, /LUNAR|Lunar Surface|Moon mission/i, "no Moon mission anywhere in the player-facing page");
  assert.doesNotMatch(briefing, /<button(?![^>]*btn-close)/, "the briefing has no launch button (only the close button)");
  assert.match(briefing, /stand on the <strong>SOLO<\/strong> platform/);
}

// Main menu: no unavailable multiplayer button; missions start on the physical platforms.
{
  const menu = section("mainMenu");
  const actions = html.slice(html.indexOf('class="menu-actions"'), html.indexOf("</div>", html.indexOf('class="menu-actions"')));
  assert.doesNotMatch(actions, /Multiplayer/i);
  assert.doesNotMatch(actions, /Unavailable/i);
  assert.match(actions, /Enter Training Center/);
  assert.ok(menu.length > 0);
}

// Controls bar: all keys, Space jump, H marked Mars-only and hidden in the lobby.
{
  const bar = section("controlsHint");
  [["WASD", "Move"], ["Mouse", "Look"], ["Shift", "Sprint"], ["Space", "Jump"], ["V", "Change view"], ["E", "Interact"], ["Esc", "Pause"]]
    .forEach(([key, action]) => assert.match(bar, new RegExp(`<kbd>${key}</kbd> ${action}`), `${key} - ${action}`));
  assert.match(bar, /<kbd>Ctrl<\/kbd>\/<kbd>C<\/kbd> Crouch/);
  assert.match(bar, /<span class="mars-only"><kbd>H<\/kbd> Helmet<\/span>/, "helmet shown only on Mars");
  assert.match(css, /\.controls-hint \.mars-only \{ display: none; \}/);
  assert.match(css, /body\.mars-active \.controls-hint \.mars-only \{ display: inline; \}/);
}

// Queue panel: accessible Leave Queue button.
{
  const panel = section("launchQueuePanel");
  assert.match(panel, /<button id="leaveQueueButton" type="button"[^>]*>Leave Queue \(X\)<\/button>/);
}

console.log("lobby-ui tests passed");
