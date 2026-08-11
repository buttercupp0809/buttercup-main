#!/usr/bin/env bash
# ============================================================
# 50-destroy - remove EVERYTHING this stack created so nothing
# lingers billing (the "garbage"). Terminates instance + EBS,
# deletes SG, subnet, RT, IGW, VPC, key pair, budget, .state.
# Requires typing DESTROY to confirm.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
require_state

echo -e "${RED}${BOLD}This deletes the inference stack and its models.${NC}"
read -r -p "Type DESTROY to confirm: " ans
[[ "$ans" == "DESTROY" ]] || die "aborted"

# tear down the router control plane first (if present)
if [[ -n "$(state_get ROUTER_URL)" ]]; then
  log "Removing router control plane"
  echo "DESTROY" | "$HERE/65-router-destroy.sh" >/dev/null 2>&1 || warn "router teardown had warnings"
fi

IID="$(state_get INSTANCE_ID)"; SG_ID="$(state_get SG_ID)"; SUBNET_ID="$(state_get SUBNET_ID)"
RT_ID="$(state_get RT_ID)"; IGW_ID="$(state_get IGW_ID)"; VPC_ID="$(state_get VPC_ID)"
KEY="$(state_get KEY_NAME)"; BN="$(state_get BUDGET_NAME)"
EIP_ALLOC="$(state_get EIP_ALLOC)"

if [[ -n "$IID" ]]; then
  log "Terminating instance $IID"
  aws_ ec2 terminate-instances --instance-ids "$IID" >/dev/null 2>&1 || true
  aws_ ec2 wait instance-terminated --instance-ids "$IID" 2>/dev/null || true
  ok "instance gone (root EBS deleted with it)"
fi
# Release the Elastic IP (an unassociated EIP keeps billing ~$3.6/mo).
if [[ -n "$EIP_ALLOC" ]]; then
  log "Releasing Elastic IP $EIP_ALLOC"
  aws_ ec2 release-address --allocation-id "$EIP_ALLOC" 2>/dev/null && ok "EIP released" || warn "EIP release may need a manual retry"
fi
if [[ -n "$SG_ID" ]]; then log "Deleting SG"; aws_ ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null || warn "SG delete retry may be needed"; fi
if [[ -n "$SUBNET_ID" ]]; then log "Deleting subnet"; aws_ ec2 delete-subnet --subnet-id "$SUBNET_ID" 2>/dev/null || true; fi
if [[ -n "$RT_ID" ]]; then log "Deleting route table"; aws_ ec2 delete-route-table --route-table-id "$RT_ID" 2>/dev/null || true; fi
if [[ -n "$IGW_ID" && -n "$VPC_ID" ]]; then
  log "Detaching + deleting IGW"
  aws_ ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" 2>/dev/null || true
  aws_ ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" 2>/dev/null || true
fi
if [[ -n "$VPC_ID" ]]; then log "Deleting VPC"; aws_ ec2 delete-vpc --vpc-id "$VPC_ID" 2>/dev/null || warn "VPC delete may need a retry"; fi
if [[ -n "$KEY" ]]; then log "Deleting key pair"; aws_ ec2 delete-key-pair --key-name "$KEY" 2>/dev/null || true; rm -f "$KEY_DIR/$KEY.pem"; fi
if [[ -n "$BN" ]]; then
  ACC=$(aws_ sts get-caller-identity --query Account --output text)
  log "Deleting budget"; aws budgets delete-budget --account-id "$ACC" --budget-name "$BN" 2>/dev/null || true
fi

rm -f "$STATE_FILE"
ok "destroyed. Verify none remain: ./40-status.sh will report no state."
echo "Double-check in console there are no leftover volumes/EIPs tagged Project=$PROJECT."
