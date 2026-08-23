// Stage A of the three-stage i2v pipeline: restyle the first frame so frame 0
// already shows the requested outfit/scene before Wan animates it. Uses the
// existing SDXL InstantID identity pipeline (generateWithComfyUIConsistent) so
// face consistency is preserved while the scene/outfit changes.
//
// Returns null on any failure (missing reference, character not found, box
// unreachable). The caller (video handler, Task 5) falls back to the character's
// raw reference photo when null is returned, so the restyle failure is always
// non-fatal.

import { prisma } from "@buttercupp/database";
import { resolveCharacterReferenceBytes } from "../reference";
import { generateWithComfyUIConsistent } from "../image/providers";
import { buildImagePrompt } from "../image/prompt";
import { logWarn } from "../../utils/log";
import type { VideoAspect } from "./constants";

export interface RestyleFirstFrameArgs {
  characterId: string;
  userRequest: string;
  // aspect is accepted for parity and logging; the image pipeline's own sizing
  // (CONSISTENT.width/height in providers.ts) governs the still dimensions.
  aspect: VideoAspect;
}

export async function restyleFirstFrame(args: RestyleFirstFrameArgs): Promise<Buffer | null> {
  try {
    const referenceBytes = await resolveCharacterReferenceBytes(args.characterId);
    if (!referenceBytes) return null;

    const character = await prisma.character.findUnique({
      where: { id: args.characterId },
      include: {
        currentVersion: {
          include: { appearanceSheet: true },
        },
      },
    });
    if (!character || !character.currentVersion?.appearanceSheet) return null;

    const sheet = character.currentVersion.appearanceSheet;
    // Map the DB style string to the union expected by buildImagePrompt.
    // "threeD" -> "3d", everything else passes through as-is.
    const style: "realistic" | "3d" | "anime" =
      character.style === "threeD"
        ? "3d"
        : (character.style as "realistic" | "anime");

    const { prompt, negativePrompt } = buildImagePrompt({
      appearanceSheet: {
        stylePrompt: sheet.stylePrompt,
        negativePrompt: sheet.negativePrompt,
        // traits from Prisma is typed as JsonValue; cast it to the interface
        // shape that buildImagePrompt expects (the DB shape matches at runtime).
        traits: (sheet.traits as Record<string, unknown>) as {
          hair?: string;
          eye?: string;
          body?: string;
          features?: string[];
          clothing?: string;
        },
      },
      style,
      // The userRequest IS the scene/outfit directive. buildImagePrompt injects
      // it as "scene: <request>" after the identity/appearance fragment, which
      // is exactly the contract: identity traits lock the face, userRequest
      // changes the scene/outfit.
      userRequest: args.userRequest,
    });

    const res = await generateWithComfyUIConsistent({
      prompt,
      negativePrompt,
      referenceBytes,
      // Drop the inswapper faceswap paste for video: its rectangular seam is very
      // visible against flat backgrounds and would propagate through every frame.
      // InstantID (+ FaceDetailer) keeps the face on-model without the seam.
      skipFaceSwap: true,
    });

    return res.buffer;
  } catch (err) {
    logWarn(
      "restyle-first-frame",
      `restyle failed for character ${args.characterId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
