#!/usr/bin/env bash
# ============================================================
# 00-preflight - read-only checks. Spends nothing. Run anytime.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

echo -e "${BOLD}poppy-inference preflight${NC}  (region: $AWS_REGION)\n"
need aws; need curl; need python3

log "AWS identity"
aws_ sts get-caller-identity --query "{Account:Account,Arn:Arn}" --output table \
  || die "AWS CLI not authenticated"

log "Instance type $INSTANCE_TYPE availability"
azs=$(aws_ ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values="$INSTANCE_TYPE" \
  --query "InstanceTypeOfferings[].Location" --output text)
[[ -z "$azs" ]] && die "$INSTANCE_TYPE not offered in $AWS_REGION"
ok "available in: $azs"

log "GPU vCPU quota (need >= 4 for $INSTANCE_TYPE)"
q=$(aws_ service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA \
  --query "Quota.Value" --output text 2>/dev/null || echo 0)
echo "   Running On-Demand G/VT instances quota = ${q} vCPUs"
python3 -c "import sys; sys.exit(0 if float('$q')>=4 else 1)" \
  && ok "quota sufficient" || die "quota too low - request an increase for L-DB2E81BA"

log "Resolve DLAMI ami-id via SSM"
ami=$(aws_ ssm get-parameter --name "$AMI_SSM_PARAM" --query "Parameter.Value" --output text 2>/dev/null)
[[ "$ami" == ami-* ]] && ok "AMI: $ami" || die "could not resolve AMI from $AMI_SSM_PARAM"

log "Estimated cost"
hr=$(python3 -c "print(f'{0.8536:.4f}')")   # informational; g6.xlarge eu-north-1
echo "   $INSTANCE_TYPE ~\$0.8536/hr  | STOPPED ~\$9/mo EBS only  | budget cap \$$MONTHLY_BUDGET_USD/mo"

log "Model URLs"
[[ -n "$STHENO_GGUF_URL" ]] && ok "Stheno URL set" || warn "STHENO_GGUF_URL empty"
[[ -n "$JUGGERNAUT_MODEL_URL"  ]] && ok "Juggernaut URL set"   || warn "JUGGERNAUT_MODEL_URL empty (set it in config.sh, or scp the model later)"

echo -e "\n${GREEN}preflight OK${NC} - safe to run 10-deploy.sh"
