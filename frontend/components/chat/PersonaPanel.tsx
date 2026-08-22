"use client";

// Right column of the chat surface: the persona's primary image, name,
// description, and a gallery grid of remaining images/reels.
// Images are generated at 9:16 and displayed with object-top so faces are
// never cropped. `images[0]` is the free/isDisplay asset shown large up top;
// among the remaining gallery items, the FIRST tile (whether image or video)
// is a free teaser matching the public character detail page's GalleryPaywall
// behavior, and every subsequent tile is blurred + locked. Aligning the two
// surfaces means the chat persona panel and /characters/[id] gallery never
// drift out of sync (see e2e/image-swap.spec.ts).
//
// Paywall teaser convention: both free previews (the hero above and the
// first gallery tile) are teasers; clicking either opens the same upgrade
// modal every locked tile does, rather than granting a full free view.
//
// Below `xl` the inline aside is `hidden`, so `PersonaPanelMobileTrigger`
// exposes the SAME body content through a PanelSheet right slide-over.

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Play, Lock, Images } from "lucide-react";
import { UpgradeModal } from "@/components/ui/UpgradeModal";
import { PanelSheet } from "@/components/chat/PanelSheet";
import { MemoryVault } from "@/components/memory/MemoryVault";
import { mediaIdentity } from "@/lib/character-media";
import type { MemoryDTO } from "@buttercupp/shared";

export interface PanelMedia {
  kind: "image" | "video";
  url: string;
}

// Internal gallery item carries an optional pre-blurred data URI used to
// render locked tiles without exposing the real URL.
interface GalleryItem extends PanelMedia {
  blur?: string;
}

export interface PersonaPanelProps {
  name: string;
  description: string;
  location?: string | null;
  images: string[];
  // Pre-blurred data URIs aligned by index with `images`. Used for locked
  // tiles so the real S3 URL never reaches the DOM.
  imageBlurs?: string[];
  assets: PanelMedia[];
  // Memory surface. Server-rendered first page so the panel never opens empty
  // and then pops; omitted entirely by callers that have no user context.
  characterId?: string;
  memories?: MemoryDTO[];
  memoryCursor?: string | null;
  memoryTotal?: number;
}

// Shared primary image + name/description + gallery grid + private-content
// CTA, reused by the desktop inline aside and the mobile PanelSheet so the
// two never drift out of sync.
function PersonaPanelContent({
  name,
  description,
  location,
  images,
  imageBlurs = [],
  assets,
  characterId,
  memories,
  memoryCursor = null,
  memoryTotal = 0,
}: PersonaPanelProps) {
  const primaryImage = images[0] ?? null;
  // Gallery is everything after the hero, minus any duplicates of the hero
  // itself. Comparison is on media *identity* (last path segment of the
  // underlying S3 key), not the full URL string: the seed writes byte-
  // identical PNGs to two different owner-prefixed keys and assigns one to
  // isDisplay (images[0]) and the other to isPrimary (images[1]). A raw
  // string dedup misses that and leaks the hero as free gallery tile 0
  // (the reported "hero == free teaser" duplication bug). See
  // frontend/lib/character-media.ts. Blurs stay aligned to their surviving
  // URLs so the locked-tile blur pipeline is preserved.
  const heroIdentity = primaryImage ? mediaIdentity(primaryImage) : null;
  const seenIdentities = new Set<string>();
  if (heroIdentity) seenIdentities.add(heroIdentity);
  const galleryPairs: { url: string; blur: string | undefined }[] = [];
  const tailBlurs = imageBlurs.slice(1);
  images.slice(1).forEach((url, idx) => {
    const id = mediaIdentity(url);
    if (seenIdentities.has(id)) return;
    seenIdentities.add(id);
    galleryPairs.push({ url, blur: tailBlurs[idx] });
  });
  // Cap the gallery to a single row of 3 tiles: index 0 is the free teaser
  // image (hero already sits above), indexes 1 and 2 are locked. Anything
  // beyond that lived below the fold as extra rows and only added upsell noise;
  // the full set is available on the private-content page linked below.
  const galleryItems: GalleryItem[] = [
    ...galleryPairs.map((p) => ({ kind: "image" as const, url: p.url, blur: p.blur })),
    ...assets.map((a) => ({ ...a })),
  ].slice(0, 3);

  // freeItem: clicked free tile -> preview lightbox (clear image + upgrade nudge)
  const [freeItem, setFreeItem] = React.useState<PanelMedia | null>(null);
  // lockedItem: clicked locked tile -> blurred upgrade modal
  const [lockedItem, setLockedItem] = React.useState<PanelMedia | null>(null);

  return (
    <>
      {/* Primary image, 4:5 portrait, object-top keeps the face visible. Even
          this free preview is a teaser: clicking it opens the upgrade modal,
          same as every gallery tile below. */}
      <div className="relative m-4 overflow-hidden rounded-2xl bg-black" style={{ paddingBottom: "125%" }}>
        {primaryImage ? (
          <button
            type="button"
            data-testid="persona-panel-hero"
            onClick={() => setFreeItem({ kind: "image", url: primaryImage })}
            aria-label={`Preview ${name}'s photo`}
            className="absolute inset-0 h-full w-full"
          >
            <img src={primaryImage} alt={name} className="h-full w-full object-cover object-top" />
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-white/60">
            {name[0]?.toUpperCase()}
          </div>
        )}
      </div>

      {/* Name + description */}
      <div className="px-5 pt-2">
        <h2 className="font-display text-2xl font-bold">{name}</h2>
        {location ? (
          <p className="mt-0.5 text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            {location}
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          {description}
        </p>
      </div>

      {/* Memory sits above the gallery on purpose: the gallery is an upsell, this
          is the thing the user was actually promised. */}
      {characterId && memories ? (
        <MemoryVault
          characterId={characterId}
          characterName={name}
          initialItems={memories}
          initialCursor={memoryCursor}
          total={memoryTotal}
        />
      ) : null}

      {/* Gallery grid: 9:16 tiles, object-top. First tile free (preview), rest locked. */}
      {galleryItems.length > 0 ? (
        <div className="mt-5 px-4">
          <div className="grid grid-cols-3 gap-2">
            {galleryItems.map((item, i) => {
              // First gallery tile is the free teaser (matches the public
              // /characters/[id] GalleryPaywall so both surfaces render the
              // same lock/blur pattern per tile index); every subsequent
              // tile is blurred + locked.
              const isLocked = i !== 0;
              return (
                <div
                  key={item.url + i}
                  data-testid={`chat-persona-gallery-tile-${i}`}
                  data-locked={isLocked ? "true" : "false"}
                  className="relative overflow-hidden rounded-lg bg-black"
                  style={{ aspectRatio: "9 / 16" }}
                >
                  {isLocked ? (
                    /* Locked tile: renders a tiny pre-blurred data URI (worthless
                       bytes). The real URL/key never reaches the DOM. */
                    <button
                      type="button"
                      onClick={() => setLockedItem(item)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                      aria-label="Unlock premium content"
                    >
                      {item.blur ? (
                        <img
                          src={item.blur}
                          alt=""
                          aria-hidden
                          draggable={false}
                          className="absolute inset-0 h-full w-full scale-110 object-cover object-top"
                        />
                      ) : (
                        <span
                          className="absolute inset-0"
                          style={{
                            background: "linear-gradient(135deg, hsl(var(--buttercupp-surface-2)) 0%, hsl(var(--buttercupp-surface)) 100%)",
                          }}
                        />
                      )}
                      <span className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
                      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/60">
                        <Lock className="h-4 w-4 text-white" />
                      </span>
                    </button>
                  ) : item.kind === "video" ? (
                    /* Free video tile */
                    <>
                      <video
                        src={item.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover object-top"
                      />
                      <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
                        <Play className="h-3.5 w-3.5 text-white" fill="white" />
                      </span>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setFreeItem(item)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFreeItem(item); }}
                        aria-label="Preview video"
                        className="absolute inset-0 cursor-pointer"
                      />
                    </>
                  ) : (
                    /* Free image tile */
                    <>
                      <img src={item.url} alt="" className="h-full w-full object-cover object-top" />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setFreeItem(item)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFreeItem(item); }}
                        aria-label="Preview photo"
                        className="absolute inset-0 cursor-pointer"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Private content CTA. Links to this character's private-content page
          (built by a separate surface). Gated on characterId so callers with no
          user/character context never render a /private-content/undefined link. */}
      {characterId ? (
        <div className="p-5">
          <Link
            href={`/private-content/${characterId}`}
            className="flex items-center gap-3 rounded-[var(--bc-radius)] border p-3 transition hover:bg-[hsl(var(--bc-cream)/0.05)]"
            style={{ borderColor: "hsl(var(--buttercupp-border))" }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--bc-amber))" }}
            >
              <Lock className="h-4 w-4 text-[hsl(28_45%_9%)]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">My Private Content</span>
              <span className="block text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                Exclusive photos &amp; videos
              </span>
            </span>
            <ChevronRight className="h-4 w-4" style={{ color: "hsl(var(--buttercupp-muted))" }} />
          </Link>
        </div>
      ) : null}

      {/* Free-tile lightbox: full clear image + upgrade nudge */}
      {freeItem && (
        <UpgradeModal
          imageSrc={freeItem.url}
          imageAlt={name}
          imageBlurred={false}
          title={`Unlock ${name}'s Private Gallery`}
          description="Get unlimited access to exclusive photos, videos, and intimate moments. Upgrade to Premium and see everything."
          onClose={() => setFreeItem(null)}
        />
      )}

      {/* Locked-tile modal: no image passed, real URL must never appear in DOM */}
      {lockedItem && (
        <UpgradeModal
          title={`Unlock ${name}'s Private Gallery`}
          description="Get unlimited access to exclusive photos, videos, and intimate moments. Upgrade to Premium and see everything."
          onClose={() => setLockedItem(null)}
        />
      )}
    </>
  );
}

export function PersonaPanel(props: PersonaPanelProps) {
  return (
    <aside
      className="hidden h-full w-96 shrink-0 flex-col overflow-y-auto border-l xl:flex"
      style={{ borderColor: "hsl(var(--buttercupp-border))" }}
    >
      <PersonaPanelContent {...props} />
    </aside>
  );
}

// Mobile/tablet access: below `xl` the aside above is `hidden`, so this
// trigger (surfaced in the compact chat top-bar) opens the same body content
// in a right slide-over PanelSheet.
export function PersonaPanelMobileTrigger(props: PersonaPanelProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${props.name}'s gallery`}
        data-testid="persona-trigger"
        className="tap-target flex items-center justify-center rounded-md text-[hsl(var(--bc-fg))] xl:hidden"
      >
        <Images className="h-5 w-5" />
      </button>
      <PanelSheet side="right" open={open} onClose={() => setOpen(false)} label={props.name}>
        <PersonaPanelContent {...props} />
      </PanelSheet>
    </>
  );
}
