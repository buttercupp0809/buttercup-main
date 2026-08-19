// Tests for the active check-in path. Prisma and the LLM provider are
// mocked so the suite runs offline and deterministically. See
// image-turn.context.test.ts for the same mocking convention.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const conversationFindFirst = vi.fn();
const userFindUnique = vi.fn();
const userProfileFindUnique = vi.fn();
const messageFindFirst = vi.fn();
const messageCreate = vi.fn();
const conversationUpdate = vi.fn();
const txMessageFindFirst = vi.fn();
const txMessageCreate = vi.fn();
const txConversationUpdate = vi.fn();
const prismaTransaction = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    conversation: { findFirst: conversationFindFirst, update: conversationUpdate },
    user: { findUnique: userFindUnique },
    userProfile: { findUnique: userProfileFindUnique },
    message: { findFirst: messageFindFirst, create: messageCreate },
    $transaction: prismaTransaction,
  },
}));

const callLLMMock = vi.fn();
vi.mock("../../llm/provider", () => ({
  callLLM: callLLMMock,
}));

// Import AFTER the mocks so the module resolves against the stubs above.
const { maybeRunCheckin, CHECKIN_GAP_MS, buildCheckinSystemPrompt } = await import("../checkin");

const FORBIDDEN_FIRST_OPEN = [
  "re-initiating",
  "again",
  "welcome back",
  "last time",
  "as we talked",
  "since we last",
  "our last chat",
];

const CONV_ID = "conv-1";
const USER_ID = "user-1";

function baseConv(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    userId: USER_ID,
    characterId: "char-1",
    character: {
      id: "char-1",
      name: "Aria",
      contentRating: "sfw",
    },
    characterVersion: {
      personality: "warm",
      backstory: "grew up by the sea",
      behavioralInstructions: "playful",
      greeting: "It's so good to see you again.",
    },
    ...overrides,
  };
}

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "alice@example.com",
    subscriptionTier: "free",
    jurisdiction: null,
    ...overrides,
  };
}

// Sets up a $transaction that runs the callback against tx-scoped spies so
// tests can assert what happened INSIDE the transaction.
function primeTransaction(latestInsideTx: unknown, options: { createdMessage?: { id: string; content: string; createdAt: Date } } = {}) {
  txMessageFindFirst.mockReset().mockResolvedValue(latestInsideTx);
  txMessageCreate.mockReset().mockImplementation(async ({ data }) => ({
    id: options.createdMessage?.id ?? "msg-new",
    conversationId: data.conversationId,
    role: data.role,
    content: options.createdMessage?.content ?? data.content,
    createdAt: options.createdMessage?.createdAt ?? new Date(),
  }));
  txConversationUpdate.mockReset().mockResolvedValue({});
  prismaTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      message: { findFirst: txMessageFindFirst, create: txMessageCreate },
      conversation: { update: txConversationUpdate },
    };
    return cb(tx);
  });
}

beforeEach(() => {
  conversationFindFirst.mockReset();
  userFindUnique.mockReset();
  userProfileFindUnique.mockReset().mockResolvedValue(null);
  messageFindFirst.mockReset().mockResolvedValue(null);
  messageCreate.mockReset();
  conversationUpdate.mockReset();
  callLLMMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maybeRunCheckin - eligibility", () => {
  it("creates a check-in when there are no messages", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "*smiles* Hey Alice.", provider: "openrouter", model: "x", fallback: false });
    primeTransaction(null);

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });

    expect(result.created).toBe(true);
    expect(result.message?.role).toBe("assistant");
    expect(callLLMMock).toHaveBeenCalledTimes(1);
    expect(txMessageCreate).toHaveBeenCalledTimes(1);
    expect(txConversationUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = txConversationUpdate.mock.calls[0][0];
    expect(updateArgs.data.messageCount).toEqual({ increment: 1 });
    expect(updateArgs.data.lastMessageAt).toBeInstanceOf(Date);
  });

  it("creates a check-in when last message is user and older than the gap", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    const old = new Date(Date.now() - CHECKIN_GAP_MS - 60_000);
    messageFindFirst.mockResolvedValueOnce({ role: "user", createdAt: old });
    callLLMMock.mockResolvedValueOnce({ text: "hey Alice", provider: "openrouter", model: "x", fallback: false });
    primeTransaction({ role: "user", createdAt: old });

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(true);
  });

  it("does NOT create when last message is within the gap", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    const recent = new Date(Date.now() - 60_000);
    messageFindFirst.mockResolvedValueOnce({ role: "user", createdAt: recent });

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(false);
    expect(callLLMMock).not.toHaveBeenCalled();
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  it("does NOT create when last message is assistant (no stacking)", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    const old = new Date(Date.now() - CHECKIN_GAP_MS - 60_000);
    messageFindFirst.mockResolvedValueOnce({ role: "assistant", createdAt: old });

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(false);
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it("does NOT create when the conversation is not owned by the user", async () => {
    conversationFindFirst.mockResolvedValueOnce(null);
    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(false);
    expect(callLLMMock).not.toHaveBeenCalled();
  });
});

describe("maybeRunCheckin - name resolution", () => {
  it("uses displayName when present", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser({ email: "raw@example.com" }));
    userProfileFindUnique.mockResolvedValueOnce({ displayName: "Alice", preferences: null });
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "hi Alice", provider: "openrouter", model: "x", fallback: false });
    primeTransaction(null);

    await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    const systemPrompt: string = callLLMMock.mock.calls[0][0].systemPrompt;
    expect(systemPrompt).toContain("The user's name is Alice.");
    expect(systemPrompt).not.toContain("The user's name is raw.");
  });

  it("falls back to email local part when displayName is missing", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser({ email: "bob@example.com" }));
    userProfileFindUnique.mockResolvedValueOnce(null);
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "hi Bob", provider: "openrouter", model: "x", fallback: false });
    primeTransaction(null);

    await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    const systemPrompt: string = callLLMMock.mock.calls[0][0].systemPrompt;
    expect(systemPrompt).toContain("The user's name is bob.");
  });
});

describe("maybeRunCheckin - fallback", () => {
  it("uses personalized greeting when callLLM rejects", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    userProfileFindUnique.mockResolvedValueOnce({ displayName: "Alice", preferences: null });
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockRejectedValueOnce(new Error("chain down"));
    primeTransaction(null);

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(true);
    expect(result.message?.content).toContain("Alice");
    // The base greeting is "It's so good to see you again." so personalized
    // form starts with "Hey Alice, ".
    expect(result.message?.content.startsWith("Hey Alice,")).toBe(true);
  });

  it("uses greeting fallback when provider chain returns hardcoded", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    userProfileFindUnique.mockResolvedValueOnce({ displayName: "Alice", preferences: null });
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({
      text: "some hardcoded string",
      provider: "hardcoded",
      model: "hardcoded",
      fallback: true,
    });
    primeTransaction(null);

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });
    expect(result.created).toBe(true);
    expect(result.message?.content.startsWith("Hey Alice,")).toBe(true);
  });
});

describe("maybeRunCheckin - mode-aware system prompt", () => {
  const persona = {
    name: "Aria",
    personality: "warm",
    backstory: "grew up by the sea",
    behavioralInstructions: "playful",
    contentRating: "sfw",
  };
  const personalization = {
    name: "Alice",
    vibe: null,
    interests: ["hiking"],
    companionGoal: null,
  };

  it("first_open prompt does not imply prior interaction", () => {
    const prompt = buildCheckinSystemPrompt("first_open", persona, personalization).toLowerCase();
    for (const phrase of FORBIDDEN_FIRST_OPEN) {
      expect(prompt).not.toContain(phrase);
    }
    expect(prompt).toContain("very first message");
    expect(prompt).toContain("alice");
  });

  it("reopen_after_gap prompt uses reconnect phrasing", () => {
    const prompt = buildCheckinSystemPrompt("reopen_after_gap", persona, personalization).toLowerCase();
    expect(prompt).toContain("reaching out to reconnect");
    expect(prompt).toContain("picking up");
  });

  it("uses first_open mode when there are no prior messages", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    userProfileFindUnique.mockResolvedValueOnce({ displayName: "Alice", preferences: null });
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "*smiles* Hey Alice.", provider: "openrouter", model: "x", fallback: false });
    primeTransaction(null);

    await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });

    const systemPrompt: string = callLLMMock.mock.calls[0][0].systemPrompt;
    const lower = systemPrompt.toLowerCase();
    for (const phrase of FORBIDDEN_FIRST_OPEN) {
      expect(lower).not.toContain(phrase);
    }
    expect(lower).toContain("very first message");
    const userTurn: string = callLLMMock.mock.calls[0][0].messages[0].content;
    expect(userTurn).toContain("very first time");
  });

  it("uses reopen_after_gap mode when last message is an old user message", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    userProfileFindUnique.mockResolvedValueOnce({ displayName: "Alice", preferences: null });
    const old = new Date(Date.now() - CHECKIN_GAP_MS - 60_000);
    messageFindFirst.mockResolvedValueOnce({ role: "user", createdAt: old });
    callLLMMock.mockResolvedValueOnce({ text: "hey Alice", provider: "openrouter", model: "x", fallback: false });
    primeTransaction({ role: "user", createdAt: old });

    await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });

    const systemPrompt: string = callLLMMock.mock.calls[0][0].systemPrompt;
    expect(systemPrompt.toLowerCase()).toContain("reaching out to reconnect");
    expect(systemPrompt.toLowerCase()).toContain("picking up");
  });
});

describe("maybeRunCheckin - persistence and idempotency", () => {
  it("creates exactly one assistant message and updates counters in one transaction", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "hi", provider: "openrouter", model: "x", fallback: false });
    primeTransaction(null);

    await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });

    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    expect(txMessageCreate).toHaveBeenCalledTimes(1);
    expect(txConversationUpdate).toHaveBeenCalledTimes(1);
    // Non-tx create/update MUST NOT be used for the assistant write.
    expect(messageCreate).not.toHaveBeenCalled();
    expect(conversationUpdate).not.toHaveBeenCalled();
  });

  it("aborts the write when a concurrent call already left an assistant message", async () => {
    conversationFindFirst.mockResolvedValueOnce(baseConv());
    userFindUnique.mockResolvedValueOnce(baseUser());
    // First (pre-tx) check: no messages. Second call (inside tx) sees the
    // concurrent assistant message that landed in the interim.
    messageFindFirst.mockResolvedValueOnce(null);
    callLLMMock.mockResolvedValueOnce({ text: "hi", provider: "openrouter", model: "x", fallback: false });
    primeTransaction({ role: "assistant", createdAt: new Date() });

    const result = await maybeRunCheckin({ conversationId: CONV_ID, userId: USER_ID });

    expect(result.created).toBe(false);
    expect(txMessageCreate).not.toHaveBeenCalled();
    expect(txConversationUpdate).not.toHaveBeenCalled();
  });
});
