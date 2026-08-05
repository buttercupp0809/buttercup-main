// Phase 23: visible dead-letter for terminal memory-pipeline failures.
//
// The memory extractor and the compactor are fire-and-forget from the chat
// engine's point of view: they MUST NOT throw into the reply path and they
// MUST NOT hang a turn. But a silent failure is also unacceptable, because
// we would degrade retrieval quality over time without any signal. So the
// contract is: swallow the exception from the caller's perspective, log
// via `logError("memory", ...)`, AND append a row to `MemoryDeadLetter` so
// an operator can query volume and set an alert on it.
//
// Writing the dead-letter row is itself best-effort; if the DB is
// unreachable we just log and move on, because raising here would defeat
// the whole point.

import { prisma } from "@poppy/database";
import { logError, logWarn } from "../utils/log";

export interface DeadLetterContext {
  userId?: string | null;
  characterId?: string | null;
  sourceMessageId?: string | null;
  [k: string]: unknown;
}

export async function deadLetter(
  stage: string,
  ctx: DeadLetterContext,
  err: unknown,
): Promise<void> {
  const errText = err instanceof Error ? err.message : String(err);
  logError("memory", err, { deadLetter: true, stage, ...ctx });
  try {
    await prisma.memoryDeadLetter.create({
      data: {
        userId: ctx.userId ?? null,
        characterId: ctx.characterId ?? null,
        sourceMessageId: ctx.sourceMessageId ?? null,
        stage,
        error: errText.slice(0, 4000),
      },
    });
  } catch (writeErr) {
    // If we cannot even record the dead-letter, we still return normally so
    // the fire-and-forget caller keeps going. The logError above is the
    // observability of last resort.
    logWarn("memory", `deadLetter row write failed for stage=${stage}`, {
      reason: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
}
