"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandRow } from "@/components/brand/Logo";

/*
 * Marketing header.
 *
 * Two states, because one cannot serve both: over the hero portrait it has to be
 * invisible chrome (a scrim only, no bar, no border) or it cuts a band across
 * the face; over the feed it has to be an opaque surface or the nav sits
 * illegibly on top of card art. It swaps at the first scroll.
 */

export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  const [lifted, setLifted] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-30">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300 ease-[var(--ease-out)]"
        style={{
          opacity: lifted ? 0 : 1,
          background:
            "linear-gradient(to bottom, hsl(28 30% 4% / 0.85), hsl(28 30% 4% / 0.4) 60%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 border-b transition-opacity duration-300 ease-[var(--ease-out)]"
        style={{
          opacity: lifted ? 1 : 0,
          backgroundColor: "hsl(var(--bc-bg) / 0.82)",
          borderColor: "hsl(var(--bc-border))",
          backdropFilter: "blur(18px) saturate(1.15)",
        }}
      />
      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 px-safe py-3">
        <Link href="/" className="bc-press -m-1 rounded-lg p-1" aria-label="ButterCupp home">
          <BrandRow />
        </Link>
        <nav className="flex items-center gap-1.5 text-sm sm:gap-3">
          {/*
            Hidden on phones: logo + two buttons + this link overflow 390px and
            the nav wraps over the hero. The hero's own "See everyone" button
            covers the same destination on mobile.
          */}
          <Link
            href="/gallery"
            className="hidden rounded-md px-2.5 py-1.5 text-[hsl(var(--bc-cream)/0.72)] transition-colors duration-200 hover:bg-[hsl(var(--bc-cream)/0.08)] hover:text-[hsl(var(--bc-cream))] sm:block"
          >
            Browse
          </Link>
          {signedIn ? (
            <Link href="/dashboard">
              <Button className="h-9 rounded-full px-5">Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/signup">
                <Button className="h-9 rounded-full px-4 sm:px-5">
                  {/* Short label on phones: the full CTA wraps the nav to two rows. */}
                  <span className="sm:hidden">Get started</span>
                  <span className="hidden sm:inline">Create Free Account</span>
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="h-9 rounded-full px-4 sm:px-5">
                  Login
                </Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
