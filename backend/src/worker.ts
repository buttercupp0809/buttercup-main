// Standalone worker entrypoint. Runs in its own ECS task (or the same task
// as the API in a small dev deployment). Owns the BullMQ Worker and the
// Redis subscriber for WS bridge messages.
//
// Run locally: `npm run worker` (added to backend/package.json scripts).

import "./load-env";
import { startMediaWorker } from "./queue/media-worker";
import { startLoraWorker } from "./queue/lora-worker";
import { isRedisConfigured } from "./queue/connection";
import { logInfo, logError } from "./utils/log";

// Local run (host, outside docker):
//   docker compose up -d redis
//   REDIS_URL=redis://localhost:6379 npm run worker -w backend
// For real generation add POPPY_JUGGERNAUT_URL=http://127.0.0.1:8188 (or a
// FAL_KEY / REPLICATE_API_TOKEN). Without a running worker + reachable
// Redis, enqueued image jobs sit unprocessed and no image ever appears;
// that is the exact local symptom this phase repairs.
async function main() {
  logInfo("worker", "process starting", {
    redisConfigured: isRedisConfigured(),
    concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 4),
  });
  const worker = await startMediaWorker();
  if (!worker) {
    // Fail-fast is correct for a dedicated worker container: ECS will
    // restart the task and the logs point straight at the cause.
    if (!isRedisConfigured()) {
      logError("worker", "FATAL: REDIS_URL not set; media worker cannot start", {
        fatal: true,
        hint: "set REDIS_URL and restart",
      });
    } else {
      // Most common cause now: a second worker was started while one is already
      // running. The single-worker lock refuses it (see media-worker logs).
      logError("worker", "worker not started (another worker holds the lock, or bullmq is unavailable)", {
        fatal: true,
        hint: "a media worker is likely already running; do NOT start a second one",
      });
    }
    process.exit(1);
  }

  // LoRA training worker (concurrency 1, serial GPU training).
  // Null return is non-fatal: the process keeps running to serve media jobs.
  // A null here means Redis is absent, BullMQ is missing, or another lora
  // worker already holds the single-worker lock.
  const loraWorker = await startLoraWorker();
  if (!loraWorker) {
    logInfo("worker", "lora worker not started (Redis absent, lock held, or BullMQ unavailable); media worker continues");
  }

  const shutdown = async (signal: string) => {
    logInfo("worker", `${signal} received, shutting down`);
    if (loraWorker) await loraWorker.close();
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logError("worker", err, { fatal: true });
  process.exit(1);
});
