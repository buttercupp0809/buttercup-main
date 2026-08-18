#!/usr/bin/env bash
# 03-provision-secrets.sh
# Push application secrets into AWS Secrets Manager as one secret per key,
# named "$SECRET_PREFIX/<KEY>" (e.g. buttercupp/DATABASE_URL). The ECS task
# definitions reference these by ARN (see infra/ecs/task-*.json).
#
# Input: a git-ignored file `secrets.env` in THIS directory, KEY=VALUE per line.
#   - lines starting with # and blank lines are ignored
#   - VALUE may contain '=' (only the first '=' splits the pair)
#   - surrounding single/double quotes on VALUE are stripped
#
# The script creates the secret if missing, else puts a new version. Values are
# NEVER printed; only the key names that were written are listed at the end.
#
# Expected keys (fill secrets.env with these; not all are strictly required to
# boot, but the task defs reference the core set):
#   DATABASE_URL, JWT_SECRET, REDIS_URL,
#   OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
#   ELEVENLABS_API_KEY, CARTESIA_API_KEY, GOOGLE_TTS_API_KEY,
#   FAL_KEY, REPLICATE_API_TOKEN,
#   S3_BUCKET, POPPY_S3_BUCKET_GENERATED, POPPY_S3_BUCKET_REELS, AWS_REGION,
#   CLOUDFRONT_URL, CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY,
#   PAYMENT_PRIMARY_PROVIDER,
#   CCBILL_ACCOUNT_NUMBER, CCBILL_FLEXFORM_ID, CCBILL_DATALINK_SALT,
#   VEROTEL_SHOP_ID, VEROTEL_SIGNATURE_KEY,
#   SEGPAY_PACKAGE_ID, SEGPAY_URL_ID, SEGPAY_HMAC_KEY,
#   COINBASE_COMMERCE_API_KEY, SENTRY_DSN,
#   DODO_API_KEY, DODO_WEBHOOK_KEY, DODO_ENVIRONMENT,
#   DODO_PRODUCT_DAILY, DODO_PRODUCT_WEEKLY, DODO_PRODUCT_MONTHLY,
#   DODO_PRODUCT_PACK_100, DODO_PRODUCT_PACK_500, DODO_PRODUCT_PACK_2000,
#   POPPY_ROUTER_URL, POPPY_ROUTER_TOKEN, POPPY_STHENO_URL, POPPY_JUGGERNAUT_URL,
#   MATURE_CONTENT_ENABLED
#
# Usage:
#   ./03-provision-secrets.sh            # interactive
#   ./03-provision-secrets.sh --yes      # auto-confirm
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account

secrets_file="$SCRIPT_DIR/secrets.env"
[ -f "$secrets_file" ] || die "missing $secrets_file (create it, KEY=VALUE per line; it is git-ignored)"

# Collect keys first so we can show a plan (names only) before mutating.
keys=()
while IFS= read -r _k; do [ -n "$_k" ] && keys+=("$_k"); done < <(grep -vE '^\s*(#|$)' "$secrets_file" | sed -E 's/=.*$//' | sed -E 's/[[:space:]]+$//')
[ "${#keys[@]}" -gt 0 ] || die "no KEY=VALUE lines found in $secrets_file"

log "Will write ${#keys[@]} secret(s) under prefix '$SECRET_PREFIX/':"
printf '  %s\n' "${keys[@]}"
confirm "Create/update ${#keys[@]} Secrets Manager secrets under $SECRET_PREFIX/*"

written=()
skipped=()
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  key="$(printf '%s' "$key" | sed -E 's/[[:space:]]+$//')"
  [ -n "$key" ] || continue
  # Strip one layer of surrounding quotes if present.
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac

  # Secrets Manager rejects empty values, and the app treats a missing optional
  # key as "provider not configured". So skip blanks instead of creating them.
  if [ -z "$val" ]; then
    skipped+=("$key")
    continue
  fi

  name="$SECRET_PREFIX/$key"
  if aws secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "$val" >/dev/null
  else
    aws secretsmanager create-secret \
      --name "$name" \
      --description "ButterCupp $key" \
      --secret-string "$val" >/dev/null
  fi
  written+=("$name")
done < <(grep -vE '^\s*(#|$)' "$secrets_file")

echo
ok "Wrote ${#written[@]} secret(s) (names only, values never shown):"
printf '  %s\n' "${written[@]}"
if [ "${#skipped[@]}" -gt 0 ]; then
  warn "Skipped ${#skipped[@]} empty key(s) (add a value to secrets.env + re-run to set them):"
  printf '  %s\n' "${skipped[@]}"
fi
