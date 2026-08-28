// GET/POST /api/sign/:token — public, token-authenticated (no login).
// This is what app/sign/[token]/page.tsx calls.

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashToken, markOpened, markSigned, markApproved, declineEnvelope, isRecipientUnlocked } from "@/lib/signing/envelopes";
import { logAuditEvent, requestContext } from "@/lib/signing/audit";
import { finalizePdf, type FilledField } from "@/lib/signing/pdf";
import { generateCertificate } from "@/lib/signing/certificate";
import { storage } from "@/lib/storage";
import { incrementUsage } from "@/lib/billing/metering";
import type { FieldDefinition } from "@/lib/signing/field-types";
import { isFieldVisible } from "@/lib/signing/field-types";
import { evaluateFormula, FormulaError } from "@/lib/signing/formula";
import { captureException } from "@/lib/monitoring";
import { isFieldPaid } from "@/lib/signing/payment";
import { buildNumericInputs } from "@/lib/signing/formula-inputs";

/**
 * Server-side field validation — checked against the TEMPLATE's field_map
 * by stable field id, not just against whatever the client submitted.
 * Client-side validation in the signer page is a UX convenience; this is
 * the real enforcement.
 */
async function validateSubmittedFields(envelopeId: string, templateFieldMap: FieldDefinition[], submitted: FilledField[]): Promise<string | null> {
  const submittedById = new Map(submitted.map((f) => [f.id, f]));
  const submittedValues = Object.fromEntries(submitted.map((f) => [f.id, f.value]));

  for (const def of templateFieldMap) {
    if (def.type === "note" || def.type === "formula") continue; // formula fields are recomputed, never validated against client input
    if (!isFieldVisible(def, submittedValues)) continue; // a conditionally hidden field is never required — and never validated against, regardless of what the client sent

    if (def.type === "payment") {
      // A payment field is never satisfied by a submitted string value —
      // "paid" is a fact this server verified independently via Stripe's
      // webhook (see lib/signing/payment.ts's isFieldPaid), not something
      // the client can just assert. Required or not, if it's on the
      // document, it must show as paid before signing completes.
      const paid = await isFieldPaid(envelopeId, def.id);
      if (!paid) {
        return `Payment required: ${def.paymentConfig?.label ?? "payment"} hasn't been completed yet.`;
      }
      continue;
    }

    const match = submittedById.get(def.id);
    const value = match?.value ?? "";

    if (def.required && !value) {
      return `Missing required field: ${def.customConfig?.label ?? def.type}`;
    }
    if (def.type === "custom" && def.customConfig?.pattern && value) {
      const re = new RegExp(def.customConfig.pattern);
      if (!re.test(value)) {
        return def.customConfig.patternErrorMessage ?? `Invalid value for field: ${def.customConfig.label}`;
      }
    }
  }
  return null;
}

/**
 * Strips out values for fields that aren't currently visible per their
 * visibleIf condition — defense in depth against a client that submits a
 * value for a field it was never shown (whether by tampering or a stale
 * payload). These never reach the burned PDF.
 */
function stripHiddenFieldValues(templateFieldMap: FieldDefinition[], submitted: FilledField[]): FilledField[] {
  const submittedValues = Object.fromEntries(submitted.map((f) => [f.id, f.value]));
  const visibleIds = new Set(
    templateFieldMap.filter((def) => isFieldVisible(def, submittedValues)).map((def) => def.id)
  );
  return submitted.filter((f) => visibleIds.has(f.id));
}

/**
 * Overwrites any formula field's submitted value with a server-recomputed
 * one — trusting the client's value would let anyone submit an arbitrary
 * total for a "quantity × price" field by editing the request body.
 */
function recomputeFormulaFields(templateFieldMap: FieldDefinition[], submitted: FilledField[]): FilledField[] {
  const valuesById = Object.fromEntries(submitted.map((f) => [f.id, f.value]));
  const numericInputs = buildNumericInputs(templateFieldMap, valuesById);

  const formulaDefs = templateFieldMap.filter((d) => d.type === "formula" && d.formulaConfig);
  const computed: Record<string, string> = {};
  for (const def of formulaDefs) {
    try {
      const inputs = { ...numericInputs, ...Object.fromEntries(Object.entries(computed).map(([k, v]) => [k, Number(v)])) };
      const result = evaluateFormula(def.formulaConfig!.expression, inputs);
      computed[def.id] = result.toFixed(def.formulaConfig!.decimalPlaces ?? 2);
    } catch (err) {
      computed[def.id] = "";
      if (!(err instanceof FormulaError)) throw err;
    }
  }

  return submitted.map((f) => (f.id in computed ? { ...f, value: computed[f.id] } : f));
}

async function findRecipient(token: string) {
  const accessTokenHash = hashToken(token);
  return prisma.recipient.findUnique({
    where: { accessTokenHash },
    include: { envelope: { include: { template: true } } },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const recipient = await findRecipient(token);
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });

  if (recipient.envelope.expiresAt && recipient.envelope.expiresAt < new Date()) {
    return NextResponse.json({ error: "this envelope has expired" }, { status: 410 });
  }

  // A recipient who already signed/approved/declined and reopens their
  // email link (or double-clicks the tab) should see a clean "already
  // done" screen, not be served the interactive form again — isRecipientUnlocked()
  // only checks PRIOR recipients in signingOrder, never this recipient's
  // own status, so that check alone doesn't catch this case.
  if (["signed", "approved", "declined"].includes(recipient.status)) {
    return NextResponse.json({
      already_acted: true,
      status: recipient.status,
      envelope_status: recipient.envelope.status,
      template_name: recipient.envelope.template.name,
      recipient: { name: recipient.name, email: recipient.email, role: recipient.role },
    });
  }

  const gate = await isRecipientUnlocked(recipient.id);
  if (!gate.unlocked) {
    return NextResponse.json({
      locked: true,
      reason: gate.reason,
      envelope_status: recipient.envelope.status,
      template_name: recipient.envelope.template.name,
      recipient: { name: recipient.name, role: recipient.role },
    });
  }

  // Email OTP gate — a second factor beyond just possessing the link (see
  // Recipient.otpCodeHash in schema.prisma). Checked after the signing-order
  // unlock gate above (no point emailing a code for a recipient who can't
  // act yet anyway) but before markOpened/audit-logging "opened" below —
  // the document isn't actually opened until this passes.
  if (!recipient.otpVerifiedAt) {
    return NextResponse.json({
      requires_otp: true,
      otp_sent: !!(recipient.otpExpiresAt && recipient.otpExpiresAt > new Date()),
      envelope_status: recipient.envelope.status,
      template_name: recipient.envelope.template.name,
      recipient: { name: recipient.name, email: recipient.email, role: recipient.role },
    });
  }

  if (recipient.status === "pending") {
    await markOpened(recipient.id);
    const ctx = requestContext(req);
    await logAuditEvent(recipient.envelopeId, "opened", recipient.id, ctx, { recipientName: recipient.name, recipientEmail: recipient.email });
  }

  return NextResponse.json({
    locked: false,
    envelope_status: recipient.envelope.status,
    template_name: recipient.envelope.template.name,
    pdf_url: storage.url(recipient.envelope.template.pdfStorageKey),
    // Envelope's own field snapshot takes priority — falls back to the
    // template's fields for older envelopes created before fieldMap
    // existed on Envelope. Using template.fieldMap unconditionally here
    // was a real bug: it meant any field edits made via the envelope
    // field editor after send (lib/signing/envelopes.ts's
    // updateEnvelopeFields) never actually reached the signer — they'd
    // always see the template's original, unedited fields.
    field_map: recipient.envelope.fieldMap ?? recipient.envelope.template.fieldMap,
    recipient: { name: recipient.name, email: recipient.email, role: recipient.role },
  });
}

interface SignBody {
  action: "sign" | "approve" | "decline";
  fields?: FilledField[];
  decline_reason?: string;
  geo?: Record<string, unknown>;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const recipient = await findRecipient(token);
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });

  // Same already-acted check as GET, but checked FIRST here — the decline
  // branch below previously ran before any gate at all, so a recipient
  // could decline a second time (or decline after already signing) with
  // no server-side check stopping them.
  if (["signed", "approved", "declined"].includes(recipient.status)) {
    return NextResponse.json({ error: `You've already ${recipient.status} this document.` }, { status: 409 });
  }

  const body = (await req.json()) as SignBody;
  const ctx = requestContext(req);

  if (body.action === "decline") {
    await declineEnvelope(recipient.id, body.decline_reason ?? "No reason provided");
    return NextResponse.json({ status: "declined" });
  }

  const gate = await isRecipientUnlocked(recipient.id);
  if (!gate.unlocked) {
    return NextResponse.json({ error: gate.reason ?? "This document isn't ready for you to act on yet" }, { status: 403 });
  }

  if (body.action === "approve") {
    if (recipient.role !== "approver") {
      return NextResponse.json({ error: "only an approver can approve — this recipient is a " + recipient.role }, { status: 403 });
    }
    const updated = await markApproved(recipient.id);
    return NextResponse.json({ status: updated.status });
  }

  if (recipient.role !== "signer") {
    return NextResponse.json({ error: `a ${recipient.role} cannot sign — use the approve action instead` }, { status: 403 });
  }

  if (!body.fields?.length) {
    return NextResponse.json({ error: "fields are required to sign" }, { status: 400 });
  }

  // Same envelope-first fallback as GET — see the comment there. This is
  // the copy of the field layout actually used to validate and finalize
  // what the signer submits, so it must match what they were shown.
  const templateFieldMap = (recipient.envelope.fieldMap ?? recipient.envelope.template.fieldMap) as unknown as FieldDefinition[];
  const finalFields = stripHiddenFieldValues(templateFieldMap, recomputeFormulaFields(templateFieldMap, body.fields));

  const validationError = await validateSubmittedFields(recipient.envelopeId, templateFieldMap, finalFields);
  if (validationError) {
    await logAuditEvent(recipient.envelopeId, "signing_validation_failed", recipient.id, ctx, {
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      reason: validationError,
    });
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const updated = await markSigned(recipient.id, ctx.ipAddress, body.geo);

  const refreshedEnvelope = await prisma.envelope.findUniqueOrThrow({
    where: { id: recipient.envelopeId },
    include: { template: true },
  });

  if (refreshedEnvelope.status === "completed") {
    // Everything from here on is POST-signature — the recipient's actual
    // signature is already durably recorded by markSigned() above. If
    // finalization fails, that must never surface as "your signature
    // didn't go through" (it did), and it must never fail silently either
    // — previously this whole block had no try/catch at all, so a storage
    // or PDF-generation failure here became a raw unhandled 500 with zero
    // audit trail, leaving a signed-but-never-finalized envelope that no
    // one would know to go fix.
    try {
      const pdfBytes = await storage.get(refreshedEnvelope.template.pdfStorageKey);
      const signedPdf = await finalizePdf(pdfBytes, finalFields);
      const key = `signed/${refreshedEnvelope.tenantId}/${refreshedEnvelope.id}.pdf`;
      const stored = await storage.put(key, signedPdf, "application/pdf");
      await prisma.envelope.update({
        where: { id: refreshedEnvelope.id },
        data: { signedPdfStorageKey: stored.key },
      });
      await generateCertificate(refreshedEnvelope.id);
    } catch (err) {
      await captureException(err, { context: "post_signature_finalization", envelopeId: refreshedEnvelope.id, recipientId: recipient.id });
      await logAuditEvent(refreshedEnvelope.id, "finalization_failed", recipient.id, ctx, {
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        reason: err instanceof Error ? err.message : String(err),
      });
      // Signature is recorded — tell the truth about that, and be honest
      // that something needs manual attention rather than implying the
      // signature itself failed.
      return NextResponse.json({
        status: updated.status,
        warning: "Your signature was recorded, but we hit an issue preparing the final document. Our team has been notified — you don't need to sign again.",
      });
    }
  }

  await incrementUsage(refreshedEnvelope.tenantId, "api_calls");

  // certificate_ready only true once this WAS the completing action and
  // generateCertificate() above actually succeeded — envelope_id is safe to
  // return here (unlike GET, which never exposes it pre-signature) since
  // this recipient has just authenticated via their own token and acted.
  return NextResponse.json({
    status: updated.status,
    envelope_id: refreshedEnvelope.id,
    certificate_ready: refreshedEnvelope.status === "completed",
  });
}
