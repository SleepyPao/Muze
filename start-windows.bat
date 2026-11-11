@echo off
REM Maze Rescue - double-click to start the game on THIS computer (Windows).
REM Served from http://localhost:8787/ Chrome / Edge can remember the microphone permission.
REM If config.local.js has an apiKey, the AI is used through this little server; the key stays on this computer.
cd /d "%~dp0"
set PORT=8787
set HOST=127.0.0.1
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8787/
  echo Maze Rescue: http://localhost:8787/   ^(close this window to stop^)
  node server\proxy.js
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  echo Node.js not found - using Python ^(Demo mode unless config.local.js has a key^).
  start "" http://localhost:8787/
  python -m http.server 8787 --bind 127.0.0.1
  goto :eof
)
echo Please install Node.js from https://nodejs.org - or double-click index.html ^(the microphone will ask each time^).
pause
