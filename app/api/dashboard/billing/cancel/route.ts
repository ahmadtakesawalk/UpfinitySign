// DEPLOY TO: app/api/dashboard/billing/cancel/route.ts
// Self-serve plan cancellation. Schedules cancellation for the end of the
// current billing period (see cancelSubscription's doc comment in
// lib/billing/payment-provider.ts) — the actual downgrade to free happens
// later via the existing customer.subscription.deleted webhook path, not
// here. This route's only job is to actually reach Stripe/Paddle and start
// that, which nothing in the app did before this.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { getActivePaymentProvider } from "@/lib/billing/active-provider";
import { captureException } from "@/lib/monitoring";

export async function POST() {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can cancel the plan" }, { status: 403 });
  }

  const subscription = await prisma.subscription.findUnique({ where: { tenantId: user.tenantId } });
  if (!subscription?.externalCustomerId) {
    return NextResponse.json({ error: "No active paid subscription found for this workspace." }, { status: 400 });
  }

  try {
    const provider = await getActivePaymentProvider();
    await provider.cancelSubscription(subscription.externalCustomerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "billing_cancel", tenantId: user.tenantId });
    const message = err instanceof Error ? err.message : "Something went wrong cancelling your plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
