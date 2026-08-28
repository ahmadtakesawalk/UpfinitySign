// DEPLOY TO: app/api/admin/ledger/[id]/refund/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { refundInvoice } from "@/lib/billing/refund";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireRole(["super_admin", "billing_ops"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const formData = await req.formData();
  const reason = (formData.get("reason") as string)?.trim() ?? "";
  const ip = req.headers.get("x-forwarded-for") ?? undefined;

  try {
    const refund = await refundInvoice(id, reason);
    await logAdminAction(admin, "invoice.refunded", refund.tenantId, { originalInvoiceId: id, reason }, ip);
    return NextResponse.redirect(new URL("/admin/ledger", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "admin_refund", invoiceId: id });
    const message = err instanceof Error ? err.message : "Refund failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
