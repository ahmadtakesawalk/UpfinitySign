// DEPLOY TO: app/api/admin/set-password/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/admin-auth";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json();
    if (!token || !newPassword) {
      return NextResponse.json({ error: "token and newPassword are required" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resetToken = await prisma.adminPasswordResetToken.findUnique({ where: { tokenHash } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.platformAdmin.update({
        where: { id: resetToken.platformAdminId },
        data: { passwordHash: hashPassword(newPassword) },
      }),
      prisma.adminPasswordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "admin_set_password" });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
