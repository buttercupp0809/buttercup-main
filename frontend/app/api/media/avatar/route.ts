// Avatar upload/generate endpoint. Phase 07 (media queue) + Phase 09
// (image generation) will wire this to S3 + Fal/Replicate. For now:
//   - `POST` with multipart/form-data + a `file` -> stores under a local
//     dev key (we return a deterministic pseudo-key so the wizard has
//     something to persist).
//   - `POST` with JSON `{ generate: true, prompt }` -> returns a placeholder
//     key with a TODO(phase-09) marker.
//
// Mature avatar generation is age-gated; SFW is not.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireAuth();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(400, "missing_file");
    if (file.size > 8 * 1024 * 1024) return jsonError(413, "file_too_large");
    // Deterministic key from user + file hash so re-uploading the same file
    // returns the same key (idempotent uploads).
    const buf = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 24);
    const key = `avatars/${user.id}/${hash}`;
    // TODO(phase-07): upload to S3 (BullMQ producer). Local dev returns key.
    return NextResponse.json({ key, kind: "upload" });
  }

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { generate?: boolean; prompt?: string; mature?: boolean };
    if (!body.generate) return jsonError(400, "invalid_body");
    if (body.mature) {
      const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
      if (!verified) return jsonError(403, "age_verification_required");
    }
    const jobId = crypto.randomBytes(8).toString("hex");
    // TODO(phase-09): enqueue a real generate job (Fal/Replicate).
    return NextResponse.json({
      key: `avatars/${user.id}/placeholder-${jobId}`,
      kind: "generate_stub",
      todo: "phase-09",
    });
  }

  return jsonError(415, "unsupported_content_type");
}
