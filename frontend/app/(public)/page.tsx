import Link from "next/link";
import { getLandingCharacters } from "@/lib/marketing";
import { getPublicReels } from "@/lib/reels/data";
import { Hero } from "@/components/marketing/Hero";
import { ReelsCarousel } from "@/components/marketing/ReelsCarousel";
import { ValueProps } from "@/components/marketing/ValueProps";
import { SocialProof } from "@/components/marketing/SocialProof";
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
    getPublicReels(14),
  ]);
  return (
    <>
      <Hero items={items} viewerAllowsMature={viewerAllowsMature} />
      <ReelsCarousel reels={reels} />
      <ValueProps />
      <TrustPromise />
      <SocialProof />
      <section className="mx-auto max-w-4xl px-6 px-safe py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your companion is waiting.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
          Sign up in seconds. 18+ only. No pressure, no lectures.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="w-full sm:w-auto">
            <Button className="w-full px-6 py-6 text-base sm:w-auto">Create your companion</Button>
          </Link>
          <Link href="/gallery" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full px-6 py-6 text-base sm:w-auto">
              Browse
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}
