import { describe, expect, it } from "vitest";
import { stripThinkingBlocks, StreamGuard, isMetaCommentary } from "./sanitize";

describe("stripThinkingBlocks", () => {
  it("removes closed <think>...</think>", () => {
    expect(stripThinkingBlocks("<think>ignore me</think>Hi there")).toBe("Hi there");
  });
  it("removes closed <reasoning>...</reasoning>", () => {
    expect(stripThinkingBlocks("<reasoning>a</reasoning>Hello")).toBe("Hello");
  });
  it("removes [thinking]...[/thinking]", () => {
    expect(stripThinkingBlocks("[thinking]x[/thinking]Yo")).toBe("Yo");
  });
  it("drops an unclosed <think> tail", () => {
    expect(stripThinkingBlocks("Hi <think>oops")).toBe("Hi");
  });
  it("strips 'Okay, the user...' preamble", () => {
    expect(
      stripThinkingBlocks("Okay, the user wants a story about a cat.\n\nHere is a cat story."),
    ).toBe("Here is a cat story.");
  });
  it("peels a meta-commentary paragraph", () => {
    expect(
      stripThinkingBlocks("The user is testing me.\n\nHello there, friend."),
    ).toBe("Hello there, friend.");
  });
  it("leaves normal text alone", () => {
    expect(stripThinkingBlocks("Hey, how are you today?")).toBe("Hey, how are you today?");
  });
});

describe("isMetaCommentary", () => {
  it("flags third-person analyses", () => {
    expect(isMetaCommentary("The user seems tired.")).toBe(true);
    expect(isMetaCommentary("Looking at their prior turn...")).toBe(true);
  });
  it("does not flag direct speech", () => {
    expect(isMetaCommentary("Hey there.")).toBe(false);
  });
});

describe("StreamGuard", () => {
  it("passes through plain text", () => {
    const g = new StreamGuard();
    let out = "";
    out += g.push("Hi ");
    out += g.push("there");
    out += g.end();
    expect(out).toBe("Hi there");
  });

  it("holds back partial '<thi' until it resolves", () => {
    const g = new StreamGuard();
    // Push a chunk that ends in '<thi' ,  guard must not forward those 4 chars
    // yet because they could still be the start of <think>.
    const first = g.push("Hello <thi");
    expect(first.endsWith("<thi")).toBe(false);
    expect(first.includes("Hello")).toBe(true);
    const next = g.push("nk>ignored</think>. Bye");
    // After the closing tag resolves we get the tail.
    expect(next).toBe(". Bye");
    expect(g.end()).toBe("");
  });

  it("suppresses everything inside a completed <think> block delivered in one chunk", () => {
    const g = new StreamGuard();
    const out = g.push("A<think>secret</think>B") + g.end();
    expect(out).toBe("AB");
  });

  it("drops an unclosed <think> at stream end", () => {
    const g = new StreamGuard();
    const out = g.push("visible <think>partial") + g.end();
    expect(out).toBe("visible ");
  });

  it("does not hold back '< ' when it clearly is not a tag opener", () => {
    const g = new StreamGuard();
    const out = g.push("2 < 5 is true") + g.end();
    expect(out).toBe("2 < 5 is true");
  });
});
