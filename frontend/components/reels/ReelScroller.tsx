"use client";

// Vertical, full-height reel viewer (TikTok / Instagram Reels style). A
// scroll-snap column of padded, rounded 9:16 videos; only the reel in view
// plays. Each reel overlays the persona name + location, a Chat Now button,
// and a like control that persists via POST /api/reels/:id/like.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Volume2, VolumeX, Play, Heart } from "lucide-react";

export interface ReelItem {
  id: string;
  src: string;
  name: string;
  location: string;
  avatar: string | null;
  chatHref: string;
  likes: number;
  liked: boolean;
}

export function ReelScroller({ items }: { items: ReelItem[] }) {
  const [muted, setMuted] = React.useState(true);
  // Which reel is centered in the viewport. The active reel and its immediate
  // neighbors (activeIndex -1, activeIndex, +1) mount a real <video>; every
  // other reel renders a same-size placeholder so scroll offsets and snap
  // points stay identical, but no far-away <video> is ever created. This keeps
  // a long feed from spinning up dozens of simultaneous media elements.
  const [activeIndex, setActiveIndex] = React.useState(0);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="buttercupp-glass relative w-full max-w-md overflow-hidden rounded-3xl p-8 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(24rem 16rem at 50% -10%, hsl(var(--bc-amber) / 0.2), transparent 60%)",
            }}
          />
          <div className="relative flex flex-col items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--bc-honey) / 0.2), hsl(var(--bc-amber) / 0.2))",
                color: "hsl(var(--bc-amber))",
              }}
            >
              <Play className="h-5 w-5" fill="currentColor" />
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              No reels yet
            </h2>
            <p className="text-sm" style={{ color: "hsl(var(--bc-muted))" }}>
              New reels drop as companions come online. Check back in a bit.
            </p>
            <Link
              href="/discover"
              className="mt-2 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-[hsl(28_45%_9%)] shadow-[0_8px_24px_-12px_hsl(var(--bc-amber)/0.55)] transition hover:brightness-110"
              style={{
                background: "var(--bc-gradient-brand-h)",
              }}
            >
              Browse companions
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="reel-scroller"
      className="mx-auto h-full w-full max-w-[460px] snap-y snap-mandatory overflow-y-scroll overscroll-contain [-webkit-overflow-scrolling:touch]"
    >
      {items.map((item, i) => (
        <Reel
          key={item.id}
          item={item}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          // A reel mounts a real <video> only inside the +/-1 window around
          // the active reel; the active one is the only one that autoplays.
          windowed={Math.abs(i - activeIndex) <= 1}
          active={i === activeIndex}
          onActivate={() => setActiveIndex(i)}
        />
      ))}
    </div>
  );
}

function Reel({
  item,
  muted,
  onToggleMute,
  windowed,
  active,
  onActivate,
}: {
  item: ReelItem;
  muted: boolean;
  onToggleMute: () => void;
  windowed: boolean;
  active: boolean;
  onActivate: () => void;
}) {
  const router = useRouter();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = React.useState(false);
  const [liked, setLiked] = React.useState(item.liked);
  const [likes, setLikes] = React.useState(item.likes);
  const [busy, setBusy] = React.useState(false);

  // Observe the stable wrapper (always mounted, fixed height) rather than the
  // <video>, which only exists inside the window. Crossing the 0.6 threshold
  // marks this reel active in the parent, which recomputes the +/-1 window.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.6) onActivate();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onActivate]);

  // Only the active reel plays; neighbors stay loaded but paused. This runs
  // whenever active flips or the <video> (re)mounts as the window slides.
  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.play().then(() => setPaused(false)).catch(() => {});
    } else {
      v.pause();
    }
  }, [active, windowed]);

  function togglePlay() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPaused(false)).catch(() => {});
    } else {
      v.pause();
      setPaused(true);
    }
  }

  async function toggleLike() {
    if (busy) return;
    // Optimistic update; revert if the request fails.
    const prevLiked = liked;
    const prevLikes = likes;
    const nextLiked = !prevLiked;
    setLiked(nextLiked);
    setLikes(prevLikes + (nextLiked ? 1 : -1));
    setBusy(true);
    try {
      const res = await fetch(`/api/reels/${item.id}/like`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.status === 401) {
        // Not signed in: revert and send them to login.
        setLiked(prevLiked);
        setLikes(prevLikes);
        router.push("/login?next=/reels");
        return;
      }
      if (!res.ok) throw new Error("like_failed");
      const body = (await res.json()) as { liked: boolean; count: number };
      setLiked(body.liked);
      setLikes(body.count);
    } catch {
      setLiked(prevLiked);
      setLikes(prevLikes);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="h-full w-full snap-start snap-always p-3">
      <div className="relative h-full w-full overflow-hidden rounded-3xl bg-black shadow-xl">
        {windowed ? (
          <video
            ref={ref}
            src={item.src}
            muted={muted}
            loop
            playsInline
            // Only the active reel eagerly buffers; neighbors fetch metadata so
            // they can start quickly once scrolled to.
            preload={active ? "auto" : "metadata"}
            poster={item.avatar ?? undefined}
            onClick={togglePlay}
            className="h-full w-full object-cover"
          />
        ) : (
          // Out-of-window placeholder: same footprint as the video (so scroll
          // position and snap points are preserved) but no <video> element.
          // Shows the avatar poster when available, otherwise a solid box.
          item.avatar ? (
            <img
              src={item.avatar}
              alt={item.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-black" aria-hidden />
          )
        )}

        {/* Legibility scrim for the bottom overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 rounded-b-3xl bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        {/* Tap-to-play affordance (only when a real video is mounted) */}
        {windowed && paused ? (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 backdrop-blur">
              <Play className="h-8 w-8 text-white" fill="white" />
            </span>
          </button>
        ) : null}

        {/* Mute toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="tap-target absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-black/60"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>

        {/* Bottom-left: avatar + name/location + Chat Now.
            Wrapper is pointer-events-none so taps on empty space still
            play/pause the video; interactive children re-enable pointer events. */}
        <div className="pointer-events-none absolute inset-x-4 bottom-5 flex items-center gap-3 pb-safe text-white">
          <div
            className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-black/50 ring-2"
            style={{ boxShadow: "0 4px 16px -6px hsl(var(--bc-amber) / 0.55)", borderColor: "transparent", outline: "none" }}
          >
            <div
              className="h-full w-full rounded-full p-[2px]"
              style={{
                background: "var(--bc-gradient-brand)",
              }}
            >
              <div className="h-full w-full overflow-hidden rounded-full bg-black">
                {item.avatar ? (
                  <img
                    src={item.avatar}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">
                    {item.name[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-display text-lg font-semibold leading-tight drop-shadow">
              {item.name}
            </span>
            <span className="truncate text-xs text-white/80 drop-shadow-sm">{item.location}</span>
          </div>
          <Link
            href={item.chatHref}
            className="tap-target pointer-events-auto ml-1 inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-[hsl(28_45%_9%)] shadow-[0_8px_24px_-12px_hsl(var(--bc-amber)/0.7)] ring-1 ring-[hsl(var(--bc-honey)/0.4)] transition-all duration-200 hover:scale-105 hover:brightness-110"
            style={{
              background: "var(--bc-gradient-brand-h)",
            }}
          >
            Chat Now
          </Link>
        </div>

        {/* Right rail: like */}
        <div className="absolute bottom-24 right-3 flex flex-col items-center gap-1 pb-safe text-white">
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? "Unlike" : "Like"}
            className="tap-target flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-md transition duration-200 hover:scale-110 hover:bg-black/60 active:scale-90"
            style={
              liked
                ? { boxShadow: "0 6px 22px -8px hsl(var(--bc-ember) / 0.7)" }
                : undefined
            }
          >
            <Heart
              className="h-7 w-7 transition"
              style={
                liked
                  ? {
                      color: "hsl(var(--bc-ember))",
                      fill: "hsl(var(--bc-ember))",
                    }
                  : { color: "white" }
              }
            />
          </button>
          <span className="text-sm font-semibold drop-shadow">{likes.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
