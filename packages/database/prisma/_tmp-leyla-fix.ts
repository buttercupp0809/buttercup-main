// Leyla: swap the flagged main image for a clean one, preserving the character
// and its 2 conversations. New main = c0 (white sundress, already webp).
// Delete only the flagged CharacterMedia row (b4903974). isPrimary (reference
// face) goes to the canonical /personas seed. SELECT-only unless --apply.
import { prisma } from "@buttercupp/database";

const CHAR = "e3f954dd-572a-44c4-98d2-10373c79dad7";
const NEW_MAIN_ID = "ea212670-6e45-4d0b-9dce-d3906d8886dd"; // c0 images/37b533f2...webp
const BAD_ID = "2548c13e-2920-40c8-bfb9-4b83249b02ba";      // images/b4903974...png
const APPLY = process.argv.includes("--apply");

async function main() {
  const seed = await prisma.characterMedia.findFirst({
    where: { characterId: CHAR, kind: "image", url: { startsWith: "/personas/" } },
    orderBy: { sort: "asc" }, select: { id: true, url: true },
  });
  const newMain = await prisma.characterMedia.findUnique({ where: { id: NEW_MAIN_ID }, select: { url: true } });
  const bad = await prisma.characterMedia.findUnique({ where: { id: BAD_ID }, select: { url: true } });
  console.log("new main:", newMain?.url, "| bad(delete):", bad?.url, "| seed(ref):", seed?.url);
  if (!APPLY) { await prisma.$disconnect(); return; }

  await prisma.$transaction([
    prisma.characterMedia.updateMany({ where: { characterId: CHAR, kind: "image" }, data: { isMain: false, isDisplay: false, isPrimary: false } }),
    prisma.characterMedia.update({ where: { id: NEW_MAIN_ID }, data: { isMain: true, isDisplay: true, hidden: false } }),
    ...(seed ? [prisma.characterMedia.update({ where: { id: seed.id }, data: { isPrimary: true } })] : []),
    prisma.characterMedia.delete({ where: { id: BAD_ID } }),
  ]);
  console.log("applied: new main set, canonical seed = reference, flagged image deleted");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
