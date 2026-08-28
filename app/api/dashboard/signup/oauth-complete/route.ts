// DEPLOY TO: app/api/dashboard/signup/oauth-complete/route.ts

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { createTenantSession, hashPassword } from "@/lib/tenant-auth";
import { verifyPendingProfile } from "@/lib/oauth";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export async function POST(req: NextRequest) {
  try {
    const { token, companyName } = await req.json();
    if (!token) {
      return NextResponse.json({ error: "Missing token." }, { status: 400 });
    }

    const profile = verifyPendingProfile(token);
    if (!profile) {
      return NextResponse.json({ error: "This link is invalid or has expired — start over from the signup page." }, { status: 400 });
    }

    const name = companyName?.trim() || profile.email.split("@")[0];

    // Re-check for a race: someone could have signed up with this email via
    // another path in the few minutes since the OAuth redirect.
    const existing = await prisma.tenantUser.findFirst({ where: { email: profile.email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists — sign in instead." }, { status: 409 });
    }

    const baseSlug = slugify(name) || "workspace";
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.tenant.findUnique({ where: { slug } })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 20) {
        return NextResponse.json({ error: "Couldn't generate a workspace URL — try a different company name." }, { status: 400 });
      }
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + config.trial.lengthDays);
    const tenant = await prisma.tenant.create({ data: { name, slug, trialEndsAt } });
    // OAuth-created accounts still get a passwordHash — never shown,
    // never usable (it's hashPassword() applied to random bytes, so no
    // password can ever match it) — so TenantUser.passwordHash can stay
    // non-nullable and every other code path that reads it doesn't need
    // an OAuth special case. This account signs in via /api/auth/google
    // or /api/auth/microsoft every time, never the password form. A bare
    // random string here (without hashPassword's salt:hash format) would
    // make login's verifyPassword() throw instead of just failing —
    // hashing it avoids that.
    const owner = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: profile.email,
        passwordHash: hashPassword(randomBytes(32).toString("hex")),
        role: "owner",
      },
    });

    await createTenantSession(owner);

    sendEmail({
      to: owner.email,
      subject: "Welcome to Upfinity Sign",
      html: `<p>Your workspace <strong>${name}</strong> is ready. You're signed in with your ${profile.provider === "google" ? "Google" : "Microsoft"} account.</p>`,
    }).catch((err) => captureException(err, { context: "oauth_signup_welcome_email" }));

    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "oauth_signup_complete" });
    return NextResponse.json({ error: "Something went wrong creating your workspace. Please try again." }, { status: 500 });
  }
}
