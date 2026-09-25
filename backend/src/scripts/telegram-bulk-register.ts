import "../load-env";
import fs from "node:fs";
import { randomBytes } from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@buttercupp/database";
import { setWebhook, setMyPhoto } from "../telegram/client";
import {
  setMyCommands,
  setMyName,
  setMyShortDescription,
} from "../telegram/client-configure";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateEntry {
  characterId: string;
  characterName: string;
  suggestedUsernames: string[];
  botToken: string;
  botUsername: string;
}

interface ProcessResult {
  characterId: string;
  characterName: string;
  botUsername: string;
  status: "registered" | "skipped" | "error";
  photoSet: boolean;
  photoSkipped: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35,}$/;

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath: string | undefined;
  let dryRun = false;
  let skipPhoto = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--skip-photo") {
      skipPhoto = true;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  return { inputPath, dryRun, skipPhoto, force };
}

async function resolvePhotoUrl(url: string): Promise<string | null> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  // Local static file (starts with "/") - cannot use for Telegram
  if (url.startsWith("/")) {
    return null;
  }
  // S3 key - generate a presigned URL
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const s3 = new S3Client({ region });
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: url });
  const presigned = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return presigned;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { inputPath, dryRun, skipPhoto, force } = parseArgs();

  if (!inputPath) {
    console.error("Error: --input <path> is required");
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found: ${inputPath}`);
    process.exit(1);
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  if (!BACKEND_URL) {
    console.error("Error: BACKEND_URL env var is required");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  const entries: TemplateEntry[] = JSON.parse(raw);

  console.log(`\nTelegram Bulk Register`);
  console.log(`======================`);
  if (dryRun) console.log(`DRY RUN - no changes will be made\n`);

  const results: ProcessResult[] = [];

  for (const entry of entries) {
    const { characterId, characterName, botToken, botUsername } = entry;

    // Validate token format
    if (!botToken || !BOT_TOKEN_RE.test(botToken)) {
      const msg = `invalid or missing botToken (format: <digits>:<35+ alphanum>)`;
      console.log(`[SKIP] ${characterName}: ${msg}`);
      results.push({
        characterId,
        characterName,
        botUsername,
        status: "error",
        photoSet: false,
        photoSkipped: false,
        error: msg,
      });
      continue;
    }

    if (!botUsername) {
      const msg = `botUsername is empty`;
      console.log(`[SKIP] ${characterName}: ${msg}`);
      results.push({
        characterId,
        characterName,
        botUsername,
        status: "error",
        photoSet: false,
        photoSkipped: false,
        error: msg,
      });
      continue;
    }

    try {
      // Check if already configured
      const existing = await prisma.telegramBotConfig.findUnique({
        where: { characterId },
      });

      if (existing && !force) {
        console.log(
          `[SKIP] ${characterName} (@${botUsername}) - already configured (use --force to re-register)`,
        );
        results.push({
          characterId,
          characterName,
          botUsername,
          status: "skipped",
          photoSet: false,
          photoSkipped: true,
        });
        continue;
      }

      if (dryRun) {
        console.log(
          `[DRY-RUN] ${characterName} (@${botUsername}) - would register webhook and configure bot`,
        );
        results.push({
          characterId,
          characterName,
          botUsername,
          status: "registered",
          photoSet: false,
          photoSkipped: skipPhoto,
        });
        continue;
      }

      // Generate webhook secret
      const webhookSecret = randomBytes(32).toString("hex");

      // Upsert TelegramBotConfig
      await prisma.telegramBotConfig.upsert({
        where: { characterId },
        create: { characterId, botToken, botUsername, webhookSecret },
        update: { botToken, botUsername, webhookSecret },
      });

      // Register webhook
      const webhookUrl = `${BACKEND_URL}/telegram/webhook/${characterId}`;
      await setWebhook(botToken, webhookUrl, webhookSecret);

      // Set commands
      await setMyCommands(botToken, [
        { command: "start", description: "Link your Buttercupp account" },
        { command: "help", description: "Show help" },
      ]);

      // Set bot name to character name
      await setMyName(botToken, characterName);

      // Set short description
      await setMyShortDescription(botToken, "Your AI companion on Buttercupp");

      // Try to set bot photo
      let photoSet = false;
      let photoSkipped = skipPhoto;

      if (!skipPhoto) {
        const media = await prisma.characterMedia.findFirst({
          where: { characterId, hidden: false, kind: "image" },
          orderBy: [
            { isDisplay: "desc" },
            { isPrimary: "desc" },
            { createdAt: "asc" },
          ],
          select: { url: true },
        });

        if (media) {
          const photoUrl = await resolvePhotoUrl(media.url).catch(
            () => null,
          );
          if (photoUrl) {
            await setMyPhoto(botToken, photoUrl);
            photoSet = true;
          } else {
            photoSkipped = true;
          }
        } else {
          photoSkipped = true;
        }
      }

      const photoNote = photoSet
        ? ", photo set"
        : photoSkipped
          ? ", photo skipped"
          : "";
      console.log(`[OK] ${characterName} (@${botUsername}) - webhook set${photoNote}`);

      results.push({
        characterId,
        characterName,
        botUsername,
        status: "registered",
        photoSet,
        photoSkipped,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] ${characterName} (@${botUsername}): ${msg}`);
      results.push({
        characterId,
        characterName,
        botUsername,
        status: "error",
        photoSet: false,
        photoSkipped: false,
        error: msg,
      });
    }
  }

  // Summary
  const registered = results.filter((r) => r.status === "registered").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;
  const photosSet = results.filter((r) => r.photoSet).length;
  const photosSkippedCount = results.length - photosSet;

  console.log(`\nSummary`);
  console.log(`-------`);
  console.log(`Processed: ${results.length} characters`);
  console.log(
    `Registered: ${registered} new, ${skipped} skipped (already configured)`,
  );
  console.log(`Photos set: ${photosSet}`);
  console.log(
    `Photos skipped: ${photosSkippedCount} (no S3 config or local-only URL)`,
  );
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    console.log(`\nErrors:`);
    results
      .filter((r) => r.status === "error")
      .forEach((r) => {
        console.log(`  ${r.characterName}: ${r.error}`);
      });
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
