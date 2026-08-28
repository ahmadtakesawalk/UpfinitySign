// DEPLOY TO: app/api/dashboard/webhook-activity/[id]/retry/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { retryDeadLetter } from "@/lib/webhooks/dispatch";
import { captureException } from "@/lib/monitoring";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const deadLetter = await prisma.deadLetterWebhook.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!deadLetter) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (deadLetter.resolvedAt) return NextResponse.json({ error: "Already resolved." }, { status: 409 });

    const result = await retryDeadLetter(id);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    await captureException(err, { context: "webhook_dead_letter_retry", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
