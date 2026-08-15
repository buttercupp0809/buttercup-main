-- AlterTable
ALTER TABLE "CharacterMedia" ADD COLUMN     "isDisplay" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CharacterMedia_characterId_isDisplay_idx" ON "CharacterMedia"("characterId", "isDisplay");
