#!/usr/bin/env bash
# Start NINDITO POS (macOS/Linux). Open http://localhost:4321 afterwards. Stop with Ctrl+C.
cd "$(dirname "$0")"
exec node scripts/launcher.mjs "$@"
