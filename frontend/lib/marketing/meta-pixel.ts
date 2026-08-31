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

// Fallback USD prices per SKU when live pricing (from /billing/plans or
// /billing/token-packs) is not available at fire time. Kept in sync with
// backend/src/subscription/plan-limits.ts (PLAN_LIMITS.*.priceUsd) and
// backend/src/payments/webhooks/shared.ts (TOKEN_PACKS.*.priceUsd). If those
// change, update this map too so Meta receives the right conversion value.
const FALLBACK_PRICE_USD: Record<string, number> = {
  daily: 1,
  weekly: 6,
  monthly: 25,
  sub_monthly: 19.99,
  sub_yearly: 149,
  pack_100: 2,
  pack_500: 8,
  pack_2000: 25,
};

// Human labels sent as content_name so Meta Events Manager shows something
// legible instead of the raw SKU. Not user-facing copy.
const PURCHASE_LABEL: Record<string, string> = {
  daily: "Daily Pass",
  weekly: "Weekly Pass",
  monthly: "Monthly Pass",
  sub_monthly: "Monthly Subscription",
  sub_yearly: "Yearly Subscription",
  pack_100: "Token Pack 100",
  pack_500: "Token Pack 500",
  pack_2000: "Token Pack 2000",
};

export interface TrackPurchaseArgs {
  sku: string; // "daily" | "weekly" | "monthly" | "sub_monthly" | "sub_yearly" | "pack_*"
  valueUsd?: number; // preferred: live price from /billing/plans; falls back to FALLBACK_PRICE_USD
  currency?: string; // defaults "USD"
  eventID?: string; // optional dedupe id if you ever add server-side CAPI
}

/**
 * Fire the Meta Pixel "Purchase" (and, for recurring SKUs, "Subscribe") event
 * for a successful payment. Idempotent per browser session: repeated calls
 * with the same sku + eventID are no-ops so a page refresh on the billing
 * success URL never double-counts.
 */
export function trackPurchase(args: TrackPurchaseArgs): void {
  if (typeof window === "undefined") return;
  const sku = args.sku;
  const value =
    typeof args.valueUsd === "number" && args.valueUsd > 0
      ? args.valueUsd
      : FALLBACK_PRICE_USD[sku];
  if (typeof value !== "number" || value <= 0) {
    if (DEBUG) console.warn(`[meta-pixel] trackPurchase: no price for sku "${sku}"; skipping`);
    return;
  }
  const currency = args.currency ?? "USD";
  const dedupeKey = `bc:meta:purchase:${sku}:${args.eventID ?? "no-id"}`;
  try {
    if (window.sessionStorage.getItem(dedupeKey)) {
      if (DEBUG) console.debug(`[meta-pixel] trackPurchase deduped for "${sku}"`);
      return;
    }
    window.sessionStorage.setItem(dedupeKey, String(Date.now()));
  } catch {
    // sessionStorage can throw in private-browsing or strict mode; fall
    // through and still fire once (better a possible double than a miss).
  }
  const payload = {
    value,
    currency,
    content_ids: [sku],
    content_name: PURCHASE_LABEL[sku] ?? sku,
    content_type: "product",
  };
  metaTrack("Purchase", payload, args.eventID);
  // Fire "Subscribe" for EVERY paid SKU (passes, subscriptions, token
  // packs). Every one of these is a real conversion and lets subscription-
  // optimized campaigns in Meta Ads Manager bid on the full funnel, not
  // just the two recurring plans. Dedupe below piggybacks on the same
  // sessionStorage key so refreshes still fire each event only once.
  metaTrack("Subscribe", payload, args.eventID);
}
