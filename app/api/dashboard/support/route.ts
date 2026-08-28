// DEPLOY TO: app/api/dashboard/support/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const subject = (formData.get("subject") as string)?.trim();
    const body = (formData.get("body") as string)?.trim();
    const category = (formData.get("category") as string) === "refund" ? "refund" : "general";
    const invoiceId = (formData.get("invoiceId") as string)?.trim() || null;
    if (!subject || !body) {
      return NextResponse.json({ error: "Subject and message are required." }, { status: 400 });
    }
    if (invoiceId) {
      // Confirm the invoice is actually this tenant's own before linking it
      // — invoiceId arrives from a form field, not a trusted session value.
      const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId: user.tenantId } });
      if (!invoice) return NextResponse.json({ error: "That invoice wasn't found on your account." }, { status: 400 });
    }

    await prisma.supportMessage.create({
      data: { tenantId: user.tenantId, senderEmail: user.email, subject, body, category, invoiceId },
    });

    // Confirmation to the sender — "we'll get back to you" made concrete,
    // not just a toast that disappears.
    sendEmail({
      to: user.email,
      subject: category === "refund" ? `We got your refund request: ${subject}` : `We got your message: ${subject}`,
      html: `<p>Thanks for reaching out — we've received your ${category === "refund" ? "refund request" : "message"} and will get back to you soon.</p>
             <p style="color:#888;font-size:13px;">Your message: "${body.slice(0, 200)}${body.length > 200 ? "…" : ""}"</p>`,
    }, { tenantId: user.tenantId }).catch((err) => captureException(err, { context: "support_message_confirmation" }));

    return NextResponse.redirect(new URL("/dashboard/settings?message=sent", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "support_message_submit", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
