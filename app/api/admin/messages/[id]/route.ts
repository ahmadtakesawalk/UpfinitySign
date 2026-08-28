// DEPLOY TO: app/api/admin/messages/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const message = await prisma.supportMessage.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date(), resolvedByAdminId: admin.id },
    });

    // The sender got a confirmation on submit ("we got your message") but
    // otherwise had no way to know it was actually answered — this closes
    // that loop rather than leaving them checking Settings indefinitely.
    sendEmail({
      to: message.senderEmail,
      subject: `Re: ${message.subject}`,
      html: `<p>Your message to Upfinity Sign support has been marked resolved. If you have any follow-up, just reply to this email or send a new message from Settings.</p>`,
    }, { tenantId: message.tenantId }).catch((err) => captureException(err, { context: "support_message_resolved_email" }));

    return NextResponse.redirect(new URL("/admin/messages", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "admin_message_resolve" });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
