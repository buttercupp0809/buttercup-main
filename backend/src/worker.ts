// Standalone worker entrypoint. Runs in its own ECS task (or the same task
// as the API in a small dev deployment). Owns the BullMQ Worker and the
// Redis subscriber for WS bridge messages.
//
// Run locally: `npm run worker` (added to backend/package.json scripts).

import "./load-env";
import { startMediaWorker } from "./queue/media-worker";
import { logInfo, logWarn, logError } from "./utils/log";

async function main() {
  logInfo("worker", "process starting");
  const worker = startMediaWorker();
  if (!worker) {
    logWarn("worker", "no worker started (check REDIS_URL and bullmq); exiting");
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
