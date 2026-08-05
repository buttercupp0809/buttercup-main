-- DropIndex
DROP INDEX "memory_embedding_idx";

-- DropIndex
DROP INDEX "memory_summary_embedding_idx";

-- AlterTable
ALTER TABLE "MemorySummary" ALTER COLUMN "themes" DROP DEFAULT;
