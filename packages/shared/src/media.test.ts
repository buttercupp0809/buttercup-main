import { describe, it, expect } from "vitest";
import { createVideoPayloadSchema, creationImageJobPayloadSchema, parseCreationImagePayload } from "./media";

describe("createVideoPayloadSchema sceneMode", () => {
  it("defaults sceneMode to transform", () => {
    const p = createVideoPayloadSchema.parse({ userRequest: "on a beach" });
    expect(p.sceneMode).toBe("transform");
  });
  it("accepts keep and rejects unknown", () => {
    expect(createVideoPayloadSchema.parse({ userRequest: "x", sceneMode: "keep" }).sceneMode).toBe("keep");
    expect(() => createVideoPayloadSchema.parse({ userRequest: "x", sceneMode: "nope" })).toThrow();
  });
  it("accepts 8 second duration", () => {
    expect(createVideoPayloadSchema.parse({ userRequest: "x", seconds: 8 }).seconds).toBe(8);
  });
});

describe("creationImageJobPayloadSchema expression/pose", () => {
  const base = {
    source: "creation" as const,
    characterId: "char-abc",
    characterVersionId: "ver-xyz",
    variant: 0,
  };

  it("parses without expression or pose (invariant: existing payloads still valid)", () => {
    const result = creationImageJobPayloadSchema.parse(base);
    expect(result.expression).toBeUndefined();
    expect(result.pose).toBeUndefined();
  });

  it("accepts a valid expression", () => {
    const result = creationImageJobPayloadSchema.parse({ ...base, expression: "smiling" });
    expect(result.expression).toBe("smiling");
  });

  it("accepts a valid pose", () => {
    const result = creationImageJobPayloadSchema.parse({ ...base, pose: "three_quarter_left" });
    expect(result.pose).toBe("three_quarter_left");
  });

  it("accepts both expression and pose together", () => {
    const result = creationImageJobPayloadSchema.parse({ ...base, expression: "seductive", pose: "sitting" });
    expect(result.expression).toBe("seductive");
    expect(result.pose).toBe("sitting");
  });

  it("rejects an invalid expression value", () => {
    expect(() => creationImageJobPayloadSchema.parse({ ...base, expression: "winking" })).toThrow();
  });

  it("rejects an invalid pose value", () => {
    expect(() => creationImageJobPayloadSchema.parse({ ...base, pose: "standing" })).toThrow();
  });
});

describe("parseCreationImagePayload with expression/pose", () => {
  it("returns expression and pose when present and valid", () => {
    const payload = {
      source: "creation",
      characterId: "c1",
      characterVersionId: "v1",
      variant: 1,
      expression: "happy",
      pose: "front",
    };
    const result = parseCreationImagePayload(payload);
    expect(result).not.toBeNull();
    expect(result?.expression).toBe("happy");
    expect(result?.pose).toBe("front");
  });

  it("returns null for a non-creation payload (no source=creation)", () => {
    expect(parseCreationImagePayload({ source: "chat", characterId: "c1", variant: 0 })).toBeNull();
  });

  it("returns null when expression is an invalid value (zod rejects)", () => {
    const payload = {
      source: "creation",
      characterId: "c1",
      characterVersionId: "v1",
      variant: 0,
      expression: "not-an-expression",
    };
    expect(parseCreationImagePayload(payload)).toBeNull();
  });
});
