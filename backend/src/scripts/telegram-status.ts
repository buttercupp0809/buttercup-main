import "../load-env";
import { prisma } from "@buttercupp/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s.padEnd(maxLen);
  return s.slice(0, maxLen - 1) + "~";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const characters = await prisma.character.findMany({
    select: {
      name: true,
      telegramBotConfig: {
        select: {
          botUsername: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const COL_NAME = 20;
  const COL_USER = 20;
  const COL_WEBHOOK = 18;
  const COL_CONFIG = 6;

  const header =
    `${"Character".padEnd(COL_NAME)} | ${"Bot Username".padEnd(COL_USER)} | ${"Webhook".padEnd(COL_WEBHOOK)} | Config`;
  const divider =
    `${"-".repeat(COL_NAME)}-+-${"-".repeat(COL_USER)}-+-${"-".repeat(COL_WEBHOOK)}-+-------`;

  console.log(`\nTelegram Bot Status`);
  console.log(`===================\n`);
  console.log(header);
  console.log(divider);

  let configured = 0;

  for (const c of characters) {
    const hasConfig = c.telegramBotConfig !== null;
    if (hasConfig) configured++;

    const nameCol = truncate(c.name, COL_NAME);
    const usernameCol = hasConfig
      ? truncate(`@${c.telegramBotConfig!.botUsername}`, COL_USER)
      : "(not configured)".padEnd(COL_USER);
    const webhookCol = hasConfig
      ? "registered".padEnd(COL_WEBHOOK)
      : "-".padEnd(COL_WEBHOOK);
    const configCol = hasConfig ? "yes" : "no";

    console.log(`${nameCol} | ${usernameCol} | ${webhookCol} | ${configCol}`);
  }

  console.log(divider);
  console.log(
    `\n${configured} / ${characters.length} characters have Telegram bots configured\n`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
