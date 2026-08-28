// DEPLOY TO: lib/signing/envelopes.ts
// Envelope lifecycle management — the core of the product. See PRD.md §5/§11.

import { randomBytes, createHash } from "crypto";
import { prisma } from "../db";
import { config } from "../config";
import { logAuditEvent } from "./audit";
import { incrementUsage, assertWithinTierLimit } from "../billing/metering";
import { dispatchWebhook } from "../webhooks/dispatch";
import { sendEmail, emailForRole } from "../email";
import { captureException } from "../monitoring";
import { encryptToken, decryptToken } from "../token-crypto";
import { upsertContacts } from "./contacts";
import type { RecipientRole } from "@prisma/client";

// Envelope statuses that are still "in flight" — nothing has locked the
// document yet (no signature completed, nobody declined/voided it, it
// hasn't expired). Shared between the expiry sweep and field editing so
// the two can't drift out of sync with each other: an envelope's fields
// stay editable and resendable for exactly as long as it's still eligible
// to expire, and become locked the moment it reaches a terminal state.
export const ACTIVE_ENVELOPE_STATUSES = ["sent", "delivered", "opened"] as const;

/**
 * Sends the initial notification to any recipient who is now unlocked but
 * hasn't been notified yet (still "pending" with no prior email sent).
 * Called after any markApproved/markSigned/declineEnvelope transition, so
 * the next person in signingOrder gets emailed the moment it's actually
 * their turn — not before, and not left waiting after their turn arrives.
 */
export async function notifyUnlockedRecipients(envelopeId: string) {
  const envelope = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { template: true, recipients: { where: { status: "pending" } } },
  });

  for (const recipient of envelope.recipients) {
    const gate = await isRecipientUnlocked(recipient.id);
    if (!gate.unlocked || !recipient.accessTokenEncrypted) continue;

    try {
      const rawToken = decryptToken(recipient.accessTokenEncrypted);
      const url = `${config.appUrl}/sign/${rawToken}`;
      const template = emailForRole(recipient.role as "signer" | "approver" | "cc", recipient.name, url, envelope.template.name);
      await sendEmail({ to: recipient.email, subject: template.subject, html: template.html }, { tenantId: envelope.tenantId });
    } catch (err) {
      await captureException(err, { context: "notify_unlocked_recipient", envelopeId, recipientId: recipient.id });
      await logAuditEvent(envelopeId, "email_failed", recipient.id, {}, {
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export interface CreateEnvelopeInput {
  templateId: string;
  externalRef?: string;
  expiresInHours?: number;
  reminderAfterHours?: number; // per-envelope override — see Envelope.reminderAfterHoursOverride
  message?: string;
  accessCode?: string; // shared secret between sender and recipient(s), scoped to the whole envelope — not per-recipient
  recipients: {
    name: string;
    email: string;
    role?: RecipientRole;
    signingOrder?: number;
  }[];
}

export async function createEnvelope(tenantId: string, input: CreateEnvelopeInput) {
  await assertWithinTierLimit(tenantId, "envelopes_sent");

  const template = await prisma.template.findFirst({
    where: { id: input.templateId, tenantId },
  });
  if (!template) throw new Error("Template not found for this tenant");
  if (template.aiDrafted && !template.aiReviewedAt) {
    // Enforced here, not just hidden in the UI — this is the one place
    // every envelope-creation path (dashboard, bulk send, the v1 API)
    // funnels through, so there's no route that can accidentally send an
    // AI-generated document nobody has actually reviewed.
    throw new Error(
      "This template was drafted by the AI assistant and hasn't been reviewed yet. Open it in the template builder and mark it reviewed before sending."
    );
  }

  const expiresAt = new Date();
  expiresAt.setHours(
    expiresAt.getHours() + (input.expiresInHours ?? config.envelopes.defaultExpiryHours)
  );

  // accessCode is one shared value for the whole envelope, so it's hashed
  // once here — same hashToken() helper as accessTokenHash, applied to
  // every recipient below rather than generated per-recipient.
  const accessCodeHash = input.accessCode ? hashToken(input.accessCode) : undefined;

  // Generate raw tokens here, before they're hashed for storage — this is
  // the one place they exist in plaintext, and the only place a signing
  // link can be built from. Previously these were generated and discarded
  // inline in the .create() call below, which meant no email could ever be
  // sent — fixed by holding onto the raw/hash pairs through creation.
  const recipientsWithTokens = input.recipients.map((r, i) => {
    const rawToken = generateAccessToken();
    return {
      name: r.name,
      email: r.email,
      role: r.role ?? "signer",
      signingOrder: r.signingOrder ?? i + 1,
      rawToken,
      accessTokenHash: hashToken(rawToken),
      accessTokenEncrypted: encryptToken(rawToken),
      accessCodeHash,
    };
  });

  const envelope = await prisma.envelope.create({
    data: {
      tenantId,
      templateId: input.templateId,
      externalRef: input.externalRef,
      expiresAt,
      reminderAfterHoursOverride: input.reminderAfterHours,
      message: input.message,
      // Envelope-scoped snapshot of the template's fields at send time —
      // this is what field edits made during/after send write to, so the
      // template itself (a reusable master) never gets mutated by a
      // single envelope's tweaks. Falls back to the template's own
      // field_map wherever this is null (older envelopes, or if the
      // template somehow has no fields yet).
      fieldMap: template.fieldMap ?? undefined,
      status: "sent",
      recipients: {
        create: recipientsWithTokens.map(({ rawToken, ...r }) => r),
      },
    },
    include: { recipients: true },
  });

  await logAuditEvent(envelope.id, "sent");
  await incrementUsage(tenantId, "envelopes_sent");
  await dispatchWebhook(tenantId, {
    event: "envelope.sent",
    envelope_id: envelope.id,
    external_ref: envelope.externalRef,
    status: envelope.status,
  });

  // Only the first order group gets emailed immediately — anyone with a
  // higher signingOrder is locked (see isRecipientUnlocked) and would just
  // hit a "waiting on X" message if they opened their link now. They get
  // notified via notifyUnlockedRecipients() once it's actually their turn.
  const minOrder = Math.min(...recipientsWithTokens.map((r) => r.signingOrder));
  for (const r of recipientsWithTokens.filter((r) => r.signingOrder === minOrder)) {
    const url = `${config.appUrl}/sign/${r.rawToken}`;
    const emailContent = emailForRole(r.role as "signer" | "approver" | "cc", r.name, url, template.name);
    const dbRecipientId = envelope.recipients.find((dbR) => dbR.email === r.email && dbR.signingOrder === r.signingOrder)?.id;
    sendEmail({ to: r.email, subject: emailContent.subject, html: emailContent.html }, { tenantId }).catch(async (err) => {
      await captureException(err, { context: "envelope_email_send", envelopeId: envelope.id, recipientEmail: r.email, role: r.role });
      await logAuditEvent(envelope.id, "email_failed", dbRecipientId, {}, {
        recipientName: r.name,
        recipientEmail: r.email,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }

  await upsertContacts(tenantId, input.recipients);

  return envelope;
}

/**
 * Creates an envelope that stays private until publishDraftEnvelope() is
 * called — no emails, no webhook, no tier-limit usage counted yet (a draft
 * costs nothing; sending is what counts against the tier). Recipients and
 * their access tokens are created now, same as a live envelope, so
 * publishing later is just a status flip + email send, not a second
 * creation pass. The AI-review gate is deliberately NOT checked here —
 * that belongs at publish time, since a draft isn't going out yet and
 * shouldn't block someone from starting one before a template finishes review.
 */
export async function createDraftEnvelope(tenantId: string, input: CreateEnvelopeInput) {
  const template = await prisma.template.findFirst({ where: { id: input.templateId, tenantId } });
  if (!template) throw new Error("Template not found for this tenant");

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (input.expiresInHours ?? config.envelopes.defaultExpiryHours));
  const accessCodeHash = input.accessCode ? hashToken(input.accessCode) : undefined;

  const recipientsWithTokens = input.recipients.map((r, i) => {
    const rawToken = generateAccessToken();
    return {
      name: r.name,
      email: r.email,
      role: r.role ?? "signer",
      signingOrder: r.signingOrder ?? i + 1,
      accessTokenHash: hashToken(rawToken),
      accessTokenEncrypted: encryptToken(rawToken),
      accessCodeHash,
    };
  });

  const draft = await prisma.envelope.create({
    data: {
      tenantId,
      templateId: input.templateId,
      externalRef: input.externalRef,
      expiresAt,
      reminderAfterHoursOverride: input.reminderAfterHours,
      message: input.message,
      fieldMap: template.fieldMap ?? undefined,
      status: "draft",
      recipients: { create: recipientsWithTokens },
    },
    include: { recipients: true },
  });

  await upsertContacts(tenantId, input.recipients);

  return draft;
}

/**
 * Overwrites a draft's recipients and envelope-level settings with
 * whatever's currently on the form — this is what makes resuming a draft,
 * editing it, and hitting Send actually save those edits before
 * publishing, instead of publishing whatever was on the draft when it was
 * first saved. Replaces the whole recipient set (delete + recreate with
 * fresh tokens) rather than diffing old vs new — simpler, and correct
 * either way since nothing has been sent yet for a draft.
 */
export async function updateDraftEnvelope(tenantId: string, envelopeId: string, input: CreateEnvelopeInput) {
  const draft = await prisma.envelope.findFirst({ where: { id: envelopeId, tenantId, status: "draft" } });
  if (!draft) throw new Error("This draft can no longer be found, or it was already sent.");

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (input.expiresInHours ?? config.envelopes.defaultExpiryHours));
  const accessCodeHash = input.accessCode ? hashToken(input.accessCode) : undefined;

  const recipientsWithTokens = input.recipients.map((r, i) => {
    const rawToken = generateAccessToken();
    return {
      name: r.name,
      email: r.email,
      role: r.role ?? "signer",
      signingOrder: r.signingOrder ?? i + 1,
      accessTokenHash: hashToken(rawToken),
      accessTokenEncrypted: encryptToken(rawToken),
      accessCodeHash,
    };
  });

  await prisma.recipient.deleteMany({ where: { envelopeId } });

  const updated = await prisma.envelope.update({
    where: { id: envelopeId },
    data: {
      templateId: input.templateId,
      externalRef: input.externalRef,
      expiresAt,
      reminderAfterHoursOverride: input.reminderAfterHours,
      message: input.message,
      recipients: { create: recipientsWithTokens },
    },
    include: { recipients: true },
  });

  await upsertContacts(tenantId, input.recipients);

  return updated;
}

/**
 * The actual "send" moment for a draft — everything createEnvelope() does
 * after the row exists (tier-limit check, AI-review gate, status flip,
 * audit log, webhook, usage counter, first-order-group emails), applied to
 * an existing draft row instead of a brand-new one. Recipients and their
 * tokens already exist from createDraftEnvelope — decryptToken() recovers
 * the raw token for the email link, since only the hash/encrypted forms
 * are ever stored (same mechanism send-reminder already relies on).
 */
export async function publishDraftEnvelope(tenantId: string, envelopeId: string) {
  const draft = await prisma.envelope.findFirst({
    where: { id: envelopeId, tenantId, status: "draft" },
    include: { recipients: true, template: true },
  });
  if (!draft) throw new Error("This draft can no longer be found, or it was already sent.");
  if (draft.template.aiDrafted && !draft.template.aiReviewedAt) {
    throw new Error(
      "This template was drafted by the AI assistant and hasn't been reviewed yet. Open it in the template builder and mark it reviewed before sending."
    );
  }

  await assertWithinTierLimit(tenantId, "envelopes_sent");

  const envelope = await prisma.envelope.update({
    where: { id: envelopeId },
    data: { status: "sent" },
    include: { recipients: true },
  });

  await logAuditEvent(envelope.id, "sent");
  await incrementUsage(tenantId, "envelopes_sent");
  await dispatchWebhook(tenantId, {
    event: "envelope.sent",
    envelope_id: envelope.id,
    external_ref: envelope.externalRef,
    status: envelope.status,
  });

  const minOrder = Math.min(...envelope.recipients.map((r: (typeof envelope.recipients)[number]) => r.signingOrder));
  for (const r of envelope.recipients.filter((r: (typeof envelope.recipients)[number]) => r.signingOrder === minOrder)) {
    let rawToken: string;
    try {
      rawToken = decryptToken(r.accessTokenEncrypted!);
    } catch (err) {
      await captureException(err, { context: "publish_draft_decrypt", envelopeId: envelope.id, recipientId: r.id });
      continue;
    }
    const url = `${config.appUrl}/sign/${rawToken}`;
    const emailContent = emailForRole(r.role as "signer" | "approver" | "cc", r.name, url, draft.template.name);
    sendEmail({ to: r.email, subject: emailContent.subject, html: emailContent.html }, { tenantId }).catch(async (err) => {
      await captureException(err, { context: "envelope_email_send", envelopeId: envelope.id, recipientEmail: r.email, role: r.role });
      await logAuditEvent(envelope.id, "email_failed", r.id, {}, {
        recipientName: r.name,
        recipientEmail: r.email,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return envelope;
}

/**
 * Overwrites this envelope's own field snapshot — never the template's.
 * Only allowed while the envelope is still active (see
 * ACTIVE_ENVELOPE_STATUSES): once it's completed, declined, voided, or
 * expired, the document is locked and this throws. The status check is
 * done inside the update's `where` clause (not a separate read-then-check)
 * so it's atomic — no race between "checked it's editable" and "wrote the
 * change" where another request could complete the envelope in between.
 */
export async function updateEnvelopeFields(envelopeId: string, tenantId: string, fieldMap: unknown, actorEmail: string) {
  try {
    const updated = await prisma.envelope.update({
      where: { id: envelopeId, tenantId, status: { in: [...ACTIVE_ENVELOPE_STATUSES] } },
      data: { fieldMap: fieldMap as any },
    });
    await logAuditEvent(updated.id, "fields_updated", undefined, {}, { actorName: actorEmail });
    return updated;
  } catch {
    throw new Error("This envelope can no longer be edited — it's already completed, declined, voided, or expired.");
  }
}

export function generateAccessToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function markOpened(recipientId: string) {
  const recipient = await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: "opened" },
  });
  await logAuditEvent(recipient.envelopeId, "opened", recipientId, {}, { recipientName: recipient.name, recipientEmail: recipient.email });
  return recipient;
}

/**
 * Whether this recipient is allowed to act yet — true only once every
 * recipient with a LOWER signingOrder has completed their own action
 * (signed or approved). Recipients sharing the same signingOrder act in
 * parallel (that's the point of the field existing at all — most envelopes
 * have one order group). Declined/voided upstream recipients permanently
 * block anyone after them, since there's nothing valid left to act on.
 *
 * NOTE: cc recipients are gated by signingOrder the same as signers/
 * approvers here, for simplicity. If you'd rather cc'd people always get
 * notified immediately regardless of their position in the order (arguably
 * more intuitive, since they don't block anyone), exclude role === "cc"
 * from the priorRecipients loop below. Flagging the simplification rather
 * than deciding it silently.
 */
export async function isRecipientUnlocked(recipientId: string): Promise<{ unlocked: boolean; reason?: string }> {
  const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
  const priorRecipients = await prisma.recipient.findMany({
    where: { envelopeId: recipient.envelopeId, signingOrder: { lt: recipient.signingOrder } },
  });

  for (const prior of priorRecipients) {
    if (prior.status === "declined") {
      return { unlocked: false, reason: `${prior.name} declined this document — nothing left to act on.` };
    }
    const completedStates = prior.role === "approver" ? ["approved"] : ["signed"];
    if (!completedStates.includes(prior.status)) {
      return { unlocked: false, reason: `Waiting on ${prior.name} (${prior.role}) to act first.` };
    }
  }

  return { unlocked: true };
}

export async function markApproved(recipientId: string) {
  const recipient = await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: "approved", signedAt: new Date() }, // signedAt doubles as "acted at" — no separate column needed for a status that isn't "signed"
  });
  await logAuditEvent(recipient.envelopeId, "approved", recipientId, {}, { recipientName: recipient.name, recipientEmail: recipient.email });
  await notifyUnlockedRecipients(recipient.envelopeId);
  return recipient;
}

export async function markSigned(recipientId: string, ipAddress?: string, geo?: Record<string, unknown>) {
  const recipient = await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: "signed", signedAt: new Date(), ipAddress, geo: geo as any },
  });
  await logAuditEvent(recipient.envelopeId, "signed", recipientId, { ipAddress, geo }, { recipientName: recipient.name, recipientEmail: recipient.email });

  const envelope = await prisma.envelope.findUnique({
    where: { id: recipient.envelopeId },
    include: { recipients: true },
  });
  const allSigned = envelope?.recipients
    .filter((r) => r.role === "signer")
    .every((r) => r.status === "signed");

  if (allSigned && envelope) {
    await completeEnvelope(envelope.id);
  } else {
    await notifyUnlockedRecipients(recipient.envelopeId);
  }

  return recipient;
}

async function completeEnvelope(envelopeId: string) {
  const envelope = await prisma.envelope.update({
    where: { id: envelopeId },
    data: { status: "completed", completedAt: new Date() },
  });
  // Actual PDF finalize (burn fields, PKI sign) + certificate generation is
  // triggered from the sign API route once all field values are in hand —
  // see app/api/sign/[token]/route.ts and lib/signing/certificate.ts.
  await dispatchWebhook(envelope.tenantId, {
    event: "envelope.completed",
    envelope_id: envelope.id,
    external_ref: envelope.externalRef,
    status: envelope.status,
  });
  return envelope;
}

export async function declineEnvelope(recipientId: string, reason: string) {
  const recipient = await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: "declined", declineReason: reason },
  });
  const envelope = await prisma.envelope.update({
    where: { id: recipient.envelopeId },
    data: { status: "declined" },
  });
  await logAuditEvent(envelope.id, "declined", recipientId, {}, { recipientName: recipient.name, recipientEmail: recipient.email, reason });
  await dispatchWebhook(envelope.tenantId, {
    event: "envelope.declined",
    envelope_id: envelope.id,
    external_ref: envelope.externalRef,
    reason,
  });
  return recipient;
}

export async function voidEnvelope(envelopeId: string, tenantId: string, reason: string) {
  const envelope = await prisma.envelope.update({
    where: { id: envelopeId, tenantId },
    data: { status: "voided" },
  });
  await logAuditEvent(envelope.id, "voided", undefined, {}, { reason });
  await dispatchWebhook(tenantId, {
    event: "envelope.voided",
    envelope_id: envelope.id,
    external_ref: envelope.externalRef,
    reason,
  });
  return envelope;
}

/**
 * Sends a reminder email to one recipient — the single implementation
 * both the automatic cadence (app/api/cron/reminders) and a manual
 * "send reminder now" trigger call, so they can never drift out of sync
 * with each other. `isManual` only changes the audit event type/summary
 * and skips the "already reminded on cadence" cutoff check the cron
 * applies — a manual send is an explicit override, not subject to the
 * same "don't repeat too often" logic that protects against the cron
 * accidentally spamming someone.
 */
export async function sendReminderEmail(
  envelope: { id: string; tenantId: string; template: { name: string } },
  recipient: { id: string; name: string; email: string; role: string; accessTokenEncrypted: string | null },
  isManual = false
): Promise<{ sent: boolean; error?: string }> {
  try {
    if (!recipient.accessTokenEncrypted) {
      // Envelopes created before accessTokenEncrypted existed have no
      // encrypted copy to decrypt from — can't recover a live link.
      return { sent: false, error: "This envelope predates link recovery — void and resend to get a working reminder link." };
    }
    const rawToken = decryptToken(recipient.accessTokenEncrypted);
    const url = `${config.appUrl}/sign/${rawToken}`;
    const emailContent = emailForRole(recipient.role as "signer" | "approver" | "cc", recipient.name, url, envelope.template.name, true);
    await sendEmail({ to: recipient.email, subject: emailContent.subject, html: emailContent.html }, { tenantId: envelope.tenantId });

    await logAuditEvent(
      envelope.id,
      isManual ? "manual_reminder_sent" : "reminder_sent",
      recipient.id,
      {},
      { recipientName: recipient.name, recipientEmail: recipient.email }
    );
    return { sent: true };
  } catch (err) {
    await captureException(err, { context: isManual ? "manual_reminder_send" : "reminder_send", envelopeId: envelope.id, recipientId: recipient.id });
    await logAuditEvent(envelope.id, "email_failed", recipient.id, {}, {
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, error: "Couldn't send the reminder — try again shortly." };
  }
}

/** Called from the reminder cron (see app/api/cron/reminders/route.ts). */
export async function expireOverdueEnvelopes() {
  const overdue = await prisma.envelope.findMany({
    where: { status: { in: [...ACTIVE_ENVELOPE_STATUSES] }, expiresAt: { lt: new Date() } },
  });
  for (const envelope of overdue) {
    await prisma.envelope.update({ where: { id: envelope.id }, data: { status: "expired" } });
    await logAuditEvent(envelope.id, "expired");
    await dispatchWebhook(envelope.tenantId, {
      event: "envelope.expired",
      envelope_id: envelope.id,
      external_ref: envelope.externalRef,
    });
  }
  return overdue.length;
}
