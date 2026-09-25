import { test, expect } from "vitest";
import { buildApiUrl } from "../client";

// Only test the pure helper - actual HTTP calls are tested via integration.
test("buildApiUrl constructs correct endpoint", () => {
  const url = buildApiUrl("BOT_TOKEN_123", "sendMessage");
  expect(url).toBe("https://api.telegram.org/botBOT_TOKEN_123/sendMessage");
});
