import { getCurrentUser } from "@/lib/auth";
import { PublicHeader } from "@/components/marketing/PublicHeader";
import { Footer } from "@/components/Footer";

// Public app shell: marketing header + site-wide footer. Server component;
// resolves the current user just to swap the right-side CTAs. Never blocks
// visitors: `requireAuth`/`requireAgeVerified` do not run here.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader signedIn={Boolean(user)} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
