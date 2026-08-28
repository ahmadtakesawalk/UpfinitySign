// DEPLOY TO: app/api/dashboard/login/lookup/route.ts
//
// Same email-to-workspace resolution logic the OAuth login callbacks
// already use (findMany by email, branch on count) — applied to password
// login too, so both paths behave consistently. Previously password
// login required typing the exact workspace slug upfront, unlike OAuth
// which already looks this up automatically. This closes that gap rather
// than leaving password login as the worse-UX path.
//
// Deliberately does NOT reveal whether an email exists at all if it
// matches zero tenants — same anti-enumeration posture as
// forgot-password. Only actual workspace names are shown once there's
// something real to disambiguate between.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const matches = await prisma.tenantUser.findMany({
      where: { email: email.trim().toLowerCase() },
      include: { tenant: { select: { slug: true, name: true, suspended: true } } },
    });

    const usable = matches.filter((m) => !m.tenant.suspended);

    if (usable.length === 0) {
      // Generic response — don't confirm or deny whether this email has
      // an account anywhere, same reasoning as forgot-password.
      return NextResponse.json({ workspaces: [] });
    }

    return NextResponse.json({
      workspaces: usable.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name })),
    });
  } catch (err) {
    await captureException(err, { context: "login_lookup" });
    return NextResponse.json({ workspaces: [] });
  }
}
