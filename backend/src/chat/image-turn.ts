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
import { callLLM } from "../llm/provider";
import { SAFETY_NEGATIVE } from "../media/image/constants";
import { IMAGE_ENRICHMENT_FILLS } from "../media/image/enrichment-fills";
import { toWebP } from "../media/image/convert";
import { logInfo, logWarn } from "../utils/log";
import { uploadGenerated, canUploadToS3, getGeneratedSignedUrl, getSignedUrl } from "../media/storage";
import { createReadyAsset } from "../media/asset";
import { resolvePoppyBaseUrl } from "../inference/poppyEndpoint";
import { getLatestSummary } from "../llm/memory-retriever";

// Number of most recent chat turns fed into the image enrichment call as
// background context. Clamped to [10, 20]: fewer than 10 turns loses too much
// conversational flavor; more than 20 blows past the fast-enrichment budget
// (Stheno call needs to return in a few hundred ms so the user sees the image
// quickly).
const IMAGE_CONTEXT_TURNS_RAW = 15;
export const IMAGE_CONTEXT_TURNS = Math.min(20, Math.max(10, IMAGE_CONTEXT_TURNS_RAW));

// Hard cap on the recentTurns transcript character length. Keeps the
// enrichment call fast and well under Stheno's context window even when
// individual messages are long.
const CONTEXT_CHAR_BUDGET = 1500;

export interface ImageContext {
  recentTurns: string;
  summary: string;
  // Resolved from the conversation while building context, so the caller does
  // not have to re-query it. null when unknown (no conversation, or DB error).
  characterId: string | null;
}

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
    // The backend (ECS) cannot read the frontend's local /personas/*.webp
    // files, so a local-path reference yields no bytes and InstantID falls back
    // to a random face. Fetch candidates in priority order and prefer the first
    // S3/remote-readable one; only use a local "/" path as a last resort.
    const candidates = await prisma.characterMedia.findMany({
      where: { characterId, kind: "image" },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
      select: { url: true },
      take: 20,
    });
    const url = candidates.find((m) => !m.url.startsWith("/"))?.url ?? candidates[0]?.url;
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

// Same sanitizer engine.ts uses: base64 data URLs (chat image fallback path
// stores them directly on the message) would otherwise blow out Stheno's
// context window. Also caps individual messages so a single pathological turn
// cannot dominate the transcript.
function sanitizeContextContent(content: string): string {
  if (content.startsWith("data:")) return "[shared a photo]";
  // Also catch data URLs embedded mid-message (defense in depth).
  const scrubbed = content.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[shared a photo]");
  return scrubbed.length > 800 ? scrubbed.slice(0, 800) : scrubbed;
}

// Build the background context block for image enrichment: last N messages
// from the conversation (chronological, sanitized) plus a short running
// summary. Any DB failure is swallowed and returns an empty context so image
// generation still proceeds. Never throws.
export async function buildImageContext(
  conversationId: string,
  userId?: string,
): Promise<ImageContext> {
  const empty: ImageContext = { recentTurns: "", summary: "", characterId: null };
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        characterId: true,
        character: { select: { name: true } },
      },
    });
    const characterId = conv?.characterId ?? null;
    const characterName = conv?.character?.name ?? "Character";

    const [historyRows, summary] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: IMAGE_CONTEXT_TURNS,
        select: { role: true, content: true },
      }),
      userId && characterId
        ? getLatestSummary(userId, characterId).catch(() => null)
        : Promise.resolve(null),
    ]);

    const chronological = [...historyRows].reverse();
    const lines: string[] = [];
    for (const row of chronological) {
      const speaker = row.role === "user" ? "User" : characterName;
      lines.push(`${speaker}: ${sanitizeContextContent(row.content)}`);
    }
    let recentTurns = lines.join("\n");
    if (recentTurns.length > CONTEXT_CHAR_BUDGET) {
      // Keep the tail (most recent turns) since it is the most relevant.
      recentTurns = recentTurns.slice(recentTurns.length - CONTEXT_CHAR_BUDGET);
    }

    const summaryText = summary?.summary?.trim() ?? "";
    return { recentTurns, summary: summaryText, characterId };
  } catch (err) {
    logWarn("chat-image", `buildImageContext failed: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}

// Small stoplist: common English words we do NOT want to force-preserve in
// the enriched prompt because they carry no visual signal.
const TOKEN_GUARD_STOPLIST = new Set([
  "a", "an", "the", "of", "on", "in", "at", "to", "for", "with",
  "and", "or", "but", "so", "she", "he", "her", "his", "him", "you",
  "me", "my", "your", "our", "we", "they", "them", "it", "its",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "this", "that", "these", "those", "then", "than", "there", "here",
  "please", "just", "really", "very", "some", "any", "one", "two",
  "now", "yes", "no", "not", "do", "does", "did", "have", "has", "had",
]);

// Extract concrete tokens (nouns/adjectives) from the user's prompt fragment
// that we want to guarantee survive the enrichment rewrite. Case-preserving
// unique output. Only alphabetical words 3+ chars.
export function extractGuardTokens(userFragment: string): string[] {
  if (!userFragment) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of userFragment.split(/[^A-Za-z']+/)) {
    if (raw.length < 3) continue;
    const key = raw.toLowerCase();
    if (TOKEN_GUARD_STOPLIST.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

// Append any missing guard tokens verbatim to the enriched prompt so the
// downstream image model literally receives them. Only appends tokens that
// are absent (case-insensitive), so tokens the LLM did keep are not
// duplicated. See Plans/cursor-prompt/35-major-fixes-batch.md #D.2 step 4.
export function ensureGuardTokens(enriched: string, guardTokens: string[]): string {
  if (guardTokens.length === 0) return enriched;
  const lower = enriched.toLowerCase();
  const missing = guardTokens.filter((t) => !lower.includes(t.toLowerCase()));
  if (missing.length === 0) return enriched;
  return `${enriched}, ${missing.join(", ")}`;
}

// Call the LLM to transform a raw cleaned prompt into a rich Juggernaut XL
// prompt. When context is provided, its recent turns and running summary
// are attached as SECONDARY background flavor, while the raw prompt remains
// the PRIMARY authoritative intent.
//
// Two robustness changes (see Plans/cursor-prompt/35-major-fixes-batch.md #D.2/#D.3):
//   1. Route through callLLM (the mature provider chain: local Stheno ->
//      OpenRouter/anthropic fallback) instead of a direct Stheno fetch,
//      so enrichment still runs when the GPU box is down (matches how
//      generateImageTeaser already works).
//   2. Lower temperature (0.15) and a post-guard step: any high-signal
//      user token that the rewrite dropped is appended back verbatim.
//      Locks the user's concrete words (outfit, place, pose, colors) into
//      the final prompt regardless of model behavior.
export async function enrichImagePrompt(
  rawPrompt: string,
  context?: ImageContext,
  guardTokens?: string[],
): Promise<string> {
  const systemPrompt = IMAGE_ENRICHMENT_FILLS.imageEnrichmentPrompt.trim();
  if (!systemPrompt) return rawPrompt;

  const summaryBlock = context?.summary?.trim() ?? "";
  const recentBlock = context?.recentTurns?.trim() ?? "";
  const tokens = guardTokens ?? extractGuardTokens(rawPrompt);
  const quotedTokens = tokens.length > 0 ? tokens.map((t) => `"${t}"`).join(", ") : "(none)";
  const userMessage = [
    "PRIMARY IMAGE REQUEST (preserve every detail exactly, do not drop or change any element):",
    rawPrompt,
    "",
    `MUST-PRESERVE TOKENS (these exact words MUST appear verbatim in the output): ${quotedTokens}`,
    "",
    "BACKGROUND CONTEXT (secondary, use only to add consistent flavor, never to override the primary request):",
    `Summary: ${summaryBlock || "(none)"}`,
    "Recent conversation:",
    recentBlock || "(none)",
    "",
    "Produce one vivid image-generation prompt under 150 words that fully preserves the primary request and layers in consistent background flavor where it does not conflict.",
  ].join("\n");

  if (!summaryBlock && !recentBlock && context) {
    logWarn("chat-image", `enrichImagePrompt: context provided but both summary and recent turns empty`);
  }

  try {
    const result = await callLLM({
      purpose: "extract",
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      // Enrichment is prompt-shaping, not creative writing. Low temperature
      // stops Stheno from paraphrasing away concrete user tokens.
      temperature: 0.15,
      maxTokens: 300,
      timeoutMs: 15_000,
      contentRating: "mature",
    });
    if (result.provider === "hardcoded") return ensureGuardTokens(rawPrompt, tokens);
    const enriched = result.text?.trim();
    if (!enriched) return ensureGuardTokens(rawPrompt, tokens);
    return ensureGuardTokens(enriched, tokens);
  } catch {
    // Keep the direct-Stheno path as a last resort in case callLLM refuses
    // (unknown purpose etc.). Best-effort; on any failure return the raw
    // prompt with guard tokens re-appended, exactly like the fast path.
    try {
      const base = await resolvePoppyBaseUrl("stheno");
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "stheno",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: 300,
          temperature: 0.15,
          stream: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return ensureGuardTokens(rawPrompt, tokens);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const enriched = data.choices?.[0]?.message?.content?.trim();
      return ensureGuardTokens(enriched || rawPrompt, tokens);
    } catch {
      return ensureGuardTokens(rawPrompt, tokens);
    }
  }
}

// Ask for a short in-character message the character sends while the image is
// being generated. Routed through the full LLM chain (callLLM), NOT Stheno
// directly: when the self-hosted GPU box is down (prod symptom), a direct
// Stheno call fails and every teaser degrades to the bland canned line below.
// callLLM falls through to OpenRouter (already configured in prod), so the
// teaser stays creative even with the box offline. Returns a safe fallback on
// any failure so the caller never has to handle errors.
export async function generateImageTeaser(
  characterName: string,
  userPrompt: string,
): Promise<string> {
  const fallback = `Give me just a moment to get that perfect shot ready for you...`;
  try {
    const result = await callLLM({
      purpose: "chat",
      systemPrompt: `You are ${characterName}. The user has requested a photo of you. Write a short, playful, in-character response (1-2 sentences) to let them know their photo is on its way. Be flirtatious and stay fully in character. No hashtags, no emojis, no stage directions.`,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 70,
      temperature: 0.9,
      contentRating: "mature",
    });
    const text = result.text?.trim();
    // Never surface the generic hardcoded LLM fallback as a teaser.
    if (!text || result.provider === "hardcoded") return fallback;
    return text;
  } catch {
    return fallback;
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
  const context = conversationId ? await buildImageContext(conversationId, userId) : undefined;
  const enrichedPrompt = await enrichImagePrompt(prompt, context);

  // buildImageContext already resolved the character from the conversation, so
  // reuse it instead of issuing a second conversation.findUnique.
  let referenceBytes: Buffer | null = null;
  const characterId: string | null = context?.characterId ?? null;
  if (characterId) {
    referenceBytes = await resolveCharacterReferenceBytes(characterId);
    if (referenceBytes) {
      logInfo("chat-image", `reference resolved (${referenceBytes.length} bytes) char=${characterId}: consistent face path`);
    } else {
      logWarn("chat-image", `no reference bytes for char=${characterId}: falling back to faceless txt2img (no character consistency)`);
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
