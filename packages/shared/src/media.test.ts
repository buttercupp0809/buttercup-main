import { describe, it, expect } from "vitest";
import { createVideoPayloadSchema } from "./media";

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
