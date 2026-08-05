import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correcthorse4battery");
    expect(hash).not.toContain("correcthorse");
    expect(await verifyPassword("correcthorse4battery", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correcthorse4battery");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns false on garbage inputs", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("", "$2a$12$abcdef")).toBe(false);
  });
});
