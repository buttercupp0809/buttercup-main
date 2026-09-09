-- Migration: add_email_nurture_pipeline
-- Adds User.unsubscribedAt, User.unsubscribeToken, and EmailSendLog table.
-- Part of the Brevo-backed lifecycle email nurture system.
-- Additive only; no existing columns or rows are modified.

-- User: unsubscribe fields
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "unsubscribedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unsubscribeToken" TEXT;

-- Unique constraint on unsubscribeToken (minted lazily, must be unique per user).
CREATE UNIQUE INDEX IF NOT EXISTS "User_unsubscribeToken_key"
  ON "User"("unsubscribeToken");

-- EmailSendLog: one row per outbound nurture email attempt.
CREATE TABLE IF NOT EXISTS "EmailSendLog" (
  "id"                TEXT        NOT NULL,
  "userId"            TEXT        NOT NULL,
  "segment"           INTEGER     NOT NULL,
  "campaign"          TEXT        NOT NULL,
  "provider"          TEXT        NOT NULL DEFAULT 'brevo',
  "providerMessageId" TEXT,
  "sentAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"            TEXT        NOT NULL DEFAULT 'sent',

  CONSTRAINT "EmailSendLog_pkey" PRIMARY KEY ("id")
);

-- Foreign key: EmailSendLog -> User (cascade on user delete).
ALTER TABLE "EmailSendLog"
  ADD CONSTRAINT "EmailSendLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes: idempotency + cadence math + analytics.
CREATE INDEX IF NOT EXISTS "EmailSendLog_userId_segment_sentAt_idx"
  ON "EmailSendLog"("userId", "segment", "sentAt");

CREATE INDEX IF NOT EXISTS "EmailSendLog_sentAt_idx"
  ON "EmailSendLog"("sentAt");

CREATE INDEX IF NOT EXISTS "EmailSendLog_status_sentAt_idx"
  ON "EmailSendLog"("status", "sentAt");
