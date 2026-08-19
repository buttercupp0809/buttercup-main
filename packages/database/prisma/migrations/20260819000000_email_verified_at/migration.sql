-- Phase 34 Feature C: email verification. Adds the nullable timestamp used by
-- requireEmailVerified() in the (protected) layout to gate password signups
-- until they click the Resend verification link. Google OAuth users are
-- auto-verified at both create and link time. Additive/nullable so existing
-- rows are safe; the prod backfill (Manual step) treats existing users as
-- verified so nobody is locked out.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
