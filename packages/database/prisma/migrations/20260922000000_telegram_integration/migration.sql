-- CreateTable
CREATE TABLE "TelegramBotConfig" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUserLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "username" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotConfig_characterId_key" ON "TelegramBotConfig"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotConfig_botToken_key" ON "TelegramBotConfig"("botToken");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUserLink_userId_characterId_key" ON "TelegramUserLink"("userId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUserLink_telegramUserId_characterId_key" ON "TelegramUserLink"("telegramUserId", "characterId");

-- CreateIndex
CREATE INDEX "TelegramUserLink_userId_idx" ON "TelegramUserLink"("userId");

-- CreateIndex
CREATE INDEX "TelegramUserLink_telegramUserId_idx" ON "TelegramUserLink"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkToken_token_key" ON "TelegramLinkToken"("token");

-- CreateIndex
CREATE INDEX "TelegramLinkToken_token_idx" ON "TelegramLinkToken"("token");

-- CreateIndex
CREATE INDEX "TelegramLinkToken_expiresAt_idx" ON "TelegramLinkToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "TelegramBotConfig" ADD CONSTRAINT "TelegramBotConfig_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUserLink" ADD CONSTRAINT "TelegramUserLink_botConfig_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "TelegramBotConfig"("characterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkToken" ADD CONSTRAINT "TelegramLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
