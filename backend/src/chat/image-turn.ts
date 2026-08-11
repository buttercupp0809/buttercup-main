// In-chat image generation. When a user asks for an image during chat, we take
// their message text as the scene prompt and generate through the self-hosted
// Juggernaut XL model (ComfyUI on the GPU box).
//
// Character consistency: if the conversation's character has a reference image,
// we run the SAME InstantID + FaceDetailer + FaceSwap workflow the command
// pipeline uses (persona_pipeline.py), locking that exact face onto the scene.
// If there is no reference, we fall back to plain txt2img. Result is a base64
// data URL so it renders inline in chat (no S3 / queue / worker involved).

import path from "node:path";
import { readFile } from "node:fs/promises";
import { prisma } from "@buttercupp/database";
import { generateImage, generateWithComfyUIConsistent } from "../media/image/providers";
import { SAFETY_NEGATIVE } from "../media/image/constants";
import { logWarn } from "../utils/log";
import { uploadGenerated, isStorageConfigured, getSignedUrl } from "../media/storage";
import { createReadyAsset } from "../media/asset";

// Negative prompt: minors block (legal) + framing guards (prevent cropped
// partial-body shots) + quality cleanup.
const NEGATIVE = `${SAFETY_NEGATIVE}, cropped, out of frame, head out of frame, hands cut off, cut off, close-up, zoomed in, partial body, missing feet, missing legs, body out of frame, headshot, lowres, bad anatomy, bad hands, extra fingers, watermark, text, jpeg artifacts, deformed`;

export interface ChatImageResult {
  // CloudFront signed URL when S3 is configured; data:image/png;base64,... in
  // local dev (when storage is not configured). Callers treat this as an opaque
  // URL that can be dropped into <img src>.
  url: string;
  mediaAssetId?: string; // set when saved to S3; absent in base64 fallback mode
  provider: string;
  consistent: boolean;
  seed?: number;
}

// Detect explicit face direction in the user's message so the generation honours it
// instead of overriding with a random pose. Returns null when no hint is found.
export function extractPoseHint(text: string): string | null {
  const t = text.toLowerCase();
  if (/looking (directly )?(at( the)? camera|straight( ahead)?|at (me|you))/.test(t)) return "looking directly at camera";
  if (/looking (to the |)right/.test(t) || /facing right/.test(t)) return "looking to the right, three-quarter view";
  if (/looking (to the |)left/.test(t) || /facing left/.test(t)) return "looking to the left, three-quarter view";
  if (/(over( my| your)? shoulder|looking back)/.test(t)) return "glancing over shoulder";
  if (/(side( view| profile)|profile (view|shot))/.test(t)) return "side profile";
  return null;
}

// Strip the request phrasing so the actual subject becomes the prompt.
// "send me a photo of a woman on a beach" -> "a woman on a beach".
// Falls back to the raw text if stripping would leave nothing.
export function cleanImagePrompt(text: string): string {
  const stripped = text
    .replace(
      /^\s*(please\s+)?(can\s+you\s+|could\s+you\s+|will\s+you\s+)?(send|show|share|give|take|generate|make|create)\s+(me\s+)?(a\s+|an\s+|some\s+)?(pic(ture)?|photo|selfie|image|shot|snap)\s*(of\s+|showing\s+|with\s+)?/i,
      "",
    )
    .replace(/^\s*(what|how)\s+do\s+you\s+look\s+like\??/i, "")
    .trim();
  return stripped.length > 0 ? stripped : text.trim();
}

// Load the character's reference face image bytes. CharacterMedia.url is either
// an absolute http(s) URL or a public asset path (e.g. /personas/x.jpg served
// from frontend/public). Returns null if none is resolvable (caller falls back).
async function resolveCharacterReferenceBytes(characterId: string): Promise<Buffer | null> {
  try {
    const media = await prisma.characterMedia.findFirst({
      where: { characterId, kind: "image" },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
      select: { url: true },
    });
    const url = media?.url;
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    if (url.startsWith("/")) {
      const publicDir = process.env.POPPY_PUBLIC_DIR ?? path.resolve(process.cwd(), "../frontend/public");
      return await readFile(path.join(publicDir, url));
    }
    return null;
  } catch (err) {
    logWarn("chat-image", `reference resolve failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Generate an image from the user's chat text. When conversationId maps to a
// character with a reference image, the exact face is locked in (consistent);
// otherwise a plain scene is generated.
export async function generateChatImage(
  userText: string,
  conversationId?: string,
  userId?: string,
): Promise<ChatImageResult> {
  const prompt = cleanImagePrompt(userText);

  let referenceBytes: Buffer | null = null;
  let characterId: string | null = null;
  if (conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { characterId: true },
    });
    if (conv?.characterId) {
      characterId = conv.characterId;
      referenceBytes = await resolveCharacterReferenceBytes(conv.characterId);
    }
  }

  async function persistAndSign(
    buffer: Buffer,
    provider: string,
    consistent: boolean,
    seed?: number,
  ): Promise<ChatImageResult> {
    if (userId && isStorageConfigured()) {
      const s3Key = await uploadGenerated(buffer, {
        userId,
        kind: "image",
        contentType: "image/png",
      });
      const asset = await createReadyAsset({
        userId,
        characterId,
        kind: "image",
        s3Key,
      });
      const signedUrl = await getSignedUrl(s3Key, 48 * 3600);
      return { url: signedUrl, mediaAssetId: asset.id, provider, consistent, seed };
    }
    // Local dev fallback: return base64 data URL, nothing persisted.
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
    return { url: dataUrl, provider, consistent, seed };
  }

  if (referenceBytes) {
    const poseHint = extractPoseHint(userText);
    const res = await generateWithComfyUIConsistent({
      prompt,
      negativePrompt: NEGATIVE,
      referenceBytes,
      poseHint: poseHint ?? undefined,
    });
    return persistAndSign(res.buffer, res.provider, true, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
  }

  // No reference: plain photoreal scene (Juggernaut txt2img via provider chain).
  const res = await generateImage({
    prompt,
    negativePrompt: NEGATIVE,
    style: "realistic",
    referenceImageUrls: [],
    loraRef: null,
  });
  return persistAndSign(res.buffer, res.provider, false, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
}
