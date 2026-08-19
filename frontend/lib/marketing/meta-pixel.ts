// Client-side Meta Pixel helpers. Safe to import anywhere; every call is
// guarded for SSR and for fbq not being loaded yet. The base pixel and PageView
// are installed in app/layout.tsx (afterInteractive), so by the time a user
// completes an in-app action like signup, fbq is normally already loaded; the
// retry below covers the rare race where an action fires before the script runs.

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export type MetaStandardEvent =
  | "PageView"
  | "Lead"
  | "CompleteRegistration"
  | "ViewContent"
  | "InitiateCheckout"
  | "AddPaymentInfo"
  | "Purchase"
  | "Subscribe";

const FBQ_MAX_ATTEMPTS = 25; // about 5s at 200ms, covers the afterInteractive load race
const FBQ_RETRY_MS = 200;
const DEBUG = process.env.NODE_ENV !== "production";

// One-shot kill flag: once we have exhausted retries waiting for fbq (ad blocker,
// CSP block, or a misconfigured pixel id), every later call short-circuits instead
// of burning 5s of timers before dropping.
let fbqLoadFailed = false;

/**
 * Fire a Meta standard event. Pass eventID to dedupe against a matching
 * server-side Conversions API event (Meta merges pixel plus CAPI events that
 * share an event name and eventID). If fbq is not defined yet, retry briefly
 * rather than dropping the event.
 */
export function metaTrack(
  event: MetaStandardEvent,
  data?: Record<string, unknown>,
  eventID?: string,
  attempt = 0,
): void {
  if (typeof window === "undefined") return;
  if (fbqLoadFailed) return;
  if (typeof window.fbq !== "function") {
    if (attempt >= FBQ_MAX_ATTEMPTS) {
      fbqLoadFailed = true;
      if (DEBUG) {
        console.warn(
          `[meta-pixel] fbq never ready, dropped "${event}" and disabling further calls`,
        );
      }
      return;
    }
    window.setTimeout(() => metaTrack(event, data, eventID, attempt + 1), FBQ_RETRY_MS);
    return;
  }
  try {
    if (eventID) {
      window.fbq("track", event, data ?? {}, { eventID });
    } else {
      window.fbq("track", event, data ?? {});
    }
    if (DEBUG) console.debug(`[meta-pixel] fired "${event}"`, { eventID, data });
  } catch (err) {
    if (DEBUG) console.warn(`[meta-pixel] track "${event}" threw`, err);
  }
}
