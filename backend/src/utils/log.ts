// Structured, scoped logging with PII/secret redaction. Mirrors the Pellow
// approach (../Pellow/backend/src/utils/log.ts): bracketed [scope] prefixes and
// a redact() pass over anything that could contain an email, phone number, or
// API key before it reaches the logs. logError never leaks a raw provider
// message to a user-facing path.
//
// Usage:
//   logInfo("LLM", `chat -> openrouter/${model} in ${ms}ms`, { fallback });
//   logWarn("LLM", "openrouter skipped: no client");
//   logError("chat", err, { conversationId });

const REDACT =
  /\b(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-or-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9_]{20,}|\+?\d{10,15})\b/g;

export function redact(s: string): string {
  return s.replace(REDACT, "<redacted>");
}

function fmtExtra(extra?: Record<string, unknown>): string {
  if (!extra) return "";
  try {
    return ` ${redact(JSON.stringify(extra))}`;
  } catch {
    return "";
  }
}

export function logInfo(scope: string, msg: string, extra?: Record<string, unknown>): void {
  console.log(`[${scope}] ${redact(msg)}${fmtExtra(extra)}`);
}

export function logWarn(scope: string, msg: string, extra?: Record<string, unknown>): void {
  console.warn(`[${scope}] ${redact(msg)}${fmtExtra(extra)}`);
}

// Log an error with PII/secrets masked. NEVER surface the raw error message to
// a client/user; return a static friendly string instead.
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}] ${redact(msg)}${fmtExtra(extra)}`);
}
