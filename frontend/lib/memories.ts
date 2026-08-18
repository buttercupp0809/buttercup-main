// Server-side read of what a companion has remembered about the viewer.
//
// The memory pipeline (extractor, compactor, dedup) is entirely backend-owned;
// this module only reads. It exists so the chat page can render the memory
// surface in its first paint instead of shipping a spinner, while the client
// component keeps using the already-shipped /api/memory routes for paging and
// deletes. Row shape matches MemoryDTO exactly so the two paths are
// interchangeable.

import { prisma } from "@buttercupp/database";
import type { MemoryDTO } from "@buttercupp/shared";

export interface CompanionMemories {
  items: MemoryDTO[];
  /** Total she holds, so the UI can say "12 things" while showing 6. */
  total: number;
  nextCursor: string | null;
}

/**
 * Pinned first, then newest. Pinned memories are the ones the pipeline (or the
 * user, later) marked as load-bearing, so burying them under yesterday's small
 * talk would misrepresent what she actually holds onto.
 *
 * Ordering here has to match what /api/memory returns for page 2 onward or the
 * "show more" button will produce a list that jumps around. The route orders by
 * createdAt desc, so pinned rows are hoisted client-side after merge rather
 * than being a different sort.
 */
export async function getCompanionMemories(
  userId: string,
  characterId: string,
  take = 6,
): Promise<CompanionMemories> {
  try {
    const [rows, total] = await Promise.all([
      prisma.memory.findMany({
        where: { userId, characterId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
      }),
      prisma.memory.count({ where: { userId, characterId } }),
    ]);
    let nextCursor: string | null = null;
    if (rows.length > take) {
      // Cursor is the last row we return, matching /api/memory: that handler
      // resumes with `skip: 1`, so handing it the probe row would skip a memory.
      rows.pop();
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }
    return {
      items: rows.map((m) => ({
        id: m.id,
        characterId: m.characterId,
        content: m.content,
        category: m.category,
        tier: m.tier,
        importance: m.importance,
        confidence: m.confidence,
        pinned: m.pinned,
        createdAt: m.createdAt.toISOString(),
        lastAccessedAt: m.lastAccessedAt?.toISOString() ?? null,
      })),
      total,
      nextCursor,
    };
  } catch {
    // Memory is an enhancement to the chat page, never a reason to 500 it.
    return { items: [], total: 0, nextCursor: null };
  }
}
