import { describe, expect, it } from "vitest";
import { prisma } from "./index";

describe("@buttercupp/database", () => {
  it("does trivial math", () => {
    expect(1 + 1).toBe(2);
  });

  it("exports a Prisma client singleton", () => {
    expect(prisma).toBeDefined();
    expect(typeof (prisma as unknown as { $connect: unknown }).$connect).toBe("function");
  });
});
