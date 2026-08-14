#!/usr/bin/env bash
# 07-provision-amplify.sh
# AWS Amplify Hosting for the Next.js 16 frontend (SSR / WEB_COMPUTE).
#
# Steps:
#   - create an Amplify app (platform WEB_COMPUTE) connected to $GITHUB_REPO_URL
#   - create the $AMPLIFY_BRANCH branch (auto-build on, framework 'Next.js - SSR')
#   - set app env vars from a git-ignored `amplify-env.env` (KEY=VALUE per line)
#   - associate the custom domain $ROOT_DOMAIN:
#         www  -> the branch (main serving surface, = $FRONTEND_HOST)
#         apex '' -> redirect to www
#
# GitHub connection note:
#   Connecting a PRIVATE GitHub repo needs a one-time authorization. Either:
#     (1) set GITHUB_ACCESS_TOKEN in the environment before running (a PAT with
#         repo scope), which this script passes as --access-token, OR
#     (2) create the app in the Amplify console using "Connect repository" (the
#         GitHub App OAuth flow) and re-run this script to fill env vars + domain.
#   The amplify.yml at the repo root drives the actual build.
#
# Prints: AMPLIFY_APP_ID and the default amplifyapp.com domain.
#
# Usage:
#   GITHUB_ACCESS_TOKEN=ghp_xxx ./07-provision-amplify.sh --yes
#   ./07-provision-amplify.sh           # interactive (console-connected repo path)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_cmds aws jq
resolve_account

app_name="$PROJECT"
env_file="$SCRIPT_DIR/amplify-env.env"

# Build the env-vars map JSON from amplify-env.env (if present).
env_json='{}'
if [ -f "$env_file" ]; then
  env_json="$(grep -vE '^\s*(#|$)' "$env_file" | jq -Rn '
    [ inputs
      | capture("^(?<k>[^=]+)=(?<v>.*)$")
      | { (.k|gsub("\\s+$";"")): .v }
    ] | add // {}')"
  log "Loaded $(jq 'length' <<<"$env_json") env var(s) from amplify-env.env"
else
  warn "no amplify-env.env found; app will be created without env vars (add them later)"
fi

# =============================================================================
# App (find-or-create)
# =============================================================================
app_id="$(aws amplify list-apps \
  --query "apps[?name=='$app_name'].appId | [0]" --output text 2>/dev/null || true)"

if [ -n "$app_id" ] && [ "$app_id" != "None" ]; then
  ok "Amplify app already exists: $app_id"
  # Keep env vars in sync on re-runs.
  if [ "$env_json" != '{}' ]; then
    confirm "Update Amplify app $app_id environment variables from amplify-env.env"
    aws amplify update-app --app-id "$app_id" \
      --platform WEB_COMPUTE \
      --environment-variables "$env_json" >/dev/null
    ok "Updated env vars on $app_id"
  fi
else
  confirm "Create Amplify app '$app_name' (WEB_COMPUTE) connected to $GITHUB_REPO_URL"
  create_args=(
    --name "$app_name"
    --platform WEB_COMPUTE
    --repository "$GITHUB_REPO_URL"
    --environment-variables "$env_json"
    --enable-branch-auto-build
  )
  if [ -n "${GITHUB_ACCESS_TOKEN:-}" ]; then
    create_args+=(--access-token "$GITHUB_ACCESS_TOKEN")
  else
    warn "GITHUB_ACCESS_TOKEN not set; if the repo is private, finish the 'Connect repository' step in the Amplify console, then re-run."
  fi
  app_id="$(aws amplify create-app "${create_args[@]}" --query 'app.appId' --output text)"
  ok "Created Amplify app: $app_id"
fi

# =============================================================================
# Branch
# =============================================================================
if aws amplify get-branch --app-id "$app_id" --branch-name "$AMPLIFY_BRANCH" >/dev/null 2>&1; then
  ok "Amplify branch already exists: $AMPLIFY_BRANCH"
else
  confirm "Create Amplify branch $AMPLIFY_BRANCH (auto-build on, framework 'Next.js - SSR')"
  aws amplify create-branch \
    --app-id "$app_id" \
    --branch-name "$AMPLIFY_BRANCH" \
    --framework "Next.js - SSR" \
    --enable-auto-build \
    --stage PRODUCTION >/dev/null
  ok "Created branch: $AMPLIFY_BRANCH"
fi

# =============================================================================
# Custom domain: www -> branch, apex -> redirect to www.
# GATED behind AMPLIFY_ASSOCIATE_DOMAIN=true because associating the domain cuts
# www over from the current host (Vercel) to Amplify. Verify the build on the
# default *.amplifyapp.com domain FIRST, then re-run with the flag to cut over.
# =============================================================================
if [ "${AMPLIFY_ASSOCIATE_DOMAIN:-false}" != "true" ]; then
  warn "Skipping custom-domain association. Test the build on the default amplifyapp.com domain,"
  warn "  then re-run with AMPLIFY_ASSOCIATE_DOMAIN=true to cut $FRONTEND_HOST over from Vercel to Amplify."
elif aws amplify get-domain-association --app-id "$app_id" --domain-name "$ROOT_DOMAIN" >/dev/null 2>&1; then
  ok "Domain association already exists: $ROOT_DOMAIN"
else
  confirm "CUT OVER: associate $ROOT_DOMAIN (www -> $AMPLIFY_BRANCH, apex redirect to www). This repoints www from Vercel to Amplify."
  aws amplify create-domain-association \
    --app-id "$app_id" \
    --domain-name "$ROOT_DOMAIN" \
    --enable-auto-sub-domain \
    --sub-domain-settings \
        "prefix=www,branchName=$AMPLIFY_BRANCH" \
        "prefix=,branchName=$AMPLIFY_BRANCH" >/dev/null
  ok "Domain association requested for $ROOT_DOMAIN"
  log "Add the DNS records Amplify shows (run: aws amplify get-domain-association --app-id $app_id --domain-name $ROOT_DOMAIN)."
  log "The apex ('') redirect to www is configured in the Amplify console/domain rewrites once the domain verifies."
fi

default_domain="$app_id.amplifyapp.com"
echo
ok "Amplify complete. Paste into config.env:"
cat <<EOF
  AMPLIFY_APP_ID=$app_id
EOF
log "Default domain: https://$AMPLIFY_BRANCH.$default_domain (custom domain: https://$FRONTEND_HOST once DNS verifies)"
