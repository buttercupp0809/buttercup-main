-- Phase 23: memory hardening. Additive, no data-shape change.
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
CREATE INDEX IF NOT EXISTS "Memory_userId_characterId_sourceMessageId_idx"
  ON "Memory" ("userId", "characterId", "sourceMessageId");

CREATE TABLE IF NOT EXISTS "MemoryDeadLetter" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "characterId" TEXT,
  "sourceMessageId" TEXT,
  "stage" TEXT NOT NULL,
  "error" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MemoryDeadLetter_stage_createdAt_idx"
  ON "MemoryDeadLetter" ("stage", "createdAt");
CREATE INDEX IF NOT EXISTS "MemoryDeadLetter_userId_characterId_idx"
  ON "MemoryDeadLetter" ("userId", "characterId");
