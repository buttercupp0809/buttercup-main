#!/usr/bin/env bash
# ============================================================
# poppy-inference - shared helpers (sourced by every script)
# ============================================================
set -uo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/config.sh"

log()   { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
die()   { err "$*"; exit 1; }

aws_() { aws --region "$AWS_REGION" "$@"; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# ---- tiny KEY=VALUE state store ----------------------------
state_set() {  # state_set KEY VALUE
  touch "$STATE_FILE"
  grep -v "^$1=" "$STATE_FILE" > "$STATE_FILE.tmp" 2>/dev/null || true
  echo "$1=$2" >> "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}
state_get() {  # state_get KEY -> value on stdout ("" if absent)
  [[ -f "$STATE_FILE" ]] || { echo ""; return; }
  grep "^$1=" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d= -f2-
}
require_state() {
  [[ -f "$STATE_FILE" ]] || die "no .state found - run 10-deploy.sh first"
}

# Standard tag arguments applied to EVERY resource we create, so
# 40-status/50-destroy can find (and only find) our stuff.
tag_spec() {  # tag_spec <resource-type> [extra Name suffix]
  local rtype="$1" name="${2:-$PROJECT}"
  echo "ResourceType=$rtype,Tags=[{Key=Name,Value=$name},{Key=Project,Value=$PROJECT},{Key=ManagedBy,Value=$MANAGED_BY}]"
}

my_ip() { curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]'; }

instance_state() {  # -> pending|running|stopping|stopped|... or "none"
  local id; id="$(state_get INSTANCE_ID)"
  [[ -z "$id" ]] && { echo "none"; return; }
  aws_ ec2 describe-instances --instance-ids "$id" \
    --query "Reservations[0].Instances[0].State.Name" --output text 2>/dev/null || echo "none"
}

instance_ip() {
  local id; id="$(state_get INSTANCE_ID)"
  [[ -z "$id" ]] && { echo ""; return; }
  aws_ ec2 describe-instances --instance-ids "$id" \
    --query "Reservations[0].Instances[0].PublicIpAddress" --output text 2>/dev/null | sed 's/None//'
}
