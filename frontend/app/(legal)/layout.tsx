import Link from "next/link";
import { Footer } from "@/components/Footer";
import { BrandRow } from "@/components/brand/Logo";

// Public server layout for /legal/*. No requireAuth(); every legal page is
// readable by a logged-out visitor by design. Header carries a minimal
// "Back to ButterCupp" affordance so a user coming from a new-tab link can find
// their way home; the site-wide Footer is mounted at the bottom so the
// nested legal cross-links keep working.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--bc-bg))] text-[hsl(var(--bc-fg))]">
      <header className="sticky top-0 z-40 border-b border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-bg)/0.8)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-safe py-4">
          <Link
            href="/"
            className="bc-focus rounded-[var(--bc-radius-xs)] transition-opacity hover:opacity-90"
          >
            <BrandRow markSize={28} />
          </Link>
          <Link
            href="/"
            className="bc-focus inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--bc-border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--bc-muted))] transition-colors hover:border-[hsl(var(--bc-amber)/0.4)] hover:text-[hsl(var(--bc-amber))]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to ButterCupp
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
