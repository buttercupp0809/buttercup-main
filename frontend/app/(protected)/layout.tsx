import { redirect } from "next/navigation";
import { prisma } from "@buttercupp/database";
import { requireEmailVerified } from "@/lib/auth";
import { needsConsent as computeNeedsConsent } from "@/lib/consent";
import { listConversations } from "@/lib/chats";
import { SideNav } from "@/components/app-shell/SideNav";
import { MobileNav, MobileBottomBar } from "@/components/app-shell/MobileNav";
import { ProfileMenu } from "@/components/app-shell/ProfileMenu";
import { PremiumPill } from "@/components/app-shell/PremiumPill";
import { ConsentGate } from "@/components/app-shell/ConsentGate";
import { isPaidTier } from "@buttercupp/shared";

// Dark cinematic in-app shell (PRD §2.3 + §1). The `.buttercupp-app` wrapper
// scopes the dark theme + rose/violet accents to authenticated surfaces so
// the marketing shell stays light. ConsentGate blocks access until the user
// has agreed to age + ToS + Privacy (versioned; see frontend/lib/consent.ts)
// on first login; middleware has already checked the auth cookie.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // Phase 34 Feature C: requireEmailVerified() calls requireAuth() internally
  // (single User row read) and hard-blocks unverified password signups before
  // the consent gate runs. Google OAuth users are exempt inside the helper.
  // Must precede ConsentGate so an unverified user cannot even see the
  // consent modal on top of the app shell; they get bounced to /verify-email.
  const user = await requireEmailVerified();
  // Server-authoritative: decided from the fresh User row on every protected
  // navigation, never trusted from a client cookie. See frontend/lib/consent.ts.
  const needsConsent = computeNeedsConsent(user);

  // Age-verified but not yet onboarded -> run the magical onboarding wizard
  // once. Order matters: consent (age + ToS + Privacy) is handled above by
  // ConsentGate first, THEN onboarding. /onboarding is its own route group
  // (not nested under (protected)), so this does not loop: the onboarding
  // layout has the inverse check (already-onboarded -> /dashboard).
  //
  // SignupForm.tsx and the age-gate page's client redirects intentionally
  // keep pushing "/dashboard" rather than "/onboarding": this layout gate is
  // the single source of truth for the post-auth destination, so an
  // un-onboarded user landing on /dashboard is simply bounced here instead
  // of duplicating this check in multiple client components.
  if (!needsConsent && user.completedOnboardingAt === null) {
    redirect("/onboarding");
  }

  const recents = await listConversations(user.id, 6).catch(() => []);

  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });

  const profileUser = {
    email: user.email,
    displayName: profile?.displayName ?? null,
    avatarUrl: null,
    tier: user.subscriptionTier,
  };

  const shell = (
    // h-dvh (not h-screen) + overflow-hidden pins the whole app to the
    // dynamic viewport so the mobile URL bar / on-screen keyboard collapsing
    // does not crop the bottom bar; body never scrolls, scrolling is
    // contained to <main> (long pages) or to the internal panes of full-height
    // pages like chat and reels.
    <div className="buttercupp-app flex h-dvh overflow-hidden">
      <SideNav user={profileUser} recents={recents} />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          // pb-2 on phones: with the notch inset added on top, pb-3 pushed this
          // chrome past 120px before any content appeared.
          className="flex shrink-0 items-center justify-between border-b pb-2 pt-[max(0.625rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] md:pb-3 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.75rem,env(safe-area-inset-right))] md:pt-[max(0.75rem,env(safe-area-inset-top))] lg:pr-[max(2.25rem,env(safe-area-inset-right))]"
          style={{ borderColor: "hsl(var(--buttercupp-border))" }}
        >
          <MobileNav user={profileUser} recents={recents} />
          <div className="ml-auto flex items-center gap-3">
            {/*
              Locked product decision (Plans/cursor-prompt/35-major-fixes-batch.md #G):
              the 70% OFF upsell pill is a conversion surface for free users
              only. Paid users (premium OR pro) already upgraded, so showing
              it to them is noise and looks like a bug. isPaidTier is display
              logic; billing capability gating still keys on the raw enum.
            */}
            {!isPaidTier(profileUser.tier) ? <PremiumPill /> : null}
            {/* Top-right user avatar + dropdown (account/subscription/sign
                out). Renders on every viewport: on mobile it sits next to the
                hamburger trigger, on desktop it mirrors the sidebar footer's
                ProfileMenu as a second, independently useful entry point (the
                sidebar can be collapsed or scrolled out of view). This is a
                distinct instance from the one in the sidebar footer AND the
                one inside MobileNav's drawer, so it carries its own testid;
                a previous fix mistakenly assumed this header instance was a
                mobile-only duplicate of the sidebar one and hid it behind
                `md:hidden`, which is what made the top-right icon disappear
                on desktop. Giving each instance a distinct trigger testid
                (instead of hiding one) fixes the duplicate-testid problem
                without removing the feature. */}
            <ProfileMenu
              user={profileUser}
              collapsed
              placement="down"
              align="right"
              triggerTestId="header-profile-menu-trigger"
              menuTestId="header-profile-menu"
            />
          </div>
        </header>
        {/* Bottom padding must clear the fixed MobileBottomBar (its own height
            plus the home-bar inset) or the last row of every scrolling page ends
            up permanently underneath it. */}
        <main className="min-h-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
        <MobileBottomBar />
      </div>
    </div>
  );

  return <ConsentGate needsConsent={needsConsent}>{shell}</ConsentGate>;
}
