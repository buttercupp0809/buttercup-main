"use client";

// Route-scoped error boundary for /chat/<characterId>. Without this, any
// render throw inside the chat page (server or client) tears down the entire
// tab and the user sees the raw Next.js error overlay in dev / a blank tab
// in prod, which is exactly the "chat is broken" symptom from
// Plans/cursor-prompt/35-major-fixes-batch.md #E.
//
// Keeping the fallback intentionally small: a reload button that re-invokes
// the route's data fetch via Next's `reset()` and a link to the chats index
// so the user is never truly stuck.

import * as React from "react";
import Link from "next/link";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Log to the console for local repro; a real client SDK (Sentry) is
    // already wired at the app shell, so we do not double-report here.
    // eslint-disable-next-line no-console
    console.error("[chat/error] boundary caught", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="max-w-md space-y-2">
        <h2 className="font-display text-lg font-semibold text-[hsl(var(--bc-fg))]">
          This chat could not open.
        </h2>
        <p className="text-sm text-[hsl(var(--bc-muted))]">
          Something went wrong while loading her messages. Reloading usually fixes it.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-[hsl(var(--bc-amber))] px-4 py-2 text-sm font-semibold text-[hsl(28_45%_9%)] hover:opacity-90"
        >
          Reload chat
        </button>
        <Link
          href="/chats"
          className="rounded-full border border-[hsl(var(--bc-border))] px-4 py-2 text-sm font-medium text-[hsl(var(--bc-fg))] hover:bg-[hsl(var(--bc-cream)/0.06)]"
        >
          Back to chats
        </Link>
      </div>
    </div>
  );
}
