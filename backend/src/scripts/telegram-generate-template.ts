import "../load-env";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@buttercupp/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string, maxSlugLen: number): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxSlugLen);
}

function suggestUsernames(name: string): [string, string, string] {
  // All Telegram usernames: 5-32 chars total, only a-z 0-9 underscore, must
  // end in "bot". We compute three variants in priority order.
  const suffix = "_bot";
  const suffixBc = "_bc_bot";
  const prefixBc = "bc_";
  const suffixBcLong = "_bot";

  const slug1 = slugify(name, 32 - suffix.length); // leaves room for "_bot"
  const primary = `${slug1}${suffix}`;

  const slug2 = slugify(name, 32 - suffixBc.length); // leaves room for "_bc_bot"
  const fallback1 = `${slug2}${suffixBc}`;

  const slug3 = slugify(name, 32 - prefixBc.length - suffixBcLong.length); // leaves room for "bc_" + "_bot"
  const fallback2 = `${prefixBc}${slug3}${suffixBcLong}`;

  return [primary, fallback1, fallback2];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface TemplateEntry {
  characterId: string;
  characterName: string;
  suggestedUsernames: [string, string, string];
  botToken: string;
  botUsername: string;
}

async function main() {
  // Parse CLI args
  let outputPath = "telegram-bots-template.json";
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    outputPath = args[outputIdx + 1];
  }

  // Query all characters with existing bot config
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      name: true,
      telegramBotConfig: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const needsBots = characters.filter((c) => c.telegramBotConfig === null);

  const template: TemplateEntry[] = needsBots.map((c) => ({
    characterId: c.id,
    characterName: c.name,
    suggestedUsernames: suggestUsernames(c.name),
    botToken: "",
    botUsername: "",
  }));

  fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), "utf-8");

  console.log(`\nTelegram Bot Template Generator`);
  console.log(`================================`);
  console.log(`Total characters: ${characters.length}`);
  console.log(`Already have bots: ${characters.length - needsBots.length}`);
  console.log(`Need bots: ${needsBots.length}`);
  console.log(`Output: ${path.resolve(outputPath)}\n`);

  console.log(`BotFather Quick-Start Guide`);
  console.log(`---------------------------`);
  console.log(`1. Open Telegram and search for @BotFather`);
  console.log(`2. Send /newbot`);
  console.log(
    `3. Enter the character name when prompted (e.g. "Ariana")`,
  );
  console.log(
    `4. Enter a username from the suggestedUsernames list (must be globally unique, try in order)`,
  );
  console.log(
    `5. BotFather replies with the bot token. Copy it into the botToken field in the JSON.`,
  );
  console.log(
    `6. Fill botUsername with whichever username was accepted by BotFather.`,
  );
  console.log(`7. Repeat for the next character.`);
  console.log(
    `8. Rate limit: approximately 20 bots per day per Telegram account.`,
  );
  console.log(
    `\nOnce the JSON is filled, run:\n  npm run telegram:bulk-register -- --input ${outputPath}\n`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
