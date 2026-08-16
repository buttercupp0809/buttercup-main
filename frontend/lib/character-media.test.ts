import { describe, expect, it } from "vitest";
import {
  mediaIdentity,
  dedupeByIdentity,
  excludeHeroIdentity,
} from "@/lib/character-media";

describe("mediaIdentity", () => {
  it("returns the last path segment of a raw S3 key", () => {
    expect(mediaIdentity("character-media/abc/juggernaut-1-p1-v1.png")).toBe(
      "juggernaut-1-p1-v1.png",
    );
  });

  it("returns the same identity for two owner-prefixed keys with the same filename", () => {
    // This is the seed data bug: byte-identical PNGs written to two
    // different owner-prefixed keys.
    const a = mediaIdentity("character-media/ownerA/juggernaut-1-p1-v1.png");
    const b = mediaIdentity("character-media/ownerB/juggernaut-1-p1-v1.png");
    expect(a).toBe(b);
    expect(a).toBe("juggernaut-1-p1-v1.png");
  });

  it("decodes /api/media?k= dev-proxy URLs and returns the last segment", () => {
    const url =
      "/api/media?k=character-media%2Fowner%2Fjuggernaut-1-p1-v1.png";
    expect(mediaIdentity(url)).toBe("juggernaut-1-p1-v1.png");
  });

  it("returns the same identity for a raw key and its /api/media wrapper", () => {
    const raw = "character-media/owner/foo.png";
    const proxied = "/api/media?k=character-media%2Fowner%2Ffoo.png";
    expect(mediaIdentity(raw)).toBe(mediaIdentity(proxied));
  });

  it("strips the query string on a full https URL (signed CloudFront varies per call)", () => {
    const a = mediaIdentity(
      "https://cdn.example.com/character-media/x/foo.png?Signature=aaa&Expires=1",
    );
    const b = mediaIdentity(
      "https://cdn.example.com/character-media/x/foo.png?Signature=bbb&Expires=2",
    );
    expect(a).toBe(b);
    expect(a).toBe("foo.png");
  });

  it("uses the full path for local public assets", () => {
    expect(mediaIdentity("/personas/5.webp")).toBe("/personas/5.webp");
    expect(mediaIdentity("/personas/5.webp")).not.toBe(mediaIdentity("/personas/6.webp"));
  });

  it("returns empty string for empty input", () => {
    expect(mediaIdentity("")).toBe("");
  });
});

describe("dedupeByIdentity", () => {
  it("preserves order and drops later duplicates", () => {
    const urls = [
      "character-media/a/foo.png",
      "character-media/b/foo.png",
      "character-media/a/bar.png",
    ];
    expect(dedupeByIdentity(urls)).toEqual([
      "character-media/a/foo.png",
      "character-media/a/bar.png",
    ]);
  });

  it("keeps an aligned array in lockstep with the survivors", () => {
    const urls = [
      "character-media/a/foo.png",
      "character-media/b/foo.png",
      "character-media/a/bar.png",
    ];
    const blurs = ["blur-foo", "blur-foo-dup", "blur-bar"];
    const { urls: outUrls, aligned } = dedupeByIdentity(urls, blurs);
    expect(outUrls).toEqual([
      "character-media/a/foo.png",
      "character-media/a/bar.png",
    ]);
    expect(aligned).toEqual(["blur-foo", "blur-bar"]);
  });
});

describe("excludeHeroIdentity", () => {
  it("drops entries whose identity matches the hero", () => {
    const hero = "character-media/ownerA/juggernaut-1-p1-v1.png";
    const gallery = [
      "character-media/ownerB/juggernaut-1-p1-v1.png", // dup of hero (bug case)
      "character-media/ownerA/juggernaut-1-p2-v1.png",
    ];
    expect(excludeHeroIdentity(hero, gallery)).toEqual([
      "character-media/ownerA/juggernaut-1-p2-v1.png",
    ]);
  });

  it("returns the gallery untouched when the hero is null", () => {
    const gallery = ["character-media/x/a.png", "character-media/x/b.png"];
    expect(excludeHeroIdentity(null, gallery)).toEqual(gallery);
  });

  it("keeps aligned entries in lockstep", () => {
    const hero =
      "/api/media?k=character-media%2FownerA%2Fjuggernaut-1-p1-v1.png";
    const gallery = [
      "/api/media?k=character-media%2FownerB%2Fjuggernaut-1-p1-v1.png",
      "/api/media?k=character-media%2FownerA%2Fjuggernaut-1-p2-v1.png",
    ];
    const blurs = ["blur-dup", "blur-keep"];
    const { urls, aligned } = excludeHeroIdentity(hero, gallery, blurs);
    expect(urls).toHaveLength(1);
    expect(aligned).toEqual(["blur-keep"]);
  });
});
