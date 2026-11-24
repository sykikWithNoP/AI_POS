#!/usr/bin/env bash
# Start Free AI POS (macOS/Linux). Open http://localhost:4321 afterwards. Stop with Ctrl+C.
cd "$(dirname "$0")"
exec node scripts/launcher.mjs "$@"
