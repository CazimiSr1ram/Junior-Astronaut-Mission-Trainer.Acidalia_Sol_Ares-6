import os

from flask import Flask, render_template

app = Flask(__name__)

# Developer-only debugging tools (mission clock panel and time acceleration).
# Off unless the server is started with JAMT_DEV_TOOLS=1; never enable for a public demo.
DEV_TOOLS_ENABLED = os.environ.get("JAMT_DEV_TOOLS") == "1"

# Development-only scripted showcase for screen recording (static/js/demo-mode.js).
# Served only with JAMT_DEMO=1, and it only runs on /?demo=1. Never enable for players.
DEMO_ENABLED = os.environ.get("JAMT_DEMO") == "1"

@app.route("/")
def home():
    return render_template("index.html", dev_tools=DEV_TOOLS_ENABLED, demo_mode=DEMO_ENABLED)

if __name__ == "__main__":
    # Flask debug mode (auto-reload and the interactive debugger) is off by default.
    # For local development: FLASK_DEBUG=1 python app.py. Never enable it on a shared server.
    debug_enabled = os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="127.0.0.1", port=7070, debug=debug_enabled)