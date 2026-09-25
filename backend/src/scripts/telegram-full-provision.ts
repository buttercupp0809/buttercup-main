// Integrated Telegram bot provisioning script.
// For each character in prod DB that lacks a TelegramBot:
//   1. Creates the bot via BotFather (gramjs MTProto)
//   2. Writes TelegramBotConfig to PROD DB
//   3. Registers webhook with Telegram
//   4. Sets bot name, description, short description, commands
//   5. Sets bot profile photo from the character's display image
//   6. Waits 30s before the next character
//
// Required env vars (in backend/.env):
//   PROD_DATABASE_URL  - production Postgres URL
//   TELEGRAM_API_ID    - from my.telegram.org
//   TELEGRAM_API_HASH  - from my.telegram.org
//   TELEGRAM_SESSION   - gramjs session string (from --auth-only run)
//   TELEGRAM_PHONE     - your phone number (fallback for first-time auth)
//
// Optional:
//   BACKEND_URL        - defaults to https://api.buttercupp.fun
//
// Usage:
//   npm run telegram:full-provision -- [--limit N] [--dry-run] [--skip-photo]

import "../load-env";
import { randomBytes } from "crypto";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
// PrismaClient used directly here because this script connects to a SEPARATE
// prod database, not the singleton's DATABASE_URL (which points at local dev).
// This is a one-shot admin script that calls $disconnect() before exit.
import { PrismaClient } from "@prisma/client";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { NewMessageEvent } from "telegram/events/NewMessage";
import { setWebhook, setMyPhoto } from "../telegram/client";
import {
  setMyName,
  setMyDescription,
  setMyShortDescription,
  setMyCommands,
} from "../telegram/client-configure";
import { getSignedUrl } from "../media/storage";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 20;
  let dryRun = false;
  let skipPhoto = false;
  const logPath = path.resolve("telegram-provision-log.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--skip-photo") skipPhoto = true;
  }

  return { limit, dryRun, skipPhoto, logPath };
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Flood-wait error (BotFather rate limit)
// ---------------------------------------------------------------------------

class FloodWaitError extends Error {
  constructor(public readonly seconds: number) {
    super(`BotFather flood wait: ${seconds}s`);
  }
}

function parseFloodWait(text: string): number | null {
  const lower = text.toLowerCase();
  if (!lower.includes("too many") && !lower.includes("flood")) return null;
  const match = text.match(/(\d+)\s+second/i);
  return match ? parseInt(match[1], 10) : 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// BotFather conversation helpers
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function waitForBotFatherReply(
  client: TelegramClient,
  timeoutMs = 45_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let handler: (event: NewMessageEvent) => void;

    const cleanup = () => {
      clearTimeout(timer);
      client.removeEventHandler(handler, new NewMessage({ fromUsers: ["BotFather"] }));
    };

    handler = (event: NewMessageEvent) => {
      const text = event.message.text ?? "";
      cleanup();
      resolve(text);
    };

    client.addEventHandler(handler, new NewMessage({ fromUsers: ["BotFather"] }));

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for BotFather reply (45s)"));
    }, timeoutMs);
  });
}

function makeBotUsername(name: string, attempt: number): string {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  const suffix = attempt <= 1 ? "_bot" : `_${attempt}_bot`;
  const maxSlug = 32 - "bc_".length - suffix.length;
  const trimmed = slug.slice(0, maxSlug);
  const username = `bc_${trimmed}${suffix}`;
  return username.length >= 5 && username.length <= 32 ? username : `bc_bot_${Date.now()}`;
}

async function createBotInBotFather(
  client: TelegramClient,
  character: { id: string; name: string },
): Promise<{ botToken: string; botUsername: string }> {
  await client.sendMessage("BotFather", { message: "/newbot" });

  const namePrompt = await waitForBotFatherReply(client);
  const floodSecs = parseFloodWait(namePrompt);
  if (floodSecs !== null) throw new FloodWaitError(floodSecs);
  if (!namePrompt.toLowerCase().includes("name") && !namePrompt.toLowerCase().includes("alright")) {
    throw new Error(`Unexpected BotFather response after /newbot: ${namePrompt.slice(0, 120)}`);
  }

  await client.sendMessage("BotFather", { message: character.name });

  let botToken: string | null = null;
  let botUsername: string | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const username = makeBotUsername(character.name, attempt);

    if (attempt === 1) {
      const usernamePrompt = await waitForBotFatherReply(client);
      if (!usernamePrompt.toLowerCase().includes("username")) {
        throw new Error(
          `Unexpected BotFather response waiting for username prompt: ${usernamePrompt.slice(0, 120)}`,
        );
      }
    }

    await client.sendMessage("BotFather", { message: username });
    const reply = await waitForBotFatherReply(client);

    if (reply.toLowerCase().includes("sorry") && reply.toLowerCase().includes("taken")) {
      console.log(`    @${username} taken, trying next variant...`);
      continue;
    }

    const floodAfterUsername = parseFloodWait(reply);
    if (floodAfterUsername !== null) throw new FloodWaitError(floodAfterUsername);

    const tokenMatch = reply.match(/(\d+:[A-Za-z0-9_-]{35,})/);
    if (tokenMatch) {
      botToken = tokenMatch[1];
      botUsername = username;
      break;
    }

    throw new Error(
      `Unexpected BotFather response after sending username: ${reply.slice(0, 200)}`,
    );
  }

  if (!botToken || !botUsername) {
    throw new Error(`All username attempts exhausted for character "${character.name}"`);
  }

  return { botToken, botUsername };
}

// ---------------------------------------------------------------------------
// Log file helpers
// ---------------------------------------------------------------------------

interface LogEntry {
  characterId: string;
  characterName: string;
  botUsername: string;
  botToken: string;
  status: "ok" | "failed";
  photoSet: boolean;
  error?: string;
  createdAt: string;
}

function appendLog(logPath: string, entry: LogEntry): void {
  const existing: LogEntry[] = fs.existsSync(logPath)
    ? (JSON.parse(fs.readFileSync(logPath, "utf-8")) as LogEntry[])
    : [];
  existing.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { limit, dryRun, skipPhoto, logPath } = parseArgs();

  const PROD_DB_URL = requireEnv("PROD_DATABASE_URL");
  const API_ID = parseInt(requireEnv("TELEGRAM_API_ID"), 10);
  const API_HASH = requireEnv("TELEGRAM_API_HASH");
  const SESSION_STR = process.env.TELEGRAM_SESSION ?? "";
  const PHONE = process.env.TELEGRAM_PHONE;
  const BACKEND_URL = process.env.BACKEND_URL ?? "https://api.buttercupp.fun";

  // Prod DB connection (separate from the app singleton).
  const prodPrisma = new PrismaClient({ datasources: { db: { url: PROD_DB_URL } } });

  // Query characters without a TelegramBotConfig in prod DB.
  const characters = await prodPrisma.character.findMany({
    where: { telegramBotConfig: null },
    select: {
      id: true,
      name: true,
      bio: true,
      media: {
        where: { hidden: false, kind: "image" },
        orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
        select: { url: true },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  console.log(`\nTelegram Full Provision`);
  console.log(`=======================`);
  console.log(`Found ${characters.length} character(s) to provision (limit: ${limit})`);
  if (dryRun) console.log(`DRY RUN - no changes will be written\n`);

  if (characters.length === 0) {
    console.log("Nothing to do.");
    await prodPrisma.$disconnect();
    return;
  }

  if (dryRun) {
    for (const c of characters) {
      console.log(`  Would provision: "${c.name}" -> @${makeBotUsername(c.name, 1)}`);
    }
    await prodPrisma.$disconnect();
    return;
  }

  // Connect gramjs.
  const session = new StringSession(SESSION_STR);
  const gramClient = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await gramClient.start({
    phoneNumber: async () => PHONE ?? prompt("Phone number: "),
    password: async () => prompt("2FA password (blank if none): "),
    phoneCode: async () => prompt("Telegram OTP: "),
    onError: (err) => console.error("Auth error:", err),
  });

  const savedSession = gramClient.session.save() as unknown as string;
  if (!SESSION_STR) {
    console.log("\n[IMPORTANT] Add to .env: TELEGRAM_SESSION=" + savedSession + "\n");
  }

  let successCount = 0;
  let failCount = 0;
  const INTER_BOT_DELAY_MS = 30_000;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const label = `[${i + 1}/${characters.length}] "${char.name}"`;
    console.log(`\n${label}`);

    let botToken: string | null = null;
    let botUsername: string | null = null;
    let photoSet = false;

    // Step 1: Create bot in BotFather (up to 3 retries on flood wait).
    let attempts = 0;
    while (attempts < 3) {
      try {
        const result = await createBotInBotFather(gramClient, char);
        botToken = result.botToken;
        botUsername = result.botUsername;
        console.log(`  [1/5] BotFather: @${botUsername} created`);
        break;
      } catch (err) {
        if (err instanceof FloodWaitError) {
          attempts++;
          const wait = err.seconds + 5;
          console.log(`  [1/5] Flood wait ${err.seconds}s. Waiting ${wait}s (attempt ${attempts}/3)...`);
          await sleep(wait * 1000);
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toUpperCase().includes("FLOOD_WAIT")) {
          attempts++;
          const secs = parseInt(msg.match(/(\d+)/)?.[1] ?? "60", 10) + 5;
          console.log(`  [1/5] gramjs FloodWait. Waiting ${secs}s (attempt ${attempts}/3)...`);
          await sleep(secs * 1000);
          continue;
        }
        console.error(`  [1/5] FAILED to create bot: ${msg}`);
        appendLog(logPath, {
          characterId: char.id,
          characterName: char.name,
          botUsername: "",
          botToken: "",
          status: "failed",
          photoSet: false,
          error: msg,
          createdAt: new Date().toISOString(),
        });
        failCount++;
        break;
      }
    }

    if (!botToken || !botUsername) {
      if (i < characters.length - 1) {
        console.log(`  Waiting ${INTER_BOT_DELAY_MS / 1000}s before next character...`);
        await sleep(INTER_BOT_DELAY_MS);
      }
      continue;
    }

    try {
      // Step 2: Write TelegramBotConfig to PROD DB.
      const webhookSecret = randomBytes(32).toString("hex");
      await prodPrisma.telegramBotConfig.upsert({
        where: { characterId: char.id },
        create: { characterId: char.id, botToken, botUsername, webhookSecret },
        update: { botToken, botUsername, webhookSecret },
      });
      console.log(`  [2/5] DB: TelegramBotConfig upserted`);

      // Step 3: Register webhook.
      const webhookUrl = `${BACKEND_URL}/telegram/webhook/${char.id}`;
      await setWebhook(botToken, webhookUrl, webhookSecret);
      console.log(`  [3/5] Webhook: ${webhookUrl}`);

      // Step 4: Set bot metadata via Bot API.
      await setMyName(botToken, char.name);
      if (char.bio) await setMyDescription(botToken, char.bio);
      await setMyShortDescription(botToken, "Your AI companion on Buttercupp");
      await setMyCommands(botToken, [
        { command: "start", description: "Link your Buttercupp account" },
        { command: "help", description: "Show help" },
      ]);
      console.log(`  [4/5] Bot API: name, description, commands set`);

      // Step 5: Set bot profile photo from character's display image.
      if (!skipPhoto && char.media[0]?.url) {
        const rawUrl = char.media[0].url;
        try {
          let photoUrl: string;
          if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            photoUrl = rawUrl;
          } else if (rawUrl.startsWith("/")) {
            throw new Error("local static path, skipping");
          } else {
            photoUrl = await getSignedUrl(rawUrl, 900);
          }
          await setMyPhoto(botToken, photoUrl);
          photoSet = true;
          console.log(`  [5/5] Photo: set`);
        } catch (photoErr) {
          const msg = photoErr instanceof Error ? photoErr.message : String(photoErr);
          console.log(`  [5/5] Photo: skipped (${msg})`);
        }
      } else {
        console.log(`  [5/5] Photo: skipped (${skipPhoto ? "--skip-photo flag" : "no display image"})`);
      }

      console.log(`  Done: "${char.name}" @${botUsername}`);
      appendLog(logPath, {
        characterId: char.id,
        characterName: char.name,
        botUsername,
        botToken,
        status: "ok",
        photoSet,
        createdAt: new Date().toISOString(),
      });
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  PROVISION FAILED: ${msg}`);
      appendLog(logPath, {
        characterId: char.id,
        characterName: char.name,
        botUsername: botUsername ?? "",
        botToken: botToken ?? "",
        status: "failed",
        photoSet: false,
        error: msg,
        createdAt: new Date().toISOString(),
      });
      failCount++;
    }

    if (i < characters.length - 1) {
      console.log(`  Waiting ${INTER_BOT_DELAY_MS / 1000}s before next character...`);
      await sleep(INTER_BOT_DELAY_MS);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Provisioned: ${successCount}`);
  console.log(`Failed:      ${failCount}`);
  console.log(`Log:         ${logPath}`);

  await gramClient.disconnect();
  await prodPrisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
