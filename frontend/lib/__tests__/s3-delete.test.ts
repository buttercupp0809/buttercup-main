import { describe, expect, it } from "vitest";
import { extractS3Key } from "@/lib/s3-delete";

describe("extractS3Key", () => {
  it("returns null for empty / nullish", () => {
    expect(extractS3Key(null)).toBeNull();
    expect(extractS3Key(undefined)).toBeNull();
    expect(extractS3Key("")).toBeNull();
  });

  it("drops local public paths (seed art)", () => {
    expect(extractS3Key("/personas/5.webp")).toBeNull();
    expect(extractS3Key("/reels/hero.mp4")).toBeNull();
  });

  it("passes bare S3 keys through unchanged", () => {
    expect(extractS3Key("images/user-1/abc.png")).toBe("images/user-1/abc.png");
    expect(extractS3Key("media/user-2/image/xyz.jpg")).toBe("media/user-2/image/xyz.jpg");
  });

  it("extracts the key from a /api/media proxy URL", () => {
    expect(extractS3Key("/api/media?k=images%2Fuser-1%2Fabc.png")).toBe(
      "images/user-1/abc.png",
    );
  });

  it("returns null for an /api/media proxy URL missing the k param", () => {
    expect(extractS3Key("/api/media")).toBeNull();
    expect(extractS3Key("/api/media?other=1")).toBeNull();
  });

  it("strips CloudFront host + query, keeps the pathname key", () => {
    expect(
      extractS3Key(
        "https://cdn.example.com/images/user-1/abc.png?Signature=deadbeef&Expires=1234",
      ),
    ).toBe("images/user-1/abc.png");
  });

  it("handles nested S3 key paths", () => {
    expect(extractS3Key("media/user-3/image/deep/deep/file.webp")).toBe(
      "media/user-3/image/deep/deep/file.webp",
    );
  });
});
