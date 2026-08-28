// POST /api/v1/tenant/delete — requests deletion. Deliberately does NOT
// hard-delete on this call: signed legal documents may have retention
// obligations independent of the tenant's wishes (see PRD §6 retention
// policy), so this sets a grace-period marker. The purge job
// (lib/billing/retention-purge.ts, daily cron) acts on deletionRequestedAt
// after that period, checking retention requirements per envelope before
// removing anything. Suspending immediately (below) does stop all further use.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

const GRACE_PERIOD_DAYS = 30;

export async function POST(_req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can request deletion" }, { status: 403 });
  }

  try {
    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: { deletionRequestedAt: new Date(), suspended: true, suspensionReason: "deletion_requested" }, // suspend immediately, purge after grace period
    });

    return NextResponse.json({
      status: "deletion_requested",
      grace_period_days: GRACE_PERIOD_DAYS,
      note: "Your workspace is suspended immediately. Data will be purged after the grace period, subject to any document retention requirements — contact support to cancel this request in the meantime.",
    });
  } catch (err) {
    await captureException(err, { context: "tenant_delete_request", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
