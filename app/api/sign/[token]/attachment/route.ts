// DEPLOY TO: app/api/sign/[token]/attachment/route.ts
//
// Public, token-authenticated (same pattern as the parent sign route) —
// lets a recipient upload a file for an "attachment"-type field while
// filling out an envelope. Separate from the main sign POST because file
// uploads are multipart/form-data, not JSON like the rest of the sign
// payload — the field's stored value ends up being the storage key
// returned here, not the file bytes themselves.

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { isRecipientUnlocked } from "@/lib/signing/envelopes";
import { logAuditEvent } from "@/lib/signing/audit";
import { captureException } from "@/lib/monitoring";
import type { FieldDefinition } from "@/lib/signing/field-types";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB — generous for the ID/receipt/etc use case, not a general file host

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accessTokenHash = hashToken(token);
  const recipient = await prisma.recipient.findUnique({
    where: { accessTokenHash },
    include: { envelope: { include: { template: true } } },
  });
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });
  if (recipient.role !== "signer") {
    return NextResponse.json({ error: "only a signer can upload an attachment" }, { status: 403 });
  }

  const gate = await isRecipientUnlocked(recipient.id);
  if (!gate.unlocked) {
    return NextResponse.json({ error: gate.reason ?? "This document isn't ready for you to act on yet" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const fieldId = formData.get("field_id") as string | null;
  if (!file || !fieldId) {
    return NextResponse.json({ error: "file and field_id are required" }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "That file is too large (15MB max)." }, { status: 413 });
  }

  // Envelope's own field snapshot takes priority over the template's —
  // see the matching fix/comment in app/api/sign/[token]/route.ts.
  const fieldMap = (recipient.envelope.fieldMap ?? recipient.envelope.template.fieldMap) as unknown as FieldDefinition[];
  const field = fieldMap.find((f) => f.id === fieldId);
  if (!field || field.type !== "attachment") {
    return NextResponse.json({ error: "That field isn't an attachment field on this document." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const key = `attachments/${recipient.envelopeId}/${recipient.id}/${fieldId}-${file.name}`;

  try {
    const stored = await storage.put(key, bytes, file.type || "application/octet-stream");
    return NextResponse.json({ key: stored.key, filename: file.name });
  } catch (err) {
    await captureException(err, { context: "attachment_upload", envelopeId: recipient.envelopeId, recipientId: recipient.id });
    await logAuditEvent(recipient.envelopeId, "attachment_upload_failed", recipient.id, {}, {
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "That file couldn't be uploaded — try again." }, { status: 500 });
  }
}
