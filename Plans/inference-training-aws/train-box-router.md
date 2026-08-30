# poppy-lora-training - scale-to-zero router

> **DO NOT PROVISION WITHOUT EXPLICIT HUMAN APPROVAL.**
> The Lambda + API Gateway resources described here incur AWS charges when deployed.

Scale-to-zero control plane for the `buttercupp-lora` BullMQ queue.
The training box starts when a job is enqueued and stops when it has been idle
for `IDLE_MINUTES`. Mirrors the router pattern from `Plans/inference-aws/`
(Lambda + API Gateway + EventBridge).

---

## Start-on-enqueue flow

```
BullMQ worker (backend)
  picks up job from "buttercupp-lora" queue
  |
  v
router GET /wake?token=***
  Lambda: if instance is stopped -> ec2.StartInstances
  returns { status: "warming"|"ready", ip, eta_seconds }
  |
  v
backend polls GET /status?token=*** until { ready: true }
  (shows "waking your companion" UI state to user if UI-visible)
  |
  v
backend POSTs training payload to http://<ip>:8282/train
  { jobId, tomlConfig }   (TOML from buildKohyaConfig in train.ts)
  |
  v
training-api (server.py on :8282) runs kohya_ss sdxl_train_network.py
backend polls GET http://<ip>:8282/status/<jobId> until done/failed
  |
  v
backend uploads checkpoint .safetensors to S3
updates CharacterLora record (status -> "ready", arcfaceScore, s3Key)
```

The TOML config sent in step 4 is produced by `buildKohyaConfig` in
`backend/src/media/lora/train.ts` with the dataset directory and output name
filled in by the BullMQ worker. The queue name `buttercupp-lora` matches
`LORA_QUEUE_NAME` from `packages/shared/src/lora.ts`.

---

## Stop-on-idle flow

Two layers of idle stop, same as `Plans/inference-aws/`:

**Layer 1 (on-box, primary):** `poppy-lora-idle.timer` runs every 5 min.
Checks:
- No active GPU utilization (nvidia-smi < 5%)
- No open connections on `:8282` (training API) or `:8188` (ComfyUI)
- No `.training-lock` file (left by `server.py` while a job runs)
- No `.keepalive` file (manual override; admin removes when done)
- No active SSH sessions on `:22`

If idle for `IDLE_MINUTES` consecutive ticks, calls `shutdown -h now`.
Instance `SHUTDOWN_BEHAVIOR=stop` ensures this stops (not terminates) the box.

**Layer 2 (AWS Budgets, backstop):** the `$MONTHLY_BUDGET_USD` budget alarm
at 90% can trigger an AWS Budgets stop action (manual step; see README.md).
Belt-and-braces against a stuck idle check.

---

## Router Lambda

Mirrors `Plans/inference-aws/router/lambda_function.py` (same handler pattern).
Differences:
- `INSTANCE_ID` is the training box instance (not the inference box).
- `/wake` endpoint: returns `{ status, ip, eta_seconds, endpoints }` where
  `endpoints.trainingApi = "http://<ip>:8282"` instead of stheno/juggernaut.
- `WARM_ETA_SECONDS` default: 120 (model downloads already baked into AMI;
  only Docker startup + service ready check adds latency after a stop/start).

Deploy after the training box is provisioned:
```bash
# APPROVAL REQUIRED before running.
./router-deploy.sh    # Lambda + API Gateway + EventBridge (pennies/mo)
./router-destroy.sh   # remove just the router; training box untouched
```

Router endpoints (set `ROUTER_AUTH_TOKEN` in `config.sh` first):
```
GET  /wake?token=***      starts box if stopped; {status, ip, eta_seconds, endpoints}
GET  /status?token=***    {state, ip, ready}
POST /sleep?token=***     manual stop
```

EventBridge schedules (optional, `ENABLE_SCHEDULES=true` in `config.sh`):
- `PREWARM_CRON`: start before expected peak usage hours.
- `NIGHTLY_STOP_CRON`: force-stop safety net on top of the on-box idle timer.

---

## IAM scoping

Lambda execution role is scoped to ONLY this one training box instance:
```json
{
  "Effect": "Allow",
  "Action": ["ec2:StartInstances", "ec2:StopInstances"],
  "Resource": "arn:aws:ec2:<region>:<account>:instance/<INSTANCE_ID>"
}
```
Plus minimal CloudWatch Logs permissions. Same pattern as inference-aws.

---

## Capacity-error / fallback AZ handling

`g5.xlarge` (A10G 24GB) may hit `InsufficientInstanceCapacity` in a given AZ.
When the router `/wake` receives this from `ec2.start_instances`, it returns:
```json
{ "status": "no_capacity", "state": "stopped", "ip": null, "eta_seconds": null }
```

The backend BullMQ worker (Task 13) handles `no_capacity` by:
1. Logging the capacity error.
2. Retrying the queue job with exponential backoff.
3. Optionally alerting ops to move the instance to a different AZ
   (`FORCE_AZ` in `config.sh`, then re-deploy the subnet).

Fallback AZ order for `eu-north-1` g5 capacity (in priority order when the
primary AZ is exhausted): `eu-north-1b` -> `eu-north-1a` -> `eu-north-1c`.
Update `AZ` in `config.sh` and re-run `./deploy.sh` to move. Only one subnet
per AZ needed; the old subnet can be deleted after the new one is active.

---

## No Elastic IP

The training box has no Elastic IP (same as inference and video boxes).
An idle EIP costs ~$3.65/mo. The router always fetches the current public IP
from `ec2.describe_instances` and returns it in `/wake` and `/status` responses.
The backend reads the IP from the router response; no hardcoded IP anywhere.

---

## Reference

- Queue name: `buttercupp-lora` (from `LORA_QUEUE_NAME` in `packages/shared/src/lora.ts`)
- Training API port: `8282` (not public; backend SG inbound only)
- ComfyUI (validation) port: `8188`
- Router pattern: mirrors `Plans/inference-aws/router/lambda_function.py`
- Idle check pattern: mirrors `Plans/inference-aws/user-data.sh` idle-check section
