// DEPLOY TO: app/api/dashboard/templates/[id]/duplicate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const duplicate = await prisma.template.create({
      data: {
        tenantId: user.tenantId,
        name: `${existing.name} (copy)`,
        pdfStorageKey: existing.pdfStorageKey,
        fieldMap: existing.fieldMap as any,
      },
    });

    return NextResponse.json({ template_id: duplicate.id }, { status: 201 });
  } catch (err) {
    await captureException(err, { context: "template_duplicate", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong duplicating this template. Please try again." }, { status: 500 });
  }
}
