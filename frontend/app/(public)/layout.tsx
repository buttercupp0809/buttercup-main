import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";

// Public app shell: marketing header + site-wide footer. Server component;
// resolves the current user just to swap the right-side CTAs. Never blocks
// visitors: `requireAuth`/`requireAgeVerified` do not run here.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{
          borderColor: "hsl(var(--poppy-border))",
          backgroundColor: "hsl(var(--poppy-bg) / 0.75)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Poppy
          </Link>
          <nav className="flex flex-wrap items-center gap-2 text-sm sm:gap-4">
            <Link
              href="/gallery"
              className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Browse
            </Link>
            {user ? (
              <Link href="/dashboard">
                <Button className="h-9 rounded-full px-5">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/signup">
                  <Button className="h-9 rounded-full px-5">Create Free Account</Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="h-9 rounded-full px-5">
                    Login
                  </Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
