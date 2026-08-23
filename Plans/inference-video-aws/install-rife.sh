#!/usr/bin/env bash
# Install (or re-install) the ComfyUI-Frame-Interpolation custom node on the
# ALREADY-RUNNING Wan box without a full re-provision. Safe to run more than
# once: the git clone is skipped if the directory already exists, and pip
# install is idempotent.
#
# Usage: ./install-rife.sh
# Prereqs: box is running (wan-start.sh has been called), your IP is in the SG.
#
# After this script succeeds, set WAN_INTERPOLATION=1 in the backend environment
# to enable Stage C (32fps RIFE interpolation). Do NOT set that env var
# automatically; it requires human sign-off and a backend redeploy.
#
# rife49.pth auto-downloads on the first RIFE render; you do not need to fetch
# it manually.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

IID="$(grep -E '^INSTANCE_ID=' "$VSTATE" | cut -d= -f2)"
[ -z "${IID:-}" ] && { echo "no INSTANCE_ID in $VSTATE"; exit 1; }

IP="$(grep -E '^PUBLIC_IP=' "$VSTATE" | cut -d= -f2)"
if [ -z "${IP:-}" ] || [ "$IP" = "None" ]; then
  IP="$(aws --region "$AWS_REGION" ec2 describe-instances --instance-ids "$IID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
fi
[ -z "${IP:-}" ] || [ "$IP" = "None" ] && { echo "box has no public IP; is it running?"; exit 1; }

SSH="ssh -i $KEY_PEM -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@$IP"

echo "== target: ubuntu@$IP =="

echo "== 1. clone ComfyUI-Frame-Interpolation (skip if exists) =="
$SSH bash -s <<'REMOTE'
set -euo pipefail
CUSTOM_NODES=/opt/poppy/comfyui-custom-nodes
RIFE_DIR="$CUSTOM_NODES/ComfyUI-Frame-Interpolation"
mkdir -p "$CUSTOM_NODES"
if [ ! -d "$RIFE_DIR/.git" ]; then
  git clone --depth 1 https://github.com/Fannovel16/ComfyUI-Frame-Interpolation "$RIFE_DIR"
  echo "cloned"
else
  echo "exists: $RIFE_DIR (skip clone)"
fi
chmod -R 777 "$CUSTOM_NODES"
REMOTE

echo "== 2. pip install requirements inside the container =="
$SSH bash -s <<'REMOTE'
set -euo pipefail
RIFE_REQ="/opt/ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation/requirements.txt"
docker exec poppy-wan bash -c "
  PYTHON=\$(command -v python3 || command -v python) &&
  if [ -f '$RIFE_REQ' ]; then
    \$PYTHON -m pip install --quiet --no-warn-script-location -r '$RIFE_REQ' && echo 'rife pip install done'
  else
    echo 'requirements.txt not found; node directory may be empty' && exit 1
  fi
"
REMOTE

echo "== 3. restart ComfyUI to load the new node =="
$SSH bash -s <<'REMOTE'
set -euo pipefail
systemctl restart poppy-wan.service
echo "poppy-wan restarting..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "ComfyUI up with RIFE node"; break
  fi
  sleep 5
  [ "$i" -eq 30 ] && echo "not up after 150s; check: journalctl -u poppy-wan"
done
REMOTE

echo
echo "RIFE install complete."
echo "Confirm the node loaded: http://$IP:8188 -> Manager -> Installed Custom Nodes"
echo
echo "To enable Stage C (32fps interpolation), set in the backend environment:"
echo "  WAN_INTERPOLATION=1"
echo "then redeploy. Do NOT set it automatically; it requires human sign-off."
