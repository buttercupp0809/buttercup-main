-- Additive: adds isMain boolean flag to CharacterMedia. Default false so
-- pre-existing rows keep their current isDisplay/isPrimary semantics until
-- bulk_generate_main.py + promote-main-images.ts writes the flag.
--
-- See Plans/cursor-prompt/35-major-fixes-batch.md #B.

ALTER TABLE "CharacterMedia" ADD COLUMN "isMain" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "CharacterMedia_characterId_isMain_idx" ON "CharacterMedia"("characterId", "isMain");
