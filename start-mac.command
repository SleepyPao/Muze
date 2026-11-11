#!/bin/bash
# Maze Rescue - double-click to start the game on THIS computer (macOS).
# The game opens at http://localhost:8787/ . Served from localhost (not as a file), Chrome can remember the
# microphone permission ("Allow on every visit"), so pupils are not asked every time they press Speak.
# If config.local.js has an apiKey, the AI is used through this little server; the key stays on this computer.
# Without Node.js a small Python server shows the game in Demo mode; it never serves config.local.js or .git.
cd "$(dirname "$0")" || exit 1
PORT=8787
URL="http://localhost:$PORT/"

# Is OUR server answering on the port? (-f: an error page is not "yes"; --max-time: never wait forever)
is_ours() {
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep '"ok":true' | grep -q 'maze-rescue'
}
# Is ANY program listening on the port?
port_busy() {
  if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; fi
}
# Open the browser only when the game really answers (up to about 10 s).
open_when_ready() {
  for _ in $(seq 1 40); do
    if is_ours; then open "$URL"; return 0; fi
    sleep 0.25
  done
  return 1
}

if is_ours; then
  echo "Maze Rescue is already running."; open "$URL"; exit 0
fi
if port_busy; then
  echo "Port $PORT is used by another program, so Maze Rescue cannot start."
  echo "Close that program (or an old Maze Rescue window) and double-click again."
  echo "You can also double-click index.html (the microphone will ask each time)."
  read -r -p "Press Enter to close."
  exit 1
fi
if command -v node >/dev/null 2>&1; then
  open_when_ready &
  echo "Maze Rescue: $URL   (close this window to stop)"
  HOST=127.0.0.1 PORT=$PORT node server/proxy.js
elif command -v python3 >/dev/null 2>&1 && python3 -c "import http.server" >/dev/null 2>&1; then
  echo "Node.js not found - using Python: the game runs in Demo mode (no AI)."
  open_when_ready &
  echo "Maze Rescue: $URL   (close this window to stop)"
  python3 server/fallback.py "$PORT"
else
  echo "Please install Node.js (https://nodejs.org) - or just double-click index.html (the microphone will ask each time)."
  read -r -p "Press Enter to close."
  exit 1
fi
status=$?
if [ "$status" -ne 0 ]; then read -r -p "Maze Rescue stopped. Press Enter to close."; fi
exit "$status"
