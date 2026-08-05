-- Phase 20: additive plan + free-trial counter columns.
-- Additive and idempotent. Non-destructive: no drops, no retypes.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "freeMessagesUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "plan" TEXT;
