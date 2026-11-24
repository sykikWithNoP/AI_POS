@echo off
rem Start Free AI POS (Windows). Keep this window open while you use the POS; close it to stop.
cd /d "%~dp0"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4321"
node scripts\launcher.mjs %*
