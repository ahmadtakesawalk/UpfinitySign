// DEPLOY TO: app/api/sign/[token]/route.ts
// GET/POST /api/sign/:token — public, token-authenticated (no login).
// This is what app/sign/[token]/page.tsx calls.

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashToken, markOpened, markSigned, markApproved, declineEnvelope, isRecipientUnlocked } from "@/lib/signing/envelopes";
import { logAuditEvent, requestContext } from "@/lib/signing/audit";
import { finalizeMultiDocumentPdf, type FilledField } from "@/lib/signing/pdf";
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
    include: { envelope: { include: { template: { include: { additionalDocuments: { orderBy: { order: "asc" } } } } } } },
  });
}

/**
 * Same document-list construction as GET's response — pulled out so POST
 * can resolve "which field_map am I validating this submission against"
 * without duplicating the primary-vs-additional-documents logic.
 */
function resolveDocuments(recipient: NonNullable<Awaited<ReturnType<typeof findRecipient>>>) {
  return [
    {
      name: recipient.envelope.template.name,
      pdfStorageKey: recipient.envelope.template.pdfStorageKey,
      fieldMap: (recipient.envelope.fieldMap ?? recipient.envelope.template.fieldMap) as unknown as FieldDefinition[],
    },
    ...recipient.envelope.template.additionalDocuments.map((d: (typeof recipient.envelope.template.additionalDocuments)[number]) => ({
      name: d.name,
      pdfStorageKey: d.pdfStorageKey,
      fieldMap: d.fieldMap as unknown as FieldDefinition[],
    })),
  ];
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

  const resolvedDocs = resolveDocuments(recipient);

  return NextResponse.json({
    locked: false,
    envelope_status: recipient.envelope.status,
    template_name: recipient.envelope.template.name,
    // Kept at the top level, unchanged, for backward compat with anything
    // still reading these directly — always mirrors documents[0].
    pdf_url: storage.url(resolvedDocs[0].pdfStorageKey),
    // Envelope's own field snapshot takes priority — falls back to the
    // template's fields for older envelopes created before fieldMap
    // existed on Envelope. Using template.fieldMap unconditionally here
    // was a real bug: it meant any field edits made via the envelope
    // field editor after send (lib/signing/envelopes.ts's
    // updateEnvelopeFields) never actually reached the signer — they'd
    // always see the template's original, unedited fields.
    field_map: resolvedDocs[0].fieldMap,
    // Multi-document — index 0 is always the primary document above,
    // duplicated here rather than left implicit so the sign page has one
    // consistent array to iterate regardless of document count. Indexes
    // 1+ come straight from TemplateDocument, read live (no per-envelope
    // snapshot) — same trade-off Quick Edit already made: blocked from
    // editing while any envelope is active (ACTIVE_ENVELOPE_STATUSES), so
    // this can't change out from under someone mid-signing.
    documents: resolvedDocs.map((d) => ({ name: d.name, pdf_url: storage.url(d.pdfStorageKey), field_map: d.fieldMap })),
    completed_document_indexes: recipient.completedDocumentIndexes,
    recipient: { name: recipient.name, email: recipient.email, role: recipient.role },
  });
}

interface SignBody {
  action: "sign" | "approve" | "decline";
  fields?: FilledField[];
  decline_reason?: string;
  geo?: Record<string, unknown>;
  // Which document this submission is for, on a multi-document envelope —
  // omitted (or 0) means "the only document" for a single-document
  // envelope, so existing clients that never send this keep working
  // exactly as before.
  document_index?: number;
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

  const resolvedDocs = resolveDocuments(recipient);
  const documentIndex = body.document_index ?? 0;
  if (documentIndex < 0 || documentIndex >= resolvedDocs.length) {
    return NextResponse.json({ error: "Invalid document_index for this envelope." }, { status: 400 });
  }
  if (recipient.completedDocumentIndexes.includes(documentIndex)) {
    return NextResponse.json({ error: "You've already completed this document." }, { status: 409 });
  }

  // Scoped to THIS document's own field map — validateSubmittedFields,
  // stripHiddenFieldValues, and recomputeFormulaFields were already
  // generic over whatever field map is passed in, so nothing about those
  // three needed to change for multi-document support, only what gets
  // passed to them.
  const docFieldMap = resolvedDocs[documentIndex].fieldMap;
  const finalFields = stripHiddenFieldValues(docFieldMap, recomputeFormulaFields(docFieldMap, body.fields));

  const validationError = await validateSubmittedFields(recipient.envelopeId, docFieldMap, finalFields);
  if (validationError) {
    await logAuditEvent(recipient.envelopeId, "signing_validation_failed", recipient.id, ctx, {
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      reason: validationError,
    });
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const newCompletedIndexes = [...recipient.completedDocumentIndexes, documentIndex];
  const isLastDocument = newCompletedIndexes.length === resolvedDocs.length;

  if (!isLastDocument) {
    // Not done yet — hold this document's values, record it as completed,
    // and tell the client which document to show next. No signature is
    // recorded, no envelope-completion check runs, nothing gets burned —
    // all of that only happens once every document is covered, below.
    const pending = { ...(recipient.pendingFieldValues as unknown as Record<string, unknown>), [String(documentIndex)]: finalFields };
    await prisma.recipient.update({
      where: { id: recipient.id },
      data: { completedDocumentIndexes: newCompletedIndexes, pendingFieldValues: pending as any },
    });
    const nextDocumentIndex = resolvedDocs.findIndex((_, i) => !newCompletedIndexes.includes(i));
    return NextResponse.json({
      status: "document_completed",
      document_index: documentIndex,
      next_document_index: nextDocumentIndex,
      total_documents: resolvedDocs.length,
    });
  }

  // Last document — record completedDocumentIndexes durably BEFORE the
  // riskier finalization work below, same "the recorded fact and the
  // best-effort follow-up are two separate steps" split markSigned/
  // finalization already use for the single-document case.
  await prisma.recipient.update({ where: { id: recipient.id }, data: { completedDocumentIndexes: newCompletedIndexes } });

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
      const pendingByIndex = recipient.pendingFieldValues as unknown as Record<string, FilledField[]>;
      const docsForBurn = await Promise.all(
        resolvedDocs.map(async (d, i) => ({
          pdfBytes: await storage.get(d.pdfStorageKey),
          // The document just submitted uses finalFields fresh off this
          // request; every earlier document for this recipient comes from
          // what got accumulated in pendingFieldValues along the way.
          fields: i === documentIndex ? finalFields : (pendingByIndex[String(i)] ?? []),
        }))
      );
      const signedPdf = await finalizeMultiDocumentPdf(docsForBurn);
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
