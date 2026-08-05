// DTOs + query schemas for the user-facing memory management endpoints.
// Users can list "what does this character remember about me?" per character
// and delete individual rows. Everything is scoped by the caller's userId
// on the server side; the schemas here only cover shape.

import { z } from "zod";

export const memoryListQuerySchema = z.object({
  characterId: z.string().min(1).max(64).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;

export interface MemoryDTO {
  id: string;
  characterId: string;
  content: string;
  category: string;
  tier: "hot" | "warm" | "cold";
  importance: number;
  confidence: number;
  pinned: boolean;
  createdAt: string;
  lastAccessedAt: string | null;
}

export interface MemoryListResponse {
  items: MemoryDTO[];
  nextCursor: string | null;
}
