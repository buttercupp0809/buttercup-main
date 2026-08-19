"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { POLICY_VERSION } from "@/lib/consent";
import { ModalOverlay, ModalCard } from "@/components/ui/Modal";

interface Props {
  needsConsent: boolean;
  children: React.ReactNode;
}

export function ConsentGate({ needsConsent, children }: Props) {
  const router = useRouter();
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"accept" | "decline" | null>(null);

  if (!needsConsent) return <>{children}</>;

  // A single "I Agree" action stands in for all three consents at once: the
  // beautifully-written copy right above the button is what makes clear
  // *what* the user is agreeing to (18+, Terms, Privacy), so one affirmative
  // tap can honestly send all three fields as true together. The server DTO
  // (ConsentAcceptDto, packages/shared/src/dto/consent.ts) still requires
  // all three as z.literal(true) independently; this UI simply stops making
  // the user click three checkboxes to produce that same true/true/true.
  async function agree() {
    setBusy("accept");
    setErr(null);
    const res = await fetch("/api/consent/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        policyVersion: POLICY_VERSION,
        tosAccepted: true,
        privacyAccepted: true,
        ageConfirmed: true,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const code = body.error ?? "consent_failed";
      setErr(
        code === "stale_policy_version"
          ? "Our policies were updated. Please refresh and try again."
          : "Something went wrong. Please try again.",
      );
      setBusy(null);
      return;
    }
    // The server row is authoritative: re-render the (protected) layout so it
    // re-evaluates needsConsent(user) against the freshly written consent
    // and unmounts this gate. No client cookie is set or trusted here.
    router.refresh();
  }

  async function decline() {
    setBusy("decline");
    const res = await fetch("/api/consent/decline", { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { redirect?: string } | null;
    router.push(body?.redirect ?? "/login");
  }

  return (
    <>
      {/* App shell blurred underneath the gate */}
      <div className="pointer-events-none select-none blur-sm">{children}</div>

      {/* Fullscreen consent overlay. Non-dismissible: no close button, no
          click-outside-to-close, no escape-to-close. The only exits are
          Agree (proceed) and Decline (auto-logout). One prominent action
          replaces the old three-checkbox form: agreeing to the single
          "I Agree" action IS agreeing to all three things named in the copy
          right above it, so the request still sends all three fields true
          together (see agree() above). */}
      <ModalOverlay
        data-testid="consent-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="consent-heading"
        backdropOpacity={0.8}
        backdropBlur="lg"
      >
        <ModalCard size="md" className="p-8 sm:p-10">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full p-[1.5px]"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--bc-honey)), hsl(var(--bc-amber)))",
            }}
          >
            <div
              className="flex h-full w-full items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--bc-surface-2))" }}
            >
              <ShieldCheck className="h-6 w-6" style={{ color: "hsl(var(--bc-amber))" }} />
            </div>
          </div>

          <h1
            id="consent-heading"
            className="font-display mt-5 text-2xl font-semibold tracking-tight sm:text-[1.75rem]"
          >
            Before you continue
          </h1>

          <p className="mt-3 text-[0.95rem] leading-relaxed" style={{ color: "hsl(var(--bc-muted))" }}>
            ButterCupp is an 18+ platform for adult AI companionship. By selecting{" "}
            <span style={{ color: "hsl(var(--bc-fg))" }}>&ldquo;I Agree&rdquo;</span> below, you
            confirm you are at least 18 years old and accept our{" "}
            <a
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: "hsl(var(--bc-amber))" }}
            >
              Terms of Service
            </a>
            ,{" "}
            <a
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: "hsl(var(--bc-amber))" }}
            >
              Privacy Policy
            </a>
            , and{" "}
            <a
              href="/legal/cookie"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: "hsl(var(--bc-amber))" }}
            >
              Cookie Policy
            </a>
            . These govern how conversations, images, and payments work on ButterCupp.
          </p>

          {err ? (
            <p className="mt-4 text-sm" style={{ color: "hsl(var(--bc-danger))" }}>
              {err}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              data-testid="consent-decline"
              onClick={decline}
              disabled={busy !== null}
              className="rounded-lg border px-5 py-3 text-sm font-semibold transition hover:bg-[hsl(var(--bc-cream)/0.06)] disabled:opacity-50 sm:flex-1"
              style={{
                borderColor: "hsl(var(--bc-border))",
                color: "hsl(var(--bc-muted))",
              }}
            >
              {busy === "decline" ? "Signing out..." : "Decline"}
            </button>
            <button
              type="button"
              data-testid="consent-accept"
              onClick={agree}
              disabled={busy !== null}
              className="rounded-lg px-5 py-3 text-sm font-semibold text-[hsl(28_45%_9%)] transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 sm:flex-[1.4]"
              style={{
                background: "var(--bc-gradient-brand-v)",
                boxShadow: "0 10px 24px -6px hsl(var(--bc-amber) / 0.55)",
              }}
            >
              {busy === "accept" ? "Confirming..." : "I Agree, continue"}
            </button>
          </div>
        </ModalCard>
      </ModalOverlay>
    </>
  );
}
