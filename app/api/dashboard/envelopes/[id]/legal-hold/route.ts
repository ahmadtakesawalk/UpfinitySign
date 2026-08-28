// DEPLOY TO: app/api/dashboard/envelopes/[id]/legal-hold/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/signing/audit";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const envelope = await prisma.envelope.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!envelope) return NextResponse.json({ error: "not found" }, { status: 404 });

    const next = !envelope.legalHold;
    await prisma.envelope.update({ where: { id }, data: { legalHold: next } });
    await logAuditEvent(id, next ? "legal_hold_placed" : "legal_hold_released", undefined, {}, {});

    return NextResponse.json({ legal_hold: next });
  } catch (err) {
    await captureException(err, { context: "envelope_legal_hold", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
