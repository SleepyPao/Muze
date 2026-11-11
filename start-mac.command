#!/bin/bash
# Maze Rescue - double-click to start the game on THIS computer (macOS).
# The game opens at http://localhost:8787/ . Served from localhost (not as a file), Chrome can remember the
# microphone permission ("Allow on every visit"), so pupils are not asked every time they press Speak.
# If config.local.js has an apiKey, the AI is used through this little server; the key stays on this computer.
cd "$(dirname "$0")" || exit 1
PORT=8787
URL="http://localhost:$PORT/"
if curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Maze Rescue is already running."; open "$URL"; exit 0
fi
if command -v node >/dev/null 2>&1; then
  (sleep 1; open "$URL") &
  echo "Maze Rescue: $URL   (close this window to stop)"
  HOST=127.0.0.1 PORT=$PORT node server/proxy.js
elif command -v python3 >/dev/null 2>&1 && python3 -c "import http.server" >/dev/null 2>&1; then
  echo "Node.js not found - using Python (no AI relay; Demo mode unless config.local.js has a key)."
  (sleep 1; open "$URL") &
  echo "Maze Rescue: $URL   (close this window to stop)"
  python3 -m http.server $PORT --bind 127.0.0.1
else
  echo "Please install Node.js (https://nodejs.org) - or just double-click index.html (the microphone will ask each time)."
  read -r -p "Press Enter to close."
fi
