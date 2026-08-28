// DEPLOY TO: app/api/admin/staff/route.ts
//
// super_admin only, both for listing and inviting — "support" and
// "billing_ops" staff can see plenty via the rest of /admin, but who has
// platform-admin access at all is exactly the kind of thing only
// super_admin should control. Mirrors the tenant team-invite pattern
// (app/api/dashboard/team/invite): create the row with no password,
// generate a reset token, email a set-password link.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

const TOKEN_TTL_HOURS = 72;
const VALID_ROLES = ["super_admin", "support", "billing_ops"];

export async function GET() {
  try {
    await requireRole(["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const staff = await prisma.platformAdmin.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, role: true, passwordHash: true, createdAt: true },
  });

  return NextResponse.json({
    staff: staff.map((s) => ({ id: s.id, email: s.email, role: s.role, created_at: s.createdAt, pending_setup: !s.passwordHash })),
  });
}

export async function POST(req: NextRequest) {
  let currentAdmin;
  try {
    currentAdmin = await requireRole(["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { email, role } = await req.json();
    if (!email?.trim()) return NextResponse.json({ error: "email is required" }, { status: 400 });
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const existing = await prisma.platformAdmin.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "This person already has platform admin access." }, { status: 409 });
    }

    const invited = await prisma.platformAdmin.create({ data: { email, role, passwordHash: null } });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
    await prisma.adminPasswordResetToken.create({ data: { platformAdminId: invited.id, tokenHash, expiresAt } });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    await logAdminAction(currentAdmin, "staff.invited", undefined, { invitedEmail: email, role }, ip);

    try {
      await sendEmail({
        to: email,
        subject: "You've been invited to Upfinity Sign platform admin",
        html: `<p>${currentAdmin.email} invited you as a platform admin (${role}).</p>
               <p><a href="${config.appUrl}/admin/set-password?token=${rawToken}">Accept invite & set your password</a></p>`,
      });
    } catch (err) {
      await captureException(err, { context: "admin_staff_invite_email", invitedEmail: email });
      // Row + token still exist even if the email didn't send — same
      // reasoning as the tenant team-invite route.
    }

    return NextResponse.json({ id: invited.id, email: invited.email, role: invited.role });
  } catch (err) {
    await captureException(err, { context: "admin_staff_invite" });
    return NextResponse.json({ error: "Something went wrong sending this invite. Please try again." }, { status: 500 });
  }
}
