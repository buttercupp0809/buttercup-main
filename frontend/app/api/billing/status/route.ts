// Server-truthful billing status. Proxies GET {BACKEND_URL}/billing/entitlements
// (the same resolver assertCanChat/assertCanConsumeMedia enforce against) and
// reads User.tokenBalance + User.subscriptionTier + Subscription.status via
// the prisma singleton. This route used to inline a STALE TIER_LIMITS map
// that had drifted from backend/src/subscription/plans.ts + limits.ts; that
// map is gone. The only numbers here are proxied from the backend or read
// from the DB columns the backend itself writes (grant.ts / webhooks/shared.ts),
// never a second hardcoded copy.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/constants";

export const runtime = "nodejs";

const quotaBucketSchema = z.object({
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
});

// Mirrors backend/src/subscription/entitlements.ts `Entitlements`. Parsed
// before use so an upstream shape drift fails loudly instead of silently
// passing through `unknown` fields to the client.
const entitlementsResponseSchema = z.object({
  plan: z.enum(["free", "daily", "weekly", "monthly"]),
  active: z.boolean(),
  expiresAt: z.string().nullable(),
  chats: quotaBucketSchema,
  images: quotaBucketSchema,
  videos: quotaBucketSchema,
  freeMessagesUsed: z.number(),
});

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function GET() {
  const user = await requireAuth();
  const jar = await cookies();
  const auth = jar.get(AUTH_COOKIE)?.value;

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/billing/entitlements`, {
      headers: auth ? { cookie: `${AUTH_COOKIE}=${encodeURIComponent(auth)}` } : {},
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "backend_unreachable", hint: "Start the backend: npm run dev:backend" },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "entitlements_unavailable" }, { status: 502 });
  }

  const parsed = entitlementsResponseSchema.safeParse(await upstream.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_upstream_shape" }, { status: 502 });
  }
  const ent = parsed.data;

  // User.subscriptionTier is the field backend/src/subscription/enforce.ts
  // itself reads for the voice/image/premiumModel feature gate
  // (enforceFeature via normalizeTier), including on downgrade (the webhook
  // resets it to "free" even though Subscription.tier is not always
  // touched). Reading the same column the enforcer reads keeps this route
  // truthful instead of drifting from a second, differently-updated copy.
  const sub = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { status: true },
  });
  const tier = user.subscriptionTier;

  return NextResponse.json({
    plan: ent.plan,
    tier,
    status: sub?.status ?? (ent.active ? "active" : "inactive"),
    currentPeriodEnd: ent.expiresAt,
    tokenBalance: user.tokenBalance,
    entitlements: {
      chats: ent.chats,
      images: ent.images,
      videos: ent.videos,
    },
    // Derived from the resolved tier only (voice/image gate on any paid
    // tier; premiumModel gates on "pro"), matching
    // backend/src/subscription/limits.ts TIER_LIMITS exactly. No quota or
    // price numbers are computed here.
    grants: {
      voice: tier !== "free",
      image: tier !== "free",
      premiumModel: tier === "pro",
    },
  });
}
