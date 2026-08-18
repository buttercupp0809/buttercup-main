import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bucketForKey } from "./storage";

const ENV_KEYS = [
  "S3_BUCKET",
  "POPPY_S3_BUCKET_GENERATED",
  "POPPY_S3_BUCKET_REELS",
] as const;

describe("bucketForKey", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.S3_BUCKET = "poppy-media";
    process.env.POPPY_S3_BUCKET_GENERATED = "poppy-generated";
    process.env.POPPY_S3_BUCKET_REELS = "poppy-reels";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("routes reels/* to POPPY_S3_BUCKET_REELS", () => {
    expect(bucketForKey("reels/1.mp4")).toBe("poppy-reels");
    expect(bucketForKey("reels/65.mp4")).toBe("poppy-reels");
  });

  it("routes images/* to POPPY_S3_BUCKET_GENERATED", () => {
    expect(bucketForKey("images/user-1/abc.png")).toBe("poppy-generated");
  });

  it("routes everything else to S3_BUCKET", () => {
    expect(bucketForKey("media/user-1/image/x.png")).toBe("poppy-media");
    expect(bucketForKey("anything")).toBe("poppy-media");
  });
});
