"""
poppy-inference router - scale-to-zero controller.

Two invocation paths:
  1. API Gateway HTTP API (payload v2): GET /wake, GET /status, POST /sleep
     Callers (your BACKEND, not the browser) hit /wake when a user shows
     intent (opens the app, clicks a Meta ad, enters chat). It starts the
     GPU if stopped and reports state so the caller can poll readiness.
  2. EventBridge Scheduler: event {"action":"start"|"stop"} for pre-warm /
     nightly stop.

Env:
  INSTANCE_ID        the one GPU instance this router controls
  AUTH_TOKEN         optional shared secret required on HTTP calls
  WARM_ETA_SECONDS   advertised cold-start estimate
The box stops ITSELF when idle (on-box timer), so there is no /sleep needed
for normal operation; it exists only for manual override.
"""
import json
import os
import boto3

INSTANCE_ID = os.environ["INSTANCE_ID"]
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
WARM_ETA = int(os.environ.get("WARM_ETA_SECONDS", "110"))

ec2 = boto3.client("ec2")


def _describe():
    r = ec2.describe_instances(InstanceIds=[INSTANCE_ID])
    inst = r["Reservations"][0]["Instances"][0]
    return inst["State"]["Name"], inst.get("PublicIpAddress")


def _resp(code, body):
    return {
        "statusCode": code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def _start_if_needed(state):
    if state in ("stopped", "stopping"):
        try:
            ec2.start_instances(InstanceIds=[INSTANCE_ID])
            return "warming"
        except ec2.exceptions.ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code == "InsufficientInstanceCapacity":
                return "no_capacity"
            raise
    if state in ("pending",):
        return "warming"
    if state == "running":
        return "ready"
    return "unknown"


def handler(event, _ctx):
    # ---- EventBridge Scheduler path (no HTTP wrapper) ----
    action = event.get("action") if isinstance(event, dict) else None
    if action in ("start", "stop"):
        state, _ = _describe()
        if action == "start" and state in ("stopped", "stopping"):
            ec2.start_instances(InstanceIds=[INSTANCE_ID])
        elif action == "stop" and state in ("running", "pending"):
            ec2.stop_instances(InstanceIds=[INSTANCE_ID])
        return {"ok": True, "action": action, "was": state}

    # ---- HTTP API path ----
    ctx = event.get("requestContext", {}).get("http", {})
    path = event.get("rawPath", "/")
    method = ctx.get("method", "GET")
    qs = event.get("queryStringParameters") or {}
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}

    if AUTH_TOKEN:
        supplied = qs.get("token") or headers.get("x-poppy-token")
        if supplied != AUTH_TOKEN:
            return _resp(401, {"error": "unauthorized"})

    state, ip = _describe()

    if path.endswith("/wake"):
        status = _start_if_needed(state)
        return _resp(200, {
            "status": status,            # warming | ready | unknown
            "state": state,
            "ip": ip,
            "eta_seconds": 0 if status == "ready" else WARM_ETA,
            "endpoints": {"stheno": f"http://{ip}:8001/v1", "juggernaut": f"http://{ip}:8188"} if ip else None,
        })

    if path.endswith("/status"):
        return _resp(200, {"state": state, "ip": ip, "ready": state == "running"})

    if path.endswith("/sleep") and method == "POST":
        if state in ("running", "pending"):
            ec2.stop_instances(InstanceIds=[INSTANCE_ID])
        return _resp(200, {"status": "stopping", "was": state})

    return _resp(404, {"error": "not found", "path": path})
