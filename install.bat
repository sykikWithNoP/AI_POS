@echo off
rem Free AI POS - setup for Windows.
rem The runtime modules are already in this folder; this checks Node.js and gets build tools if asked.
rem   install.bat         check everything is ready
rem   install.bat --dev   also install build/test tools (needed for "npm run build")
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22.5 or newer ^(LTS^):
  echo   winget install OpenJS.NodeJS.LTS
  echo   or download it from https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Install 22.5 or newer: winget upgrade OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node"') do echo [ok] Node.js %%v

node -e "Promise.all(['express','@anthropic-ai/sdk','qrcode','nepali-date-converter'].map(m=>import(m))).then(()=>process.exit(0),()=>process.exit(1))" 2>nul
if errorlevel 1 (
  echo Runtime modules missing - installing them from package-lock.json...
  call npm ci --omit=dev --no-audit --no-fund || (pause & exit /b 1)
)
echo [ok] Runtime modules

if /i "%~1"=="--dev" (
  echo Installing build/test tools ^(esbuild^)...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
  echo [ok] Build tools ready: npm run build / npm test
)

echo.
echo Ready. Start the POS by double-clicking start.bat, then open http://localhost:4321
pause
