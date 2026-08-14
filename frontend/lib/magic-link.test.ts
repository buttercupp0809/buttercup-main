import { describe, expect, it } from "vitest";
import { sha256Hex } from "./magic-link";
import { createHash } from "crypto";

describe("sha256Hex", () => {
  it("matches node:crypto sha256", () => {
    const raw = "deadbeef-cafebabe";
    const expected = createHash("sha256").update(raw).digest("hex");
    expect(sha256Hex(raw)).toBe(expected);
  });

  it("is deterministic and 64 hex chars", () => {
    const a = sha256Hex("abc");
    const b = sha256Hex("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
