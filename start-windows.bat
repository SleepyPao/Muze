@echo off
REM Maze Rescue - double-click to start the game on THIS computer (Windows).
REM Served from http://localhost:8787/ Chrome / Edge can remember the microphone permission.
REM If config.local.js has an apiKey, the AI is used through this little server; the key stays on this computer.
REM Without Node.js a small Python server shows the game in Demo mode; it never serves config.local.js or .git.
cd /d "%~dp0"
set PORT=8787
set HOST=127.0.0.1
set URL=http://localhost:8787/

REM Already running? (curl.exe is part of Windows 10 and 11; -f: an error page is not "yes"; --max-time: never hang)
curl -sf --max-time 2 http://127.0.0.1:8787/api/health 2>nul | findstr /C:"maze-rescue" >nul 2>nul
if not errorlevel 1 goto running

where node >nul 2>nul
if errorlevel 1 goto trypython
REM Open the browser about 2 seconds from now, when the server is listening.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start %URL%"
echo Maze Rescue: %URL%   ^(close this window to stop^)
node server\proxy.js
if errorlevel 1 pause
goto :eof

:trypython
set PY=
python -c "import http.server" >nul 2>nul
if not errorlevel 1 set PY=python
if defined PY goto python
py -3 -c "import http.server" >nul 2>nul
if not errorlevel 1 set PY=py -3
if not defined PY goto nothing
:python
echo Node.js not found - using Python: the game runs in Demo mode ^(no AI^).
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start %URL%"
echo Maze Rescue: %URL%   ^(close this window to stop^)
%PY% server\fallback.py 8787
if errorlevel 1 pause
goto :eof

:running
echo Maze Rescue is already running.
start "" %URL%
goto :eof

:nothing
echo Please install Node.js from https://nodejs.org - or double-click index.html ^(the microphone will ask each time^).
pause
