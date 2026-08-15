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
import { IMAGE_ENRICHMENT_FILLS } from "../media/image/enrichment-fills";
import { toWebP } from "../media/image/convert";
import { logInfo, logWarn } from "../utils/log";
import { uploadGenerated, canUploadToS3, getGeneratedSignedUrl, getSignedUrl } from "../media/storage";
import { createReadyAsset } from "../media/asset";
import { resolvePoppyBaseUrl } from "../inference/poppyEndpoint";

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
    // Bare S3 key. Route to the correct bucket by prefix, matching the frontend
    // /api/media proxy: "images/" keys live in the generated bucket
    // (POPPY_S3_BUCKET_GENERATED, where the persona pipeline wrote them), all
    // other keys live in the character-media bucket (S3_BUCKET). Signing against
    // the wrong bucket 404s, which used to silently drop face consistency.
    const signed = url.startsWith("images/")
      ? await getGeneratedSignedUrl(url, 60)
      : await getSignedUrl(url, 60);
    const r = await fetch(signed);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (err) {
    logWarn("chat-image", `reference resolve failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Call Stheno to transform a raw cleaned prompt into a rich Juggernaut XL prompt.
// Returns the enriched prompt on success; falls back to rawPrompt silently on
// any network error, non-OK response, or empty content.
async function enrichImagePrompt(rawPrompt: string): Promise<string> {
  const systemPrompt = IMAGE_ENRICHMENT_FILLS.imageEnrichmentPrompt.trim();
  if (!systemPrompt) return rawPrompt;
  try {
    const base = await resolvePoppyBaseUrl("stheno");
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "stheno",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `User's image request (preserve every detail, then elaborate): ${rawPrompt}`,
          },
        ],
        max_tokens: 250,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return rawPrompt;
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const enriched = data.choices?.[0]?.message?.content?.trim();
    return enriched || rawPrompt;
  } catch {
    return rawPrompt;
  }
}

// Ask Steno for a short in-character message the character sends while the image
// is being generated. Returns a safe fallback on any failure so the caller
// never has to handle errors.
export async function generateImageTeaser(
  characterName: string,
  userPrompt: string,
): Promise<string> {
  try {
    const base = await resolvePoppyBaseUrl("stheno");
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "stheno",
        messages: [
          {
            role: "system",
            content: `You are ${characterName}. The user has requested a photo of you. Write a short, playful, in-character response (1-2 sentences) to let them know their photo is on its way. Be flirtatious and stay fully in character. No hashtags, no emojis, no stage directions.`,
          },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 70,
        temperature: 0.9,
        stream: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Give me just a moment to get that perfect shot ready for you...`;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || `Give me just a moment to get that perfect shot ready for you...`;
  } catch {
    return `Give me just a moment to get that perfect shot ready for you...`;
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
  const enrichedPrompt = await enrichImagePrompt(prompt);

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
      if (referenceBytes) {
        logInfo("chat-image", `reference resolved (${referenceBytes.length} bytes) char=${characterId}: consistent face path`);
      } else {
        logWarn("chat-image", `no reference bytes for char=${characterId}: falling back to faceless txt2img (no character consistency)`);
      }
    }
  }

  async function persistAndSign(
    rawBuffer: Buffer,
    provider: string,
    consistent: boolean,
    seed?: number,
  ): Promise<ChatImageResult> {
    const { buffer, contentType } = await toWebP(rawBuffer);
    if (userId && canUploadToS3()) {
      const s3Key = await uploadGenerated(buffer, {
        userId,
        kind: "image",
        contentType,
      });
      const asset = await createReadyAsset({
        userId,
        characterId,
        kind: "image",
        s3Key,
      });
      // Link the generated image into CharacterMedia so it appears in the
      // character's gallery and can be reused in future persona pipelines.
      if (characterId) {
        await prisma.characterMedia.create({
          data: {
            characterId,
            kind: "image",
            url: s3Key,
            isPrimary: false,
            // Seconds (not ms) so the value fits INT4; still monotonically
            // increasing, so generated images sort to the end of the gallery.
            sort: Math.floor(Date.now() / 1000),
          },
        });
      }
      // Emit the same-origin /api/media proxy URL (not a raw S3/MinIO
      // presigned URL) so the browser hits a URL under the app's own
      // domain and the proxy handles endpoint / bucket / CDN selection.
      // A raw presigned URL against S3_ENDPOINT (local MinIO) only
      // resolves when the browser can reach that hostname directly; on a
      // mobile viewport or a different network host it 404s and the
      // <img> falls back to alt text ("generated"). Mirror how
      // frontend/lib/cdn.ts::signAssetUrl already builds gallery URLs.
      const proxyUrl = `/api/media?k=${encodeURIComponent(s3Key)}`;
      return { url: proxyUrl, mediaAssetId: asset.id, provider, consistent, seed };
    }
    // Local dev fallback: return base64 data URL, nothing persisted.
    const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
    return { url: dataUrl, provider, consistent, seed };
  }

  if (referenceBytes) {
    const poseHint = extractPoseHint(userText);
    const res = await generateWithComfyUIConsistent({
      prompt: enrichedPrompt,
      negativePrompt: NEGATIVE,
      referenceBytes,
      poseHint: poseHint ?? undefined,
    });
    return persistAndSign(res.buffer, res.provider, true, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
  }

  // No reference: plain photoreal scene (Juggernaut txt2img via provider chain).
  const res = await generateImage({
    prompt: enrichedPrompt,
    negativePrompt: NEGATIVE,
    style: "realistic",
    referenceImageUrls: [],
    loraRef: null,
  });
  return persistAndSign(res.buffer, res.provider, false, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
}
