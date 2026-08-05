// SB 243 break reminder. Pure calculation; the session store (Redis or
// Conversation.lastMessageAt) is the caller's responsibility. Threshold is
// deliberately tunable via config/flags so an operator can adjust without
// a code change.

const CONTINUOUS_USE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const REPEAT_INTERVAL_MS = 60 * 60 * 1000; // hourly thereafter

const REMINDER_TEXT =
  "You've been chatting for a while. Consider taking a short break to stretch or step outside.";

export interface BreakReminderInput {
  now?: Date;
  sessionStartedAt: Date;
  lastReminderAt: Date | null;
}

export interface BreakReminderResult {
  due: boolean;
  message: string | null;
}

export function checkBreakReminder(input: BreakReminderInput): BreakReminderResult {
  const now = input.now ?? new Date();
  const sessionMs = now.getTime() - input.sessionStartedAt.getTime();
  if (sessionMs < CONTINUOUS_USE_THRESHOLD_MS) return { due: false, message: null };
  if (input.lastReminderAt) {
    const sinceLast = now.getTime() - input.lastReminderAt.getTime();
    if (sinceLast < REPEAT_INTERVAL_MS) return { due: false, message: null };
  }
  return { due: true, message: REMINDER_TEXT };
}

export const _internal = {
  CONTINUOUS_USE_THRESHOLD_MS,
  REPEAT_INTERVAL_MS,
};
