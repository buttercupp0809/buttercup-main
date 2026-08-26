// Media worker. One BullMQ Worker instance per process; scales horizontally
// by running more processes. Owns the debit/refund lifecycle around each
// job. On terminal failure (attempts exhausted) it refunds tokens and
// notifies the user; on InsufficientTokensError it bails immediately with no
// retry.

import { parseCreationImagePayload, type MediaJobData } from "@buttercupp/shared";
import { withRetry, RETRY_PRESETS } from "../utils/retry";
import {
  markProcessing,
  markReady,
  markFailed,
  attachCreationCharacterMedia,
  attachVideoCharacterMedia,
  attachCharacterMediaMeta,
} from "../media/asset";
import { debitTokens, refundTokens, InsufficientTokensError } from "../media/token-ledger";
import { uploadMedia } from "../media/storage";
import { handlers } from "../media/handlers";
import { consumePlanQuota } from "../subscription/enforce";
import { entitlementsFor } from "../subscription/entitlements";
import { notifyMediaReady, notifyMediaError } from "./ws-notify";
import { createWorkerConnection, getRedisConnection } from "./connection";
import { MEDIA_QUEUE_NAME } from "@buttercupp/shared";
import { prisma } from "@buttercupp/database";
import { logInfo, logWarn, logError } from "../utils/log";
import { recordMediaJobOutcome } from "../metrics";

// ---------------------------------------------------------------------------
// Self-healing guardrails (added after repeated prod-drift incidents):
//  1. SINGLE-WORKER LOCK: two worker processes on the same queue steal each
//     other's BullMQ job locks ("could not renew lock") and freeze every job.
//     A Redis lock with a heartbeat TTL makes a second worker refuse to start.
//  2. STUCK-JOB REAPER: if a worker is killed mid-render, its MediaAsset is
//     stranded in `processing` forever and the UI spins with no signal. A
//     periodic sweep fails orphaned assets (refund + notify) so the UI settles.
// ---------------------------------------------------------------------------

const WORKER_LOCK_KEY = "poppy:media-worker:lock";
const WORKER_LOCK_TTL_MS = 60_000; // lock expires if the holder dies
const WORKER_LOCK_RENEW_MS = 20_000; // renew well before expiry
// A render can legitimately take up to the comfywan poll cap (~20 min). Only an
// asset older than this with no progress is truly orphaned (its worker died).
const STUCK_ASSET_TIMEOUT_MS = 35 * 60 * 1000;
const REAPER_INTERVAL_MS = 60_000;

// Unique id for THIS process so the lock owner is identifiable in logs.
const WORKER_INSTANCE_ID = `${process.pid}-${Date.now()}`;

// Try to become the one true worker. Returns a renew timer on success, or null
// when another live worker already holds the lock (caller must not start).
async function acquireWorkerLock(): Promise<NodeJS.Timeout | null> {
  const redis = getRedisConnection();
  if (!redis) return null; // no Redis => single-process dev; nothing to guard
  // SET NX PX: atomically claim the lock only if free (or previously expired).
  const ok = await redis.set(WORKER_LOCK_KEY, WORKER_INSTANCE_ID, "PX", WORKER_LOCK_TTL_MS, "NX");
  if (ok !== "OK") {
    const holder = await redis.get(WORKER_LOCK_KEY).catch(() => "unknown");
    logError(
      "media-worker",
      new Error(
        `another media worker is already running (lock held by ${holder}). ` +
          `Refusing to start a second worker: two workers steal each other's ` +
          `BullMQ locks and freeze all jobs. Stop the other worker first.`,
      ),
      { instance: WORKER_INSTANCE_ID },
    );
    return null;
  }
  logInfo("media-worker", "acquired single-worker lock", { instance: WORKER_INSTANCE_ID });
  // Renew the TTL while we live; only refresh if WE still own it.
  const timer = setInterval(() => {
    redis
      .set(WORKER_LOCK_KEY, WORKER_INSTANCE_ID, "PX", WORKER_LOCK_TTL_MS, "XX")
      .catch((err) => logWarn("media-worker", "lock renew failed", { err: String(err) }));
  }, WORKER_LOCK_RENEW_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

async function releaseWorkerLock(): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) return;
  // Only delete if we still own it (avoid clobbering a successor's lock).
  const holder = await redis.get(WORKER_LOCK_KEY).catch(() => null);
  if (holder === WORKER_INSTANCE_ID) await redis.del(WORKER_LOCK_KEY).catch(() => null);
}

// Sweep MediaAssets stranded in `processing` past the timeout and settle them.
// Runs only in the single live worker, so it will not race a healthy render.
async function reapStuckAssets(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_ASSET_TIMEOUT_MS);
  let stuck: Array<{ id: string; userId: string; kind: string }> = [];
  try {
    stuck = await prisma.mediaAsset.findMany({
      where: { status: "processing", updatedAt: { lt: cutoff } },
      select: { id: true, userId: true, kind: true },
      take: 50,
    });
  } catch (err) {
    logWarn("media-worker", "reaper query failed", { err: String(err) });
    return;
  }
  for (const a of stuck) {
    logWarn("media-worker", "reaping orphaned asset (worker likely died mid-job)", {
      mediaAssetId: a.id,
      kind: a.kind,
    });
    await markFailed(a.id, "orphaned_timeout").catch(() => null);
    await notifyMediaError(a.userId, a.id, "handler_failed").catch(() => null);
  }
}

function loadBullMq(): { Worker: unknown } | null {
  try {
    return require("bullmq");
  } catch {
    return null;
  }
}

interface JobLike {
  id: string;
  data: MediaJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

// Exported so the queue tests can drive the same code path without spinning
// up BullMQ + Redis.
export async function processJob(job: JobLike): Promise<{ ok: boolean; s3Key?: string; url?: string }> {
  const data = job.data;
  logInfo("media", `job ${job.id} start kind=${data.kind}`, {
    userId: data.userId,
    mediaAssetId: data.mediaAssetId,
    attempt: job.attemptsMade + 1,
  });
  await markProcessing(data.mediaAssetId, job.id);

  // 1. Atomic debit. InsufficientTokensError is terminal (no retry).
  try {
    await debitTokens({
      userId: data.userId,
      delta: data.tokenCost,
      reason: data.kind === "voice" ? "voice_gen" : "image_gen",
      refId: data.mediaAssetId,
    });
  } catch (err) {
    if (err instanceof InsufficientTokensError) {
      logWarn("media", `job ${job.id} aborted: insufficient_tokens`, { userId: data.userId });
      recordMediaJobOutcome({ kind: data.kind, status: "failed" });
      await markFailed(data.mediaAssetId, "insufficient_tokens");
      await notifyMediaError(data.userId, data.mediaAssetId, "insufficient_tokens");
      return { ok: false };
    }
    throw err;
  }

  // 2. Handler + upload, wrapped in the media retry preset. Handler errors
  //    bubble out of this function so BullMQ retries. Terminal failures
  //    are caught by the outer worker callback.
  try {
    const out = await withRetry(
      () => handlers[data.kind](data),
      RETRY_PRESETS.media,
      `media:${data.kind}`,
    );
    const s3Key = await uploadMedia(out.buffer, {
      userId: data.userId,
      kind: data.kind,
      contentType: out.contentType,
    });
    await markReady(data.mediaAssetId, s3Key, out.meta);

    // Phase 28: creation-time character images also need a canonical
    // CharacterMedia row (gallery reads MediaAsset; chat + cards read
    // CharacterMedia). This mirrors the dual-write backend/src/chat/
    // image-turn.ts already does for chat selfies. Best-effort: a failure
    // here must not undo the already-committed `ready` MediaAsset; it is
    // logged so the row can be backfilled instead.
    if (data.kind === "image" && data.characterId) {
      const creation = parseCreationImagePayload(data.payload);
      if (creation) {
        try {
          const { characterMediaId } = await attachCreationCharacterMedia({
            characterId: data.characterId,
            url: s3Key,
            sort: creation.variant,
          });
          await attachCharacterMediaMeta(data.mediaAssetId, characterMediaId);
        } catch (err) {
          logWarn("media", `creation dual-write failed for job ${job.id}`, {
            mediaAssetId: data.mediaAssetId,
            characterId: data.characterId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Phase 28: creation-time video dual-write. Mirrors the image block above
    // for video kind. Best-effort: a failure must not undo the committed
    // `ready` MediaAsset; it is logged for manual backfill.
    if (data.kind === "video" && data.characterId) {
      try {
        const { characterMediaId } = await attachVideoCharacterMedia({
          characterId: data.characterId,
          url: s3Key,
        });
        await attachCharacterMediaMeta(data.mediaAssetId, characterMediaId);
      } catch (err) {
        logWarn("media", `video dual-write failed for job ${job.id}`, {
          mediaAssetId: data.mediaAssetId,
          characterId: data.characterId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Phase 21: consume plan quota on TERMINAL success only. markReady is
    // called exactly once (the row's status flips from processing -> ready),
    // so a BullMQ retry cannot reach here twice; that + the atomic upsert
    // in consumePlanQuota is our double-count defense. Voice is not
    // plan-quota-gated; only image + video.
    if (data.kind === "image" || data.kind === "video") {
      try {
        const ent = await entitlementsFor(data.userId);
        if (ent.active && ent.plan !== "free") {
          const expires = ent.expiresAt ? new Date(ent.expiresAt) : null;
          await consumePlanQuota(data.userId, data.kind, ent.plan, expires);
        }
      } catch (err) {
        // Best-effort: quota accounting must never mark a successful job
        // as failed to the user. The prisma log captures the miss.
        logWarn("media", `consumePlanQuota failed`, { userId: data.userId, kind: data.kind, err: String(err) });
      }
    }

    // Emit the same-origin /api/media proxy URL (not a raw presigned S3
    // URL). The proxy respects S3_ENDPOINT + bucket routing and works
    // uniformly across local MinIO dev, mobile clients, and prod CDN
    // without leaking backend-only host names into the browser.
    const url = `/api/media?k=${encodeURIComponent(s3Key)}`;
    await notifyMediaReady(data.userId, {
      mediaAssetId: data.mediaAssetId,
      url,
      kind: data.kind,
      conversationId: data.conversationId,
    });
    logInfo("media", `job ${job.id} ready kind=${data.kind}`, { userId: data.userId, s3Key });
    recordMediaJobOutcome({ kind: data.kind, status: "ok" });
    return { ok: true, s3Key, url };
  } catch (err) {
    // Only refund on terminal failure (final attempt). Prior attempts leave
    // the debit in place; BullMQ will re-invoke us.
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isFinal) {
      logError("media", err, { jobId: job.id, kind: data.kind, userId: data.userId, terminal: true });
      recordMediaJobOutcome({ kind: data.kind, status: "failed" });
      await refundTokens({
        userId: data.userId,
        delta: data.tokenCost,
        reason: data.kind === "voice" ? "voice_gen" : "image_gen",
        refId: data.mediaAssetId,
      }).catch(() => null);
      await markFailed(data.mediaAssetId, err instanceof Error ? err.message : "handler_failed").catch(() => null);
      await notifyMediaError(data.userId, data.mediaAssetId, "handler_failed").catch(() => null);
    } else {
      logWarn("media", `job ${job.id} attempt ${job.attemptsMade + 1} failed, will retry`, {
        kind: data.kind,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
      });
    }
    throw err;
  }
}

const HEARTBEAT_INTERVAL_MS = 30_000;

// Boot a real BullMQ worker. Called from backend/src/worker.ts. Async because
// it must first win the single-worker lock; returns null when another worker
// already holds it (the caller fails fast) or when Redis/BullMQ are absent.
export async function startMediaWorker(): Promise<{ close: () => Promise<void> } | null> {
  const connection = createWorkerConnection();
  if (!connection) {
    logWarn("media-worker", "REDIS_URL not set; worker not started");
    return null;
  }
  const mod = loadBullMq();
  if (!mod) {
    logWarn("media-worker", "bullmq not installed; worker not started");
    return null;
  }
  // Single-worker guarantee: refuse to start if another live worker holds the
  // lock. This is the fix for the recurring double-worker lock-contention hang.
  const lockTimer = await acquireWorkerLock();
  if (!lockTimer && getRedisConnection()) {
    return null; // another worker owns the lock; do not start a second one
  }
  const concurrency = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? 4);
  // Backpressure for the single self-hosted GPU. Juggernaut/ComfyUI serves one
  // image at a time (~15-20s each); an unbounded burst of jobs all hit /prompt
  // at once, pile into ComfyUI's internal queue, and trip the 300s poll timeout
  // in waves (each timeout then retries up to 3x, amplifying the load). A BullMQ
  // limiter caps how many jobs START per window so the queue drains steadily.
  // Defaults are a generous ceiling (above one A10G's real throughput, so they
  // only bind during a flood); tune down if the managed fallbacks rate-limit.
  // Zero infra cost.
  const rateMax = Number(process.env.MEDIA_WORKER_RATE_MAX ?? 12);
  const rateDurationMs = Number(process.env.MEDIA_WORKER_RATE_DURATION_MS ?? 60_000);
  const WorkerCtor = mod.Worker as new (
    name: string,
    fn: (job: JobLike) => Promise<unknown>,
    opts: Record<string, unknown>,
  ) => { close: () => Promise<void>; on: (evt: string, fn: (...a: unknown[]) => void) => void };
  // Liveness signal. Emitting after every job AND on a timer means an
  // idle-but-alive worker still shows up in /ecs/buttercupp-worker logs,
  // and a crash-looping worker is visible as a gap in heartbeat lines.
  // Counters are process-local; log values only (never REDIS_URL or any
  // credential; see the security checklist in phase doc).
  let processed = 0;
  const worker = new WorkerCtor(MEDIA_QUEUE_NAME, (job) => processJob(job), {
    connection,
    concurrency,
    limiter: { max: rateMax, duration: rateDurationMs },
  });
  worker.on("completed", () => {
    processed += 1;
    logInfo("media-worker", "heartbeat", { processed, concurrency, trigger: "completed" });
  });
  worker.on("failed", () => {
    logInfo("media-worker", "heartbeat", { processed, concurrency, trigger: "failed" });
  });
  const timer = setInterval(() => {
    logInfo("media-worker", "heartbeat", { processed, concurrency, trigger: "timer" });
  }, HEARTBEAT_INTERVAL_MS);
  // Unref so the timer never blocks graceful shutdown.
  if (typeof timer.unref === "function") timer.unref();

  // Stuck-job reaper: settle assets stranded by a dead worker so the UI never
  // spins forever. Runs immediately, then on an interval.
  void reapStuckAssets();
  const reaperTimer = setInterval(() => void reapStuckAssets(), REAPER_INTERVAL_MS);
  if (typeof reaperTimer.unref === "function") reaperTimer.unref();

  const close = worker.close.bind(worker);
  logInfo("media-worker", `started (concurrency ${concurrency}, limiter ${rateMax}/${rateDurationMs}ms)`);
  return {
    close: async () => {
      clearInterval(timer);
      clearInterval(reaperTimer);
      if (lockTimer) clearInterval(lockTimer);
      await releaseWorkerLock().catch(() => null);
      await close();
    },
  };
}
