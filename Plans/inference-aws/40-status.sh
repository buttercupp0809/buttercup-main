#!/usr/bin/env bash
# ============================================================
# 40-status - state, IP, endpoints, month-to-date cost, budget.
# Read-only. Spends nothing.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
require_state
IID="$(state_get INSTANCE_ID)"

echo -e "${BOLD}poppy-inference status${NC}  (region: $AWS_REGION)\n"
st="$(instance_state)"
echo "  Instance:  $IID  [$st]"
if [[ "$st" == "running" ]]; then
  IP="$(instance_ip)"
  echo "  Public IP: $IP"
  echo "  Stheno:    http://$IP:8001/v1     Juggernaut: http://$IP:8188"
  curl -fsS --max-time 4 "http://$IP:8001/v1/models" >/dev/null 2>&1 && echo "  Stheno:    ✓ up" || echo "  Stheno:    … not ready"
  curl -fsS --max-time 4 "http://$IP:8188/" >/dev/null 2>&1 && echo "  Juggernaut:      ✓ up" || echo "  Juggernaut:      … not ready"
fi

echo ""
log "Month-to-date cost (Cost Explorer)"
START=$(date -u +%Y-%m-01); END=$(date -u +%Y-%m-%d)
[[ "$START" == "$END" ]] && END=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d "+1 day" +%Y-%m-%d)
mtd=$(aws ce get-cost-and-usage --region us-east-1 --time-period Start="$START",End="$END" \
  --granularity MONTHLY --metrics UnblendedCost \
  --query "ResultsByTime[0].Total.UnblendedCost.Amount" --output text 2>/dev/null || echo "n/a")
echo "  MTD spend (whole account): \$$mtd   |  cap: \$$MONTHLY_BUDGET_USD"

BN="$(state_get BUDGET_NAME)"
if [[ -n "$BN" ]]; then
  ACC=$(aws_ sts get-caller-identity --query Account --output text)
  aws budgets describe-budget --account-id "$ACC" --budget-name "$BN" \
    --query "Budget.{Limit:BudgetLimit.Amount,Spent:CalculatedSpend.ActualSpend.Amount}" --output table 2>/dev/null || true
fi
