#!/usr/bin/env bash
# NINDITO POS — setup for macOS and Linux.
# The runtime modules are already in this folder; this checks Node.js and gets the build tools if asked.
#   ./install.sh          check everything is ready
#   ./install.sh --dev    also install build/test tools (needed for `npm run build`)
set -euo pipefail
cd "$(dirname "$0")"

need_major=22; need_minor=5
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js ${need_major}.${need_minor} or newer (LTS):"
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "  brew install node@22        (Homebrew)   or download from https://nodejs.org"
  else
    echo "  Ubuntu/Debian: see https://nodejs.org/en/download (NodeSource or nvm: nvm install 22)"
  fi
  exit 1
fi
ver="$(node -p 'process.versions.node')"
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>${need_major}||(a===${need_major}&&b>=${need_minor})?0:1)"; then
  echo "Node.js ${ver} is too old. Install ${need_major}.${need_minor} or newer (e.g. nvm install 22)."
  exit 1
fi
echo "✓ Node.js ${ver}"

# Runtime modules ship with the project; reinstall only if they are missing (e.g. a partial copy).
if ! node -e "Promise.all(['express','@anthropic-ai/sdk','qrcode','nepali-date-converter'].map(m=>import(m))).then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  echo "Runtime modules missing — installing them from package-lock.json…"
  npm ci --omit=dev --no-audit --no-fund
fi
echo "✓ Runtime modules (express, Anthropic SDK, qrcode, nepali-date-converter)"

if [[ "${1:-}" == "--dev" ]]; then
  echo "Installing build/test tools (esbuild)…"
  npm install --no-audit --no-fund
  echo "✓ Build tools ready: npm run build · npm test"
fi

# Optional extras
command -v lp >/dev/null 2>&1 && echo "✓ System printing (lp) found — USB receipt printers can be used" || echo "• Optional: install CUPS (lp) to print to USB receipt printers"
chmod +x start.sh 2>/dev/null || true
echo
echo "Ready. Start the POS with:  ./start.sh   then open http://localhost:4321"
