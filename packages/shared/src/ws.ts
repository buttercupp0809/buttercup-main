// PRD §9.2 WebSocket event contract. Both the WS gateway and the SSE fallback
// route emit these shapes. Adding a new event type: add the schema here,
// wire the union, and every consumer picks it up via type inference.

import { z } from "zod";

// ============================================================================
// Client -> Server
// ============================================================================

export const chatSendDto = z.object({
  type: z.literal("chat.send"),
  conversationId: z.string().min(1).max(64),
  text: z.string().min(1).max(4000),
});
export type ChatSendEvent = z.infer<typeof chatSendDto>;

export const chatCancelDto = z.object({
  type: z.literal("chat.cancel"),
  conversationId: z.string().min(1).max(64),
});
export type ChatCancelEvent = z.infer<typeof chatCancelDto>;

export const typingStartDto = z.object({
  type: z.literal("typing.start"),
  conversationId: z.string().min(1).max(64),
});
export const typingStopDto = z.object({
  type: z.literal("typing.stop"),
  conversationId: z.string().min(1).max(64),
});

export const mediaRequestDto = z.object({
  type: z.literal("media.request"),
  conversationId: z.string().min(1).max(64),
  kind: z.enum(["image", "voice", "video"]),
  prompt: z.string().max(1000).optional(),
});

export const wsClientEventSchema = z.discriminatedUnion("type", [
  chatSendDto,
  chatCancelDto,
  typingStartDto,
  typingStopDto,
  mediaRequestDto,
]);
export type WSClientEvent = z.infer<typeof wsClientEventSchema>;

// ============================================================================
// Server -> Client
// ============================================================================

export interface ChatTokenEvent {
  type: "chat.token";
  conversationId: string;
  delta: string;
}
export interface ChatDoneEvent {
  type: "chat.done";
  conversationId: string;
  messageId: string;
  provider: string;
  model: string;
}
export interface TypingIndicatorEvent {
  type: "typing.indicator";
  conversationId: string;
  who: "assistant" | "user";
  active: boolean;
}
export interface MediaReadyEvent {
  type: "media.ready";
  conversationId: string;
  mediaAssetId: string;
  url: string;
  kind: "image" | "voice" | "video";
}
export interface RelationshipUpdateEvent {
  type: "relationship.update";
  conversationId: string;
  affectionLevel: number;
  mood?: string;
}
export interface SafetyInterventionEvent {
  type: "safety.intervention";
  conversationId: string;
  message: string;
  resources: { label: string; url: string }[];
}
export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

// Phase 21 paywall frame. Emitted by BOTH transports (WS + SSE) so the
// client sees an identical shape regardless of which path served it. The
// `plans` array is the resolved public catalog; the client can render
// three cards directly without an extra fetch.
export interface PaywallPlanOption {
  plan: string; // "daily" | "weekly" | "monthly" (free never appears here)
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
}
export interface PaywallEvent {
  type: "paywall";
  conversationId: string;
  reason: string;
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number; // -1 = unlimited (will not fire for chat)
  plans: PaywallPlanOption[];
  upgradeUrl: string;
}

export type WSServerEvent =
  | ChatTokenEvent
  | ChatDoneEvent
  | TypingIndicatorEvent
  | MediaReadyEvent
  | RelationshipUpdateEvent
  | SafetyInterventionEvent
  | PaywallEvent
  | ErrorEvent;
