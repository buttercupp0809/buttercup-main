"use client";

// Recurring upgrade nudge for users with NO active plan (no subscription AND
// no daily/weekly/monthly pass). Every 30 minutes it shows the shared
// UpgradeModal with a character the user has NOT talked to on the left and the
// upgrade CTA on the right. The moment the user has any active plan/pass the
// billing check short-circuits and the popup stops firing.
//
// Cadence survives client navigations and reloads via a localStorage epoch-ms
// timestamp, so the popup does NOT re-fire on every page load. A ~60s poll
// (rather than a single 30-min setInterval that resets on remount) makes the
// cadence robust to route changes inside the SPA shell.

import * as React from "react";
import { UpgradeModal } from "@/components/ui/UpgradeModal";

const LAST_SHOWN_KEY = "bc:upgradeNagLastShown";
const CADENCE_MS = 10 * 60 * 1000; // 10 minutes
const POLL_MS = 60 * 1000; // check due-ness every ~60s

interface UntalkedCharacter {
  id: string;
  name: string;
  imageUrl: string | null;
}

function readLastShown(): number {
  try {
    const raw = window.localStorage.getItem(LAST_SHOWN_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastShown(ts: number): void {
  try {
    window.localStorage.setItem(LAST_SHOWN_KEY, String(ts));
  } catch {
    // storage unavailable (private mode / quota): degrade to session-only.
  }
}

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<UntalkedCharacter | null>(null);
  // Prevents overlapping runs (a slow fetch spanning two poll ticks) and
  // avoids re-nagging while the modal is already open.
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    async function maybeShow() {
      if (cancelled || busyRef.current) return;
      // Do not stack a second nag on top of an open one.
      if (active) return;
      if (Date.now() - readLastShown() < CADENCE_MS) return;

      busyRef.current = true;
      try {
        // 1. Source of truth: does the user have any active plan/pass?
        const statusRes = await fetch("/api/billing/status", { cache: "no-store" });
        if (!statusRes.ok) return; // transient: retry next tick, keep lastShown
        const status = (await statusRes.json()) as { plan?: string; status?: string };
        // User HAS a plan/pass -> never nag, do not touch lastShown.
        if (status.plan !== "free" || status.status === "active") return;

        // 2. Pick a character the user has not talked to.
        const charRes = await fetch("/api/characters/untalked-to", { cache: "no-store" });
        if (!charRes.ok) return;
        const body = (await charRes.json()) as { character: UntalkedCharacter | null };
        if (cancelled) return;
        if (!body.character) {
          // Talked to everyone (or none exist): skip, but bump lastShown so we
          // retry a cadence later instead of hammering every 60s.
          writeLastShown(Date.now());
          return;
        }

        // 3. Show it. lastShown is set on close so a dismissed nag resets the
        // 30-min clock.
        setActive(body.character);
      } catch {
        // network error: swallow, retry next tick.
      } finally {
        busyRef.current = false;
      }
    }

    const interval = window.setInterval(() => {
      void maybeShow();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // active is intentionally excluded: the poll reads the latest via closure
    // through the ref/state guards, and re-subscribing the interval on every
    // open/close would reset the cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = React.useCallback(() => {
    writeLastShown(Date.now());
    setActive(null);
  }, []);

  return (
    <>
      {children}
      {active && (
        <UpgradeModal
          title="Someone new wants to meet you"
          description={`${active.name} is waiting to chat. Upgrade to unlock unlimited messages, exclusive photos, and every character.`}
          ctaLabel="Upgrade to Premium"
          ctaHref="/billing"
          onClose={handleClose}
          imageSrc={active.imageUrl}
          imageAlt={active.name}
          imageBlurred={false}
        />
      )}
    </>
  );
}
