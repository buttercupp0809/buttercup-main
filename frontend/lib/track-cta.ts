// Fire-and-forget CTA click tracker. Calls POST /analytics/cta on the
// backend. Never throws and never blocks the caller.

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export function trackCta(buttonId: string, area: string): void {
  void fetch(`${BACKEND_URL}/analytics/cta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ buttonId, area, path: window.location.pathname }),
  }).catch(() => {});
}
