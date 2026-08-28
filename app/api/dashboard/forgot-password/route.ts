// POST /api/dashboard/forgot-password
// Requires workspace + email, same reasoning as login (lib/tenant-auth.ts)
// — the same email can belong to a TenantUser row in more than one
// workspace, so the reset token is issued for exactly one specific row,
// not "whichever tenant matches this email first".

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";
import { assertWithinLoginRateLimit, RateLimitExceededError } from "@/lib/rate-limit";

const TOKEN_TTL_MINUTES = 30;

export async function POST(req: NextRequest) {
  try {
    const { workspace, email } = await req.json();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    try {
      await assertWithinLoginRateLimit(`reset:${ip}:${workspace}:${email}`);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        // Still the generic response, not a distinct error — rate-limit
        // hits shouldn't be distinguishable from "account doesn't exist" any
        // more than any other failure mode here (see the comment below).
        return NextResponse.json({ message: "If that account exists, a reset link has been sent." });
      }
      throw err;
    }

    // Always return the same response whether or not the account exists —
    // otherwise this endpoint becomes a way to enumerate valid workspace/email
    // combinations.
    const genericResponse = NextResponse.json({
      message: "If that account exists, a reset link has been sent.",
    });

    if (!workspace || !email) return genericResponse;

    try {
      const tenant = await prisma.tenant.findUnique({ where: { slug: workspace } });
      if (!tenant || tenant.suspended) return genericResponse;

      const user = await prisma.tenantUser.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email } },
      });
      if (!user) return genericResponse;

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

      await prisma.passwordResetToken.create({
        data: { tenantUserId: user.id, tokenHash, expiresAt },
      });

      const resetUrl = `${config.appUrl}/dashboard/reset-password?token=${rawToken}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your Upfinity Sign password",
        html: `<p>Someone requested a password reset for your ${tenant.name} workspace.</p>
               <p><a href="${resetUrl}">Reset your password</a> (expires in ${TOKEN_TTL_MINUTES} minutes)</p>
               <p style="color:#888;font-size:12px;">If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      await captureException(err, { context: "forgot_password" });
      // Still return the generic response — don't leak whether something
      // failed internally vs. the account simply not existing.
    }

    return genericResponse;
  } catch (err) {
    // Covers req.json() failing and the rate-limit re-throw above — both
    // were outside any catch before, so an unexpected failure there
    // (rather than an actual account-existence check) produced an empty
    // response body instead of even the generic message this route is
    // otherwise careful to always return.
    await captureException(err, { context: "forgot_password_outer" });
    return NextResponse.json({ message: "If that account exists, a reset link has been sent." });
  }
}
