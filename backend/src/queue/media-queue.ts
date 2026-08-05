// Media job producer. Wraps BullMQ's Queue so callers do not import bullmq
// directly, and so we can degrade gracefully when Redis / BullMQ are not
// installed (compile without the SDK, throw at runtime with a clear error).

import { MEDIA_QUEUE_NAME, type MediaJobData } from "@poppy/shared";
import { getRedisConnection } from "./connection";

let _queue: unknown = null;

function loadBullMq(): { Queue: unknown } | null {
  try {
    return require("bullmq");
  } catch {
    return null;
  }
}

function getQueue(): unknown {
  if (_queue) return _queue;
  const connection = getRedisConnection();
  if (!connection) throw new Error("REDIS_URL not configured");
  const mod = loadBullMq();
  if (!mod) throw new Error("bullmq not installed");
  const QueueCtor = mod.Queue as new (name: string, opts: Record<string, unknown>) => unknown;
  _queue = new QueueCtor(MEDIA_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _queue;
}

export async function enqueueMediaJob(data: MediaJobData): Promise<{ jobId: string }> {
  const q = getQueue() as { add: (name: string, data: MediaJobData) => Promise<{ id: string }> };
  const job = await q.add(data.kind, data);
  return { jobId: job.id };
}
