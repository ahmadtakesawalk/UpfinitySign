// POST /api/dashboard/team/invite
// Creates a TenantUser with no password yet, then issues a
// PasswordResetToken so the invite link and "forgot password" link land on
// the exact same page (app/dashboard/reset-password) — setting a first
// password and resetting one are the same operation from the user's side.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

const TOKEN_TTL_HOURS = 72; // invites get a longer window than a password reset — someone might not check email same-day

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentTenantUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(currentUser, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { email, role } = await req.json();
    if (!email?.trim()) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const validRoles = ["admin", "sender", "viewer"]; // deliberately excludes "owner" — ownership isn't grantable via invite, see below
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: currentUser.tenantId } });

    const existing = await prisma.tenantUser.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
    if (existing) {
      return NextResponse.json({ error: "This person is already on your team." }, { status: 409 });
    }

    const invitedUser = await prisma.tenantUser.create({
      data: { tenantId: tenant.id, email, role: role ?? "sender", passwordHash: null },
    });

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.passwordResetToken.create({ data: { tenantUserId: invitedUser.id, tokenHash, expiresAt } });

    try {
      await sendEmail({
        to: email,
        subject: `You've been invited to ${tenant.name} on Upfinity Sign`,
        html: `<p>${currentUser.email} invited you to join <strong>${tenant.name}</strong> on Upfinity Sign as ${invitedUser.role}.</p>
               <p><a href="${config.appUrl}/dashboard/reset-password?token=${rawToken}">Accept invite & set your password</a></p>
               <p style="color:#888;font-size:12px;">Workspace: ${tenant.slug} — you'll need this to sign in.</p>`,
      });
    } catch (err) {
      await captureException(err, { context: "team_invite_email", tenantId: tenant.id, invitedEmail: email });
      // Don't fail the whole request over email delivery — the user row and
      // token exist either way; the invite link can be manually shared if
      // the email genuinely didn't go out (e.g. dev fallback with no
      // provider configured — see lib/email.ts).
    }

    return NextResponse.json({ id: invitedUser.id, email: invitedUser.email, role: invitedUser.role });
  } catch (err) {
    await captureException(err, { context: "team_invite", tenantId: currentUser.tenantId });
    return NextResponse.json({ error: "Something went wrong sending this invite. Please try again." }, { status: 500 });
  }
}
