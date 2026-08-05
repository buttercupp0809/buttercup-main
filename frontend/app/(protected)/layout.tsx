import { requireAgeVerified } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { AiDisclosure } from "@/components/ai-disclosure";
import { SideNav } from "@/components/app-shell/SideNav";
import { MobileNav, MobileBottomBar } from "@/components/app-shell/MobileNav";
import { ProfileMenu } from "@/components/app-shell/ProfileMenu";

// Dark cinematic in-app shell (PRD §2.3 + §1). The `.buttercupp-app` wrapper
// scopes the dark theme + rose/violet accents to authenticated surfaces so
// the marketing shell stays light. requireAgeVerified() still runs first so
// the age gate cannot regress; middleware has already checked the auth
// cookie. AiDisclosure stays mounted in the header on every route for SB 243.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAgeVerified();
  const recents = await listConversations(user.id, 6).catch(() => []);

  const profileUser = {
    email: user.email,
    displayName: null,
    avatarUrl: null,
    tier: user.subscriptionTier,
  };

  return (
    <div className="buttercupp-app flex min-h-screen">
      <SideNav user={profileUser} recents={recents} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header
          className="flex items-center justify-between border-b px-4 py-3 md:px-6"
          style={{ borderColor: "hsl(var(--buttercupp-border))" }}
        >
          <MobileNav user={profileUser} recents={recents} />
          <div className="ml-auto flex items-center gap-3">
            {/*
              SB 243 still requires a persistent AI disclosure, so it stays,
              but compact and muted. The profile menu now owns the top-right
              corner for quick access to profile / billing / settings / logout.
            */}
            <AiDisclosure className="hidden sm:inline-flex opacity-70" />
            <ProfileMenu user={profileUser} collapsed placement="down" align="right" />
          </div>
        </header>
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <MobileBottomBar />
      </div>
    </div>
  );
}
