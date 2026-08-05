// LLM provider chain. Streaming + non-streaming call surfaces with an
// ordered provider fallback and a circuit breaker per provider. Ported from
// ../Pellow/backend/src/llm/provider.ts with Poppy's ordering: OpenRouter
// uncensored is the primary for mature chat; Anthropic/OpenAI premium is the
// quality fallback; a hardcoded string is the final safety net.
//
// This file is written to compile even when NONE of the LLM SDKs are
// installed. `require`-time dependencies are optional (loaded lazily), so
// unit tests can mock them and dev environments can boot without vendor
// packages. Real chat needs the SDKs installed and env keys set.

import { MODELS, HARDCODED_FALLBACK_TEXT } from "./constants";
import { logInfo, logWarn } from "../utils/log";
import { recordProviderOutcome, incrementCounter, recordLatency } from "../metrics";

// ============================================================================
// Public types
// ============================================================================

export type LLMPurpose = "chat" | "extract" | "summary" | "safety";

export interface LLMCallParams {
  purpose: LLMPurpose;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Routing hints (mature/tier/jurisdiction). Passed by the chat engine.
  contentRating?: "sfw" | "mature";
  tier?: "free" | "premium" | "pro";
  jurisdiction?: string | null;
}

export interface LLMCallResult {
  text: string;
  provider: string;
  model: string;
  fallback: boolean;
}

export type TokenSink = (delta: string) => void;

// ============================================================================
// Circuit breaker
// ============================================================================

interface HealthEntry {
  failures: number;
  disabledUntil: number;
}
const providerHealth: Record<string, HealthEntry> = {};

function isHealthy(name: string): boolean {
  const h = providerHealth[name];
  if (!h) return true;
  if (Date.now() > h.disabledUntil) {
    delete providerHealth[name];
    logInfo("LLM", `${name} re-enabled after cooldown`);
    return true;
  }
  return false;
}

function markFailed(name: string): void {
  const h = providerHealth[name] ?? { failures: 0, disabledUntil: 0 };
  h.failures += 1;
  const cooldownMs = Math.min(30_000 * Math.pow(2, h.failures - 1), 300_000);
  h.disabledUntil = Date.now() + cooldownMs;
  providerHealth[name] = h;
  logWarn("LLM", `${name} disabled for ${cooldownMs / 1000}s after ${h.failures} failure(s)`);
}

// Test-only. Clears breaker state between tests.
export function _resetProviderHealth(): void {
  for (const k of Object.keys(providerHealth)) delete providerHealth[k];
}

// ============================================================================
// Rate-limit retry
// ============================================================================

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error && "status" in err) return (err as { status?: number }).status === 429;
  if (err instanceof Error && err.message.includes("429")) return true;
  return false;
}

async function callWithRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isRateLimitError(err)) {
      const delayMs = 2000 + Math.random() * 3000;
      await new Promise((r) => setTimeout(r, delayMs));
      return await fn();
    }
    throw err;
  }
}

// ============================================================================
// Lazy client accessors (all optional dependencies)
// ============================================================================

type OpenAILike = {
  chat: {
    completions: {
      create: (args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown>;
    };
  };
};

interface OpenAICtor {
  new (opts: { apiKey: string; baseURL?: string }): OpenAILike;
}

function tryLoadOpenAI(): OpenAICtor | null {
  try {
    // Lazy dynamic import via require so the file compiles without the SDK.
    // Wrapped in try so missing packages fall through silently.
     
    const mod = require("openai");
    return mod.default ?? mod.OpenAI ?? mod;
  } catch {
    return null;
  }
}

interface AnthropicLike {
  messages: {
    stream: (args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => AsyncIterable<unknown> & {
      on?: (evt: string, cb: (d: unknown) => void) => unknown;
      finalMessage?: () => Promise<unknown>;
    };
    create: (args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  };
}

interface AnthropicCtor {
  new (opts: { apiKey: string }): AnthropicLike;
}

function tryLoadAnthropic(): AnthropicCtor | null {
  try {
     
    const mod = require("@anthropic-ai/sdk");
    return mod.default ?? mod.Anthropic ?? mod;
  } catch {
    return null;
  }
}

let _openrouter: OpenAILike | null = null;
let _openai: OpenAILike | null = null;
let _anthropic: AnthropicLike | null = null;

function getOpenRouterClient(): OpenAILike | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  if (_openrouter) return _openrouter;
  const Ctor = tryLoadOpenAI();
  if (!Ctor) return null;
  _openrouter = new Ctor({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return _openrouter;
}

function getOpenAIClient(): OpenAILike | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (_openai) return _openai;
  const Ctor = tryLoadOpenAI();
  if (!Ctor) return null;
  _openai = new Ctor({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getAnthropicClient(): AnthropicLike | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (_anthropic) return _anthropic;
  const Ctor = tryLoadAnthropic();
  if (!Ctor) return null;
  _anthropic = new Ctor({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Test-only. Lets a suite inject fake clients so provider fallback can be
// asserted without any real SDK installed.
export interface TestClientOverrides {
  openrouter?: OpenAILike | null;
  openai?: OpenAILike | null;
  anthropic?: AnthropicLike | null;
}
const _testOverrides: TestClientOverrides = {};
export function _setTestClients(overrides: TestClientOverrides): void {
  Object.assign(_testOverrides, overrides);
}
export function _clearTestClients(): void {
  for (const k of Object.keys(_testOverrides) as (keyof TestClientOverrides)[]) {
    delete _testOverrides[k];
  }
}

function resolveOpenRouter(): OpenAILike | null {
  return _testOverrides.openrouter !== undefined ? _testOverrides.openrouter : getOpenRouterClient();
}
function resolveOpenAI(): OpenAILike | null {
  return _testOverrides.openai !== undefined ? _testOverrides.openai : getOpenAIClient();
}
function resolveAnthropic(): AnthropicLike | null {
  return _testOverrides.anthropic !== undefined ? _testOverrides.anthropic : getAnthropicClient();
}

// ============================================================================
// Model routing
// ============================================================================

export type ChatProvider = "openrouter" | "anthropic" | "openai" | "hardcoded";

export interface RoutingDecision {
  order: ChatProvider[];
  primaryReason: string;
}

// Decide provider order for the chat purpose. Mature content routes to the
// OpenRouter uncensored model first; SFW + premium/pro tier routes to
// Anthropic/OpenAI first. The jurisdiction hook is here so per-region
// overrides slot in without touching downstream call code.
export function resolveModelRouting(params: {
  contentRating?: "sfw" | "mature";
  tier?: "free" | "premium" | "pro";
  jurisdiction?: string | null;
}): RoutingDecision {
  // TODO Phase 12: per-region policy hook. Example placeholders:
  //   if (jurisdiction === "GB" && contentRating === "mature") return ...
  //   if (jurisdiction === "US-LA") return ...
  void params.jurisdiction;

  if (params.contentRating === "mature") {
    return {
      order: ["openrouter", "anthropic", "openai", "hardcoded"],
      primaryReason: "mature-content-routes-uncensored",
    };
  }
  if (params.tier === "premium" || params.tier === "pro") {
    return {
      order: ["anthropic", "openai", "openrouter", "hardcoded"],
      primaryReason: "premium-tier-quality-primary",
    };
  }
  return {
    order: ["openrouter", "anthropic", "openai", "hardcoded"],
    primaryReason: "default-openrouter-primary",
  };
}

function modelFor(provider: ChatProvider, purpose: LLMPurpose): string {
  if (provider === "openrouter") {
    return purpose === "chat" ? MODELS.OPENROUTER_UNCENSORED_CHAT : MODELS.OPENROUTER_EXTRACT;
  }
  if (provider === "anthropic") {
    return purpose === "chat" ? MODELS.ANTHROPIC_CHAT : MODELS.ANTHROPIC_EXTRACT;
  }
  if (provider === "openai") {
    return purpose === "chat" ? MODELS.OPENAI_CHAT : MODELS.OPENAI_EXTRACT;
  }
  return "hardcoded";
}

// ============================================================================
// Streaming call surface
// ============================================================================

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

async function streamOpenAICompatible(
  client: OpenAILike,
  params: LLMCallParams,
  model: string,
  onToken: TokenSink,
): Promise<string> {
  const args = {
    model,
    stream: true,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    messages: [
      { role: "system", content: params.systemPrompt },
      ...params.messages,
    ],
  };
  const iter = (await client.chat.completions.create(args, { signal: params.signal })) as unknown as AsyncIterable<OpenAIStreamChunk>;
  let assembled = "";
  for await (const chunk of iter) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      assembled += delta;
      onToken(delta);
    }
  }
  return assembled;
}

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

async function streamAnthropic(
  client: AnthropicLike,
  params: LLMCallParams,
  model: string,
  onToken: TokenSink,
): Promise<string> {
  const iter = client.messages.stream(
    {
      model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.systemPrompt,
      messages: params.messages,
    },
    { signal: params.signal },
  ) as AsyncIterable<AnthropicStreamEvent>;
  let assembled = "";
  for await (const event of iter) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const delta = event.delta.text ?? "";
      assembled += delta;
      if (delta) onToken(delta);
    }
  }
  return assembled;
}

// The public entry point. Iterates through the routing order; a provider
// that fails BEFORE emitting any token falls through to the next one. Once a
// token has been emitted we commit to that provider (partial replies are
// preferable to double-emit chaos).
export async function streamLLM(
  params: LLMCallParams,
  onToken: TokenSink,
): Promise<LLMCallResult> {
  const routing = resolveModelRouting({
    contentRating: params.contentRating,
    tier: params.tier,
    jurisdiction: params.jurisdiction,
  });
  logInfo("LLM", `${params.purpose} routing [${routing.order.join(" -> ")}] (${routing.primaryReason})`, {
    contentRating: params.contentRating ?? "unset",
    tier: params.tier ?? "unset",
  });

  for (const provider of routing.order) {
    if (provider === "hardcoded") break; // handled by the fallback below
    if (!isHealthy(provider)) {
      logWarn("LLM", `${provider} skipped: circuit open (cooling down)`);
      continue;
    }

    const client =
      provider === "openrouter" ? resolveOpenRouter()
      : provider === "openai" ? resolveOpenAI()
      : provider === "anthropic" ? resolveAnthropic()
      : null;

    if (!client) {
      // Most common local cause: the SDK package is not installed, or the
      // provider's API key is unset. This is exactly why chat silently falls
      // back to the hardcoded reply, so surface it loudly.
      logWarn("LLM", `${provider} skipped: no client (SDK not installed or API key unset)`);
      continue;
    }

    const model = modelFor(provider, params.purpose);
    let emittedAny = false;
    const wrappedOnToken: TokenSink = (d) => {
      emittedAny = true;
      onToken(d);
    };
    const startedAt = Date.now();
    try {
      const text = await callWithRateLimitRetry(async () => {
        if (provider === "anthropic") {
          return streamAnthropic(client as AnthropicLike, params, model, wrappedOnToken);
        }
        return streamOpenAICompatible(client as OpenAILike, params, model, wrappedOnToken);
      });
      const elapsed = Date.now() - startedAt;
      const fallback = provider !== routing.order[0];
      recordLatency(`llm:${params.purpose}`, elapsed);
      recordProviderOutcome({ provider, success: true, fallback });
      incrementCounter(`llm_provider:${provider}`);
      logInfo("LLM", `${params.purpose} -> ${provider}/${model} in ${elapsed}ms${fallback ? " (fallback)" : ""}`);
      return { text, provider, model, fallback };
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      markFailed(provider);
      recordProviderOutcome({ provider, success: false });
      const emsg = err instanceof Error ? err.message : String(err);
      if (emittedAny) {
        // Partial stream. Do not fall through to another provider; return what
        // we streamed so the client sees a clean end even on failure.
        logWarn("LLM", `${provider} failed mid-stream after ${elapsed}ms; returning partial`, { err: emsg });
        return { text: "", provider, model, fallback: false };
      }
      // No tokens yet, safe to try the next provider.
      logWarn("LLM", `${provider} failed after ${elapsed}ms, falling through`, { err: emsg });
    }
  }

  logWarn("LLM", `all providers unavailable for ${params.purpose} -> hardcoded fallback`);
  incrementCounter("llm_provider:hardcoded");
  recordProviderOutcome({ provider: "hardcoded", success: false, fallback: true });
  onToken(HARDCODED_FALLBACK_TEXT);
  return { text: HARDCODED_FALLBACK_TEXT, provider: "hardcoded", model: "hardcoded", fallback: true };
}

// Convenience non-streaming caller (for summary/extract in later phases).
export async function callLLM(params: LLMCallParams): Promise<LLMCallResult> {
  let assembled = "";
  const result = await streamLLM(params, (d) => {
    assembled += d;
  });
  return { ...result, text: assembled || result.text };
}
