// Regression tests for the intent classifier's fast deterministic keyword
// floor added by Plans/cursor-prompt/35-major-fixes-batch.md #D.1.
//
// Two contracts:
//   1. Positive set: every obvious image REQUEST returns true.
//   2. Negative set: casual mentions of picture/photo/etc do NOT return
//      true. This is what prevents the floor from false-positiving into
//      normal chat.

import { describe, it, expect } from "vitest";
import { matchImageKeyword } from "../intent";

describe("matchImageKeyword", () => {
  const positives = [
    "send me a photo",
    "Send me a photo of you right now",
    "show me a pic",
    "share a selfie please",
    "generate a photo of you on a beach",
    "make me an image of the sunset",
    "can I see you naked",
    "i want a photo of you at the club",
    "i'd like a picture of your outfit",
    "drop a pic pls",
    "another pic please",
    "snap me a photo",
    "shoot me a selfie",
    "send me a video",
    "nudes please",
    "SELFIE PLEASE",
    "pics please",
    "send me a nude",
  ];
  const negatives = [
    "that painting is a pretty picture",
    "picture this: we are on a beach",
    "i can't picture it",
    "photography is a hobby of mine",
    "let me paint you a picture with words",
    "great imagery in that book",
    "hi",
    "how was your day",
    "tell me a story",
    "i love the way you write",
    "",
    "   ",
  ];

  for (const p of positives) {
    it(`positive: ${JSON.stringify(p)}`, () => {
      expect(matchImageKeyword(p)).toBe(true);
    });
  }

  for (const n of negatives) {
    it(`negative: ${JSON.stringify(n)}`, () => {
      expect(matchImageKeyword(n)).toBe(false);
    });
  }
});
