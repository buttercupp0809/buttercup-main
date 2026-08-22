import Link from "next/link";
import { Lock, Play } from "lucide-react";

// Presentational grid for the /private-content/[characterId] page.
//
// SECURITY: locked tiles never receive a real signed URL or S3 key. The server
// (page.tsx) signs ONLY the single free display asset and passes it as
// `freeImageUrl`; every locked tile receives a pre-blurred, downscaled data URI
// (blurMany, see frontend/lib/media-blur.ts), so no downloadable URL and no
// key ever reaches the DOM. This mirrors the GalleryPaywall / PersonaPanel
// locked-tile pattern.
//
// This is a server-compatible component (no client hooks): each locked tile is
// a plain <Link href="/billing">, so clicking any of them navigates to the
// subscription page.

export interface PrivateLockedTile {
  // Stable key only (never a URL). The media row id.
  id: string;
  kind: "image" | "video";
  // Pre-blurred data URI (worthless bytes). Not a real asset URL.
  blur: string;
}

interface Props {
  characterName: string;
  // The one free/display image, safe to show clearly. Real signed URL.
  freeImageUrl: string | null;
  lockedTiles: PrivateLockedTile[];
}

const TILE_BORDER = "1px solid hsl(var(--buttercupp-border))";

export function PrivateContentGallery({
  characterName,
  freeImageUrl,
  lockedTiles,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {freeImageUrl ? (
        <div
          data-testid="private-content-tile-free"
          data-locked="false"
          className="relative overflow-hidden rounded-2xl"
          style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
        >
          <img
            src={freeImageUrl}
            alt={`${characterName} photo`}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
          <span
            className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          >
            Free
          </span>
        </div>
      ) : null}

      {lockedTiles.map((tile) => (
        <Link
          key={tile.id}
          href="/billing"
          data-testid="private-content-tile-locked"
          data-locked="true"
          aria-label="Unlock premium content"
          className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl"
          style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
        >
          {/* Tiny pre-blurred data URI. No real URL/key in the DOM. */}
          <img
            src={tile.blur}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full scale-110 object-cover object-top"
          />
          {/* Darkening scrim over the blur for contrast */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            {tile.kind === "video" ? (
              <Play className="h-4 w-4 text-white" />
            ) : (
              <Lock className="h-4 w-4 text-white" />
            )}
          </div>
          <span
            className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
            style={{
              background:
                "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
            }}
          >
            Premium
          </span>
        </Link>
      ))}
    </div>
  );
}
