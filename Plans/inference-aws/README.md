# poppy-inference - isolated Stheno + Juggernaut GPU stack on AWS

A **completely separate** on-demand GPU box for two models:

- **Stheno** (`L3-8B-Stheno-v3.2`, text) via llama.cpp, OpenAI-compatible API on `:8001`
- **Juggernaut** (`Juggernaut-XL-v9`, photorealistic image) via ComfyUI on `:8188`

It does not touch the existing backend or frontend: its own VPC, subnet,
security group, key pair, and tags (`Project=poppy-inference`). Start it with
one command, stop it with one command.

## Cost model (hard cap = $587/mo)
- `g6.xlarge` (L4 24GB) in `eu-north-1` = **$0.8536/hr**. 24×7 would be $623 - over cap.
- So the box is **stopped by default**. Stopped = only **~$9/mo** EBS storage.
- Three guardrails keep you under $587:
  1. **Stopped by default** - you pay per hour only while running.
  2. **Idle auto-stop** - self-stops after `IDLE_MINUTES` (30) of no GPU use / no open connections. Kills the "left it on" bill.
  3. **AWS Budget $587** with alerts (and optional auto-stop action, below).
- Typical 8h/day usage ≈ **~$214/mo**.

## Commands
```bash
cd Plans/inference-aws

./00-preflight.sh   # read-only checks (free): creds, quota, AMI, prices
./10-deploy.sh      # ONE-TIME: build VPC + instance + budget (BILLABLE)
./20-start.sh       # start box, open firewall to your IP, print endpoints
./30-stop.sh        # stop box (halts compute billing; models kept)
./40-status.sh      # state, IP, endpoints, month-to-date cost (free)
./50-destroy.sh     # remove everything (type DESTROY)
```

## Before you deploy
Edit `config.sh`:
- `JUGGERNAUT_MODEL_URL` - direct download for the Juggernaut checkpoint (HF). If blank, deploy still works; `scp` the model into `/opt/poppy/models/comfyui/checkpoints/` later.
- Verify `STHENO_GGUF_URL` resolves (repo/quant filenames drift).
- Optional: `ALERT_EMAIL` (budget emails), `HF_TOKEN` / `CIVITAI_TOKEN` (gated downloads).

## Using it
```bash
# Text (OpenAI-compatible)
curl http://<IP>:8001/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# Image: open the ComfyUI UI
open http://<IP>:8188
```
The public IP changes on each stop/start (no Elastic IP, on purpose - an idle
EIP costs money). `20-start.sh` and `40-status.sh` always print the current IP.

## Isolation & anti-waste choices
- Dedicated VPC/subnet/SG - nothing shared with other stacks.
- **No NAT gateway** (~$32/mo saved) - public subnet + IGW instead.
- **No Elastic IP** - avoids idle-IP charges.
- `gp3` root volume, `DeleteOnTermination=true` - no orphaned disks.
- Daily `docker image prune` on the box - no image bloat.
- `50-destroy.sh` removes every created resource.

## Optional: budget auto-stop action (hardest cap)
The on-box idle auto-stop is the primary guard. For a belt-and-braces AWS-side
auto-stop at `BUDGET_ACTION_PCT` (90% = ~$528), create an IAM role the Budgets
service can assume with `ec2:StopInstances`, then attach a budget action of type
`RUN_SSM_DOCUMENTS` (`AWS-StopEC2Instance`) targeting `INSTANCE_ID`. Left manual
because it mints an IAM role - see AWS Budgets Actions docs.

## Auto start/stop (scale-to-zero) - the router
Optional control plane so the GPU runs only when needed and starts itself on
demand. Deploy it AFTER the GPU stack:
```bash
./60-router-deploy.sh    # Lambda + API Gateway + EventBridge (pennies/mo)
./65-router-destroy.sh   # remove just the router (GPU stack untouched)
```
Endpoints (set `ROUTER_AUTH_TOKEN` in config.sh first):
```
GET  /wake?token=***    -> starts GPU if stopped; returns {status, ip, eta_seconds, endpoints}
GET  /status?token=***  -> {state, ip, ready}
POST /sleep?token=***   -> manual stop
```

### Making it feel lag-free (warm-on-intent)
The first request after idle costs a 60–120s cold start. Hide it by warming on
*intent*, from your BACKEND (not the browser - keep the GPU off the public net):
- On **app open / login / entering chat** → call `/wake`. The box warms while the
  user reads or types; by the time they hit send it is hot.
- On **Meta ad landing** (the campaign links) → call `/wake` so a clicker is
  warming the GPU before they even sign up.
- Poll `/status` (or just try the GPU endpoint) until `ready`, showing a
  "waking your companion…" state if it is still `warming`.

### Scheduled pre-warm (EventBridge)
`ENABLE_SCHEDULES=true` creates two schedules (edit crons in config.sh):
- **pre-warm** `PREWARM_CRON` - start the GPU before peak / campaign hours so the
  day's first user hits zero cold start.
- **nightly stop** `NIGHTLY_STOP_CRON` - force-stop safety net on top of the
  on-box idle auto-stop.

## Reference
Script conventions (colors, state, tagging, cost reporting) mirror
`Pellow/Plans/aws-automation/`.
