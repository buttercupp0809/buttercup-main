// LoRA training job producer. Wraps BullMQ's Queue for the dedicated
// buttercupp-lora queue so training jobs never block the media queue.
// Matches the pattern in media-queue.ts: lazy singleton, graceful
// no-op degradation when Redis / BullMQ are absent.

import { LORA_QUEUE_NAME, type TrainLoraJobPayload } from "@buttercupp/shared";
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
  const QueueCtor = mod.Queue as new (
    name: string,
    opts: Record<string, unknown>,
  ) => unknown;
  _queue = new QueueCtor(LORA_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // Training is long-running; a single attempt per enqueue is correct.
      // The admin route can retry by re-enqueueing.
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 200,
    },
  });
  return _queue;
}

/** Enqueue a LoRA training job on the dedicated buttercupp-lora queue. */
export async function enqueueTrainLoraJob(
  data: TrainLoraJobPayload,
): Promise<{ jobId: string }> {
  const q = getQueue() as {
    add: (
      name: string,
      data: TrainLoraJobPayload,
    ) => Promise<{ id: string }>;
  };
  const job = await q.add("train-lora", data);
  return { jobId: job.id };
}
