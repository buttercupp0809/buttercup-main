// Fire-and-forget analytics writer. Mirrors Pellow's tracker.ts shape but
// uses the typed AnalyticsEventName union from @buttercupp/shared so a typo at
// the call site is a compile-time error, not a silent noop in production.

import { prisma } from "@buttercupp/database";
import type { Prisma } from "@buttercupp/database";
import type { AnalyticsEventName } from "@buttercupp/shared";

export function track(
  name: AnalyticsEventName,
  props: Record<string, unknown> = {},
  userId?: string | null,
): void {
  // fire-and-forget: analytics failures must never bubble into a request.
  void prisma.analyticsEvent
    .create({
      data: {
        name,
        userId: userId ?? undefined,
        props: props as Prisma.InputJsonValue,
      },
    })
    .catch(() => {
      // swallowed
    });
}
