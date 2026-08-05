import { NextResponse } from "next/server";
import {
  characterListQuerySchema,
  createCharacterInputSchema,
  styleWireToEnum,
} from "@buttercupp/shared";
import { prisma } from "@buttercupp/database";
import { listCharacters } from "@/lib/characters";
import { getViewer } from "@/lib/viewer";
import { jsonError } from "@/lib/api-helpers";
import { requireAgeVerified } from "@/lib/auth";
import { buildCharacterSystemPrompt } from "@/lib/character-snapshot";
import { ZodError } from "zod";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  let parsed;
  try {
    parsed = characterListQuerySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return jsonError(400, "validation_failed", {
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    return jsonError(400, "invalid_query");
  }

  const viewer = await getViewer();
  const result = await listCharacters(parsed, viewer);
  return NextResponse.json(result);
}

// Create a character from the wizard. Wraps everything in a Prisma
// transaction so a half-persisted character (e.g. Character row without a
// CharacterVersion) is impossible. Public+mature characters go through the
// moderation gate up front; the row is saved as pending until publish.
export async function POST(req: Request) {
  const user = await requireAgeVerified();
  let body;
  try {
    body = createCharacterInputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return jsonError(400, "validation_failed", {
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    return jsonError(400, "invalid_body");
  }

  // Public + mature must be age-verified; belt on top of the client gate.
  if (body.contentRating === "mature") {
    const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) return jsonError(403, "age_verification_required");
  }

  const snapshot = buildCharacterSystemPrompt(body);
  const styleEnum = styleWireToEnum(body.style);

  const created = await prisma.$transaction(async (tx) => {
    const appearance = await tx.appearanceSheet.create({
      data: {
        traits: body.traits as unknown as object,
        stylePrompt: body.stylePrompt,
        negativePrompt: body.negativePrompt ?? "",
        referenceImageKeys: body.referenceImageKeys ?? [],
      },
    });
    const voice = await tx.voiceProfile.create({
      data: {
        provider: body.voiceProfile.provider,
        voiceId: body.voiceProfile.voiceId,
        params: {},
      },
    });
    const character = await tx.character.create({
      data: {
        ownerUserId: user.id,
        name: body.name,
        age: body.age,
        gender: body.gender,
        bio: body.bio,
        tags: body.traitTags,
        style: styleEnum,
        contentRating: body.contentRating,
        visibility: "private", // publish flips this after moderation
        moderationStatus: "pending",
      },
    });
    const version = await tx.characterVersion.create({
      data: {
        characterId: character.id,
        versionNo: 1,
        personality: body.traitTags.join(", "),
        backstory: body.backstory,
        behavioralInstructions: body.behavioralInstructions,
        greeting: body.greeting,
        appearanceSheetId: appearance.id,
        voiceProfileId: voice.id,
        systemPromptSnapshot: snapshot,
      },
    });
    const withVersion = await tx.character.update({
      where: { id: character.id },
      data: { currentVersionId: version.id },
    });
    return withVersion;
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
