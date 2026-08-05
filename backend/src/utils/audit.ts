// Fire-and-forget audit writer. Ported shape-for-shape from
// ../Pellow/backend/src/utils/audit.ts. Never throws, never blocks the request
// path. Do NOT put raw passwords, tokens, or PII (beyond userId) in metadata.
// AuditLog rows have no FK to User so they survive account deletion.

import type http from "node:http";
import type { Prisma } from "@poppy/database";
import { prisma } from "@poppy/database";

export interface AuditParams {
  action: string;
  userId?: string | null;
  actorId?: string | null;
  resource?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditContext {
  ip: string | null;
  userAgent: string | null;
}

// Extract client IP + User-Agent from a Node HTTP request. Trusts the first
// entry of X-Forwarded-For only when a proxy sets it; the ALB/CloudFront in
// prod is the only trusted upstream in that regard.
export function auditContext(req: http.IncomingMessage): AuditContext {
  const fwd = req.headers["x-forwarded-for"];
  const forwardedIp =
    typeof fwd === "string" ? fwd.split(",")[0]?.trim() ?? null : null;
  const ip = forwardedIp ?? req.socket?.remoteAddress ?? null;
  const ua = req.headers["user-agent"];
  return { ip, userAgent: typeof ua === "string" ? ua : null };
}

export function writeAuditLog(params: AuditParams): void {
  try {
    void prisma.auditLog
      .create({
        data: {
          action: params.action,
          userId: params.userId ?? null,
          actorId: params.actorId ?? null,
          resource: params.resource ?? null,
          metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: params.ip ?? null,
          userAgent: params.userAgent ?? null,
        },
      })
      .catch(() => {
        // swallowed on purpose. Audit failure never breaks a request.
      });
  } catch {
    // Never let audit logging break the request path.
  }
}
