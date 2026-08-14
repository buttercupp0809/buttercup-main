#!/usr/bin/env bash
# 08a-migrate-dns-to-route53.sh
# One-time: create a Route 53 hosted zone for ROOT_DOMAIN and replicate the
# domain's CURRENT live records so that repointing the registrar's nameservers
# to Route 53 does NOT break the live site or email.
#
# The replicated records below were discovered from the live zone
# (buttercupp.fun, currently on Hostinger DNS): Vercel site (apex A + www CNAME),
# Zoho email (MX + SPF + zoho-verification + DKIM), and DMARC. REVIEW them
# against your DNS provider before running.
#
# After this runs, set the four printed nameservers at your registrar. Once they
# propagate, Route 53 is authoritative with an identical record set, and
# 08-provision-dns.sh (api + ACM validation) and Amplify domain association can
# manage the rest. www/apex stay on Vercel until you choose to cut over.
#
# Usage: ./08a-migrate-dns-to-route53.sh [--yes]
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"
require_cmds aws jq

# --- Existing live records to replicate (edit if your provider differs) ------
DKIM='v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCvJv36zEVGDNZzHjnMrF0huAz1DsR+f33HQRQrCIU/2Vnz0qPfJKK7WP1tyhw0TOupQvVKp8a8fIiGudiR92EWIOfE7KGUHwFWD1lCWBUkqQoZFLDwsMVPwK+BnqPnGy/RUWvrFB/lto1wKDdxA+EvMQgitkEkkdMltmhoE4ErMQIDAQAB'

# Build the change batch. TXT values are wrapped in the quotes Route 53 expects.
batch="$(jq -n \
  --arg root  "${ROOT_DOMAIN}." \
  --arg www   "www.${ROOT_DOMAIN}." \
  --arg dmarc "_dmarc.${ROOT_DOMAIN}." \
  --arg dkimn "zmail._domainkey.${ROOT_DOMAIN}." \
  --arg dkim  "$DKIM" \
  '{
    Comment: "Replicate live records before nameserver switch",
    Changes: [
      { Action:"UPSERT", ResourceRecordSet:{ Name:$root, Type:"A", TTL:300,
        ResourceRecords:[{Value:"216.198.79.1"}] } },
      { Action:"UPSERT", ResourceRecordSet:{ Name:$www, Type:"CNAME", TTL:300,
        ResourceRecords:[{Value:"c662945742541d1e.vercel-dns-017.com."}] } },
      { Action:"UPSERT", ResourceRecordSet:{ Name:$root, Type:"MX", TTL:300,
        ResourceRecords:[{Value:"10 mx.zoho.in."},{Value:"20 mx2.zoho.in."},{Value:"50 mx3.zoho.in."}] } },
      { Action:"UPSERT", ResourceRecordSet:{ Name:$root, Type:"TXT", TTL:300,
        ResourceRecords:[
          {Value:"\"zoho-verification=zb47308403.zmverify.zoho.in\""},
          {Value:"\"v=spf1 include:zoho.in ~all\""}
        ] } },
      { Action:"UPSERT", ResourceRecordSet:{ Name:$dmarc, Type:"TXT", TTL:300,
        ResourceRecords:[{Value:"\"v=DMARC1; p=none;\""}] } },
      { Action:"UPSERT", ResourceRecordSet:{ Name:$dkimn, Type:"TXT", TTL:300,
        ResourceRecords:[{Value:("\"" + $dkim + "\"")}] } }
    ]
  }')"

log "Records to replicate into Route 53 for ${ROOT_DOMAIN}:"
echo "$batch" | jq -r '.Changes[].ResourceRecordSet | "  \(.Type)\t\(.Name)\t\([.ResourceRecords[].Value]|join(" , "))"'

# --- 1. Hosted zone (create or reuse) ----------------------------------------
zid="$(aws route53 list-hosted-zones-by-name --dns-name "${ROOT_DOMAIN}." \
  --query "HostedZones[?Name=='${ROOT_DOMAIN}.'].Id | [0]" --output text 2>/dev/null || true)"
if [ -z "$zid" ] || [ "$zid" = "None" ]; then
  confirm "Create Route 53 hosted zone for ${ROOT_DOMAIN}"
  zid="$(aws route53 create-hosted-zone \
    --name "$ROOT_DOMAIN" \
    --caller-reference "buttercupp-$(date +%s)" \
    --hosted-zone-config "Comment=ButterCupp,PrivateZone=false" \
    --query 'HostedZone.Id' --output text)"
  ok "Created hosted zone: $zid"
else
  ok "Hosted zone already exists: $zid"
fi
zid="${zid#/hostedzone/}"

# --- 2. Replicate records ----------------------------------------------------
confirm "UPSERT the replicated live records (Vercel site + Zoho email) into zone $zid"
aws route53 change-resource-record-sets --hosted-zone-id "$zid" --change-batch "$batch" \
  --query 'ChangeInfo.Status' --output text >/dev/null
ok "Replicated ${ROOT_DOMAIN} records into Route 53"

# --- 3. Nameservers to set at the registrar ----------------------------------
echo
ok "Now set THESE four nameservers at your registrar (replace horizon/orbit.dns-parking.com):"
aws route53 get-hosted-zone --id "$zid" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n' | sed 's/^/  /'
echo
log "After the NS change propagates (verify: dig NS ${ROOT_DOMAIN}), the live site + email keep working,"
log "and you can run 05 (api cert auto-validates via 08-provision-dns.sh) and the Amplify cutover."