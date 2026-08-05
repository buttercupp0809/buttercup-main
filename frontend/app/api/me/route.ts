import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@poppy/database";
import { requireAuth, clearAuthCookie } from "@/lib/auth";
// clearAuthCookie takes the NextResponse; we pass it below.
import { jsonError } from "@/lib/api-helpers";
import { hashPassword, verifyPassword } from "@/lib/password";
import { deleteUserCascade } from "@/lib/account";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireAuth();
  return NextResponse.json({
    id: user.id,
    email: user.email,
    jurisdiction: user.jurisdiction,
    subscriptionTier: user.subscriptionTier,
    tokenBalance: user.tokenBalance,
    ageVerificationLevel: user.ageVerificationLevel,
    ageVerifiedAt: user.ageVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  });
}

const patchSchema = z.object({
  currentPassword: z.string().min(8).max(128).optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

export async function PATCH(req: Request) {
  const user = await requireAuth();
  let body;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return jsonError(400, "invalid_body");
  }
  if (body.newPassword) {
    if (!body.currentPassword) return jsonError(400, "current_password_required");
    if (!user.passwordHash) return jsonError(400, "password_not_set");
    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) return jsonError(401, "wrong_password");
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
  }
  await prisma.auditLog
    .create({
      data: {
        action: "account.update",
        userId: user.id,
        resource: `user:${user.id}`,
        metadata: { passwordChanged: Boolean(body.newPassword) },
      },
    })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await requireAuth();
  // Confirmation guard: the client must send { confirm: "DELETE" } as an
  // extra belt against accidental irreversible loss.
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") return jsonError(400, "confirmation_required");
  void req;
  const result = await deleteUserCascade(user.id);
  const res = NextResponse.json({ ok: true, ...result });
  clearAuthCookie(res);
  return res;
}
