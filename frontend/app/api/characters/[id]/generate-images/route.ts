import { spawn } from "node:child_process";
import { join } from "node:path";
import { requireAuth, signAuthToken } from "@/lib/auth";
import { prisma } from "@buttercupp/database";
import { jsonError, jsonOk } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface CharacterData {
  name: string;
  age: number;
  gender: string;
  style: string;
  bio: string;
  location?: string | null;
  stylePrompt: string | null;
  negativePrompt: string | null;
  traits: Record<string, string | undefined> | null;
  personality: string | null;
  backstory: string | null;
}

// Builds a rich style tag based on the chosen visual style.
function styleTag(style: string): string {
  if (style === "anime") return "anime style, detailed illustration, vivid color palette, cel shading, expressive eyes";
  if (style === "3d") return "stylized 3D render, subsurface scattering, soft rim lighting, ambient occlusion";
  return "photorealistic, 8k uhd, RAW photo, DSLR, sharp focus, high detail, cinematic";
}

// Builds the appearance clause from wizard trait selections.
function appearanceClause(traits: Record<string, string | undefined> | null): string {
  if (!traits) return "";
  const parts: string[] = [];
  if (traits.hair) parts.push(`${traits.hair} hair`);
  if (traits.eye) parts.push(`${traits.eye} eyes`);
  if (traits.body) parts.push(traits.body);
  if (traits.clothing) parts.push(`wearing ${traits.clothing}`);
  return parts.join(", ");
}

// Rule-based prompt generator. Produces 4 thematically distinct prompts
// from the character's stored data -- no external API call needed.
function buildPrompts(data: CharacterData): { prompts: string[]; negative: string } {
  const { name, age, gender, style, bio, location, stylePrompt, traits, personality } = data;

  const st = styleTag(style);
  const appearance = appearanceClause(traits);
  const base = [
    stylePrompt ?? `portrait of ${name}`,
    `${age} year old ${gender}`,
    appearance,
    st,
  ].filter(Boolean).join(", ");

  // Pull a short descriptive phrase from the bio for scene variety
  const bioFragment = bio ? bio.split(",")[0].replace(/^[A-Z][a-z]+\s+/, "").trim() : "";
  const loc = location ? `in ${location}` : "";

  const prompts = [
    // 1. Classic portrait -- direct, polished
    `${base}, soft natural light, confident gaze directly at camera, clean background, editorial portrait`,

    // 2. Environmental / lifestyle -- character in their world
    `${base}, ${loc || "urban environment"}, golden hour, candid lifestyle photo, shallow depth of field, authentic mood`,

    // 3. Scene from bio/personality
    `${base}, ${bioFragment || "relaxed expression"}, warm ambient light, intimate atmosphere, story-driven composition`,

    // 4. Dramatic / editorial
    `${base}, dramatic studio lighting, high contrast, bold composition, fashion editorial, ${personality ? personality.split(".")[0] : "confident"}`,
  ];

  const negative = [
    data.negativePrompt,
    "deformed, disfigured, blurry, low quality, watermark, text, logo, extra fingers, bad anatomy, child, underage",
  ].filter(Boolean).join(", ");

  return { prompts, negative };
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth();
  const { id } = await ctx.params;

  const character = await prisma.character.findUnique({
    where: { id },
    include: { currentVersion: { include: { appearanceSheet: true } } },
  });

  if (!character) return jsonError(404, "character_not_found");
  if (character.ownerUserId !== user.id) return jsonError(403, "forbidden");

  const version = character.currentVersion;
  const appearance = version?.appearanceSheet ?? null;

  const { prompts, negative } = buildPrompts({
    name: character.name,
    age: character.age,
    gender: character.gender,
    style: character.style,
    bio: character.bio,
    location: (character as { location?: string | null }).location ?? null,
    stylePrompt: appearance?.stylePrompt ?? null,
    negativePrompt: appearance?.negativePrompt ?? null,
    traits: (appearance?.traits as Record<string, string | undefined> | null) ?? null,
    personality: version?.personality ?? null,
    backstory: version?.backstory ?? null,
  });

  const apiToken = await signAuthToken(user.id);
  const apiBase = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const comfyHost = process.env.COMFYUI_HOST;
  if (!comfyHost) {
    return jsonOk({ status: "queued", message: "GPU not configured; generation skipped." });
  }

  const pipelineScript = join(process.cwd(), "..", "Plans", "inference-aws", "persona_pipeline.py");
  const venvPython = join(process.cwd(), "..", "Plans", "inference-aws", ".venv", "bin", "python3");
  const outDir = join(process.cwd(), "..", "Plans", "inference-aws", "persona-output", id);
  const ckpt = process.env.COMFYUI_CKPT ?? "juggernautXL_v8Rundiffusion.safetensors";

  const quality =
    "full body from head to toe, entire figure visible, standing far from camera, " +
    "masterpiece, best quality, soft even lighting, bright natural light, ";

  // 4 rule-built prompts, each generates 1 image (VARIANTS_PER_PROMPT=1) = 4 images total
  const args = [
    pipelineScript,
    comfyHost, id,
    "", outDir, "",
    ckpt, "1.05", "0.0", "0.75", "30", "4.5", "dpmpp_2m", "karras",
    negative, quality,
    ...prompts,
  ];

  const child = spawn(venvPython, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      VARIANTS_PER_PROMPT: "1",
      S3_BUCKET: process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET ?? "",
      CHARACTER_ID: id,
      API_BASE: apiBase,
      API_TOKEN: apiToken,
    },
  });
  child.unref();

  return jsonOk({ status: "generating", message: "Image generation started in background." });
}
