import "../load-env";
import { prisma } from "@buttercupp/database";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { NewMessageEvent } from "telegram/events/NewMessage";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { limit: number; output: string; dryRun: boolean; authOnly: boolean } {
  const args = process.argv.slice(2);
  let limit = 20;
  let output = path.resolve(__dirname, "bots-created.json");
  let dryRun = false;
  let authOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--output" && args[i + 1]) {
      output = path.resolve(args[++i]);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--auth-only") {
      authOnly = true;
    }
  }

  return { limit, output, dryRun, authOnly };
}

// ---------------------------------------------------------------------------
// Username slug generation
// ---------------------------------------------------------------------------

function makeUsername(name: string, attempt: number): string {
  // Prefix: bc_, slug: lowercase + underscores, suffix: _bot
  // Total Telegram username limit: 5-32 chars
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  const suffix = attempt <= 1 ? "_bot" : `_${attempt}_bot`;
  const base = `bc_${slug}`;

  // Trim slug if the full name would exceed 32 chars
  const maxSlug = 32 - "bc_".length - suffix.length;
  const trimmedSlug = slug.slice(0, maxSlug);
  const username = `bc_${trimmedSlug}${suffix}`;

  // Telegram requires 5-32 chars
  return username.length >= 5 && username.length <= 32 ? username : `bc_bot_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Output JSON file helpers
// ---------------------------------------------------------------------------

interface BotRecord {
  characterId: string;
  characterName: string;
  botToken: string;
  botUsername: string;
  createdAt: string;
}

function readExistingOutput(outputPath: string): BotRecord[] {
  if (!fs.existsSync(outputPath)) return [];
  try {
    const raw = fs.readFileSync(outputPath, "utf-8");
    return JSON.parse(raw) as BotRecord[];
  } catch {
    console.warn(`Warning: could not parse existing ${outputPath}, starting fresh.`);
    return [];
  }
}

function appendOutput(outputPath: string, record: BotRecord): void {
  const existing = readExistingOutput(outputPath);
  existing.push(record);
  fs.writeFileSync(outputPath, JSON.stringify(existing, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Interactive readline helper for first-run auth
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

// ---------------------------------------------------------------------------
// Wait for a BotFather reply within a timeout
// ---------------------------------------------------------------------------

function waitForBotFatherReply(
  client: TelegramClient,
  timeoutMs = 30_000
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
      reject(new Error("Timed out waiting for BotFather reply (30s)"));
    }, timeoutMs);
  });
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

// ---------------------------------------------------------------------------
// Drive BotFather conversation for a single character
// ---------------------------------------------------------------------------

async function createBotForCharacter(
  client: TelegramClient,
  character: { id: string; name: string }
): Promise<{ botToken: string; botUsername: string }> {
  // Send /newbot
  await client.sendMessage("BotFather", { message: "/newbot" });

  // BotFather asks for the display name (or flood-waits us)
  const namePrompt = await waitForBotFatherReply(client);
  const floodWait = parseFloodWait(namePrompt);
  if (floodWait !== null) throw new FloodWaitError(floodWait);
  if (!namePrompt.toLowerCase().includes("name") && !namePrompt.toLowerCase().includes("alright")) {
    throw new Error(`Unexpected BotFather response after /newbot: ${namePrompt.slice(0, 120)}`);
  }

  // Send display name
  await client.sendMessage("BotFather", { message: character.name });

  // Try usernames with up to 5 attempts
  let botToken: string | null = null;
  let botUsername: string | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const username = makeUsername(character.name, attempt);

    if (attempt > 1) {
      // BotFather already asked for the username again (after "Sorry") - just send
    } else {
      // Wait for BotFather to ask for the username
      const usernamePrompt = await waitForBotFatherReply(client);
      if (!usernamePrompt.toLowerCase().includes("username")) {
        throw new Error(`Unexpected BotFather response when waiting for username prompt: ${usernamePrompt.slice(0, 120)}`);
      }
    }

    await client.sendMessage("BotFather", { message: username });

    const reply = await waitForBotFatherReply(client);

    if (reply.toLowerCase().includes("sorry")) {
      // Username taken - loop to next attempt (BotFather will re-ask for username)
      console.log(`    Username @${username} taken, retrying...`);
      continue;
    }

    // Try to extract token from success message
    const tokenMatch = reply.match(/(\d+:[A-Za-z0-9_-]{35,})/);
    if (tokenMatch) {
      botToken = tokenMatch[1];
      botUsername = username;
      break;
    }

    // Unexpected response
    throw new Error(`Unexpected BotFather response after sending username: ${reply.slice(0, 200)}`);
  }

  if (!botToken || !botUsername) {
    throw new Error(`All username attempts exhausted for character "${character.name}"`);
  }

  return { botToken, botUsername };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { limit, output, dryRun, authOnly } = parseArgs();

  // Validate required env vars
  const apiIdRaw = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionStr = process.env.TELEGRAM_SESSION ?? "";
  const phone = process.env.TELEGRAM_PHONE;

  if (!apiIdRaw || !apiHash) {
    console.error("TELEGRAM_API_ID and TELEGRAM_API_HASH are required env vars.");
    console.error("Get them from https://my.telegram.org");
    process.exit(1);
  }

  const apiId = parseInt(apiIdRaw, 10);
  if (isNaN(apiId)) {
    console.error("TELEGRAM_API_ID must be an integer.");
    process.exit(1);
  }

  // Find characters that do NOT yet have a TelegramBotConfig
  const characters = await prisma.character.findMany({
    where: { telegramBotConfig: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`Found ${characters.length} character(s) without a Telegram bot.`);

  if (characters.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const batch = characters.slice(0, limit);
  console.log(`Processing up to ${limit} bots this run (batch size: ${batch.length}).`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would create bots for:");
    for (let i = 0; i < batch.length; i++) {
      const c = batch[i];
      console.log(`  ${i + 1}. "${c.name}" -> @${makeUsername(c.name, 1)}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Set up gramjs client
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      if (phone) return phone;
      return prompt("Enter your Telegram phone number (with country code, e.g. +1234567890): ");
    },
    password: async () => prompt("Enter your 2FA password (leave blank if none): "),
    phoneCode: async () => prompt("Enter the Telegram login code sent to your phone: "),
    onError: (err) => {
      console.error("Telegram auth error:", err);
    },
  });

  // Save session string so operator can persist it in TELEGRAM_SESSION
  const savedSession = client.session.save() as unknown as string;
  if (!sessionStr) {
    console.log("\n[IMPORTANT] Save this session string to your TELEGRAM_SESSION env var:");
    console.log(savedSession);
    console.log("");
  }

  // Auth-only mode: just authenticate and print session, then exit.
  if (authOnly) {
    console.log("\nAuthentication successful. Session saved above.");
    console.log("Add TELEGRAM_SESSION=<string above> to your .env, then run without --auth-only to create bots.");
    await client.disconnect();
    await prisma.$disconnect();
    return;
  }

  // Stats
  let created = 0;
  let failed = 0;
  let skipped = 0;

  // BotFather allows bursts of ~2 bots before triggering a flood wait.
  // Waiting 30s between each bot keeps us well under the burst threshold.
  const INTER_BOT_DELAY_MS = 30_000;

  for (const character of batch) {
    console.log(`\nCreating bot for "${character.name}"...`);

    let attempts = 0;
    const MAX_RETRIES = 3;

    while (attempts < MAX_RETRIES) {
      try {
        const { botToken, botUsername } = await createBotForCharacter(client, character);

        console.log(`  Created: @${botUsername}`);

        const record: BotRecord = {
          characterId: character.id,
          characterName: character.name,
          botToken,
          botUsername,
          createdAt: new Date().toISOString(),
        };

        appendOutput(output, record);
        created++;
        break;
      } catch (err: unknown) {
        attempts++;

        // BotFather flood wait (our FloodWaitError or gramjs FLOOD_WAIT)
        if (err instanceof FloodWaitError) {
          const waitMs = (err.seconds + 5) * 1000;
          console.log(`  BotFather rate limit. Waiting ${err.seconds + 5}s before retry ${attempts}/${MAX_RETRIES}...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        const message = err instanceof Error ? err.message : String(err);
        if (message.toUpperCase().includes("FLOOD_WAIT")) {
          const seconds = parseInt(message.match(/(\d+)/)?.[1] ?? "60", 10);
          console.log(`  gramjs FloodWait ${seconds}s. Waiting before retry ${attempts}/${MAX_RETRIES}...`);
          await new Promise((r) => setTimeout(r, (seconds + 5) * 1000));
          continue;
        }

        console.error(`  Failed for "${character.name}": ${message}`);
        failed++;
        break;
      }
    }

    // Pace between bots to avoid triggering burst rate limits.
    if (character !== batch[batch.length - 1]) {
      console.log(`  Waiting ${INTER_BOT_DELAY_MS / 1000}s before next bot...`);
      await new Promise((r) => setTimeout(r, INTER_BOT_DELAY_MS));
    }
  }

  skipped = batch.length - created - failed;

  console.log("\n--- Summary ---");
  console.log(`Created : ${created}`);
  console.log(`Failed  : ${failed}`);
  console.log(`Skipped : ${skipped}`);
  console.log(`Output  : ${output}`);
  console.log(`Remaining characters without bots: ${characters.length - batch.length}`);

  await client.disconnect();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
