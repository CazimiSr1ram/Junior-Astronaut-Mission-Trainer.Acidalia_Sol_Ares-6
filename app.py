import os

from flask import Flask, render_template

app = Flask(__name__)

# Developer-only debugging tools (mission clock panel and time acceleration).
# Off unless the server is started with JAMT_DEV_TOOLS=1; never enable for a public demo.
DEV_TOOLS_ENABLED = os.environ.get("JAMT_DEV_TOOLS") == "1"

@app.route("/")
def home():
    return render_template("index.html", dev_tools=DEV_TOOLS_ENABLED)

import json
import requests
from flask import request, jsonify

@app.post("/api/aridal/chat")
def aridal_game_chat():
    data = request.get_json(silent=True) or {}
    question = data.get("message", "")

    if not isinstance(question, str) or not question.strip():
        return jsonify({"error": "Message required"}), 400

    mission_prompt = (
        "You are Aridal, the onboard AI for a Mars mission. "
        "Help astronauts make scientifically informed decisions. "
        "Keep answers brief. Do not claim to control game systems.\n\n"
        f"Astronaut question: {question}"
    )

    try:
        with requests.post(
            "http://127.0.0.1:8080/api/chat",
            json={
                "provider": "Ollama",
                "mode": "balanced",
                "messages": [
                    {"role": "user", "content": mission_prompt}
                ]
            },
            timeout=90,
            stream=True
        ) as response:
            response.raise_for_status()
            answer = []

            for line in response.iter_lines():
                if not line:
                    continue

                event = json.loads(line)

                if event.get("type") == "token":
                    answer.append(event.get("content", ""))
                elif event.get("type") == "error":
                    raise RuntimeError("Aridal generation failed")
                elif "answer" in event:
                    answer.append(event["answer"])

            return jsonify({"reply": "".join(answer)})

    except (requests.RequestException, ValueError, RuntimeError):
        return jsonify({
            "reply": "Aridal is unavailable. Check your mission dashboard.",
            "fallback": True
        })

if __name__ == "__main__":
    # Flask debug mode (auto-reload and the interactive debugger) is off by default.
    # For local development: FLASK_DEBUG=1 python app.py. Never enable it on a shared server.
    debug_enabled = os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="127.0.0.1", port=7070, debug=debug_enabled)