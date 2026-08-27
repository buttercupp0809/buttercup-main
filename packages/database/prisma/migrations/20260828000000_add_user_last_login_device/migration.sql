-- Login-device tracking on User (see schema.prisma for rationale).
-- Additive and nullable; safe to apply against a live DB.
ALTER TABLE "User"
  ADD COLUMN "lastLoginAt"         TIMESTAMP(3),
  ADD COLUMN "lastLoginDeviceType" TEXT,
  ADD COLUMN "lastLoginUserAgent"  TEXT;
