// DEPLOY TO: app/api/dashboard/invoices/[id]/email/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { sendEmail } from "@/lib/email";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!invoice || !invoice.pdfStorageKey) return NextResponse.json({ error: "not found" }, { status: 404 });

    // The invoice is ALWAYS in the dashboard regardless of this action —
    // this only additionally sends a copy by email, it never becomes the
    // only place to find it.
    await sendEmail({
      to: user.email,
      subject: `Your Upfinity Sign receipt — ${invoice.description}`,
      html: `<p>Attached is your receipt for ${invoice.description} ($${(invoice.amountCents / 100).toFixed(2)} ${invoice.currency.toUpperCase()}).</p>
             <p><a href="${storage.url(invoice.pdfStorageKey)}">Download PDF</a></p>
             <p style="color:#888;font-size:12px;">This invoice is always available in Settings — Upfinity Sign.</p>`,
    }, { tenantId: user.tenantId });

    await prisma.invoice.update({ where: { id }, data: { emailedAt: new Date() } });

    return NextResponse.redirect(new URL("/dashboard/settings", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "invoice_email", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
