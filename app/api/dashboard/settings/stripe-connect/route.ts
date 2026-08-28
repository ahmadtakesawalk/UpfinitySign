// DEPLOY TO: app/api/dashboard/settings/stripe-connect/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { createConnectOnboardingLink } from "@/lib/signing/payment";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can connect payments" }, { status: 403 });
  }

  try {
    const url = await createConnectOnboardingLink(user.tenantId);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    await captureException(err, { context: "stripe_connect_onboarding_init", tenantId: user.tenantId });
    return NextResponse.json({ error: "Couldn't start Stripe onboarding — payments may not be configured on this platform yet." }, { status: 500 });
  }
}
