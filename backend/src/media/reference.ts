// Resolve a character's reference face image to actual bytes, for pipelines that
// must upload the image to the GPU box (InstantID chat selfies, Wan i2v video).
// CharacterMedia.url is either an absolute http(s) URL, a bare S3 key, or a
// local public path (e.g. /personas/x.webp served from frontend/public). We
// prefer a remote-readable URL and only fall back to a local "/" path (which the
// backend can read in local dev but not on ECS). Returns null if unresolvable so
// the caller can degrade gracefully.
//
// NOTE: the appearance sheet's referenceImageKeys can be a LOCAL /personas/*
// seed path that is NOT an S3 object; signing it as an S3 key 404s and yields a
// non-image XML error body. Always resolve reference bytes through here, never
// by signing referenceImageKeys directly.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@buttercupp/database";
import { getSignedUrl, getGeneratedSignedUrl } from "./storage";
import { logWarn } from "../utils/log";

export async function resolveCharacterReferenceBytes(characterId: string): Promise<Buffer | null> {
  try {
    const candidates = await prisma.characterMedia.findMany({
      where: { characterId, kind: "image" },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
      select: { url: true },
      take: 20,
    });
    const url = candidates.find((m) => !m.url.startsWith("/"))?.url ?? candidates[0]?.url;
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    if (url.startsWith("/")) {
      const publicDir = process.env.POPPY_PUBLIC_DIR ?? path.resolve(process.cwd(), "../frontend/public");
      return await readFile(path.join(publicDir, url));
    }
    // Bare S3 key. "images/" keys live in the generated bucket; all others in the
    // character-media bucket. Signing the wrong bucket 404s and silently drops
    // the reference.
    const signed = url.startsWith("images/")
      ? await getGeneratedSignedUrl(url, 60)
      : await getSignedUrl(url, 60);
    const r = await fetch(signed);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (err) {
    logWarn("media-reference", `reference resolve failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
