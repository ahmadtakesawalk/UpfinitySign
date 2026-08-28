// DEPLOY TO: app/api/dashboard/invoices/[id]/pdf/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { captureException } from "@/lib/monitoring";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!invoice || !invoice.pdfStorageKey) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.redirect(storage.url(invoice.pdfStorageKey));
  } catch (err) {
    await captureException(err, { context: "invoice_pdf_download", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
