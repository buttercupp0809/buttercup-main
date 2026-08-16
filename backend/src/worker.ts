// Standalone worker entrypoint. Runs in its own ECS task (or the same task
// as the API in a small dev deployment). Owns the BullMQ Worker and the
// Redis subscriber for WS bridge messages.
//
// Run locally: `npm run worker` (added to backend/package.json scripts).

import "./load-env";
import { startMediaWorker } from "./queue/media-worker";
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
  const worker = startMediaWorker();
  if (!worker) {
    // Fail-fast is correct for a dedicated worker container: ECS will
    // restart the task and the logs point straight at the cause.
    if (!isRedisConfigured()) {
      logError("worker", "FATAL: REDIS_URL not set; media worker cannot start", {
        fatal: true,
        hint: "set REDIS_URL and restart",
      });
    } else {
      logError("worker", "FATAL: bullmq not available; media worker cannot start", {
        fatal: true,
      });
    }
    process.exit(1);
  }
  const shutdown = async (signal: string) => {
    logInfo("worker", `${signal} received, shutting down`);
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
