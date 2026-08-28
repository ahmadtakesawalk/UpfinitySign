// DEPLOY TO: app/api/dashboard/change-password/route.ts
// Logged-in password change — requires the current password. This is
// deliberately separate from app/api/dashboard/reset-password (token-based,
// for logged-out/invited users): different threat model, different UX, no
// reason to force them through the same code path.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, hashPassword, verifyPassword } from "@/lib/tenant-auth";

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentTenantUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  if (!currentUser.passwordHash || !verifyPassword(currentPassword, currentUser.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  await prisma.tenantUser.update({
    where: { id: currentUser.id },
    data: { passwordHash: hashPassword(newPassword) },
  });

  return NextResponse.json({ ok: true });
}
