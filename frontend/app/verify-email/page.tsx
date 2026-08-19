// Phase 34 Feature C: the "check your inbox" screen. Lives OUTSIDE
// (protected) on purpose, because requireEmailVerified() in the protected
// layout is what routes an unverified user here; a nested (protected) render
// would ping-pong. If the user is already verified (e.g. clicked the link in
// another tab, then reloaded this one) we bounce them straight to /dashboard.
// Signed-out visitors go to /login so the resend button always has a
// user-scoped identity to act on.

import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { ResendVerificationButton } from "./ResendButton";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_COPY: Record<string, string> = {
  expired: "That link has expired. Send a fresh one below.",
  already_used: "That link was already used. If your account still needs verifying, resend below.",
  not_found: "We could not find that verification link.",
  invalid: "That link is not valid.",
};

export default async function VerifyEmailPage({ searchParams }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.emailVerifiedAt) redirect("/dashboard");

  const { error } = await searchParams;
  const errorMsg = error ? ERROR_COPY[error] ?? "Something went wrong. Please try again." : null;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
      style={{ backgroundColor: "hsl(var(--buttercupp-bg))", color: "hsl(var(--buttercupp-fg))" }}
    >
      <div className="mb-8">
        <a
          href="/"
          className="font-display text-2xl tracking-tight"
          style={{
            background: "linear-gradient(135deg, hsl(344 84% 71%), hsl(262 72% 68%))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          ButterCupp
        </a>
      </div>

      <section
        data-testid="verify-email-card"
        className="buttercupp-glass w-full rounded-2xl p-8"
        style={{ maxWidth: "26rem" }}
      >
        <div
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            background:
              "linear-gradient(135deg, hsl(344 84% 71% / 0.2), hsl(262 72% 68% / 0.2))",
            color: "hsl(var(--buttercupp-accent-rose))",
          }}
          aria-hidden
        >
          <MailCheck className="h-5 w-5" />
        </div>

        <h1
          className="font-display text-3xl font-semibold tracking-tight"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Verify your email
        </h1>
        <p
          className="mt-2 text-sm"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          We sent a verification link to{" "}
          <span className="font-medium" style={{ color: "hsl(var(--buttercupp-fg))" }}>
            {user.email}
          </span>
          . Click it to unlock the app. The link expires in 24 hours.
        </p>

        {errorMsg ? (
          <div
            role="alert"
            className="mt-5 rounded-xl border px-3.5 py-2.5 text-sm"
            style={{
              borderColor: "hsl(var(--buttercupp-accent-rose) / 0.5)",
              backgroundColor: "hsl(var(--buttercupp-accent-rose) / 0.08)",
              color: "hsl(var(--buttercupp-accent-rose))",
            }}
          >
            {errorMsg}
          </div>
        ) : null}

        <div className="mt-6">
          <ResendVerificationButton />
        </div>

        <p
          className="mt-6 text-xs"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          Wrong address or need to switch accounts?{" "}
          <a
            href="/logout"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Sign out
          </a>
          .
        </p>
      </section>
    </main>
  );
}
