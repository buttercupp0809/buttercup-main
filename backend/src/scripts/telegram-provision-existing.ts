// One-shot: provisions already-created bots (from bots-batch-1.json) into PROD DB.
// Reads the JSON file, upserts TelegramBotConfig, registers webhook, sets bot metadata.
import "../load-env";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { setWebhook, setMyPhoto } from "../telegram/client";
import { setMyName, setMyShortDescription, setMyCommands } from "../telegram/client-configure";
import { getSignedUrl } from "../media/storage";

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) { console.error("PROD_DATABASE_URL required"); process.exit(1); }

const BACKEND_URL = process.env.BACKEND_URL ?? "https://api.buttercupp.fun";
const inputPath = resolve("bots-batch-1.json");

interface BatchRecord {
  characterId: string;
  characterName: string;
  botToken: string;
  botUsername: string;
}

async function main() {
  const records: BatchRecord[] = JSON.parse(readFileSync(inputPath, "utf-8"));
  // Admin-script direct connection to prod (one-shot, $disconnect called before exit).
  const prod = new PrismaClient({ datasources: { db: { url: PROD_URL! } } });

  console.log(`Provisioning ${records.length} existing bot(s) to prod DB...\n`);

  for (const rec of records) {
    console.log(`Processing: "${rec.characterName}" @${rec.botUsername}`);

    const char = await prod.character.findUnique({
      where: { id: rec.characterId },
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
    });

    if (!char) {
      console.log(`  SKIP: characterId ${rec.characterId} not found in prod DB`);
      continue;
    }

    const secret = randomBytes(32).toString("hex");

    await prod.telegramBotConfig.upsert({
      where: { characterId: char.id },
      create: { characterId: char.id, botToken: rec.botToken, botUsername: rec.botUsername, webhookSecret: secret },
      update: { botToken: rec.botToken, botUsername: rec.botUsername, webhookSecret: secret },
    });
    console.log(`  [1/4] DB upserted`);

    await setWebhook(rec.botToken, `${BACKEND_URL}/telegram/webhook/${char.id}`, secret);
    console.log(`  [2/4] Webhook registered`);

    await setMyName(rec.botToken, char.name);
    if (char.bio) await setMyShortDescription(rec.botToken, char.bio.slice(0, 120));
    else await setMyShortDescription(rec.botToken, "Your AI companion on Buttercupp");
    await setMyCommands(rec.botToken, [
      { command: "start", description: "Link your Buttercupp account" },
      { command: "help", description: "Show help" },
    ]);
    console.log(`  [3/4] Bot metadata set`);

    if (char.media[0]?.url) {
      try {
        const rawUrl = char.media[0].url;
        const photoUrl = rawUrl.startsWith("http") ? rawUrl : await getSignedUrl(rawUrl, 900);
        await setMyPhoto(rec.botToken, photoUrl);
        console.log(`  [4/4] Photo set`);
      } catch (e) {
        console.log(`  [4/4] Photo skipped: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      console.log(`  [4/4] Photo skipped (no display image)`);
    }

    console.log(`  Done: "${char.name}" @${rec.botUsername}\n`);
  }

  await prod.$disconnect();
  console.log("All done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
