#!/usr/bin/env bash
# 17-ship-all.sh  [--yes] [--allow-db-push] [--skip-gpu|--skip-db|--skip-backend|--skip-frontend]
#
# ONE command to ship poppy (ButterCupp) end to end. Idempotent: safe to run
# every time. Designed so that a single `./17-ship-all.sh --yes` brings the
# whole system to a known-good deployed state without further babysitting.
#
# Phases (each prod mutation is gated by confirm; --yes makes it fully
# non-interactive):
#   0. Preflight   tools present, AWS creds valid, Docker running (auto-starts
#                  Docker Desktop on macOS and waits).
#   1. GPU box     start the self-hosted inference EC2 (discovered by its Elastic
#                  IP), nudge the router /wake, then VERIFY Stheno :8001,
#                  Juggernaut :8188, and the router respond. Non-fatal: the app
#                  falls back to cloud providers if the box stays down.
#   2. DB parity   apply Prisma migrations to prod RDS (versioned = the parity
#                  mechanism), then a migrate-diff drift check. Residual drift is
#                  reported; with --allow-db-push, ADDITIVE-ONLY drift (ADD
#                  COLUMN / CREATE TABLE|INDEX|EXTENSION IF NOT EXISTS) is applied
#                  through a destructive-statement guard. DROP/TRUNCATE/ALTER
#                  TYPE etc. are never auto-applied.
#   3. Backend     build + push the image and digest-pin roll api + worker
#                  (delegates to 11-deploy-backend.sh full).
#   4. Frontend    MERGE amplify-env.env onto the LIVE Amplify env (never drops a
#                  live key) then start + poll an Amplify RELEASE build.
#   5. Sanity      read-only post-deploy scan (15-sanity-check.sh) + /healthz +
#                  GPU endpoint recap.
#
# Nothing here is a secret; connection values come from secrets.env (git-ignored)
# and amplify-env.env. This script MUTATES production. It confirms every step
# unless --yes is passed.
#
# Usage:
#   ./17-ship-all.sh --yes                 # full unattended ship
#   ./17-ship-all.sh --yes --allow-db-push # also apply additive schema drift
#   ./17-ship-all.sh --skip-gpu --yes      # everything except the GPU box
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq curl

# ---- Flags ------------------------------------------------------------------
ALLOW_DB_PUSH=false
SKIP_GPU=false; SKIP_DB=false; SKIP_BE=false; SKIP_FE=false
for a in "$@"; do
  case "$a" in
    --allow-db-push) ALLOW_DB_PUSH=true ;;
    --skip-gpu)      SKIP_GPU=true ;;
    --skip-db)       SKIP_DB=true ;;
    --skip-backend)  SKIP_BE=true ;;
    --skip-frontend) SKIP_FE=true ;;
    --yes)           ;;  # consumed by lib.sh (AUTO_YES)
    *) die "unknown argument: $a" ;;
  esac
done
YES_FLAG=""; [ "${AUTO_YES:-false}" = true ] && YES_FLAG="--yes"

# Read a single value from secrets.env without sourcing the whole file (its
# CLOUDFRONT_PRIVATE_KEY line contains backslashes that a naive source mangles).
secret_val() { grep -m1 "^$1=" "$SCRIPT_DIR/secrets.env" 2>/dev/null | cut -d= -f2- || true; }

banner() { printf "\n%b========== %s ==========%b\n" "$C_BLUE" "$1" "$C_RESET"; }

# =============================================================================
# Phase 0: preflight
# =============================================================================
ensure_docker() {
  # Only needed when we will build the backend image.
  if [ "$SKIP_BE" = true ]; then return 0; fi
  if docker info >/dev/null 2>&1; then ok "Docker is running"; return 0; fi
  log "Docker is not running; launching Docker Desktop ..."
  open -a Docker >/dev/null 2>&1 || open -a "Docker Desktop" >/dev/null 2>&1 \
    || warn "could not auto-open Docker Desktop (open it manually)"
  local i
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then ok "Docker is ready"; return 0; fi
    printf "."; sleep 3
  done
  echo
  die "Docker did not start within ~180s. Start Docker Desktop and re-run."
}

# =============================================================================
# Phase 1: GPU inference box (wake + verify)
# =============================================================================
verify_endpoint() {
  local label="$1" url="$2" tries="${3:-24}" i
  log "verifying $label: $url"
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 6 "$url" >/dev/null 2>&1; then ok "$label responding"; return 0; fi
    sleep 10
  done
  return 1
}

phase_gpu() {
  banner "1/5 GPU inference box"
  local router token stheno jug ip iid state wq
  router="$(secret_val POPPY_ROUTER_URL)"
  token="$(secret_val POPPY_ROUTER_TOKEN)"
  stheno="$(secret_val POPPY_STHENO_URL)"
  jug="$(secret_val POPPY_JUGGERNAUT_URL)"
  if [ -z "$stheno" ] && [ -z "$router" ]; then
    warn "no POPPY_* endpoints in secrets.env; skipping GPU phase"
    return 0
  fi
  ip="$(printf '%s' "$stheno" | sed -E 's#^https?://##; s#:.*$##')"

  # 1. Ensure the EC2 box is running (discovered by its Elastic IP so we never
  #    hardcode an instance id that could change).
  if [ -n "$ip" ]; then
    iid="$(aws ec2 describe-addresses --region "$AWS_REGION" --public-ips "$ip" \
      --query 'Addresses[0].InstanceId' --output text 2>/dev/null || true)"
    if [ -n "$iid" ] && [ "$iid" != "None" ]; then
      state="$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$iid" \
        --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo unknown)"
      log "GPU box $iid ($ip) state: $state"
      if [ "$state" != "running" ]; then
        confirm "START GPU EC2 instance $iid ($ip)"
        aws ec2 start-instances --region "$AWS_REGION" --instance-ids "$iid" >/dev/null
        log "waiting for instance to reach 'running' ..."
        aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$iid"
        ok "instance running (services still booting)"
      fi
    else
      warn "could not resolve an instance from IP $ip (EIP may have moved); relying on router wake"
    fi
  fi

  # 2. Nudge the router to (re)start the box + its inference services. This is
  #    the same /wake the backend uses; it is best-effort.
  if [ -n "$router" ]; then
    wq="${router%/}/wake"; [ -n "$token" ] && wq="$wq?token=$token"
    log "calling router /wake ..."
    if curl -fsS --max-time 30 "$wq" >/dev/null 2>&1; then ok "router wake accepted"; else warn "router wake call failed (continuing to verify)"; fi
  fi

  # 3. Verify the actual inference endpoints answer (this is the real check:
  #    the instance can be 'running' while llama.cpp / ComfyUI are still down).
  local gpu_ok=true
  if [ -n "$stheno" ]; then
    verify_endpoint "Stheno (:8001)" "${stheno%/}/v1/models" 24 \
      || { warn "Stheno not responding on $stheno (services may need a restart on the box)"; gpu_ok=false; }
  fi
  if [ -n "$jug" ]; then
    verify_endpoint "Juggernaut (:8188)" "${jug%/}/system_stats" 6 \
      || { warn "Juggernaut not responding on $jug (ComfyUI may need a restart on the box)"; gpu_ok=false; }
  fi
  if [ "$gpu_ok" = true ]; then
    ok "GPU box up: chat runs on Stheno and in-chat images can generate"
  else
    warn "GPU box not fully up. Chat falls back to OpenRouter; in-chat images will fail until it is."
    warn "  If the EC2 is 'running' but ports are dead, the llama.cpp/ComfyUI services on the box need restarting (SSH/SSM)."
  fi
}

# =============================================================================
# Phase 2: database parity (prod RDS)
# =============================================================================
# Additive-only guard, mirroring Pellow's assert_additive_sql: return 0 for a
# safe additive statement, 1 for anything that could lose data.
is_additive_sql() {
  local s; s="$(printf '%s' "$1" | sed 's/^[[:space:]]*//')"
  case "$s" in ""|--*|/\**) return 1 ;; esac
  if printf '%s' "$s" | grep -qiE '\b(DROP|TRUNCATE|DELETE|RENAME|ALTER[[:space:]]+TABLE[[:space:]].*(DROP|ALTER[[:space:]]+COLUMN|SET[[:space:]]+NOT[[:space:]]+NULL)|ALTER[[:space:]]+COLUMN.*TYPE)\b'; then
    return 1
  fi
  printf '%s' "$s" | grep -qiE '^(CREATE[[:space:]]+(TABLE|INDEX|UNIQUE[[:space:]]+INDEX|EXTENSION)([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?|ALTER[[:space:]]+TABLE[[:space:]].*[[:space:]]ADD[[:space:]]+COLUMN)'
}

phase_db() {
  banner "2/5 database parity (prod RDS)"
  require_cmds npx psql
  local dburl; dburl="$(secret_val DATABASE_URL)"
  [ -n "$dburl" ] || die "no DATABASE_URL in secrets.env"

  confirm "DB PARITY: ensure pgvector + apply Prisma migrations to PROD RDS ($RDS_ENDPOINT/$DB_NAME)"

  log "ensuring pgvector extension (idempotent) ..."
  psql "$dburl" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null \
    && ok "pgvector present"

  local pdir="$REPO_ROOT/packages/database"

  log "prisma migrate deploy (applies committed migrations = local->prod parity) ..."
  ( cd "$pdir" && DATABASE_URL="$dburl" npx prisma migrate deploy )
  ok "migrate deploy completed"

  log "prisma migrate status:"
  ( cd "$pdir" && DATABASE_URL="$dburl" npx prisma migrate status ) || warn "migrate status returned non-zero (see above)"

  # Residual drift: schema.prisma vs what is actually in prod. migrate diff
  # --exit-code returns 0 = identical, 2 = drift, 1 = error. (return/local stay
  # in this function's scope; only the cd runs in a subshell.)
  log "checking for residual schema drift ..."
  local rc=0
  ( cd "$pdir" && DATABASE_URL="$dburl" npx prisma migrate diff \
      --from-url "$dburl" --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1 ) || rc=$?
  if [ "$rc" = "0" ]; then
    ok "no drift: prod schema matches schema.prisma"
    ok "database parity phase complete"
    return 0
  fi
  if [ "$rc" != "2" ]; then
    warn "could not compute schema diff (prisma exit $rc); skipping drift auto-align"
    ok "database parity phase complete"
    return 0
  fi

  warn "schema drift detected between prod and schema.prisma"
  local drift="/tmp/poppy-drift-$$.sql"
  ( cd "$pdir" && DATABASE_URL="$dburl" npx prisma migrate diff \
      --from-url "$dburl" --to-schema-datamodel prisma/schema.prisma --script ) > "$drift" 2>/dev/null || true

  local applied=0 refused=0 stmt
  # Normalize to one statement per line, then classify each.
  while IFS= read -r stmt; do
    [ -z "${stmt// }" ] && continue
    case "$stmt" in --*) continue ;; esac
    if is_additive_sql "$stmt"; then
      if [ "$ALLOW_DB_PUSH" = true ]; then
        if psql "$dburl" -v ON_ERROR_STOP=1 -c "$stmt" >/dev/null 2>&1; then
          ok "applied additive: $stmt"; applied=$((applied+1))
        else
          warn "additive statement failed: $stmt"
        fi
      else
        warn "additive change pending (re-run with --allow-db-push to apply): $stmt"
      fi
    else
      warn "REFUSED non-additive (needs human review): $stmt"; refused=$((refused+1))
    fi
  done < <(grep -vE '^\s*(--|$)' "$drift" | tr '\n' ' ' | sed 's/;[[:space:]]*/;\n/g')

  rm -f "$drift"
  log "drift summary: applied=$applied refused=$refused (allow_db_push=$ALLOW_DB_PUSH)"
  if [ "$refused" -gt 0 ]; then
    warn "$refused destructive/unknown drift statement(s) were NOT applied (need human review)."
  fi
  ok "database parity phase complete"
}

# =============================================================================
# Phase 3: backend (delegates to the digest-pinned deployer)
# =============================================================================
phase_backend() {
  banner "3/5 backend deploy (api + worker)"
  # 11-deploy-backend.sh owns build+push+digest-pinned roll and waits for
  # services-stable + /healthz. We pass through --yes when set.
  "$SCRIPT_DIR/11-deploy-backend.sh" full $YES_FLAG
}

# =============================================================================
# Phase 4: frontend (Amplify env MERGE + RELEASE build)
# =============================================================================
phase_frontend() {
  banner "4/5 frontend (Amplify env + release)"
  need AMPLIFY_APP_ID
  local env_file="$SCRIPT_DIR/amplify-env.env"

  if [ -f "$env_file" ]; then
    # Parse amplify-env.env into a JSON object.
    local file_json
    file_json="$(grep -vE '^\s*(#|$)' "$env_file" | jq -Rn '
      [ inputs | capture("^(?<k>[^=]+)=(?<v>.*)$") | { (.k|gsub("\\s+$";"")): .v } ] | add // {}')"

    # Read the LIVE env and MERGE the file ON TOP. This never drops a key that
    # only exists live (e.g. APP_AWS_REGION, OPENROUTER_API_KEY, REDIS_URL,
    # POPPY_S3_BUCKET_REELS are live-only), which a blind --environment-variables
    # replace would wipe and break prod.
    local live_json merged_json
    live_json="$(aws amplify get-app --app-id "$AMPLIFY_APP_ID" --region "$AMPLIFY_REGION" \
      --query 'app.environmentVariables' --output json)"
    merged_json="$(jq -s '.[0] * .[1]' <(printf '%s' "$live_json") <(printf '%s' "$file_json"))"

    local before after
    before="$(jq 'length' <<<"$live_json")"; after="$(jq 'length' <<<"$merged_json")"
    confirm "MERGE Amplify env for $AMPLIFY_APP_ID ($before live keys -> $after after merge; live keys preserved)"
    aws amplify update-app --app-id "$AMPLIFY_APP_ID" --region "$AMPLIFY_REGION" \
      --platform WEB_COMPUTE --environment-variables "$merged_json" >/dev/null
    ok "Amplify env merged ($after keys)"
  else
    warn "no amplify-env.env; skipping env sync (build will use existing env)"
  fi

  confirm "START an Amplify RELEASE build for $AMPLIFY_APP_ID / $AMPLIFY_BRANCH"
  local job
  job="$(aws amplify start-job --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$AMPLIFY_BRANCH" --job-type RELEASE --query 'jobSummary.jobId' --output text)"
  ok "Amplify job $job started; polling to completion ..."
  while true; do
    local st
    st="$(aws amplify get-job --region "$AMPLIFY_REGION" --app-id "$AMPLIFY_APP_ID" \
      --branch-name "$AMPLIFY_BRANCH" --job-id "$job" --query 'job.summary.status' --output text)"
    case "$st" in
      SUCCEED)          ok "Amplify build $job SUCCEEDED"; break ;;
      FAILED|CANCELLED) die "Amplify build $job ended: $st" ;;
      *)                printf "  amplify: %s ...\n" "$st"; sleep 10 ;;
    esac
  done
}

# =============================================================================
# Phase 5: post-deploy sanity (read-only)
# =============================================================================
phase_sanity() {
  banner "5/5 post-deploy sanity"
  "$SCRIPT_DIR/15-sanity-check.sh" || warn "sanity check reported warnings (review above)"
  if curl -fsS --max-time 8 "https://${API_HOST}${HEALTH_PATH}" >/dev/null 2>&1; then
    ok "backend https://${API_HOST}${HEALTH_PATH} -> 200"
  else
    warn "backend health not 200 yet (rollout may still be settling)"
  fi
}

# =============================================================================
# Run
# =============================================================================
printf "%bpoppy ship-all%b  account=%s region=%s  (yes=%s allow_db_push=%s)\n" \
  "$C_GREEN" "$C_RESET" "${AWS_ACCOUNT_ID:-?}" "$AWS_REGION" "${AUTO_YES:-false}" "$ALLOW_DB_PUSH"

ensure_docker
[ "$SKIP_GPU" = true ] && log "skip: GPU"      || phase_gpu
[ "$SKIP_DB" = true ]  && log "skip: DB"       || phase_db
[ "$SKIP_BE" = true ]  && log "skip: backend"  || phase_backend
[ "$SKIP_FE" = true ]  && log "skip: frontend" || phase_frontend
phase_sanity

printf "\n"
ok "17-ship-all.sh complete. Verify chat + images on https://${FRONTEND_HOST}."
