-- Phase 30: memory graph (entities + edges) and user rulebook. Additive only,
-- no change to Memory/MemorySummary vector columns or any existing column.
-- sourceId/targetId on MemoryEdge intentionally have no FK constraint (see
-- schema.prisma header comment above model MemoryEntity).

-- CreateTable
CREATE TABLE "MemoryEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "relation" TEXT,
    "sentiment" DOUBLE PRECISION,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEdge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "entityId" TEXT,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "label" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'extraction',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timesReinforced" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryEntity_userId_characterId_kind_idx" ON "MemoryEntity"("userId", "characterId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEntity_userId_characterId_kind_normalizedName_key" ON "MemoryEntity"("userId", "characterId", "kind", "normalizedName");

-- CreateIndex
CREATE INDEX "MemoryEdge_userId_characterId_sourceId_idx" ON "MemoryEdge"("userId", "characterId", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryEdge_userId_characterId_targetId_idx" ON "MemoryEdge"("userId", "characterId", "targetId");

-- CreateIndex
CREATE INDEX "MemoryEdge_entityId_idx" ON "MemoryEdge"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEdge_sourceId_targetId_relation_key" ON "MemoryEdge"("sourceId", "targetId", "relation");

-- CreateIndex
CREATE INDEX "UserRule_userId_characterId_status_idx" ON "UserRule"("userId", "characterId", "status");

-- AddForeignKey
ALTER TABLE "MemoryEntity" ADD CONSTRAINT "MemoryEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "MemoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRule" ADD CONSTRAINT "UserRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
