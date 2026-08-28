// POST /api/dashboard/signup — creates a Tenant + first owner TenantUser
// and signs them in. Previously the only path was scripts/create-first-
// tenant-user.js — not viable as the sole way to onboard for a real SaaS.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createTenantSession } from "@/lib/tenant-auth";
import { assertWithinLoginRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    try {
      await assertWithinLoginRateLimit(`signup:${ip}`);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json({ error: "Too many attempts — try again shortly." }, { status: 429 });
      }
      throw err;
    }

    const { companyName, email, password } = await req.json();

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
    }

    const name = companyName?.trim() || email.trim().split("@")[0]; // fall back to email prefix if no name given
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
    const owner = await prisma.tenantUser.create({
      data: { tenantId: tenant.id, email: email.trim().toLowerCase(), passwordHash: hashPassword(password), role: "owner" },
    });

    await createTenantSession(owner);

    sendEmail({
      to: owner.email,
      subject: `Welcome to Upfinity Sign, ${name}`,
      html: `<p>Your workspace is ready.</p><p>Workspace URL: <strong>${slug}</strong> — use this to sign in at ${config.appUrl}/dashboard/login.</p>`,
    }).catch((err) => captureException(err, { context: "signup_welcome_email", tenantId: tenant.id }));

    return NextResponse.json({ workspace: slug });
  } catch (err) {
    // This outer catch is the actual fix for a real failure mode: without
    // it, ANY unexpected error here (most likely: the database schema not
    // being fully pushed/synced against whatever DATABASE_URL production
    // actually uses — `prisma generate` only produces types, it never
    // touches the live database) escaped this handler completely
    // uncaught. The client then received a raw empty response body,
    // which is exactly what produces "Unexpected end of JSON input" —
    // not a bug in how the client parses JSON, but the server never
    // sending a body at all. Every path through this route must now
    // return real JSON, including ones nobody anticipated.
    await captureException(err, { context: "signup" });
    return NextResponse.json({ error: "Something went wrong creating your workspace. Please try again." }, { status: 500 });
  }
}
