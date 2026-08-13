import { requireAuth } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { SideNav } from "@/components/app-shell/SideNav";
import { MobileNav, MobileBottomBar } from "@/components/app-shell/MobileNav";
import { ProfileMenu } from "@/components/app-shell/ProfileMenu";
import { PremiumPill } from "@/components/app-shell/PremiumPill";
import { ConsentGate } from "@/components/app-shell/ConsentGate";

// Dark cinematic in-app shell (PRD §2.3 + §1). The `.buttercupp-app` wrapper
// scopes the dark theme + rose/violet accents to authenticated surfaces so
// the marketing shell stays light. ConsentGate blocks access until the user
// has agreed to age + ToS + Privacy on first login; middleware has already
// checked the auth cookie.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const needsConsent =
    user.ageVerifiedAt === null ||
    user.ageVerificationLevel === "none" ||
    user.tosAcceptedAt === null ||
    user.privacyAcceptedAt === null;
  const recents = await listConversations(user.id, 6).catch(() => []);

  const profileUser = {
    email: user.email,
    displayName: null,
    avatarUrl: null,
    tier: user.subscriptionTier,
  };

  const shell = (
    // h-screen + overflow-hidden pins the whole app to the viewport so the
    // body never scrolls; scrolling is contained to <main> (long pages) or to
    // the internal panes of full-height pages like chat and reels.
    <div className="buttercupp-app flex h-screen overflow-hidden">
      <SideNav user={profileUser} recents={recents} />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="flex shrink-0 items-center justify-between border-b px-4 py-3 md:px-6"
          style={{ borderColor: "hsl(var(--buttercupp-border))" }}
        >
          <MobileNav user={profileUser} recents={recents} />
          <div className="ml-auto flex items-center gap-3">
            <PremiumPill />
            <ProfileMenu user={profileUser} collapsed placement="down" align="right" />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
        <MobileBottomBar />
      </div>
    </div>
  );

  return <ConsentGate needsConsent={needsConsent}>{shell}</ConsentGate>;
}
