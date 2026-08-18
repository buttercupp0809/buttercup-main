import Link from "next/link";
import { getLandingCharacters } from "@/lib/marketing";
import { getPublicReels } from "@/lib/reels/data";
import { Hero } from "@/components/marketing/Hero";
import { CompanionFeed } from "@/components/marketing/CompanionFeed";
import { BondStrip } from "@/components/marketing/BondStrip";
import { ReelsCarousel } from "@/components/marketing/ReelsCarousel";
import { TrustPromise } from "@/components/trust/TrustPromise";
import { Button } from "@/components/ui/button";

// Server component inside the (public) route group so it inherits the shared
// marketing header + footer. Live characters flow through getLandingCharacters
// which swallows errors: on an empty or unreachable DB the hero degrades to
// skeleton tiles instead of returning a 500.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ items, viewerAllowsMature }, reels] = await Promise.all([
    getLandingCharacters(),
    getPublicReels(24),
  ]);
  return (
    <>
      <Hero items={items} viewerAllowsMature={viewerAllowsMature} reels={reels} />
      <CompanionFeed items={items} reels={reels} viewerAllowsMature={viewerAllowsMature} />
      <BondStrip />
      {/*
        The feed wants reel metadata for the whole roster, but the carousel mounts
        a real <video> per item, so it gets a slice. Twenty-four autoplaying
        elements on one page is a mobile-data and decode budget we do not need.
      */}
      <ReelsCarousel reels={reels.slice(0, 12)} />
      <TrustPromise />

      <section className="mx-auto max-w-6xl px-6 px-safe pb-24 pt-8">
        <div className="bc-media relative isolate overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(38rem 22rem at 50% 0%, hsl(var(--bc-amber) / 0.16), transparent 70%)",
            }}
          />
          <h2 className="mx-auto max-w-[24ch] text-balance font-display text-[2rem] font-semibold leading-[1.02] tracking-[-0.03em] text-[hsl(var(--bc-cream))] sm:text-[3rem]">
            She is one message from knowing you.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-pretty text-[hsl(var(--bc-cream)/0.7)]">
            Free to start, 18+ only, and she speaks first.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="w-full sm:w-auto">
              <Button size="xl" variant="brand" className="w-full sm:w-auto">
                Start free
              </Button>
            </Link>
            <Link href="/gallery" className="w-full sm:w-auto">
              <Button size="xl" variant="outline" className="w-full sm:w-auto">
                Browse first
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
