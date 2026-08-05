-- Add Pellow-style ranking + access-tracking fields to Memory, plus the
-- richer MemorySummary shape (themes/sentiment/keyEvents) that the compactor
-- writes. Local dev DBs only; every field has a default so existing rows
-- (there are none) would be filled in safely.

ALTER TABLE "Memory"
  ADD COLUMN "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "emotionalValence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "accessCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAccessedAt" TIMESTAMP(3),
  ADD COLUMN "validUntil" TIMESTAMP(3);

ALTER TABLE "MemorySummary"
  ADD COLUMN "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sentiment" TEXT,
  ADD COLUMN "keyEvents" JSONB;
