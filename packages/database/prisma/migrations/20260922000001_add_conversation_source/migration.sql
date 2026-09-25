-- AddColumn: source to Conversation for tracking origin of conversation (web, telegram, etc.)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'web';
