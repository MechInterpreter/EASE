#!/usr/bin/env bash
set -euo pipefail

if git remote get-url origin >/dev/null 2>&1; then
  echo "[push_on_change] Remote found, pushing autosave commit..."
  git add -A
  TS=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  git commit -m "chore: autosave ${TS}" || true
  git push origin HEAD:main || true
else
  echo "[push_on_change] No remote 'origin' set; skipping push."
fi
