// DEPLOY TO: app/api/dashboard/templates/[id]/mark-reviewed/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

    await prisma.template.update({ where: { id }, data: { aiReviewedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "template_mark_reviewed", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
