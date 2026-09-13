import { describe, it, expect } from "vitest";
import { expressionSchema, poseSchema, trainLoraJobPayloadSchema } from "./lora";

describe("lora shared schemas", () => {
  it("accepts a valid expression and rejects an unknown one", () => {
    expect(expressionSchema.parse("seductive")).toBe("seductive");
    expect(expressionSchema.safeParse("angry").success).toBe(false);
  });
  it("defaults targetImageCount and validates ids", () => {
    const p = trainLoraJobPayloadSchema.parse({
      source: "train-lora",
      characterId: "c1",
      characterVersionId: "v1",
      requestedBy: "admin",
    });
    expect(p.targetImageCount).toBe(30);
  });
  it("rejects a missing characterId", () => {
    expect(
      trainLoraJobPayloadSchema.safeParse({ source: "train-lora", characterVersionId: "v1", requestedBy: "a" }).success,
    ).toBe(false);
  });
});
