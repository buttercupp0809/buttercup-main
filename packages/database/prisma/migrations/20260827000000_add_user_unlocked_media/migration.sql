-- Add gallery_unlock to TokenReason enum
ALTER TYPE "TokenReason" ADD VALUE IF NOT EXISTS 'gallery_unlock';

-- Create UserUnlockedMedia table for persistent per-user gallery image unlock
CREATE TABLE "UserUnlockedMedia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterMediaId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserUnlockedMedia_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one unlock record per (user, media)
CREATE UNIQUE INDEX "UserUnlockedMedia_userId_characterMediaId_key" ON "UserUnlockedMedia"("userId", "characterMediaId");

-- Index for fast lookup by userId
CREATE INDEX "UserUnlockedMedia_userId_idx" ON "UserUnlockedMedia"("userId");

-- Foreign key: cascade delete when user is deleted
ALTER TABLE "UserUnlockedMedia" ADD CONSTRAINT "UserUnlockedMedia_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
