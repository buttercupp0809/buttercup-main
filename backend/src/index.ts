import "./load-env";
import http from "node:http";
import { prisma } from "@buttercupp/database";
import { attachWsGateway } from "./ws/gateway";
import { handleChatStream } from "./http/chat-stream";
import { handleMediaRoute } from "./http/media";
import { handleBillingRoute } from "./http/billing";
import { getHealthSnapshot } from "./metrics";
import { logInfo, logWarn, logError } from "./utils/log";

void prisma;

const PORT = Number(process.env.PORT ?? 4000);

const server = http.createServer(async (req, res) => {
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
    res.writeHead(dbOk ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: dbOk, db: dbOk, ...snap }));
    return;
  }
  if (await handleChatStream(req, res)) return;
  if (await handleMediaRoute(req, res)) return;
  if (await handleBillingRoute(req, res)) return;
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
