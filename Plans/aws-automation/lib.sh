#!/usr/bin/env bash
# Shared helpers for every ButterCupp AWS automation script.
#
# Every script starts with:
#   set -euo pipefail
#   source "$(dirname "$0")/lib.sh"
#
# lib.sh sources config.env, resolves the AWS account id, and exposes logging,
# guard, and small AWS helpers. It NEVER performs a mutation on its own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

# ---- Logging ----------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET='\033[0m'; C_BLUE='\033[34m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'
else
  C_RESET=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi
log()  { printf "%b==>%b %s\n" "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf "%b OK%b %s\n" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf "%bWARN%b %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf "%bERR%b %s\n" "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ---- Preconditions ----------------------------------------------------------
require_cmds() {
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing required command: $c"; done
}

# Resolve the AWS account id from the active credentials unless already set.
resolve_account() {
  if [ -z "${AWS_ACCOUNT_ID:-}" ] || [ "$AWS_ACCOUNT_ID" = "FILL" ]; then
    AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
    [ -n "$AWS_ACCOUNT_ID" ] || die "could not resolve AWS account id (is 'aws' configured?)"
    export AWS_ACCOUNT_ID
  fi
}

# Fail fast if a required "FILL AFTER PROVISION" value has not been set yet.
need() {
  local name="$1"; local val="${!name:-}"
  if [ -z "$val" ] || [ "$val" = "FILL" ]; then
    die "config value '$name' is not set yet. Run the provisioning step that produces it, then paste it into config.env."
  fi
}

# ---- Confirm gate -----------------------------------------------------------
# Every mutating action calls: confirm "<human description of what will change>"
# Pass --yes on the command line to skip the prompt in automation.
AUTO_YES="${AUTO_YES:-false}"
for a in "$@"; do [ "$a" = "--yes" ] && AUTO_YES=true; done
confirm() {
  local msg="$1"
  printf "\n%bABOUT TO:%b %s\n" "$C_YELLOW" "$C_RESET" "$msg"
  printf "Account=%s Region=%s\n" "${AWS_ACCOUNT_ID:-?}" "$AWS_REGION"
  if [ "$AUTO_YES" = true ]; then ok "auto-confirmed (--yes)"; return 0; fi
  printf "Type 'yes' to proceed: "; read -r reply
  [ "$reply" = "yes" ] || die "aborted by user"
}

# ---- Small AWS helpers ------------------------------------------------------
ecr_uri()    { echo "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"; }
secret_arn() { echo "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_PREFIX}/$1"; }
# The value CLOUDFRONT_URL that the app expects (https base, no trailing slash).
cloudfront_url() { [ "${CLOUDFRONT_DOMAIN:-FILL}" = "FILL" ] && echo "" || echo "https://${CLOUDFRONT_DOMAIN}"; }

resolve_account
