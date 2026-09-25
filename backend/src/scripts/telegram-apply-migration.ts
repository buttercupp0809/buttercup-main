// One-shot script: applies the Telegram tables migration to prod DB.
// Run once before telegram:full-provision if prod DB shows "table does not exist".
import "../load-env";
import { PrismaClient } from "@prisma/client";

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) {
  console.error("PROD_DATABASE_URL is required");
  process.exit(1);
}

// Each statement from the migration file is run separately.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "TelegramBotConfig" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramBotConfig_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "TelegramUserLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "username" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramUserLink_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "TelegramLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramBotConfig_characterId_key" ON "TelegramBotConfig"("characterId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramBotConfig_botToken_key" ON "TelegramBotConfig"("botToken")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramUserLink_userId_characterId_key" ON "TelegramUserLink"("userId", "characterId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramUserLink_telegramUserId_characterId_key" ON "TelegramUserLink"("telegramUserId", "characterId")`,
  `CREATE INDEX IF NOT EXISTS "TelegramUserLink_userId_idx" ON "TelegramUserLink"("userId")`,
  `CREATE INDEX IF NOT EXISTS "TelegramUserLink_telegramUserId_idx" ON "TelegramUserLink"("telegramUserId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLinkToken_token_key" ON "TelegramLinkToken"("token")`,
  `CREATE INDEX IF NOT EXISTS "TelegramLinkToken_token_idx" ON "TelegramLinkToken"("token")`,
  `CREATE INDEX IF NOT EXISTS "TelegramLinkToken_expiresAt_idx" ON "TelegramLinkToken"("expiresAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'TelegramBotConfig_characterId_fkey'
    ) THEN
      ALTER TABLE "TelegramBotConfig" ADD CONSTRAINT "TelegramBotConfig_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'TelegramUserLink_userId_fkey'
    ) THEN
      ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'TelegramUserLink_characterId_fkey'
    ) THEN
      ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'TelegramUserLink_botConfig_characterId_fkey'
    ) THEN
      ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_botConfig_characterId_fkey"
        FOREIGN KEY ("characterId") REFERENCES "TelegramBotConfig"("characterId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'TelegramLinkToken_userId_fkey'
    ) THEN
      ALTER TABLE "TelegramLinkToken" ADD CONSTRAINT "TelegramLinkToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

async function main() {
  // Direct PrismaClient connection to prod (one-shot admin script).
  const prodPrisma = new PrismaClient({ datasources: { db: { url: PROD_URL! } } });

  console.log("Applying Telegram tables migration to prod DB...\n");

  for (const sql of STATEMENTS) {
    const preview = sql.trim().slice(0, 60).replace(/\s+/g, " ");
    try {
      await prodPrisma.$executeRawUnsafe(sql);
      console.log(`  OK: ${preview}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "already exists" errors are fine - idempotent.
      if (msg.includes("already exists")) {
        console.log(`  SKIP (exists): ${preview}...`);
      } else {
        console.error(`  ERROR: ${preview}...\n  ${msg}`);
        await prodPrisma.$disconnect();
        process.exit(1);
      }
    }
  }

  console.log("\nMigration complete. All Telegram tables are ready in prod.");
  await prodPrisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
