// Typed analytics event taxonomy. Every emitted event name must be a
// member of this union so a typo becomes a compile error.

export type AnalyticsEventName =
  | "signup"
  | "age_verified"
  | "chat_started"
  | "message_sent"
  | "memory_written"
  | "voice_generated"
  | "image_generated"
  | "subscribe"
  | "token_purchase"
  | "crisis_event"
  | "character_created"
  | "character_published"
  | "data_exported"
  | "account_deleted"
  | "break_reminder_sent"
  | "ethical_ai_reminder_sent"
  // Phase 30: memory graph / rulebook events.
  | "emotional_pattern_detected"
  | "user_rule_created";

export interface AnalyticsEventPayload {
  name: AnalyticsEventName;
  userId?: string;
  props?: Record<string, unknown>;
}
