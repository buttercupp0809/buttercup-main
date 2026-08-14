-- Phase 10 support tables: webhook idempotency + tier usage counters.

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id"         TEXT PRIMARY KEY,
  "provider"   TEXT NOT NULL,
  "eventId"    TEXT NOT NULL,
  "eventType"  TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_provider_eventId_key" ON "WebhookEvent" ("provider", "eventId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_createdAt_idx" ON "WebhookEvent" ("createdAt");

CREATE TABLE IF NOT EXISTS "UsageCounter" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "counterType" TEXT NOT NULL,
  "period"      TEXT NOT NULL,
  "count"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UsageCounter_userId_counterType_period_key" ON "UsageCounter" ("userId", "counterType", "period");
CREATE INDEX IF NOT EXISTS "UsageCounter_userId_idx" ON "UsageCounter" ("userId");
