"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// GIS ("Sign in with Google") button.
//
// Design: Google's Identity Services library ONLY exposes credentials through
// its own rendered widget, and Google's branding guidelines require the "G"
// mark + a Google-recognizable button. But the widget itself does not fit a
// dark, gradient-CTA aesthetic. So this component renders BOTH:
//   1. Our own visually-styled button (matches the auth card, sits in-flow).
//   2. Google's official widget, absolutely positioned on top with
//      opacity: 0.001 so it is visually invisible but still hit-testable.
// Real clicks land on Google's widget (fully compliant with their ToS),
// visual pixels are ours. We ResizeObserver our container so the invisible
// Google button always matches width exactly, and re-renders it if the
// container width changes (responsive layout).
//
// The component hides itself entirely when NEXT_PUBLIC_GOOGLE_CLIENT_ID is
// not configured so a visitor never sees a broken widget. The route mirrors
// the same check on the server; email + password signup keeps working when
// Google is not configured.

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (opts: {
            client_id: string;
            callback: (r: { credential: string }) => void;
            ux_mode?: "popup" | "redirect";
            auto_select?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GIS_SCRIPT = "https://accounts.google.com/gsi/client";

// Google's renderButton clamps width to [200, 400]. Our card is ~320px wide
// on mobile and up to ~416px on desktop; we clamp to the same bounds so the
// invisible hit area always covers our visible button.
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export interface GoogleButtonProps {
  dest?: string;
  mode?: "signin_with" | "signup_with";
}

export function GoogleButton({ dest = "/dashboard", mode = "signin_with" }: GoogleButtonProps) {
  const router = useRouter();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const hiddenRef = React.useRef<HTMLDivElement>(null);
  const initedRef = React.useRef(false);
  const lastWidthRef = React.useRef(0);

  const handleCredential = React.useCallback(
    async (credential: string) => {
      setStatus("loading");
      setMessage(null);
      const res = await fetch("/api/auth/oauth/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: credential }),
      });
      if (res.status === 501) {
        setStatus("error");
        setMessage("Google sign-in is not available right now.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setMessage("Google sign-in failed. Try email/password.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { needsAgeGate?: boolean };
      router.push(body.needsAgeGate ? "/age-gate" : dest);
    },
    [router, dest],
  );

  // Load GIS + initialize + render the invisible Google widget. We only
  // initialize once, but re-render the button when the container width
  // changes so the hit area stays aligned.
  React.useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    async function loadScript(): Promise<void> {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") return;
        await new Promise<void>((resolve) => {
          existing.addEventListener("load", () => resolve(), { once: true });
        });
        return;
      }
      const s = document.createElement("script");
      s.src = GIS_SCRIPT;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
      await new Promise<void>((resolve, reject) => {
        s.addEventListener("load", () => {
          s.dataset.loaded = "true";
          resolve();
        });
        s.addEventListener("error", () => reject(new Error("gis_script_failed")));
      });
    }

    function renderNow(): void {
      const gid = window.google?.accounts?.id;
      const el = hiddenRef.current;
      const wrapper = wrapperRef.current;
      if (!gid || !el || !wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(rect.width) || 320));
      if (width === lastWidthRef.current) return;
      lastWidthRef.current = width;

      if (!initedRef.current) {
        gid.initialize({
          client_id: clientId as string,
          callback: (r) => {
            void handleCredential(r.credential);
          },
        });
        initedRef.current = true;
      }

      // Wipe and re-render (Google's widget doesn't expose a resize API).
      el.innerHTML = "";
      gid.renderButton(el, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: mode,
        shape: "pill",
        logo_alignment: "left",
        width,
      });
      setReady(true);
    }

    (async () => {
      try {
        await loadScript();
        if (cancelled) return;
        renderNow();

        // Re-render on container resize so the invisible Google button
        // always covers our visible button.
        const ro = new ResizeObserver(() => renderNow());
        if (wrapperRef.current) ro.observe(wrapperRef.current);
        return () => ro.disconnect();
      } catch {
        setStatus("error");
        setMessage("Google sign-in failed to load.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, handleCredential, mode]);

  if (!clientId) {
    return (
      <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }} data-testid="google-button-disabled">
        Google sign-in is not configured on this environment.
      </p>
    );
  }

  const label = mode === "signup_with" ? "Sign up with Google" : "Continue with Google";

  return (
    <div className="flex flex-col items-stretch gap-2" data-testid="google-button">
      <div
        ref={wrapperRef}
        className="relative w-full"
        // Keep hit area >= 44px tall to match the visible button.
        style={{ minHeight: 48 }}
      >
        {/* Our visually-styled button. Purely presentational: pointer-events
            are off so real clicks pass through to the Google widget layered
            on top (transparent via opacity). This satisfies Google's ToS
            (their branded button is what actually receives the click). */}
        <div
          aria-hidden
          className={`pointer-events-none flex h-12 w-full items-center justify-center gap-3 rounded-full border transition-all duration-200 ${
            ready ? "opacity-100" : "opacity-70"
          }`}
          style={{
            borderColor: "hsl(var(--bc-border))",
            background:
              "linear-gradient(180deg, hsl(var(--bc-surface-2)), hsl(var(--bc-surface)))",
            boxShadow:
              "inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 2px rgb(0 0 0 / 0.3)",
          }}
        >
          <GoogleGlyph />
          <span className="text-sm font-semibold" style={{ color: "hsl(var(--bc-fg))" }}>{label}</span>
        </div>

        {/* Google's real widget. Absolutely positioned to fully cover our
            visible button. opacity 0.001 keeps it hit-testable and screen-
            reader visible while being visually invisible. Any hover /
            focus-visible styling from Google is masked by our layer. */}
        <div
          ref={hiddenRef}
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: 0.001 }}
          aria-label={label}
        />
      </div>
      {status === "loading" ? (
        <p className="text-xs" style={{ color: "hsl(var(--bc-muted))" }}>
          Signing you in...
        </p>
      ) : null}
      {message ? <p className="text-xs" style={{ color: "hsl(var(--bc-danger))" }}>{message}</p> : null}
    </div>
  );
}

// Official Google "G" glyph. Vector, so no external asset request and no
// mismatch between light/dark themes.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
