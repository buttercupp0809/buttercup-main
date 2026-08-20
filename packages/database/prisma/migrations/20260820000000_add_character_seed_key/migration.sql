-- Additive: adds a nullable seedKey column to Character and a partial unique
-- index. NULLs are treated as distinct by Postgres, so user-created rows
-- (ownerUserId != null, seedKey = null) are unaffected. Passes the
-- 17-ship-all.sh additive-drift guard.
--
-- See Plans/cursor-prompt/35-major-fixes-batch.md #A. Backfill (populating
-- seedKey from the primary /personas/N.webp media URL) is done by
-- sync-personas.ts on next run.

ALTER TABLE "Character" ADD COLUMN "seedKey" TEXT;

CREATE UNIQUE INDEX "Character_seedKey_key" ON "Character"("seedKey") WHERE "seedKey" IS NOT NULL;
