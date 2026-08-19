// Unit tests for the verify-email transactional template. We do not snapshot
// the full HTML (rendering quirks make snapshots noisy); instead we assert the
// hard requirements: link inclusion, CTA present, brand tokens rendered as hex
// (not CSS variables or Tailwind classes), preheader present, and a
// plain-text version that carries the URL verbatim.

import { describe, it, expect } from "vitest";
import { buildVerifyEmail } from "./verify-email";

const LINK = "https://buttercupp.fun/api/auth/verify-email?token=abc123def456";

describe("buildVerifyEmail", () => {
  const { subject, html, text } = buildVerifyEmail(LINK);

  it("returns the ButterCupp subject line unchanged", () => {
    expect(subject).toBe("Verify your ButterCupp email");
  });

  it("embeds the verification link twice (CTA + fallback)", () => {
    const occurrences = html.split(LINK).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("uses inline hex brand colors, not CSS variables or Tailwind classes", () => {
    // Current ButterCupp brand: amber #fc9908 with the amber-hot #f6812a
    // gradient partner (translated from the --bc-* tokens in globals.css).
    expect(html).toContain("#fc9908");
    expect(html).toContain("#f6812a");
    expect(html).not.toContain("var(--buttercupp");
    expect(html).not.toMatch(/class="[^"]*bg-/);
  });

  it("includes a gradient CTA button styled inline", () => {
    expect(html).toMatch(/linear-gradient\(135deg,\s*#fc9908/);
    expect(html).toMatch(/>\s*Verify email\s*</);
  });

  it("uses a table-based layout for cross-client compatibility", () => {
    expect(html).toContain("<table role=\"presentation\"");
  });

  it("includes a hidden preheader with a one-line summary", () => {
    expect(html).toMatch(/display:none;[^"]*max-height:0/);
    expect(html).toContain("Confirm your email to unlock ButterCupp");
  });

  it("declares light+dark color scheme so clients render sensibly", () => {
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  it("includes the ButterCupp wordmark and the 18+ line", () => {
    expect(html).toContain(">ButterCupp<");
    expect(html).toContain("ButterCupp is for adults 18+.");
  });

  it("mentions the 24-hour expiry", () => {
    expect(html).toContain("expires in 24 hours");
    expect(text).toContain("expires in 24 hours");
  });

  it("produces a plain-text version containing the URL verbatim", () => {
    expect(text).toContain(LINK);
    expect(text).toContain("Verify your ButterCupp email");
    expect(text).not.toContain("<html");
  });

  it("html-escapes the link if it contains special characters", () => {
    const evil = buildVerifyEmail("https://x.test/a?b=1&c=<script>");
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&amp;c=&lt;script&gt;");
  });
});
