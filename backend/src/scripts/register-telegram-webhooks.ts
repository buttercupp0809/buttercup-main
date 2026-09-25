import "../load-env";
import { prisma } from "@buttercupp/database";
import { setWebhook } from "../telegram/client";

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) {
  console.error("BACKEND_URL env var is required");
  process.exit(1);
}

async function main() {
  const bots = await prisma.telegramBotConfig.findMany();
  console.log(`Found ${bots.length} bot(s) to register.`);

  for (const bot of bots) {
    const webhookUrl = `${BACKEND_URL}/telegram/webhook/${bot.characterId}`;
    console.log(`Registering webhook for bot @${bot.botUsername} -> ${webhookUrl}`);
    await setWebhook(bot.botToken, webhookUrl, bot.webhookSecret);
    console.log(`  Done.`);
  }

  await prisma.$disconnect();
  console.log("All webhooks registered.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
