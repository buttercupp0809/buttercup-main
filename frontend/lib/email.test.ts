// Sanitizer for EMAIL_FROM. Guards against shells or dotenv variants that
// preserve wrapping double/single quotes when the value contains angle
// brackets, which would leak into the sender chip as `"ButterCupp" <...>`.

import { describe, it, expect } from "vitest";
import { sanitizeEmailFrom } from "./email";

describe("sanitizeEmailFrom", () => {
  it("strips wrapping double quotes", () => {
    expect(sanitizeEmailFrom('"ButterCupp <a@b>"')).toBe("ButterCupp <a@b>");
  });

  it("strips wrapping single quotes", () => {
    expect(sanitizeEmailFrom("'ButterCupp <a@b>'")).toBe("ButterCupp <a@b>");
  });

  it("leaves an unquoted mailbox untouched", () => {
    expect(sanitizeEmailFrom("ButterCupp <a@b>")).toBe("ButterCupp <a@b>");
  });

  it("leaves a bare address untouched", () => {
    expect(sanitizeEmailFrom("a@b")).toBe("a@b");
  });

  it("does not strip mismatched quotes", () => {
    expect(sanitizeEmailFrom('"ButterCupp <a@b>')).toBe('"ButterCupp <a@b>');
    expect(sanitizeEmailFrom("ButterCupp <a@b>\"")).toBe("ButterCupp <a@b>\"");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeEmailFrom('  "ButterCupp <a@b>"  ')).toBe("ButterCupp <a@b>");
  });

  it("returns empty string for undefined/empty inputs", () => {
    expect(sanitizeEmailFrom(undefined)).toBe("");
    expect(sanitizeEmailFrom("")).toBe("");
  });
});
