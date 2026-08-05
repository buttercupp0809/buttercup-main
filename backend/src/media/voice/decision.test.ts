import { describe, expect, it } from "vitest";
import { isVoiceRequest, shouldSendAsVoice } from "./decision";
import { truncateForVoice } from "./audio";

describe("isVoiceRequest", () => {
  it("matches an explicit voice-note request", () => {
    expect(isVoiceRequest("hey can you send me a voice note?")).toBe(true);
    expect(isVoiceRequest("say it out loud")).toBe(true);
    expect(isVoiceRequest("I want to hear your voice")).toBe(true);
  });
  it("does not match a normal chat message", () => {
    expect(isVoiceRequest("hey, how are you?")).toBe(false);
    expect(isVoiceRequest("tell me about the beach")).toBe(false);
  });
});

describe("shouldSendAsVoice", () => {
  const base = {
    userRequested: false,
    tokenBalance: 100,
    voiceCost: 5,
    recentVoiceCount: 0,
    recentVoiceLimit: 3,
  };
  it("blocks when balance is short", () => {
    expect(
      shouldSendAsVoice({ ...base, tokenBalance: 0 }).send,
    ).toBe(false);
  });
  it("returns send=true on the userRequested fast path", () => {
    expect(shouldSendAsVoice({ ...base, userRequested: true }).send).toBe(true);
  });
  it("blocks when the recent-voice limit is hit", () => {
    const d = shouldSendAsVoice({ ...base, recentVoiceCount: 5 });
    expect(d.send).toBe(false);
    expect(d.reason).toBe("recent_limit");
  });
  it("otherwise defaults to send=false (auto-voice disabled)", () => {
    expect(shouldSendAsVoice(base).send).toBe(false);
  });
});

describe("truncateForVoice", () => {
  it("passes short text through", () => {
    expect(truncateForVoice("hey there")).toBe("hey there");
  });
  it("truncates long text and appends ...", () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const out = truncateForVoice(long);
    const wc = out.split(/\s+/).length;
    expect(wc).toBeLessThanOrEqual(251);
    expect(out.endsWith("...")).toBe(true);
  });
});
