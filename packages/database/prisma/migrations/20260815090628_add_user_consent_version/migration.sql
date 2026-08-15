-- Phase 29: versioned consent gate. Additive, nullable, no backfill.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedPolicyVersion" TEXT;
