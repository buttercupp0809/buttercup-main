#!/usr/bin/env bash
# ============================================================
# 10-deploy - ONE-TIME. Creates the ISOLATED stack:
#   dedicated VPC + subnet + IGW + route table + security group
#   + key pair + g6.xlarge instance (default STOPPED-friendly)
#   + $587 monthly Budget (alerts + auto-stop backstop).
#
# This is the ONLY billable script. Idempotent-ish: it records
# every resource id into .state and skips what already exists.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need aws; need curl; need python3

[[ -n "$(state_get INSTANCE_ID)" ]] && die "already deployed (INSTANCE_ID present). Use start/stop, or 50-destroy first."

ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)
AMI=$(aws_ ssm get-parameter --name "$AMI_SSM_PARAM" --query "Parameter.Value" --output text)
[[ "$AMI" == ami-* ]] || die "AMI resolve failed"
MYIP="$(my_ip)/32"; [[ "$MYIP" == "/32" ]] && die "could not detect your public IP"
ok "AMI=$AMI  your-ip=$MYIP  account=$ACCOUNT"

# ---- 1. VPC ------------------------------------------------
log "Creating VPC ($VPC_CIDR)"
VPC_ID=$(aws_ ec2 create-vpc --cidr-block "$VPC_CIDR" \
  --tag-specifications "$(tag_spec vpc)" --query Vpc.VpcId --output text)
aws_ ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
state_set VPC_ID "$VPC_ID"; ok "VPC $VPC_ID"

# ---- 2. IGW ------------------------------------------------
log "Internet gateway"
IGW_ID=$(aws_ ec2 create-internet-gateway --tag-specifications "$(tag_spec internet-gateway)" \
  --query InternetGateway.InternetGatewayId --output text)
aws_ ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
state_set IGW_ID "$IGW_ID"; ok "IGW $IGW_ID"

# ---- 3. Security group (locked to your IP) -----------------
log "Security group (inbound limited to $MYIP)"
SG_ID=$(aws_ ec2 create-security-group --group-name "${PROJECT}-sg" \
  --description "poppy inference" --vpc-id "$VPC_ID" \
  --tag-specifications "$(tag_spec security-group)" --query GroupId --output text)
for p in "${OPEN_PORTS[@]}"; do
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=$p,ToPort=$p,IpRanges=[{CidrIp=$MYIP,Description=owner}]" >/dev/null
done
state_set SG_ID "$SG_ID"; ok "SG $SG_ID (ports: ${OPEN_PORTS[*]})"

# ---- 4. Key pair -------------------------------------------
log "Key pair"
mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
if [[ ! -f "$KEY_DIR/$KEY_NAME.pem" ]]; then
  aws_ ec2 create-key-pair --key-name "$KEY_NAME" \
    --tag-specifications "$(tag_spec key-pair)" \
    --query KeyMaterial --output text > "$KEY_DIR/$KEY_NAME.pem"
  chmod 400 "$KEY_DIR/$KEY_NAME.pem"
fi
state_set KEY_NAME "$KEY_NAME"; ok "key at keys/$KEY_NAME.pem"

# ---- 5. Route table (VPC-level, route to IGW) --------------
log "Route table"
RT_ID=$(aws_ ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "$(tag_spec route-table)" --query RouteTable.RouteTableId --output text)
aws_ ec2 create-route --route-table-id "$RT_ID" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
state_set RT_ID "$RT_ID"; ok "route table $RT_ID"

# ---- 6. Render user-data (inject vars) ---------------------
log "Rendering user-data"
UD=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  for v in STHENO_GGUF_URL STHENO_GGUF_NAME JUGGERNAUT_MODEL_URL JUGGERNAUT_MODEL_NAME \
           HF_TOKEN CIVITAI_TOKEN IDLE_MINUTES ENABLE_IDLE_STOP AWS_REGION STHENO_CTX \
           LLAMACPP_IMAGE COMFYUI_IMAGE; do
    printf 'export %s=%q\n' "$v" "${!v}"
  done
  tail -n +2 "$HERE/user-data.sh"   # body minus its own shebang
} > "$UD"

# ---- 7. Launch, trying AZs until one has capacity ----------
# GPU capacity flips between AZs (InsufficientInstanceCapacity), so try
# FORCE_AZ first (if set) then every other AZ that offers the type. A subnet
# is created per attempt in the target AZ and deleted if that AZ has no capacity.
OFFER_AZS=$(aws_ ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values="$INSTANCE_TYPE" \
  --query "InstanceTypeOfferings[].Location" --output text | tr '\t' ' ')
CANDIDATES=""
[[ -n "${FORCE_AZ:-}" ]] && CANDIDATES="$FORCE_AZ"
for az in $OFFER_AZS; do [[ "$az" != "${FORCE_AZ:-}" ]] && CANDIDATES="$CANDIDATES $az"; done
log "Launching $INSTANCE_TYPE, AZ order:$CANDIDATES"

IID=""; USED_AZ=""
for az in $CANDIDATES; do
  SUBNET_ID=$(aws_ ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$SUBNET_CIDR" \
    --availability-zone "$az" --tag-specifications "$(tag_spec subnet)" \
    --query Subnet.SubnetId --output text 2>/dev/null)
  [[ -z "$SUBNET_ID" ]] && { warn "$az: subnet create failed"; continue; }
  aws_ ec2 modify-subnet-attribute --subnet-id "$SUBNET_ID" --map-public-ip-on-launch
  aws_ ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_ID" >/dev/null
  out=$(aws_ ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
    --instance-initiated-shutdown-behavior "$SHUTDOWN_BEHAVIOR" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$EBS_SIZE_GB,VolumeType=$EBS_TYPE,DeleteOnTermination=true}" \
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
    --user-data "file://$UD" \
    --tag-specifications "$(tag_spec instance)" "$(tag_spec volume)" \
    --query "Instances[0].InstanceId" --output text 2>&1)
  if [[ "$out" == i-* ]]; then
    IID="$out"; USED_AZ="$az"
    state_set SUBNET_ID "$SUBNET_ID"; state_set AZ "$az"
    ok "launched in $az"
    break
  elif echo "$out" | grep -q "InsufficientInstanceCapacity"; then
    warn "$az: no capacity, trying next AZ"
    aws_ ec2 delete-subnet --subnet-id "$SUBNET_ID" 2>/dev/null
  else
    err "$az: launch failed: $out"
    aws_ ec2 delete-subnet --subnet-id "$SUBNET_ID" 2>/dev/null
  fi
done
rm -f "$UD"
[[ -z "$IID" ]] && die "no $INSTANCE_TYPE capacity in any AZ ($CANDIDATES). Retry later, or change region/INSTANCE_TYPE."
state_set INSTANCE_ID "$IID"; ok "instance $IID in $USED_AZ (provisioning + downloading models on first boot)"

# ---- 8b. Elastic IP (stable address for 24/7 mode) ---------
# A stable IP means the backend can use static POPPY_*_URL values and never
# depends on the router for IP resolution. An EIP attached to a RUNNING
# instance is free; it only bills (~$3.6/mo) while the instance is stopped.
log "Allocating + associating Elastic IP"
aws_ ec2 wait instance-running --instance-ids "$IID" 2>/dev/null || true
EIP_ALLOC=$(aws_ ec2 allocate-address --domain vpc \
  --tag-specifications "$(tag_spec elastic-ip)" --query AllocationId --output text 2>/dev/null || echo "")
if [[ -n "$EIP_ALLOC" && "$EIP_ALLOC" != "None" ]]; then
  aws_ ec2 associate-address --instance-id "$IID" --allocation-id "$EIP_ALLOC" >/dev/null 2>&1 || true
  EIP_ADDR=$(aws_ ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text 2>/dev/null)
  state_set EIP_ALLOC "$EIP_ALLOC"; state_set EIP "$EIP_ADDR"
  ok "Elastic IP $EIP_ADDR (set POPPY_STHENO_URL/POPPY_JUGGERNAUT_URL in backend/.env to this)"
else
  warn "EIP allocation skipped (check EIP quota); box still reachable via its public IP"
fi

# ---- 9. Budget (hard cap backstop) -------------------------
log "Monthly budget \$$MONTHLY_BUDGET_USD"
notif=""
if [[ -n "$ALERT_EMAIL" ]]; then
  for pct in "${BUDGET_ALERT_PCTS[@]}"; do
    notif+=" {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":$pct,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ALERT_EMAIL\"}]},"
  done
fi
bfile=$(mktemp)
cat > "$bfile" <<JSON
{"BudgetName":"${PROJECT}-budget","BudgetLimit":{"Amount":"$MONTHLY_BUDGET_USD","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}
JSON
if [[ -n "$notif" ]]; then
  nfile=$(mktemp); echo "[ ${notif%,} ]" > "$nfile"
  aws budgets create-budget --account-id "$ACCOUNT" --budget "file://$bfile" \
    --notifications-with-subscribers "file://$nfile" 2>/dev/null \
    && ok "budget + email alerts created" || warn "budget create skipped (may already exist / no perms)"
  rm -f "$nfile"
else
  aws budgets create-budget --account-id "$ACCOUNT" --budget "file://$bfile" 2>/dev/null \
    && ok "budget created (set ALERT_EMAIL for email alerts)" || warn "budget create skipped"
fi
rm -f "$bfile"
state_set BUDGET_NAME "${PROJECT}-budget"
warn "Auto-stop-at-${BUDGET_ACTION_PCT}% budget ACTION needs an IAM role; see README. On-box idle auto-stop (${IDLE_MINUTES}m) is the primary guard and is already active."

echo -e "\n${GREEN}Deployed.${NC} First boot pulls images + models (several min)."
echo    "Next:  ./20-start.sh   (wait for health, get endpoints)"
echo    "Note:  it is RUNNING now to provision. Run ./30-stop.sh when done, or let idle auto-stop handle it."
