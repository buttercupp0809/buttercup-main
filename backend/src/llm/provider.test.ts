import { afterEach, describe, expect, it, beforeEach } from "vitest";
import {
  resolveModelRouting,
  streamLLM,
  _setTestClients,
  _clearTestClients,
  _resetProviderHealth,
} from "./provider";

function makeOpenAIStreaming(chunks: string[]) {
  return {
    chat: {
      completions: {
        create: async () => {
          return {
            async *[Symbol.asyncIterator]() {
              for (const c of chunks) {
                yield { choices: [{ delta: { content: c } }] };
              }
            },
          };
        },
      },
    },
  };
}

function makeOpenAIFailing() {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("primary_down");
        },
      },
    },
  };
}

function makeAnthropicStreaming(chunks: string[]) {
  return {
    messages: {
      stream: (): AsyncIterable<unknown> => ({
        async *[Symbol.asyncIterator]() {
          for (const t of chunks) {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: t } };
          }
        },
      }),
      create: async () => ({}),
    },
  };
}

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    OPENROUTER_API_KEY: "test",
    ANTHROPIC_API_KEY: "test",
    OPENAI_API_KEY: "test",
  };
  _resetProviderHealth();
});
afterEach(() => {
  _clearTestClients();
  process.env = OLD_ENV;
});

describe("resolveModelRouting", () => {
  it("mature content -> openrouter first", () => {
    const r = resolveModelRouting({ contentRating: "mature", tier: "free" });
    expect(r.order[0]).toBe("openrouter");
  });
  it("premium tier + sfw -> anthropic first", () => {
    const r = resolveModelRouting({ contentRating: "sfw", tier: "premium" });
    expect(r.order[0]).toBe("anthropic");
  });
  it("default free sfw -> openrouter first", () => {
    const r = resolveModelRouting({ contentRating: "sfw", tier: "free" });
    expect(r.order[0]).toBe("openrouter");
  });
  it("hardcoded is always last", () => {
    const r = resolveModelRouting({ contentRating: "mature" });
    expect(r.order[r.order.length - 1]).toBe("hardcoded");
  });
});

describe("streamLLM", () => {
  it("uses the primary when healthy and streams tokens", async () => {
    _setTestClients({
      openrouter: makeOpenAIStreaming(["Hi", " there"]),
    });
    const tokens: string[] = [];
    const res = await streamLLM(
      {
        purpose: "chat",
        systemPrompt: "sp",
        messages: [{ role: "user", content: "hey" }],
        maxTokens: 16,
        temperature: 0.7,
        contentRating: "mature",
      },
      (t) => tokens.push(t),
    );
    expect(tokens.join("")).toBe("Hi there");
    expect(res.provider).toBe("openrouter");
    expect(res.fallback).toBe(false);
  });

  it("falls through to the next provider when the primary fails before emitting", async () => {
    _setTestClients({
      openrouter: makeOpenAIFailing(),
      anthropic: makeAnthropicStreaming(["OK"]),
    });
    const tokens: string[] = [];
    const res = await streamLLM(
      {
        purpose: "chat",
        systemPrompt: "sp",
        messages: [{ role: "user", content: "hey" }],
        maxTokens: 16,
        temperature: 0.7,
        contentRating: "mature",
      },
      (t) => tokens.push(t),
    );
    expect(tokens.join("")).toBe("OK");
    expect(res.provider).toBe("anthropic");
    expect(res.fallback).toBe(true);
  });

  it("emits the hardcoded fallback when every provider fails", async () => {
    _setTestClients({
      openrouter: makeOpenAIFailing(),
      anthropic: {
        messages: {
          stream: () => {
            throw new Error("nope");
          },
          create: async () => ({}),
        },
      },
      openai: makeOpenAIFailing(),
    });
    const tokens: string[] = [];
    const res = await streamLLM(
      {
        purpose: "chat",
        systemPrompt: "sp",
        messages: [{ role: "user", content: "hey" }],
        maxTokens: 16,
        temperature: 0.7,
        contentRating: "mature",
      },
      (t) => tokens.push(t),
    );
    expect(res.provider).toBe("hardcoded");
    expect(tokens.join("")).toContain("lost the thread");
  });

  it("skips a provider whose client is not configured", async () => {
    _setTestClients({
      openrouter: null,
      anthropic: makeAnthropicStreaming(["Anthropic serves"]),
    });
    const tokens: string[] = [];
    const res = await streamLLM(
      {
        purpose: "chat",
        systemPrompt: "sp",
        messages: [{ role: "user", content: "hey" }],
        maxTokens: 16,
        temperature: 0.7,
        contentRating: "mature",
      },
      (t) => tokens.push(t),
    );
    expect(res.provider).toBe("anthropic");
    expect(tokens.join("")).toBe("Anthropic serves");
  });
});
