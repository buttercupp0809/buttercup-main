import { describe, it, expect } from "vitest";
import { matchPoseSkeleton } from "./pose-library";

describe("matchPoseSkeleton", () => {
  it("maps known poses to skeleton files", () => {
    expect(matchPoseSkeleton("sitting on a couch")).toMatch(/sitting/);
    expect(matchPoseSkeleton("lying on the bed")).toMatch(/lying/);
  });
  it("returns null for an unknown pose", () => {
    expect(matchPoseSkeleton("just standing there")).toBeNull();
  });
});
