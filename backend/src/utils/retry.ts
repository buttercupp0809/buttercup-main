// Port of ../Pellow/backend/src/utils/retry.ts shape. Presets renamed for
// Poppy's provider mix: llm (OpenRouter/Anthropic/OpenAI), database (Prisma),
// media (Fal/Replicate/ElevenLabs/Cartesia), payment (CCBill/Verotel/Segpay).

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const LLM_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 5000,
  shouldRetry: (err) => {
    if (err instanceof Error && err.name === "AbortError") return false;
    if (err instanceof Error && "status" in err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) return false;
    }
    return true;
  },
};

const DB_RETRY: RetryConfig = {
  maxRetries: 1,
  baseDelayMs: 1000,
};

const MEDIA_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1500,
  maxDelayMs: 8000,
  shouldRetry: (err) => {
    if (err instanceof Error && "status" in err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) return false;
      if (status === 429 || (status !== undefined && status >= 500)) return true;
    }
    return true;
  },
};

const PAYMENT_RETRY: RetryConfig = {
  // Payments must never double-charge on retry. Callers pair this with an
  // idempotency key; the preset itself is conservative.
  maxRetries: 1,
  baseDelayMs: 1000,
  shouldRetry: (err) => {
    if (err instanceof Error && "status" in err) {
      const status = (err as { status?: number }).status;
      if (status !== undefined && status >= 400 && status < 500) return false;
    }
    return true;
  },
};

export const RETRY_PRESETS = {
  llm: LLM_RETRY,
  database: DB_RETRY,
  media: MEDIA_RETRY,
  payment: PAYMENT_RETRY,
} as const;

function getRetryAfter(err: unknown): number | null {
  if (err instanceof Error && "headers" in err) {
    const headers = (err as { headers?: Record<string, string> | { get?: (k: string) => string } })
      .headers;
    const ra =
      (headers as Record<string, string> | undefined)?.["retry-after"] ??
      (headers as { get?: (k: string) => string } | undefined)?.get?.("retry-after");
    if (ra) {
      const secs = Number(ra);
      if (!isNaN(secs) && secs > 0) return secs * 1000;
    }
  }
  return null;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  label = "operation",
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= config.maxRetries) break;
      if (config.shouldRetry && !config.shouldRetry(err, attempt)) break;

      const retryAfter = getRetryAfter(err);
      const exponentialDelay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt),
        config.maxDelayMs ?? Infinity,
      );
      const delayMs = retryAfter ?? exponentialDelay;

      config.onRetry?.(err, attempt + 1, delayMs);
      console.warn(
        `[Retry] ${label} attempt ${attempt + 1}/${config.maxRetries} failed, retrying in ${delayMs}ms`,
      );

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
