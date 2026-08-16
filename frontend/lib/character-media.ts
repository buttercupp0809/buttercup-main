// Character media identity + hero/gallery normalization.
//
// The "hero == first free gallery tile" duplication bug turns out to be
// data-driven: the seed writes visually-identical PNGs to two different
// CharacterMedia rows under distinct owner-prefixed S3 keys (e.g.
// `character-media/<ownerA>/juggernaut-1-p1-v1.png` AND
// `character-media/<ownerB>/juggernaut-1-p1-v1.png`, byte-identical). The
// previous dedup filtered by full URL string equality; those URLs differ,
// so the duplicate slipped through and rendered as tile 0 alongside the
// hero above.
//
// The fix is to dedup by a stable *media identity* (the last path segment
// of the underlying S3 key). That is stable across signed CloudFront URLs
// (which change every call due to `dateLessThan`), across the `/api/media?k=`
// dev proxy, and across the owner-prefix variation the seed introduces.
//
// This helper is shared by BOTH read sites that render the hero + gallery
// pair (frontend/lib/characters.ts::getCharacterDetail and the chat
// (protected)/chat/[characterId]/page.tsx) so they can never drift apart
// on the invariant `hero.identity !== any gallery[i].identity`.

// Extract a stable identity from any of the URL forms we produce:
//   - Raw S3 key ("character-media/<owner>/foo.png"): last segment "foo.png".
//   - Local dev proxy ("/api/media?k=<encoded-key>"): decode + last segment.
//   - CloudFront signed URL ("https://cdn.example.com/character-media/.../foo.png?Signature=..."):
//     strip query then last segment.
//   - Local public path ("/personas/5.webp"): the whole path (seed stock
//     art with no S3 backing; two rows with the same static path are
//     legitimately the same asset).
export function mediaIdentity(url: string): string {
  if (!url) return "";
  // Local public path: use the whole normalized path as the identity.
  if (url.startsWith("/") && !url.startsWith("/api/media")) return url;

  let key = url;
  if (url.startsWith("/api/media")) {
    const q = url.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? url.slice(q) : "");
    const k = params.get("k");
    if (k) key = k;
  } else {
    // Full https URL or raw key: strip query string first.
    const q = url.indexOf("?");
    if (q >= 0) key = url.slice(0, q);
    // For a full URL, take the pathname; for a raw key, key stays as-is.
    if (/^https?:\/\//i.test(key)) {
      try {
        key = new URL(key).pathname;
      } catch {
        // Fall through with the pre-decode value; better than throwing.
      }
    }
  }

  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}

// Dedup a list of URLs by media identity, preserving order. Optionally
// aligned with a parallel array (e.g. `imageBlurs`) so the survivor set
// keeps its blur pipeline intact.
export function dedupeByIdentity(urls: string[]): string[];
export function dedupeByIdentity<T>(
  urls: string[],
  aligned: T[],
): { urls: string[]; aligned: T[] };
export function dedupeByIdentity<T>(
  urls: string[],
  aligned?: T[],
): string[] | { urls: string[]; aligned: T[] } {
  const seen = new Set<string>();
  const outUrls: string[] = [];
  const outAligned: T[] = [];
  for (let i = 0; i < urls.length; i++) {
    const id = mediaIdentity(urls[i]);
    if (seen.has(id)) continue;
    seen.add(id);
    outUrls.push(urls[i]);
    if (aligned) outAligned.push(aligned[i] as T);
  }
  return aligned ? { urls: outUrls, aligned: outAligned } : outUrls;
}

// Drop from `urls` (and optional aligned array) any entry whose media
// identity matches `heroUrl`'s identity. Used to remove the hero's
// duplicate from a gallery list without also filtering unrelated tiles.
export function excludeHeroIdentity(
  heroUrl: string | null,
  urls: string[],
): string[];
export function excludeHeroIdentity<T>(
  heroUrl: string | null,
  urls: string[],
  aligned: T[],
): { urls: string[]; aligned: T[] };
export function excludeHeroIdentity<T>(
  heroUrl: string | null,
  urls: string[],
  aligned?: T[],
): string[] | { urls: string[]; aligned: T[] } {
  if (!heroUrl) {
    return aligned ? { urls, aligned } : urls;
  }
  const heroId = mediaIdentity(heroUrl);
  const outUrls: string[] = [];
  const outAligned: T[] = [];
  for (let i = 0; i < urls.length; i++) {
    if (mediaIdentity(urls[i]) === heroId) continue;
    outUrls.push(urls[i]);
    if (aligned) outAligned.push(aligned[i] as T);
  }
  return aligned ? { urls: outUrls, aligned: outAligned } : outUrls;
}
