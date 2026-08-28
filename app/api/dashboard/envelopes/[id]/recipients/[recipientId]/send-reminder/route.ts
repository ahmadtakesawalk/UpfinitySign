// DEPLOY TO: app/api/dashboard/envelopes/[id]/recipients/[recipientId]/send-reminder/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { isRecipientUnlocked, sendReminderEmail } from "@/lib/signing/envelopes";
import { captureException } from "@/lib/monitoring";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; recipientId: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id, recipientId } = await params;
    const recipient = await prisma.recipient.findFirst({
      where: { id: recipientId, envelopeId: id, envelope: { tenantId: user.tenantId } },
      include: { envelope: { include: { template: true } } },
    });
    if (!recipient) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (["signed", "declined"].includes(recipient.status)) {
      return NextResponse.json({ error: "This recipient has already acted — nothing to remind them about." }, { status: 409 });
    }
    if (recipient.role === "cc") {
      return NextResponse.json({ error: "A CC recipient doesn't need reminding — they have no action to take." }, { status: 400 });
    }

    const gate = await isRecipientUnlocked(recipient.id);
    if (!gate.unlocked) {
      return NextResponse.json({ error: gate.reason ?? "This recipient isn't unlocked yet — someone earlier in the signing order needs to act first." }, { status: 409 });
    }

    const result = await sendReminderEmail(recipient.envelope, recipient, true);
    if (!result.sent) {
      return NextResponse.json({ error: result.error ?? "Couldn't send the reminder." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "manual_reminder_trigger", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
