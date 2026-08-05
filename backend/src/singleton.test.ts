import { describe, expect, it } from "vitest";
import { prisma } from "@buttercupp/database";

describe("backend imports @buttercupp/database", () => {
  it("resolves the singleton across the workspace boundary", () => {
    expect(prisma).toBeDefined();
    expect(typeof (prisma as unknown as { $connect: unknown }).$connect).toBe("function");
  });

  it("does trivial math", () => {
    expect(1 + 1).toBe(2);
  });
});
