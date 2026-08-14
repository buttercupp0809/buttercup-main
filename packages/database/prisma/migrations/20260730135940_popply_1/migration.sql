-- DropIndex (IF EXISTS: first run may have dropped them without rolling back)
DROP INDEX IF EXISTS "memory_embedding_idx";

-- DropIndex
DROP INDEX IF EXISTS "memory_summary_embedding_idx";

-- NOTE: "ALTER COLUMN themes DROP DEFAULT" removed from this migration.
-- themes is added with a default in a later migration (memory_ranking_fields);
-- the DROP DEFAULT forward-reference caused P3009 on production RDS.
