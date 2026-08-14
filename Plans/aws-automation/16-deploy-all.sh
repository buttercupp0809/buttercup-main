#!/usr/bin/env bash
# 16-deploy-all.sh  [--yes]
# Orchestrator: run the full day-2 deploy pipeline with a gate between phases.
#
# Phases (stop on any failure):
#   1. 14-health-check.sh      pre-flight (must pass before we touch anything)
#   2. 10-migrate-db.sh        apply Prisma migrations to RDS
#   3. 11-deploy-backend.sh    full  (build + push + digest-pinned roll)
#   4. 12-deploy-frontend.sh   Amplify RELEASE build
#   5. 15-sanity-check.sh      post-deploy log + rollout scan
#
# Each mutating phase is gated with confirm (respects --yes). A failure in any
# phase aborts the pipeline immediately (set -e + explicit checks).
#
# Note: 10-migrate-db.sh needs the DB password. Export PGPASSWORD before running
# this orchestrator so the migrate phase does not block on an interactive prompt
# in the middle of the pipeline.
#
# Usage:
#   PGPASSWORD=... ./16-deploy-all.sh [--yes]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq docker curl

# Pass --yes straight through to the sub-scripts when set.
YES_FLAG=""
[ "${AUTO_YES:-false}" = true ] && YES_FLAG="--yes"

run_phase() {
  local title="$1"; shift
  printf "\n%b========== %s ==========%b\n" "$C_BLUE" "$title" "$C_RESET"
  if ! "$@"; then
    die "phase failed: $title"
  fi
}

# ---- 1. Pre-flight health (read-only, no gate) ------------------------------
run_phase "1/5 pre-flight health check" "$SCRIPT_DIR/14-health-check.sh"

# ---- 2. DB migrations -------------------------------------------------------
confirm "PHASE 2/5: apply Prisma migrations to production RDS"
run_phase "2/5 migrate DB" "$SCRIPT_DIR/10-migrate-db.sh" $YES_FLAG

# ---- 3. Backend deploy (full) ----------------------------------------------
confirm "PHASE 3/5: build + push + roll backend (api + worker)"
run_phase "3/5 backend deploy" "$SCRIPT_DIR/11-deploy-backend.sh" full $YES_FLAG

# ---- 4. Frontend deploy -----------------------------------------------------
confirm "PHASE 4/5: trigger Amplify frontend release"
run_phase "4/5 frontend deploy" "$SCRIPT_DIR/12-deploy-frontend.sh" $YES_FLAG

# ---- 5. Post-deploy sanity (read-only) --------------------------------------
run_phase "5/5 post-deploy sanity" "$SCRIPT_DIR/15-sanity-check.sh"

printf "\n"
ok "16-deploy-all.sh: full pipeline completed."
