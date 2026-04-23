#!/usr/bin/env bash
# Mission init — idempotent worker startup.
# NEVER starts the Electron desktop app; the user owns it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[init] repo root: $REPO_ROOT"
echo "[init] branch: $(git rev-parse --abbrev-ref HEAD)"
echo "[init] HEAD: $(git rev-parse --short HEAD)"

# 1. Verify toolchain
if ! command -v bun >/dev/null 2>&1; then
  echo "[init][ERROR] bun not found on PATH. Install via https://bun.sh/ and retry." >&2
  exit 1
fi
BUN_VERSION="$(bun -v)"
echo "[init] bun version: $BUN_VERSION"

if ! command -v node >/dev/null 2>&1; then
  echo "[init][ERROR] node not found on PATH." >&2
  exit 1
fi
echo "[init] node version: $(node -v)"

# 2. Verify dependencies are installed (node_modules must exist; do NOT mass-reinstall if so)
if [ ! -d "node_modules" ]; then
  echo "[init] node_modules missing — running `bun install`..."
  bun install
else
  echo "[init] node_modules present — skipping install (workers can `bun install` explicitly if they add deps)"
fi

# 3. Verify key SDK version pin
SDK_VER="$(node -e "console.log(require('./node_modules/@factory/droid-sdk/package.json').version)" 2>/dev/null || echo "unknown")"
echo "[init] @factory/droid-sdk version: $SDK_VER"
if [ "$SDK_VER" = "unknown" ]; then
  echo "[init][ERROR] @factory/droid-sdk not installed. Run `bun install` first." >&2
  exit 1
fi

# 4. Electron CDP health check (SOFT — do not fail init if unreachable; workers handle it)
if lsof -nP -iTCP:9230 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[init] Electron CDP 9230 is LISTENING (user-managed process detected)."
  if curl -sSf --max-time 2 http://127.0.0.1:9230/json/version >/dev/null 2>&1; then
    echo "[init] CDP /json/version responds OK — agent-browser ready."
  else
    echo "[init][WARN] Port 9230 listening but /json/version not responding. Workers doing manual CDP verification may need to wait or coordinate with the user."
  fi
else
  echo "[init][WARN] Port 9230 NOT listening. Manual-verification features (m1-f4, m2-f7, m3-f9, m4-f12, m4-f14) will fail or require coordination. DO NOT start Electron — ask the user."
fi

# 5. Baseline smoke: ensure test runner launches
if [ -z "${SKIP_BASELINE_TEST:-}" ]; then
  echo "[init] running baseline test smoke (1 fast file)..."
  # Pick a known-fast unit test to confirm vitest boots (not a full run)
  if [ -f "tests/unit/agentModes.test.ts" ]; then
    bun run test tests/unit/agentModes.test.ts --reporter=default >/dev/null 2>&1 && \
      echo "[init] baseline smoke PASS" || \
      echo "[init][WARN] baseline smoke failed — investigate before worker implementation"
  else
    echo "[init][WARN] tests/unit/agentModes.test.ts missing — skipping smoke"
  fi
else
  echo "[init] baseline smoke skipped (SKIP_BASELINE_TEST set)"
fi

# 6. Emit mission constants for workers to consume
echo "[init] mission baseline commit: cbeaab34"
echo "[init] mission target version: 0.1.7"
echo "[init] mission dir: /Users/wayz/.factory/missions/59de60c4-cfc9-4fe6-80c1-889502a429ed"
echo "[init] ready."
