@echo off
rem AI Workbench launcher: idempotent - if the workbench is already listening, just open the browser.
setlocal
chcp 65001 >nul
cd /d %~dp0..

rem Already running? Just open the UI.
curl -s -m 2 -o nul http://127.0.0.1:8787/api/v1/health
if %errorlevel%==0 (
    start "" http://127.0.0.1:8787
    exit /b 0
)

rem First run: install dependencies.
if not exist node_modules (
    echo [ai-workbench] Installing dependencies...
    call npm install --no-audit --no-fund
)

echo [ai-workbench] Starting on http://127.0.0.1:8787 ...
rem Redirect server output to data\logs so crashes leave a stack trace on disk.
start "ai-workbench" /min cmd /c "node server\index.js >>data\logs\server.out.log 2>>data\logs\server.err.log"
timeout /t 2 >nul
start "" http://127.0.0.1:8787
endlocal
