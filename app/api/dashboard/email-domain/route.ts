// DEPLOY TO: app/api/dashboard/email-domain/route.ts
//
// Enterprise-only. Setting this field only records a REQUEST — it never
// verifies domain ownership by itself, and lib/email.ts refuses to send
// from it until customFromEmailVerifiedAt is set by a platform admin (see
// app/api/admin/tenants/[id]/verify-email/route.ts). This prevents a
// tenant from unilaterally spoofing an arbitrary "from" address.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (tenant.tier !== "enterprise") {
      return NextResponse.json({ error: "Custom sending domains are an Enterprise-tier feature." }, { status: 403 });
    }

    const formData = await req.formData();
    const fromEmail = (formData.get("fromEmail") as string)?.trim();
    if (!fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    // Changing the requested address always resets verification — a new
    // address is a new domain claim, not an edit of an already-verified one.
    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: { customFromEmail: fromEmail, customFromEmailVerifiedAt: null },
    });

    return NextResponse.redirect(new URL("/dashboard/settings", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "email_domain_update", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
