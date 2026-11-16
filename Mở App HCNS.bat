@echo off
rem Bat PostgreSQL (ban portable) neu chua chay, roi mo App HCNS tai http://localhost:3600
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\Programs\pgsql\bin;%PATH%"
set "PGDATA=%LOCALAPPDATA%\Programs\pgdata"
pg_ctl status -D "%PGDATA%" >nul 2>&1 || pg_ctl start -w -D "%PGDATA%" -l "%PGDATA%\server.log" -o "-c listen_addresses=localhost"
start "" http://localhost:3600
node server/server.js
pause
