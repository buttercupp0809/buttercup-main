// Cross-workspace string-literal unions. Values MUST stay in lockstep with
// the Prisma enums declared in packages/database/prisma/schema.prisma. If a
// value changes here, change it there in the same PR.

export type SubscriptionTier = "free" | "premium" | "pro";
export type ContentRating = "sfw" | "mature";
export type Visibility = "private" | "public";
export type CharacterStyle = "realistic" | "threeD" | "anime";
export type ModerationStatus = "pending" | "approved" | "rejected";
export type MemoryTier = "hot" | "warm" | "cold";
// MediaKind moved to ./media (Zod-derived). Re-exported from index.
export type MediaStatus = "queued" | "processing" | "ready" | "failed";
export type TokenReason =
  | "purchase"
  | "image_gen"
  | "voice_gen"
  | "premium_msg"
  | "grant";
export type MessageRole = "user" | "assistant" | "system";
export type AgeVerificationLevel = "none" | "self_declared" | "vendor_verified";
