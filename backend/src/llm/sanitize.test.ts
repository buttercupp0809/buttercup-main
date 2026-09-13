import { describe, expect, it } from "vitest";
import {
  stripThinkingBlocks,
  stripImageDescriptionBlocks,
  StreamGuard,
  isMetaCommentary,
} from "./sanitize";

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

describe("stripImageDescriptionBlocks", () => {
  it("strips a trailing [Image description: ...] block and keeps the teaser", () => {
    const input =
      "Here you go, baby! Hope this snap makes your day as bright as my smile.\n\n[Image description: A photo of Ariana in a red dress standing on a beach at sunset.]";
    expect(stripImageDescriptionBlocks(input)).toBe(
      "Here you go, baby! Hope this snap makes your day as bright as my smile.",
    );
  });

  it("strips [Image: ...], [Photo: ...], and [Pic: ...] variants case-insensitively", () => {
    expect(stripImageDescriptionBlocks("Coming right up! [Image: a selfie]")).toBe("Coming right up!");
    expect(stripImageDescriptionBlocks("Say cheese! [PHOTO: a close up]")).toBe("Say cheese!");
    expect(stripImageDescriptionBlocks("Here. [pic: me smiling]")).toBe("Here.");
  });

  it("strips a block that spans newlines", () => {
    const input = "Sending it now.\n[Image description: a woman\nstanding\nin the rain]";
    expect(stripImageDescriptionBlocks(input)).toBe("Sending it now.");
  });

  it("strips an UNCLOSED trailing block (teaser cut off by max_tokens)", () => {
    // The teaser is capped at a small token budget, so the model is often cut
    // off mid-description with no closing "]". This must still be stripped.
    const input =
      "Here you go, baby! Hope this snap makes your day as bright as my smile.\n\n[Image description: A photo of Ariana";
    expect(stripImageDescriptionBlocks(input)).toBe(
      "Here you go, baby! Hope this snap makes your day as bright as my smile.",
    );
  });

  it("strips *image of ...* asterisk stage directions", () => {
    expect(stripImageDescriptionBlocks("Enjoy! *image of a sunset*")).toBe("Enjoy!");
  });

  it("leaves a normal sentence with unrelated brackets alone", () => {
    expect(stripImageDescriptionBlocks("I love you [so much] baby.")).toBe(
      "I love you [so much] baby.",
    );
  });

  it("leaves a clean teaser untouched", () => {
    const clean = "Give me just a moment to get that perfect shot ready for you...";
    expect(stripImageDescriptionBlocks(clean)).toBe(clean);
  });
});

describe("stripThinkingBlocks folds in image-description stripping", () => {
  it("removes a leaked [Image description: ...] from a main reply", () => {
    expect(
      stripThinkingBlocks("Here you go, love.\n\n[Image description: A photo of me smiling.]"),
    ).toBe("Here you go, love.");
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
