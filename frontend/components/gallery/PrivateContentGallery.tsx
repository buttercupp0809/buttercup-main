"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { trackCta } from "@/lib/track-cta";

// Presentational grid for the /private-content/[characterId] page.
//
// SECURITY: locked tiles never receive a real signed URL or S3 key. The server
// (page.tsx) signs ONLY the free display asset and already-unlocked images;
// every still-locked tile receives a pre-blurred, downscaled data URI
// (blurMany, see frontend/lib/media-blur.ts), so no downloadable URL and no
// key ever reaches the DOM.

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export interface PrivateLockedTile {
  // Stable key only (never a URL). The media row id.
  id: string;
  kind: "image" | "video";
  // Pre-blurred data URI (worthless bytes). Not a real asset URL.
  blur: string;
}

export interface PrivateUnlockedTile {
  id: string;
  kind: "image" | "video";
  // Real signed URL, safe to display. Only present for already-unlocked rows.
  url: string;
}

interface Props {
  characterName: string;
  characterId: string;
  // The one free/display image, safe to show clearly. Real signed URL.
  freeImageUrl: string | null;
  lockedTiles: PrivateLockedTile[];
  // Tiles the user has already unlocked. These render with real signed URLs.
  unlockedTiles: PrivateUnlockedTile[];
  // True when the viewer has an active subscription (can spend image tokens).
  hasActivePlan: boolean;
}

const TILE_BORDER = "1px solid hsl(var(--buttercupp-border))";

export function PrivateContentGallery({
  characterName,
  freeImageUrl,
  lockedTiles,
  unlockedTiles,
  hasActivePlan,
}: Props) {
  const router = useRouter();
  const [unlocking, setUnlocking] = React.useState<string | null>(null);

  async function unlockTile(mediaId: string) {
    trackCta("gallery_unlock_image", "private_gallery");
    setUnlocking(mediaId);
    try {
      const r = await fetch(`${BACKEND_URL}/gallery/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ characterMediaId: mediaId }),
      });
      if (r.ok) {
        router.refresh();
      }
    } catch {
      // silent: user can retry by clicking again
    } finally {
      setUnlocking(null);
    }
  }

  return (
    <div>
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

      {/* Already-unlocked tiles: rendered directly from server-signed URLs. */}
      {unlockedTiles.map((tile) => (
        <div
          key={tile.id}
          data-testid="private-content-tile-unlocked"
          data-locked="false"
          className="relative overflow-hidden rounded-2xl"
          style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
        >
          <img
            src={tile.url}
            alt={`${characterName} photo`}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </div>
      ))}

      {/* Still-locked tiles: subscription users get a 1-token unlock button;
          everyone else sees a "Premium" link to /billing. */}
      {lockedTiles.map((tile) => {
        if (hasActivePlan) {
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => void unlockTile(tile.id)}
              disabled={unlocking === tile.id}
              data-testid="private-content-tile-locked"
              data-locked="true"
              aria-label="Unlock with 1 image token"
              className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl"
              style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
            >
              <img
                src={tile.blur}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute inset-0 h-full w-full scale-110 object-cover object-top"
              />
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
                {unlocking === tile.id ? "Unlocking..." : "1 token"}
              </span>
            </button>
          );
        }

        return (
          <Link
            key={tile.id}
            href="/billing"
            onClick={() => trackCta("gallery_upgrade", "private_gallery")}
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
        );
      })}
    </div>

      {!hasActivePlan && lockedTiles.length > 0 ? (
        <div
          className="sticky bottom-20 mt-4 flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5 shadow-xl md:bottom-4"
          style={{
            background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
          }}
        >
          <span className="text-sm font-semibold text-white">
            Unlock all {lockedTiles.length} photo{lockedTiles.length !== 1 ? "s" : ""} from {characterName}
          </span>
          <a
            href="/billing"
            onClick={() => trackCta("gallery_sticky_cta", "private_gallery")}
            className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-bold"
            style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Upgrade
          </a>
        </div>
      ) : null}
    </div>
  );
}
