#!/usr/bin/env bash
# One command to run the whole local video stack, self-healing on the way up.
#
#   npm run dev:video
#
# It (1) makes sure Redis is up, (2) runs the video-box DOCTOR so the Wan 2.2
# box is healthy and POPPY_WAN_URL points at it, then (3) starts backend +
# frontend + exactly ONE media worker. The worker holds a Redis single-worker
# lock, so even if a stray worker is already running this one refuses rather
# than causing the double-worker lock-contention hang. Ctrl-C stops all three.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1;33m[dev:video]\033[0m %s\n" "$*"; }

# 1. Redis ------------------------------------------------------------------
if ! redis-cli ping >/dev/null 2>&1; then
  say "Redis not responding on localhost:6379. Start it first (e.g. 'docker compose up -d redis' or 'brew services start redis'), then re-run."
  exit 1
fi
say "Redis OK"

# 2. Video-box doctor (auto-heal the GPU box) -------------------------------
say "Running video-box doctor (wake / pin / caddy / firewall) ..."
chmod +x Plans/inference-video-aws/video-doctor.sh 2>/dev/null || true
if ! ./Plans/inference-video-aws/video-doctor.sh; then
  say "Box is NOT healthy. Video generation will fail until it recovers (see message above)."
  say "Chat/images still work. Continuing to start the app so you are not blocked."
fi

# 3. Start the stack --------------------------------------------------------
pids=()
cleanup() {
  say "shutting down ..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

say "starting backend (:4000) ..."
( npm run dev:backend ) & pids+=("$!")
say "starting frontend (:3000) ..."
( npm run dev:frontend ) & pids+=("$!")
say "starting ONE media worker (single-worker lock enforced) ..."
( npm run worker --workspace=backend ) & pids+=("$!")

say "All started. Ctrl-C stops everything. (Do NOT start another worker: the lock will reject it.)"
wait
