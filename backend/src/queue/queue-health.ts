// Read-only health surfaces for the BullMQ media queue + Redis liveness.
// Used by GET /health so a dead/stalled worker is visible instead of
// silent. All calls are guarded so a Redis outage produces a JSON body
// with `redisReachable:false` rather than a 500 (see index.ts).
//
// Secret hygiene: only booleans and numeric counts leave this module.
// Never return the REDIS_URL, connection string, or any credential.

import { getRedisConnection, isRedisConfigured } from "./connection";
import { MEDIA_QUEUE_NAME } from "@buttercupp/shared";

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed?: number;
}

export interface QueueHealth {
  redisConfigured: boolean;
  redisReachable: boolean;
  queue: QueueCounts | null;
  error: string | null;
}

const PING_TIMEOUT_MS = 500;

function loadBullMqQueue(): { Queue: unknown } | null {
  try {
    return require("bullmq");
  } catch {
    return null;
  }
}

interface RedisLike {
  ping: () => Promise<string>;
}

async function pingWithTimeout(client: RedisLike): Promise<boolean> {
  return await Promise.race<boolean>([
    client
      .ping()
      .then((r) => typeof r === "string" && r.toUpperCase() === "PONG")
      .catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PING_TIMEOUT_MS)),
  ]);
}

let _queueForHealth: unknown = null;

function getQueueForHealth(): unknown | null {
  if (_queueForHealth) return _queueForHealth;
  const connection = getRedisConnection();
  if (!connection) return null;
  const mod = loadBullMqQueue();
  if (!mod) return null;
  const QueueCtor = mod.Queue as new (name: string, opts: Record<string, unknown>) => unknown;
  _queueForHealth = new QueueCtor(MEDIA_QUEUE_NAME, { connection });
  return _queueForHealth;
}

export async function getQueueHealth(): Promise<QueueHealth> {
  const redisConfigured = isRedisConfigured();
  if (!redisConfigured) {
    return { redisConfigured, redisReachable: false, queue: null, error: null };
  }
  const client = getRedisConnection() as unknown as RedisLike | null;
  if (!client) {
    return { redisConfigured, redisReachable: false, queue: null, error: null };
  }
  let redisReachable = false;
  try {
    redisReachable = await pingWithTimeout(client);
  } catch {
    redisReachable = false;
  }
  if (!redisReachable) {
    return { redisConfigured, redisReachable, queue: null, error: null };
  }
  const queue = getQueueForHealth() as
    | { getJobCounts: (...s: string[]) => Promise<Record<string, number>> }
    | null;
  if (!queue) {
    return { redisConfigured, redisReachable, queue: null, error: null };
  }
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    return {
      redisConfigured,
      redisReachable,
      queue: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      },
      error: null,
    };
  } catch (err) {
    return {
      redisConfigured,
      redisReachable,
      queue: null,
      error: err instanceof Error ? err.message : "queue_error",
    };
  }
}
