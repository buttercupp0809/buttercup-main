// Phase 28: creation-time image generation is routed through the SAME
// Phase-07 BullMQ queue + Phase-09 imageHandler that chat selfies use. This
// route no longer spawns a detached persona_pipeline.py subprocess; the
// script (Plans/inference-aws/persona_pipeline.py) remains on disk as the
// batch/offline tool, but the in-process worker (backend/src/queue/
// media-worker.ts) is now the single create-time image path.
//
// The actual enqueue work (createQueuedAsset + enqueueMediaJob) has to run
// in the backend workspace, since that is where BullMQ/ioredis and the
// queue definition live (packages/shared stays I/O-free per CLAUDE.md, and
// frontend has no dependency on @buttercupp/backend). This route therefore
// authenticates + owns the character itself, then asks the backend service
// to do the enqueue over an internal, short-lived-token-authenticated call,
// the same way the old code minted a bearer token for the subprocess.
import { requireAuth, signAuthToken } from "@/lib/auth";
import { prisma } from "@buttercupp/database";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { assertSafeId } from "@/lib/safe-types";
import { AUTH_COOKIE } from "@/lib/constants";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let id: string;
  try {
    id = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  const character = await prisma.character.findUnique({
    where: { id },
    include: { currentVersion: { include: { appearanceSheet: true } } },
  });
  if (!character) return jsonError(404, "character_not_found");
  if (character.ownerUserId !== user.id) return jsonError(403, "forbidden");
  if (!character.currentVersion?.appearanceSheet) return jsonError(409, "appearance_missing");

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const token = await signAuthToken(user.id);

  try {
    const res = await fetch(`${backendUrl}/media/character/${id}/creation-images`, {
      method: "POST",
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
    });
    if (!res.ok) {
      // Non-blocking: the wizard already saved the character. Generation
      // simply did not start; the finish screen's status poll will show no
      // images and the user can still chat immediately.
      return jsonOk({ status: "unavailable", message: `enqueue_failed_${res.status}` });
    }
    const body = (await res.json()) as { status: string; assetIds?: string[]; message?: string };
    return jsonOk(body);
  } catch {
    // Backend service unreachable (e.g. not running in this dev session).
    return jsonOk({ status: "unavailable", message: "backend_unreachable" });
  }
}
