#!/usr/bin/env bash
# ============================================================
# 60-router-deploy - scale-to-zero control plane (BILLABLE but
# tiny: Lambda + API Gateway + EventBridge = pennies/mo, no GPU).
#
#   /wake   -> starts the GPU on demand (warm-on-intent)
#   /status -> current state + IP
#   /sleep  -> manual stop
#   EventBridge -> pre-warm before peak + nightly safety stop
#
# IAM is scoped to ONLY this one instance. Run AFTER 10-deploy.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need aws; need python3; need zip
require_state
IID="$(state_get INSTANCE_ID)"; [[ -z "$IID" ]] && die "no INSTANCE_ID - run 10-deploy.sh first"
[[ -n "$(state_get ROUTER_URL)" ]] && die "router already deployed. Use 65-router-destroy first."

ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)
INSTANCE_ARN="arn:aws:ec2:${AWS_REGION}:${ACCOUNT}:instance/${IID}"
FN="$ROUTER_NAME"
[[ -z "$ROUTER_AUTH_TOKEN" ]] && warn "ROUTER_AUTH_TOKEN is empty - /wake will be UNAUTHENTICATED. Set it in config.sh for production."

# ---- 1. Lambda execution role (scoped to this instance) ----
log "IAM role for Lambda"
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
LAMBDA_ROLE_ARN=$(aws_ iam create-role --role-name "${FN}-role" \
  --assume-role-policy-document "$TRUST" \
  --tags Key=Project,Value="$PROJECT" Key=ManagedBy,Value="$MANAGED_BY" \
  --query Role.Arn --output text 2>/dev/null) \
  || LAMBDA_ROLE_ARN=$(aws_ iam get-role --role-name "${FN}-role" --query Role.Arn --output text)
POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"arn:aws:logs:*:*:*"},
 {"Effect":"Allow","Action":["ec2:DescribeInstances"],"Resource":"*"},
 {"Effect":"Allow","Action":["ec2:StartInstances","ec2:StopInstances"],"Resource":"$INSTANCE_ARN"}
]}
JSON
)
aws_ iam put-role-policy --role-name "${FN}-role" --policy-name "${FN}-policy" --policy-document "$POLICY"
state_set LAMBDA_ROLE "${FN}-role"; ok "role ${FN}-role"
log "waiting for IAM propagation"; sleep 12

# ---- 2. Package + create Lambda ----------------------------
log "Packaging Lambda"
ZIP=$(mktemp -d)/router.zip
( cd "$HERE/router" && zip -q "$ZIP" lambda_function.py )
LAMBDA_ARN=""
for attempt in 1 2 3 4 5; do
  LAMBDA_ARN=$(aws_ lambda create-function --function-name "$FN" \
    --runtime python3.12 --handler lambda_function.handler \
    --role "$LAMBDA_ROLE_ARN" --timeout 30 --memory-size 128 \
    --zip-file "fileb://$ZIP" \
    --environment "Variables={INSTANCE_ID=$IID,AUTH_TOKEN=$ROUTER_AUTH_TOKEN,WARM_ETA_SECONDS=$WARM_ETA_SECONDS}" \
    --tags Project="$PROJECT",ManagedBy="$MANAGED_BY" \
    --query FunctionArn --output text 2>/dev/null) && break
  warn "create-function retry $attempt (role may still be propagating)"; sleep 8
done
[[ -z "$LAMBDA_ARN" ]] && die "Lambda create failed"
state_set LAMBDA_ARN "$LAMBDA_ARN"; ok "lambda $FN"

# ---- 3. HTTP API (quick-create -> $default stage) ----------
log "API Gateway HTTP API"
API_ID=$(aws_ apigatewayv2 create-api --name "$FN" --protocol-type HTTP \
  --target "$LAMBDA_ARN" \
  --query ApiId --output text)
# allow API Gateway to invoke the function
aws_ lambda add-permission --function-name "$FN" --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT}:${API_ID}/*" 2>/dev/null || true
ROUTER_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
state_set API_ID "$API_ID"; state_set ROUTER_URL "$ROUTER_URL"
ok "router URL: $ROUTER_URL"

# ---- 4. EventBridge Scheduler (pre-warm + nightly stop) ----
if [[ "$ENABLE_SCHEDULES" == "true" ]]; then
  log "EventBridge Scheduler role"
  STRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  SCHED_ROLE_ARN=$(aws_ iam create-role --role-name "${FN}-sched-role" \
    --assume-role-policy-document "$STRUST" \
    --tags Key=Project,Value="$PROJECT" Key=ManagedBy,Value="$MANAGED_BY" \
    --query Role.Arn --output text 2>/dev/null) \
    || SCHED_ROLE_ARN=$(aws_ iam get-role --role-name "${FN}-sched-role" --query Role.Arn --output text)
  aws_ iam put-role-policy --role-name "${FN}-sched-role" --policy-name invoke \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$LAMBDA_ARN\"}]}"
  state_set SCHED_ROLE "${FN}-sched-role"
  sleep 10

  log "pre-warm schedule ($PREWARM_CRON $SCHEDULE_TZ)"
  aws_ scheduler create-schedule --name "${FN}-prewarm" \
    --schedule-expression "$PREWARM_CRON" --schedule-expression-timezone "$SCHEDULE_TZ" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "{\"Arn\":\"$LAMBDA_ARN\",\"RoleArn\":\"$SCHED_ROLE_ARN\",\"Input\":\"{\\\"action\\\":\\\"start\\\"}\"}" 2>/dev/null \
    && state_set PREWARM_SCHED "${FN}-prewarm" && ok "prewarm scheduled" || warn "prewarm schedule skipped"

  log "nightly stop schedule ($NIGHTLY_STOP_CRON $SCHEDULE_TZ)"
  aws_ scheduler create-schedule --name "${FN}-nightstop" \
    --schedule-expression "$NIGHTLY_STOP_CRON" --schedule-expression-timezone "$SCHEDULE_TZ" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "{\"Arn\":\"$LAMBDA_ARN\",\"RoleArn\":\"$SCHED_ROLE_ARN\",\"Input\":\"{\\\"action\\\":\\\"stop\\\"}\"}" 2>/dev/null \
    && state_set STOP_SCHED "${FN}-nightstop" && ok "nightly stop scheduled" || warn "nightly stop schedule skipped"
fi

echo -e "\n${GREEN}Router deployed.${NC}"
echo "  Wake:   curl \"$ROUTER_URL/wake?token=***\""
echo "  Status: curl \"$ROUTER_URL/status?token=***\""
echo "  Call /wake from your backend on app-open / ad-landing so the GPU is hot before the user sends anything."
