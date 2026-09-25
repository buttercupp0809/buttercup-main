// Provisions Telegram bots for characters: sets webhook, name, description,
// short description, commands, and profile photo. Reads from DB or an input
// JSON file produced by the bot-creation step.
//
// Usage:
//   npx ts-node -r tsconfig-paths/register src/scripts/telegram-provision.ts [options]
//
// Options:
//   --input PATH        Read bot list from a JSON file instead of DB
//   --character-id UUID Provision a single character only
//   --skip-photo        Skip the profile photo step
//   --dry-run           Print actions without executing them
//
// Required env vars:
//   BACKEND_URL         e.g. https://api.buttercupp.fun
//   DATABASE_URL        (loaded via load-env)

import "../load-env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@buttercupp/database";
import { setWebhook, setMyPhoto } from "../telegram/client";
import { getSignedUrl } from "../media/storage";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const INPUT_PATH = flagValue("--input");
const CHARACTER_ID_FILTER = flagValue("--character-id");
const SKIP_PHOTO = hasFlag("--skip-photo");
const DRY_RUN = hasFlag("--dry-run");

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) {
  console.error("BACKEND_URL env var is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Local Bot API helpers (provisioning-only; not added to telegram/client.ts)
// ---------------------------------------------------------------------------

const TELEGRAM_API = "https://api.telegram.org";

interface BotApiResult {
  ok: boolean;
  description?: string;
}

async function botApiPost(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<BotApiResult> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, description: `fetch error: ${msg}` };
  }
  const json = (await res.json().catch(() => ({ ok: false }))) as BotApiResult;
  return json;
}

async function setMyName(token: string, name: string): Promise<BotApiResult> {
  return botApiPost(token, "setMyName", { name });
}

async function setMyDescription(token: string, description: string): Promise<BotApiResult> {
  // Bot API max: 512 chars
  return botApiPost(token, "setMyDescription", {
    description: description.slice(0, 512),
  });
}

async function setMyShortDescription(token: string, shortDescription: string): Promise<BotApiResult> {
  // Bot API max: 120 chars
  return botApiPost(token, "setMyShortDescription", {
    short_description: shortDescription.slice(0, 120),
  });
}

async function setMyCommands(token: string): Promise<BotApiResult> {
  return botApiPost(token, "setMyCommands", {
    commands: [
      { command: "start", description: "Connect your account" },
      { command: "image", description: "Generate an image" },
      { command: "help", description: "Show help" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InputBotEntry {
  characterId: string;
  characterName: string;
  botToken: string;
  botUsername: string;
}

interface ProvisionTarget {
  characterId: string;
  characterName: string;
  bio: string;
  botToken: string;
  botUsername: string;
  existingWebhookSecret?: string;
  displayImageUrl?: string;
}

// ---------------------------------------------------------------------------
// Build provision list
// ---------------------------------------------------------------------------

async function buildTargets(): Promise<ProvisionTarget[]> {
  if (INPUT_PATH) {
    // Read from JSON file
    const raw = fs.readFileSync(path.resolve(INPUT_PATH), "utf-8");
    const entries: InputBotEntry[] = JSON.parse(raw);

    const characterIds = entries.map((e) => e.characterId);

    // Apply single-character filter
    const filtered = CHARACTER_ID_FILTER
      ? entries.filter((e) => e.characterId === CHARACTER_ID_FILTER)
      : entries;

    if (filtered.length === 0) {
      console.error(`No entries match character-id filter: ${CHARACTER_ID_FILTER}`);
      process.exit(1);
    }

    // Fetch character data for bio + display image
    const characters = await prisma.character.findMany({
      where: { id: { in: characterIds } },
      select: {
        id: true,
        name: true,
        bio: true,
        media: {
          where: { isDisplay: true, kind: "image", hidden: false },
          select: { url: true },
          take: 1,
        },
      },
    });

    const charMap = new Map(characters.map((c) => [c.id, c]));

    // Fetch existing TelegramBotConfig rows to preserve webhookSecret if set
    const existingConfigs = await prisma.telegramBotConfig.findMany({
      where: { characterId: { in: characterIds } },
      select: { characterId: true, webhookSecret: true },
    });
    const secretMap = new Map(existingConfigs.map((c) => [c.characterId, c.webhookSecret]));

    return filtered.map((entry) => {
      const char = charMap.get(entry.characterId);
      return {
        characterId: entry.characterId,
        characterName: char?.name ?? entry.characterName,
        bio: char?.bio ?? "",
        botToken: entry.botToken,
        botUsername: entry.botUsername,
        existingWebhookSecret: secretMap.get(entry.characterId),
        displayImageUrl: char?.media[0]?.url,
      };
    });
  }

  // Default: read from DB (characters that already have TelegramBotConfig)
  const query = CHARACTER_ID_FILTER
    ? { characterId: CHARACTER_ID_FILTER }
    : {};

  const configs = await prisma.telegramBotConfig.findMany({
    where: query,
    select: {
      characterId: true,
      botToken: true,
      botUsername: true,
      webhookSecret: true,
      character: {
        select: {
          name: true,
          bio: true,
          media: {
            where: { isDisplay: true, kind: "image", hidden: false },
            select: { url: true },
            take: 1,
          },
        },
      },
    },
  });

  return configs.map((cfg) => ({
    characterId: cfg.characterId,
    characterName: cfg.character.name,
    bio: cfg.character.bio,
    botToken: cfg.botToken,
    botUsername: cfg.botUsername,
    existingWebhookSecret: cfg.webhookSecret,
    displayImageUrl: cfg.character.media[0]?.url,
  }));
}

// ---------------------------------------------------------------------------
// Provision one bot
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function provisionOne(target: ProvisionTarget): Promise<"ok" | "failed" | "skipped"> {
  const { characterId, characterName, bio, botToken, botUsername } = target;
  const label = `${characterName} (@${botUsername})`;

  const webhookSecret =
    target.existingWebhookSecret && target.existingWebhookSecret.length > 0
      ? target.existingWebhookSecret
      : crypto.randomBytes(16).toString("hex");

  const webhookUrl = `${BACKEND_URL}/telegram/webhook/${characterId}`;

  console.log(`\nProvisioning: ${label}`);
  console.log(`  characterId:  ${characterId}`);
  console.log(`  webhookUrl:   ${webhookUrl}`);
  console.log(`  skipPhoto:    ${SKIP_PHOTO}`);

  if (DRY_RUN) {
    console.log(`  [dry-run] would upsert TelegramBotConfig`);
    console.log(`  [dry-run] would call setWebhook`);
    console.log(`  [dry-run] would call setMyName`);
    console.log(`  [dry-run] would call setMyDescription`);
    console.log(`  [dry-run] would call setMyShortDescription`);
    console.log(`  [dry-run] would call setMyCommands`);
    if (!SKIP_PHOTO) {
      console.log(`  [dry-run] would call setMyPhoto (displayImageUrl: ${target.displayImageUrl ?? "none"})`);
    }
    return "ok";
  }

  try {
    // 1. Upsert TelegramBotConfig
    await prisma.telegramBotConfig.upsert({
      where: { characterId },
      create: { characterId, botToken, botUsername, webhookSecret },
      update: { botToken, botUsername, webhookSecret },
    });
    console.log(`  [1/7] DB upsert done`);

    // 2. setWebhook
    await setWebhook(botToken, webhookUrl, webhookSecret);
    console.log(`  [2/7] setWebhook done`);

    // 3. setMyName
    const nameResult = await setMyName(botToken, characterName);
    if (!nameResult.ok) {
      console.warn(`  [3/7] setMyName warn: ${nameResult.description ?? "unknown"}`);
    } else {
      console.log(`  [3/7] setMyName done`);
    }

    // 4. setMyDescription
    const descResult = await setMyDescription(botToken, bio);
    if (!descResult.ok) {
      console.warn(`  [4/7] setMyDescription warn: ${descResult.description ?? "unknown"}`);
    } else {
      console.log(`  [4/7] setMyDescription done`);
    }

    // 5. setMyShortDescription
    const shortDescResult = await setMyShortDescription(botToken, bio);
    if (!shortDescResult.ok) {
      console.warn(`  [5/7] setMyShortDescription warn: ${shortDescResult.description ?? "unknown"}`);
    } else {
      console.log(`  [5/7] setMyShortDescription done`);
    }

    // 6. setMyCommands
    const cmdsResult = await setMyCommands(botToken);
    if (!cmdsResult.ok) {
      console.warn(`  [6/7] setMyCommands warn: ${cmdsResult.description ?? "unknown"}`);
    } else {
      console.log(`  [6/7] setMyCommands done`);
    }

    // 7. Profile photo
    if (SKIP_PHOTO) {
      console.log(`  [7/7] setMyPhoto skipped (--skip-photo)`);
    } else if (!target.displayImageUrl) {
      console.log(`  [7/7] setMyPhoto skipped (no display image in DB)`);
    } else {
      try {
        const signedUrl = await getSignedUrl(target.displayImageUrl, 15 * 60);
        await setMyPhoto(botToken, signedUrl);
        console.log(`  [7/7] setMyPhoto done`);
      } catch (photoErr) {
        const msg = photoErr instanceof Error ? photoErr.message : String(photoErr);
        console.warn(`  [7/7] setMyPhoto warn: ${msg} (continuing)`);
      }
    }

    return "ok";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${msg}`);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (DRY_RUN) {
    console.log("[dry-run mode] no changes will be written\n");
  }

  const targets = await buildTargets();

  if (targets.length === 0) {
    console.log("No bots to provision. Done.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${targets.length} bot(s) to provision.`);

  let provisioned = 0;
  let failed = 0;
  let skipped = 0;

  for (const target of targets) {
    const result = await provisionOne(target);
    if (result === "ok") provisioned++;
    else if (result === "failed") failed++;
    else skipped++;

    // 100ms pause to stay well under Bot API global rate limit (30 req/s)
    await sleep(100);
  }

  console.log("\n=== Summary ===");
  console.log(`Provisioned: ${provisioned}`);
  console.log(`Failed:      ${failed}`);
  console.log(`Skipped:     ${skipped}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
