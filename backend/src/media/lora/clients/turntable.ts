// Turntable client: generates a small set of identity-consistent shots of a
// character at varied head yaw/expression to supplement gallery images in the
// LoRA training dataset.
//
// Uses the existing generateWithComfyUIConsistent + resolveCharacterReferenceBytes
// pipeline (backend/src/media/image/providers.ts + media/reference.ts) so no new
// image-box or S3 client is introduced. Each generated buffer is uploaded via
// uploadGenerated (media/storage.ts).
//
// Env vars:
//   POPPY_TURNTABLE_COUNT  integer, default 6. Number of turntable shots to
//                          generate. Keep low (<=8) to avoid flooding the GPU
//                          box during dataset prep.
//
// If the image box (POPPY_JUGGERNAUT_URL / POPPY_ROUTER_URL) is not configured,
// generateWithComfyUIConsistent throws and the error propagates to the caller
// (buildDataset), which surfaces it as a job failure. This is intentional:
// turntable generation is optional only in the sense that the dataset curator
// filters by ArcFace score -- it is not silently skipped.

import { generateWithComfyUIConsistent } from "../../image/providers";
import { resolveCharacterReferenceBytes } from "../../reference";
import { uploadGenerated } from "../../storage";

// Pose descriptors used to vary head direction across turntable shots.
// Each encodes a unique yaw + expression so the training dataset covers
// multiple angles of the same identity.
const TURNTABLE_POSES: ReadonlyArray<string> = [
  "looking directly at camera, neutral expression, portrait",
  "looking slightly to the left, relaxed smile, portrait",
  "looking slightly to the right, candid expression, portrait",
  "three-quarter view turning right, portrait",
  "three-quarter view turning left, portrait",
  "glancing over shoulder, portrait",
  "slight upward look, warm expression, portrait",
  "slight downward look, contemplative, portrait",
];

function turntableCount(): number {
  const raw = process.env.POPPY_TURNTABLE_COUNT;
  if (!raw) return 6;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, TURNTABLE_POSES.length) : 6;
}

/**
 * Generate identity-consistent turntable shots for a character and upload them.
 * Returns S3 keys for the generated images.
 *
 * Throws if the reference image cannot be resolved or the image box is unreachable.
 * The caller (buildDataset) surfaces these as job failures; do not silence them.
 */
export async function genTurntableImages(
  characterId: string,
  _characterVersionId: string,
): Promise<string[]> {
  const referenceBytes = await resolveCharacterReferenceBytes(characterId);
  if (!referenceBytes) {
    throw new Error(
      `genTurntable: no reference image found for character ${characterId}`,
    );
  }

  const count = turntableCount();
  const poses = TURNTABLE_POSES.slice(0, count);

  const keys = await Promise.all(
    poses.map(async (poseHint, idx) => {
      const seed = idx * 1_000_000 + Math.floor(Math.random() * 1_000_000);
      const result = await generateWithComfyUIConsistent({
        prompt: `${poseHint}, full body shot, professional lighting, high detail`,
        negativePrompt:
          "blurry, low quality, bad anatomy, extra limbs, deformed, watermark",
        referenceBytes,
        seed,
        poseHint,
      });
      const key = await uploadGenerated(result.buffer, {
        userId: `lora-turntable-${characterId}`,
        kind: "turntable",
        contentType: "image/png",
      });
      return key;
    }),
  );

  return keys;
}
