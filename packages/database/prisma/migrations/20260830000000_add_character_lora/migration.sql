-- Additive migration: creates the CharacterLora table.
-- NOTE: updatedAt is managed by Prisma's @updatedAt at the application layer
-- (no SQL default). Insert/update rows through Prisma, not raw SQL.
-- Apply to a LOCAL database only, then: prisma migrate resolve --applied 20260830000000_add_character_lora
CREATE TABLE "CharacterLora" (
    "id"                 TEXT NOT NULL,
    "characterId"        TEXT NOT NULL,
    "characterVersionId" TEXT NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "s3Key"              TEXT,
    "triggerToken"       TEXT,
    "baseModel"          TEXT NOT NULL DEFAULT 'realvisxl_v5',
    "rank"               INTEGER NOT NULL DEFAULT 32,
    "checkpointStep"     INTEGER,
    "arcfaceScore"       DOUBLE PRECISION,
    "datasetKey"         TEXT,
    "error"              TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterLora_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "CharacterLora_characterId_idx" ON "CharacterLora"("characterId");
CREATE INDEX "CharacterLora_status_idx" ON "CharacterLora"("status");
