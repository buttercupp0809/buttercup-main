#!/usr/bin/env bash
# ============================================================
# 30-stop - stop the instance. Compute billing stops; you keep
# only ~$9/mo EBS. Models persist for next start. Simple command.
# ============================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
require_state
IID="$(state_get INSTANCE_ID)"; [[ -z "$IID" ]] && die "no INSTANCE_ID in state"

st="$(instance_state)"
[[ "$st" == "stopped" ]] && { ok "already stopped"; exit 0; }
log "Stopping $IID"
aws_ ec2 stop-instances --instance-ids "$IID" >/dev/null
aws_ ec2 wait instance-stopped --instance-ids "$IID"
ok "stopped - compute billing halted, models preserved on EBS"
