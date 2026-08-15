// Redis connection factory. BullMQ needs `maxRetriesPerRequest: null` on
// its shared client (otherwise a slow Redis crashes the queue), and a
// SEPARATE blocking connection per Worker. This module hands out both.
//
// When REDIS_URL is unset, we return null so the API can no-op degrade
// (matches the "provider unconfigured" pattern in the LLM chain).

import type Redis from "ioredis";

import { logWarn } from "../utils/log";

let sharedClient: Redis | null = null;

// ioredis emits "error" for every transient network blip (idle disconnect,
// Redis restart, etc). Node treats an unhandled "error" event as a fatal,
// process-crashing exception, so every client we hand out MUST have a
// listener attached or a single dropped connection takes the whole backend
// process down (this is exactly what happened locally: a "Connection is
// closed" error with no listener killed the process mid E2E-run).
function withErrorHandler(client: Redis): Redis {
  client.on("error", (err: Error) => {
    logWarn("redis", "connection error (auto-reconnecting)", { err: err.message });
  });
  return client;
}

function loadIoRedis(): (typeof import("ioredis") extends { default: infer T } ? T : never) | null {
  try {
     
    const mod = require("ioredis");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// A single client for queue producers + generic reads. Do NOT pass this to a
// BullMQ Worker; workers must own a fresh blocking connection.
export function getRedisConnection(): Redis | null {
  if (sharedClient) return sharedClient;
  if (!process.env.REDIS_URL) return null;
  const Ctor = loadIoRedis();
  if (!Ctor) return null;
  const Redis = Ctor as unknown as new (url: string, opts: Record<string, unknown>) => Redis;
  sharedClient = withErrorHandler(
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
  );
  return sharedClient;
}

// Dedicated blocking connection for a BullMQ Worker. Each worker instance
// must create its own; calling this repeatedly returns a new client every
// time.
export function createWorkerConnection(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  const Ctor = loadIoRedis();
  if (!Ctor) return null;
  const Redis = Ctor as unknown as new (url: string, opts: Record<string, unknown>) => Redis;
  return withErrorHandler(
    new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
  );
}

export function isRedisConfigured(): boolean {
  return typeof process.env.REDIS_URL === "string" && process.env.REDIS_URL.length > 0;
}
