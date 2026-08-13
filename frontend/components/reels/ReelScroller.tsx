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

  if (items.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "hsl(var(--buttercupp-muted))" }}
      >
        No reels yet.
      </div>
    );
  }

  return (
    <div
      data-testid="reel-scroller"
      className="mx-auto h-full w-full max-w-[460px] snap-y snap-mandatory overflow-y-scroll overscroll-contain"
    >
      {items.map((item, i) => (
        <Reel key={item.id} item={item} index={i} muted={muted} onToggleMute={() => setMuted((m) => !m)} />
      ))}
    </div>
  );
}

function Reel({
  item,
  index,
  muted,
  onToggleMute,
}: {
  item: ReelItem;
  index: number;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const router = useRouter();
  const ref = React.useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = React.useState(false);
  const [liked, setLiked] = React.useState(item.liked);
  const [likes, setLikes] = React.useState(item.likes);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.6) {
          v.play().then(() => setPaused(false)).catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

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
    <div className="h-full w-full snap-start snap-always p-3">
      <div className="relative h-full w-full overflow-hidden rounded-3xl bg-black shadow-xl">
        <video
          ref={ref}
          src={item.src}
          muted={muted}
          loop
          playsInline
          preload={index < 2 ? "auto" : "metadata"}
          onClick={togglePlay}
          className="h-full w-full object-cover"
        />

        {/* Legibility scrim for the bottom overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 rounded-b-3xl bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        {/* Tap-to-play affordance */}
        {paused ? (
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
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/60"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>

        {/* Bottom-left: avatar + name/location + Chat Now.
            Wrapper is pointer-events-none so taps on empty space still
            play/pause the video; interactive children re-enable pointer events. */}
        <div className="pointer-events-none absolute inset-x-4 bottom-5 flex items-center gap-3 text-white">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-white/70 bg-black/50">
            {item.avatar ? (
              <img
                src={item.avatar}
                alt={item.name}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">
                {item.name[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="truncate font-display text-lg font-semibold leading-tight drop-shadow">
              {item.name}
            </span>
            <span className="truncate text-xs text-white/80 drop-shadow-sm">{item.location}</span>
          </div>
          <Link
            href={item.chatHref}
            className="pointer-events-auto ml-1 shrink-0 rounded-full border border-white/50 bg-white/10 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
          >
            Chat Now
          </Link>
        </div>

        {/* Right rail: like */}
        <div className="absolute bottom-24 right-3 flex flex-col items-center gap-1 text-white">
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? "Unlike" : "Like"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur transition hover:bg-black/55 active:scale-90"
          >
            <Heart
              className="h-7 w-7 transition"
              style={liked ? { color: "hsl(var(--buttercupp-accent-rose))", fill: "hsl(var(--buttercupp-accent-rose))" } : { color: "white" }}
            />
          </button>
          <span className="text-sm font-semibold drop-shadow">{likes.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
