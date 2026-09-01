// LoRA training worker. One BullMQ Worker instance per process consuming
// the dedicated buttercupp-lora queue. Low concurrency (1) is correct
// because GPU training is a serial, long-running operation.
//
// Mirrors the pattern from media-worker.ts:
//   - Single-worker lock via Redis SET NX (prevents two workers stealing
//     BullMQ job locks and freezing all training jobs).
//   - createWorkerConnection() gives the worker its own blocking Redis client.
//   - Payload validated with trainLoraJobPayloadSchema at the trust boundary
//     before calling the handler.
//
// Does NOT start automatically. Called from backend/src/worker.ts once the
// infra layer is ready.

import { LORA_QUEUE_NAME, trainLoraJobPayloadSchema } from "@buttercupp/shared";
import { createWorkerConnection, getRedisConnection } from "./connection";
import { runTrainLoraJob } from "../media/lora/handler";
import { logInfo, logWarn, logError } from "../utils/log";

const LORA_WORKER_LOCK_KEY = "poppy:lora-worker:lock";
const LORA_WORKER_LOCK_TTL_MS = 90_000; // longer than media: training can be slow
const LORA_WORKER_LOCK_RENEW_MS = 30_000;

const WORKER_INSTANCE_ID = `lora-${process.pid}-${Date.now()}`;

async function acquireLoraWorkerLock(): Promise<NodeJS.Timeout | null> {
  const redis = getRedisConnection();
  if (!redis) return null;
  const ok = await redis.set(
    LORA_WORKER_LOCK_KEY,
    WORKER_INSTANCE_ID,
    "PX",
    LORA_WORKER_LOCK_TTL_MS,
    "NX",
  );
  if (ok !== "OK") {
    const holder = await redis.get(LORA_WORKER_LOCK_KEY).catch(() => "unknown");
    logError(
      "lora-worker",
      new Error(
        `another lora worker is already running (lock held by ${holder}). ` +
          `Refusing to start a second worker.`,
      ),
      { instance: WORKER_INSTANCE_ID },
    );
    return null;
  }
  logInfo("lora-worker", "acquired single-worker lock", { instance: WORKER_INSTANCE_ID });
  const timer = setInterval(() => {
    redis
      .set(LORA_WORKER_LOCK_KEY, WORKER_INSTANCE_ID, "PX", LORA_WORKER_LOCK_TTL_MS, "XX")
      .catch((err: unknown) =>
        logWarn("lora-worker", "lock renew failed", { err: String(err) }),
      );
  }, LORA_WORKER_LOCK_RENEW_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

async function releaseLoraWorkerLock(): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) return;
  const holder = await redis.get(LORA_WORKER_LOCK_KEY).catch(() => null);
  if (holder === WORKER_INSTANCE_ID) await redis.del(LORA_WORKER_LOCK_KEY).catch(() => null);
}

interface JobLike {
  id: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
}

/**
 * Process a single lora training job. Exported for unit-testing without BullMQ.
 * Validates the payload, then delegates to runTrainLoraJob.
 */
export async function processLoraJob(job: JobLike): Promise<void> {
  logInfo("lora-worker", `job ${job.id} received`, { attemptsMade: job.attemptsMade });

  // Validate the payload at the worker trust boundary.
  const parsed = trainLoraJobPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    const msg = `invalid lora job payload: ${parsed.error.message}`;
    logError("lora-worker", new Error(msg), { jobId: job.id });
    // Do not throw: an invalid payload will never succeed on retry. Let the
    // job complete (return without throwing) so BullMQ marks it as succeeded
    // rather than retrying indefinitely.
    return;
  }

  logInfo("lora-worker", `job ${job.id} start characterId=${parsed.data.characterId}`);
  await runTrainLoraJob(parsed.data);
  logInfo("lora-worker", `job ${job.id} done`);
}

function loadBullMq(): { Worker: unknown } | null {
  try {
    return require("bullmq");
  } catch {
    return null;
  }
}

/**
 * Boot a real BullMQ worker for the buttercupp-lora queue.
 * Returns null when Redis/BullMQ are absent or when another worker holds the
 * lock (caller fails fast).
 */
export async function startLoraWorker(): Promise<{ close: () => Promise<void> } | null> {
  const connection = createWorkerConnection();
  if (!connection) {
    logWarn("lora-worker", "REDIS_URL not set; lora worker not started");
    return null;
  }
  const mod = loadBullMq();
  if (!mod) {
    logWarn("lora-worker", "bullmq not installed; lora worker not started");
    return null;
  }

  const lockTimer = await acquireLoraWorkerLock();
  if (!lockTimer && getRedisConnection()) {
    return null; // another worker owns the lock
  }

  const WorkerCtor = mod.Worker as new (
    name: string,
    fn: (job: JobLike) => Promise<void>,
    opts: Record<string, unknown>,
  ) => { close: () => Promise<void>; on: (evt: string, fn: (...a: unknown[]) => void) => void };

  const worker = new WorkerCtor(LORA_QUEUE_NAME, (job) => processLoraJob(job), {
    connection,
    concurrency: 1, // GPU training is serial; never run two at once
  });

  let processed = 0;
  worker.on("completed", () => {
    processed += 1;
    logInfo("lora-worker", "heartbeat", { processed, trigger: "completed" });
  });
  worker.on("failed", (_job: unknown, err: unknown) => {
    logError("lora-worker", err instanceof Error ? err : new Error(String(err)), {
      trigger: "failed",
    });
  });

  const close = worker.close.bind(worker);
  logInfo("lora-worker", "started (concurrency 1)");

  return {
    close: async () => {
      if (lockTimer) clearInterval(lockTimer);
      await releaseLoraWorkerLock().catch(() => null);
      await close();
    },
  };
}
