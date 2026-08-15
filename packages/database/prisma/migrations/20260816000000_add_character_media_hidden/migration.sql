-- Purely additive: adds the `hidden` flag used to permanently retire a
-- CharacterMedia row from every display query while preserving it (and its
-- backing file in S3/disk) for audit/history. See the HIDDEN MEDIA
-- CONVENTION comment block above `model CharacterMedia` in schema.prisma.
-- AlterTable
ALTER TABLE "CharacterMedia" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CharacterMedia_characterId_hidden_idx" ON "CharacterMedia"("characterId", "hidden");
