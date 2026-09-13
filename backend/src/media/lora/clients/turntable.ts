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
 * Returns an empty array if the image box is unreachable (inference GPU offline).
 * Gallery images alone are sufficient for LoRA training when turntable gen fails.
 */
export async function genTurntableImages(
  characterId: string,
  _characterVersionId: string,
): Promise<string[]> {
  try {
    const referenceBytes = await resolveCharacterReferenceBytes(characterId);
    if (!referenceBytes) return [];

    const count = turntableCount();
    const poses = TURNTABLE_POSES.slice(0, count);

    // Generate sequentially. The image box serves ONE ComfyUI workflow at a time
    // (single GPU); firing all shots via Promise.all would overload it and cascade
    // into poll timeouts. A simple for-await loop keeps exactly one render in flight.
    const keys: string[] = [];
    for (let idx = 0; idx < poses.length; idx++) {
      const poseHint = poses[idx];
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
      keys.push(key);
    }

    return keys;
  } catch {
    // Inference box offline or reference unavailable. Gallery images alone are
    // sufficient for LoRA training; turntable augmentation is best-effort.
    return [];
  }
}
