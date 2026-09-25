// One-shot: retroactively sets profile photos for bots already in prod TelegramBotConfig.
// Uses gramjs to talk to BotFather's /setuserpic command (Bot API setMyPhoto = 404).
// Run this after telegram:full-provision to fix photos that were skipped.
//
// Required env vars: PROD_DATABASE_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION
// Optional: TELEGRAM_PHONE (for first-time auth fallback)
//
// Usage: npm run telegram:set-photos [-- --limit N] [-- --character-id <uuid>]
import "../load-env";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { NewMessageEvent } from "telegram/events/NewMessage";
import { getRawFromS3, bucketForKey } from "../media/storage";

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) { console.error("PROD_DATABASE_URL required"); process.exit(1); }

function rl_prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => { rl.question(question, (a) => { rl.close(); resolve(a.trim()); }); });
}

function waitForBotFatherReply(client: TelegramClient, timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let handler: (event: NewMessageEvent) => void;
    const cleanup = () => {
      clearTimeout(timer);
      client.removeEventHandler(handler, new NewMessage({ fromUsers: ["BotFather"] }));
    };
    handler = (event: NewMessageEvent) => { cleanup(); resolve(event.message.text ?? ""); };
    client.addEventHandler(handler, new NewMessage({ fromUsers: ["BotFather"] }));
    timer = setTimeout(() => { cleanup(); reject(new Error("Timeout waiting for BotFather")); }, timeoutMs);
  });
}

async function setBotPhotoViaBotFather(
  client: TelegramClient,
  botUsername: string,
  imageBuffer: Buffer,
): Promise<void> {
  await client.sendMessage("BotFather", { message: "/setuserpic" });
  const selectPrompt = await waitForBotFatherReply(client);
  if (
    !selectPrompt.toLowerCase().includes("choose") &&
    !selectPrompt.toLowerCase().includes("bot") &&
    !selectPrompt.toLowerCase().includes("which")
  ) {
    throw new Error(`Unexpected /setuserpic response: ${selectPrompt.slice(0, 120)}`);
  }

  await client.sendMessage("BotFather", { message: `@${botUsername}` });
  const photoPrompt = await waitForBotFatherReply(client);
  if (
    !photoPrompt.toLowerCase().includes("photo") &&
    !photoPrompt.toLowerCase().includes("pic") &&
    !photoPrompt.toLowerCase().includes("image")
  ) {
    throw new Error(`Unexpected response after username: ${photoPrompt.slice(0, 120)}`);
  }

  await (client as TelegramClient & { sendFile: (to: string, opts: { file: Buffer; caption: string }) => Promise<unknown> }).sendFile("BotFather", { file: imageBuffer, caption: "" });

  const confirmation = await waitForBotFatherReply(client, 60_000);
  if (
    !confirmation.toLowerCase().includes("updated") &&
    !confirmation.toLowerCase().includes("success") &&
    !confirmation.toLowerCase().includes("profile picture") &&
    !confirmation.toLowerCase().includes("photo")
  ) {
    throw new Error(`Photo not confirmed: ${confirmation.slice(0, 120)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 999;
  let filterCharId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--character-id" && args[i + 1]) filterCharId = args[++i];
  }

  const API_ID = parseInt(process.env.TELEGRAM_API_ID ?? "", 10);
  const API_HASH = process.env.TELEGRAM_API_HASH ?? "";
  const SESSION_STR = process.env.TELEGRAM_SESSION ?? "";
  const PHONE = process.env.TELEGRAM_PHONE;

  if (!API_ID || !API_HASH) { console.error("TELEGRAM_API_ID and TELEGRAM_API_HASH required"); process.exit(1); }

  // Admin-script direct connection to prod (one-shot, $disconnect called before exit).
  const prod = new PrismaClient({ datasources: { db: { url: PROD_URL! } } });

  const configs = await prod.telegramBotConfig.findMany({
    where: filterCharId ? { characterId: filterCharId } : undefined,
    include: {
      character: {
        select: {
          name: true,
          media: {
            where: { hidden: false, kind: "image" },
            orderBy: [{ isDisplay: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
            select: { url: true },
            take: 1,
          },
        },
      },
    },
    take: limit,
  });

  console.log(`\nTelegram Set-Photos (via BotFather /setuserpic)`);
  console.log(`================================================`);
  console.log(`Found ${configs.length} bot config(s) to process\n`);

  if (configs.length === 0) {
    await prod.$disconnect();
    return;
  }

  const client = new TelegramClient(new StringSession(SESSION_STR), API_ID, API_HASH, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => PHONE ?? rl_prompt("Phone number: "),
    password: async () => rl_prompt("2FA password (blank if none): "),
    phoneCode: async () => rl_prompt("Telegram OTP: "),
    onError: (err) => console.error("Auth error:", err),
  });

  let ok = 0, skipped = 0, failed = 0;

  for (const cfg of configs) {
    const name = cfg.character.name;
    const rawUrl = cfg.character.media[0]?.url;

    if (!rawUrl) {
      console.log(`${name} (@${cfg.botUsername}): SKIP (no display image)`);
      skipped++;
      continue;
    }

    process.stdout.write(`${name} (@${cfg.botUsername}): `);

    try {
      let buf: Buffer | null = null;

      if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        const r = await fetch(rawUrl);
        if (r.ok) {
          buf = Buffer.from(await r.arrayBuffer());
        } else {
          console.log(`SKIP (URL fetch ${r.status})`);
          skipped++;
          continue;
        }
      } else {
        const bucket = bucketForKey(rawUrl);
        if (!bucket) {
          console.log("SKIP (no bucket for key)");
          skipped++;
          continue;
        }
        buf = await getRawFromS3(bucket, rawUrl);
      }

      if (!buf) {
        console.log("FAIL (null buffer)");
        failed++;
        continue;
      }

      await setBotPhotoViaBotFather(client, cfg.botUsername, buf);
      console.log("OK");
      ok++;

      // Small pause between /setuserpic calls to avoid BotFather rate limits.
      await new Promise(r => setTimeout(r, 3_000));
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  console.log(`\nDone. OK=${ok} skipped=${skipped} failed=${failed}`);
  await client.disconnect();
  await prod.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
