// DEPLOY TO: app/api/sign/[token]/payment/start/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { isRecipientUnlocked } from "@/lib/signing/envelopes";
import { startFieldPayment } from "@/lib/signing/payment";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";
import type { FieldDefinition } from "@/lib/signing/field-types";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const recipient = await prisma.recipient.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { envelope: { include: { template: true } } },
  });
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });

  const gate = await isRecipientUnlocked(recipient.id);
  if (!gate.unlocked) {
    return NextResponse.json({ error: gate.reason ?? "This document isn't ready for you to act on yet" }, { status: 403 });
  }

  const { field_id } = await req.json();
  // Envelope's own field snapshot takes priority over the template's —
  // see the matching fix/comment in app/api/sign/[token]/route.ts.
  const fieldMap = (recipient.envelope.fieldMap ?? recipient.envelope.template.fieldMap) as unknown as FieldDefinition[];
  const field = fieldMap.find((f) => f.id === field_id);
  if (!field || field.type !== "payment" || !field.paymentConfig) {
    return NextResponse.json({ error: "That field isn't a payment field on this document." }, { status: 400 });
  }

  try {
    const { checkoutUrl } = await startFieldPayment({
      envelopeId: recipient.envelopeId,
      recipientId: recipient.id,
      fieldId: field.id,
      tenantId: recipient.envelope.tenantId,
      amountCents: field.paymentConfig.amountCents,
      currency: field.paymentConfig.currency,
      description: field.paymentConfig.description ?? field.paymentConfig.label,
      successUrl: `${config.appUrl}/sign/${token}?payment=success`,
      cancelUrl: `${config.appUrl}/sign/${token}?payment=cancelled`,
    });
    return NextResponse.json({ checkout_url: checkoutUrl });
  } catch (err) {
    await captureException(err, { context: "start_field_payment", envelopeId: recipient.envelopeId, fieldId: field.id });
    const message = err instanceof Error ? err.message : "Couldn't start payment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
