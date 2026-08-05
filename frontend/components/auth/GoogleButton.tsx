"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// GIS ("Sign in with Google") button that wires into the existing backend
// route /api/auth/oauth/google. Hides itself entirely when
// NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured so a visitor never sees a
// broken widget. The route mirrors the same check on the server; email +
// password signup keeps working when Google is not configured.

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

export interface GoogleButtonProps {
  dest?: string;
  mode?: "signin_with" | "signup_with";
}

export function GoogleButton({ dest = "/dashboard", mode = "signin_with" }: GoogleButtonProps) {
  const router = useRouter();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const buttonRef = React.useRef<HTMLDivElement>(null);
  const initedRef = React.useRef(false);

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

  React.useEffect(() => {
    if (!clientId || initedRef.current) return;
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

    (async () => {
      try {
        await loadScript();
        if (cancelled) return;
        const gid = window.google?.accounts?.id;
        if (!gid || !buttonRef.current) return;
        gid.initialize({
          client_id: clientId,
          callback: (r) => {
            void handleCredential(r.credential);
          },
        });
        gid.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode,
          shape: "rectangular",
          logo_alignment: "left",
          width: 320,
        });
        initedRef.current = true;
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
      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="google-button-disabled">
        Google sign-in is not configured on this environment.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2" data-testid="google-button">
      <div ref={buttonRef} className="min-h-[44px]" aria-label="Sign in with Google" />
      {status === "loading" ? (
        <p className="text-xs text-slate-500">Signing you in...</p>
      ) : null}
      {message ? <p className="text-xs text-red-600">{message}</p> : null}
    </div>
  );
}
