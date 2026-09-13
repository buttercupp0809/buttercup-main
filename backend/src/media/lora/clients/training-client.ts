// Training box HTTP client.
//
// Implements the two halves of the training box API per the contract documented
// in Plans/inference-training-aws/train-box-router.md and the server.py source
// embedded in user-data.sh:
//
//   POST {base}/train    { jobId, tomlConfig }  -> { ok: true, jobId }
//   GET  {base}/status/{jobId}                  -> { state, jobId, log }
//
// state values: "running" | "done" | "failed" | "unknown"
//
// submitJob:
//   Generates a UUID job ID, POSTs the TOML config to the training box, and
//   returns the jobId. The box runs training asynchronously and tracks the job
//   by jobId.
//
// collectCheckpoints:
//   Polls GET /status/<jobId> until state is "done" or "failed". On done,
//   it reads checkpoint artifact keys from a known S3 location (the training
//   box writes checkpoints to its local EBS at JOBS_DIR and the backend polls
//   for them; for now the paths are inferred from the TOML outputDir convention
//   and returned as would-be S3 keys -- the actual S3 upload step is a
//   box-side concern and the keys follow a fixed pattern).
//
// If POPPY_TRAINING_URL is not set, both functions throw a clear "not configured"
// error. Never fakes a job submission or fake checkpoints.
//
// Polling config:
//   POPPY_TRAINING_POLL_INTERVAL_MS  (default 15000ms = 15s)
//   POPPY_TRAINING_POLL_TIMEOUT_MS   (default 3600000ms = 60min)

import crypto from "node:crypto";
import type { Checkpoint } from "../train";

function getTrainingBase(): string {
  const url = process.env.POPPY_TRAINING_URL;
  if (!url) {
    throw new Error(
      "Training box not configured: set POPPY_TRAINING_URL to the training API endpoint (http://<box-ip>:8282)",
    );
  }
  return url.replace(/\/$/, "");
}

function pollIntervalMs(): number {
  const raw = process.env.POPPY_TRAINING_POLL_INTERVAL_MS;
  if (!raw) return 15_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

function pollTimeoutMs(): number {
  const raw = process.env.POPPY_TRAINING_POLL_TIMEOUT_MS;
  if (!raw) return 3_600_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3_600_000;
}

interface TrainResponse {
  ok: boolean;
  jobId: string;
}

interface StatusResponse {
  state: "running" | "done" | "failed" | "unknown";
  jobId: string;
  checkpoints?: Array<{ step: number; key: string }>;
  log?: string;
}

/**
 * Submit a kohya TOML training config to the training box.
 * Returns the jobId that the box assigned to this run.
 * Throws if POPPY_TRAINING_URL is unset or the box returns a non-2xx status.
 */
export async function submitJob(tomlConfig: string): Promise<string> {
  const base = getTrainingBase();
  const jobId = crypto.randomUUID();
  const res = await fetch(`${base}/train`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, tomlConfig }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`training /train returned ${res.status}: ${text}`);
  }
  const body = (await res.json()) as TrainResponse;
  if (!body.ok) {
    throw new Error(`training /train returned ok=false for jobId ${jobId}`);
  }
  return body.jobId ?? jobId;
}

/**
 * Poll GET /status/<jobId> until done or failed, then return checkpoint keys.
 *
 * Checkpoint key convention: the training box writes safetensors files to
 * its local jobs dir and (via a post-training upload step) to S3 under:
 *   lora/<outputName>/<jobId>/step-<step>.safetensors
 *
 * The /status response includes a checkpoints array once the job is done.
 * If the box does not include checkpoints in the status response, the caller
 * receives an empty array (no checkpoints available = validation will fail,
 * which surfaces as a rejected LoRA, not a silent bug).
 *
 * Throws if POPPY_TRAINING_URL is unset, the poll times out, or the job fails.
 */
export async function collectCheckpoints(jobId: string): Promise<Checkpoint[]> {
  const base = getTrainingBase();
  const deadline = Date.now() + pollTimeoutMs();
  const interval = pollIntervalMs();

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const res = await fetch(`${base}/status/${jobId}`);
    if (!res.ok) {
      // Transient HTTP error: keep polling.
      continue;
    }
    const body = (await res.json()) as StatusResponse;

    if (body.state === "done") {
      const checkpoints: Checkpoint[] = (body.checkpoints ?? []).map((cp) => ({
        step: cp.step,
        key: cp.key,
      }));
      return checkpoints;
    }

    if (body.state === "failed") {
      const tail = body.log ? ` log tail: ${body.log.slice(-200)}` : "";
      throw new Error(`training job ${jobId} failed on box.${tail}`);
    }

    // state === "running" | "unknown": keep polling.
  }

  throw new Error(
    `training job ${jobId} timed out after ${pollTimeoutMs() / 1000}s`,
  );
}
