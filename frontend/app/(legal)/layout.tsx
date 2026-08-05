import Link from "next/link";
import { Footer } from "@/components/Footer";

// Public server layout for /legal/*. No requireAuth(); every legal page is
// readable by a logged-out visitor by design. Header carries a minimal
// "Back to ButterCupp" affordance so a user coming from a new-tab link can find
// their way home; the site-wide Footer is mounted at the bottom so the
// nested legal cross-links keep working.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            ButterCupp
          </Link>
          <Link
            href="/"
            className="text-xs text-slate-600 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white"
          >
            Back to ButterCupp
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
