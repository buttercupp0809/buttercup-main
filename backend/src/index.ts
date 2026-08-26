import "./load-env";
import http from "node:http";
import { prisma } from "@buttercupp/database";
import { attachWsGateway } from "./ws/gateway";
import { handleChatStream } from "./http/chat-stream";
import { handleChatCheckin } from "./http/chat-checkin";
import { handleChatCheckinStream } from "./http/chat-checkin-stream";
import { handleMediaRoute } from "./http/media";
import { handleBillingRoute } from "./http/billing";
import { handleGalleryRoute } from "./http/gallery";
import { handleAnalyticsRoute } from "./http/analytics";
import { applyCors } from "./http/cors";
import { getHealthSnapshot } from "./metrics";
import { getQueueHealth } from "./queue/queue-health";
import { logInfo, logWarn, logError } from "./utils/log";

void prisma;

const PORT = Number(process.env.PORT ?? 4000);

const server = http.createServer(async (req, res) => {
  // The frontend browser calls this server directly (billing, media,
  // chat-stream), so every response needs CORS headers or the browser
  // discards them before the app ever sees a body. See http/cors.ts.
  if (applyCors(req, res)) return;

  if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
    // Cheap liveness probe first; if DB is reachable we also emit metrics
    // so an ECS/ALB check can pick up degraded providers via /healthz.
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    const snap = getHealthSnapshot();
    // Queue health is best-effort. A Redis outage MUST NOT flip /health
    // to 500: we still want the liveness probe to succeed as long as the
    // API can talk to the DB, and callers read `redisReachable` +
    // `queue` to spot a dead worker. Only DB failure demotes the status.
    let queue = {
      redisConfigured: false,
      redisReachable: false,
      queue: null as null | Record<string, number>,
      error: null as null | string,
    };
    try {
      queue = (await getQueueHealth()) as typeof queue;
    } catch (err) {
      queue = {
        redisConfigured: false,
        redisReachable: false,
        queue: null,
        error: err instanceof Error ? err.message : "queue_error",
      };
    }
    res.writeHead(dbOk ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: dbOk,
        db: dbOk,
        redisConfigured: queue.redisConfigured,
        redisReachable: queue.redisReachable,
        queue: queue.queue,
        ...snap,
      }),
    );
    return;
  }
  if (await handleChatStream(req, res)) return;
  if (await handleChatCheckinStream(req, res)) return;
  if (await handleChatCheckin(req, res)) return;
  if (await handleMediaRoute(req, res)) return;
  if (await handleBillingRoute(req, res)) return;
  if (await handleGalleryRoute(req, res)) return;
  if (await handleAnalyticsRoute(req, res)) return;
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

attachWsGateway(server);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logWarn(
      "startup",
      `port ${PORT} is already in use. Another instance is likely still running. ` +
        `Free it with: npm run dev:clean (or: lsof -ti:${PORT} | xargs kill -9), then start again.`,
    );
    process.exit(1);
  }
  logError("startup", err);
  process.exit(1);
});

server.listen(PORT, () => {
  logInfo("startup", `http+ws listening on :${PORT}`);
});
