// DEPLOY TO: lib/signing/audit.ts
//
// Append-only audit trail (PRD.md §5). Never update or delete rows — only
// ever insert. This is the one function that should write to AuditEvent;
// keeping it centralized means the audit trail can't accidentally be
// bypassed by a code path that forgets to log.
//
// Every event gets a plain-English `summary` generated HERE, at write
// time — not computed later by whatever UI happens to render it. That
// matters for audit integrity: the sentence a compliance reviewer reads
// six months from now is exactly the sentence that was true at the
// moment the event happened, not a re-interpretation by newer code.

import { prisma } from "../db";
import type { NextRequest } from "next/server";

export type AuditEventType =
  | "sent"
  | "delivered"
  | "opened"
  | "field_filled"
  | "fields_updated"
  | "signed"
  | "approved"
  | "declined"
  | "voided"
  | "expired"
  | "reminder_sent"
  // Failure states — these did not exist before this pass. Without them,
  // a failed delivery or a failed post-signature PDF finalization was
  // only ever visible in server logs (Sentry-style captureException),
  // never in the durable audit trail a compliance reviewer or the
  // recipient's own support ticket would be checked against.
  | "email_failed"
  | "signing_validation_failed"
  | "finalization_failed"
  | "attachment_upload_failed"
  // Manual overrides on otherwise-automated behavior — see the reasoning
  // in each corresponding route for why these exist.
  | "legal_hold_placed"
  | "legal_hold_released"
  | "manual_reminder_sent"
  | "webhook_delivery_failed";

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
  geo?: Record<string, unknown>;
}

export interface AuditDetails {
  recipientName?: string;
  recipientEmail?: string;
  reason?: string; // decline reason, validation error, provider error message, etc.
  // Who performed a sender/admin-side action (as opposed to a recipient
  // action, which uses recipientName above). Used for events like
  // fields_updated where the actor is the envelope owner or a teammate
  // editing the field layout, not a signer.
  actorName?: string;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildSummary(eventType: AuditEventType, details: AuditDetails, occurredAt: Date): string {
  const who = details.recipientName ?? details.recipientEmail ?? "A recipient";
  switch (eventType) {
    case "sent": return "The envelope was sent to its recipients.";
    case "delivered": return `The signing email was delivered to ${who}.`;
    case "opened": return `${who} opened the document.`;
    case "field_filled": return `${who} filled in a field.`;
    case "fields_updated": {
      const actor = details.actorName ?? "A sender";
      return `${actor} updated the envelope's field layout on ${formatTimestamp(occurredAt)}.`;
    }
    case "signed": return `${who} signed the document.`;
    case "approved": return `${who} approved the document.`;
    case "declined": return `${who} declined to sign${details.reason ? ` — reason given: "${details.reason}"` : "."}`;
    case "voided": return `The envelope was voided${details.reason ? ` — reason: "${details.reason}"` : "."}`;
    case "expired": return "The envelope expired before all recipients completed it.";
    case "reminder_sent": return `A reminder email was sent to ${who}.`;
    case "email_failed": return `An email to ${who} failed to send${details.reason ? ` — ${details.reason}` : "."}`;
    case "signing_validation_failed": return `${who}'s submission was rejected${details.reason ? ` — ${details.reason}` : " — one or more required fields were invalid."}`;
    case "finalization_failed": return `${who} signed successfully, but generating the final signed document or certificate failed${details.reason ? ` — ${details.reason}` : "."} This needs manual follow-up.`;
    case "attachment_upload_failed": return `${who}'s file attachment failed to upload${details.reason ? ` — ${details.reason}` : "."}`;
    case "legal_hold_placed": return "A legal hold was placed on this envelope — it will be exempt from automatic deletion.";
    case "legal_hold_released": return "The legal hold on this envelope was released.";
    case "manual_reminder_sent": return `A reminder was manually sent to ${who} (outside the normal automatic cadence).`;
    case "webhook_delivery_failed": return `Your configured webhook couldn't be delivered for this event after repeated attempts${details.reason ? ` — ${details.reason}` : "."} Check Webhook activity to retry.`;
    default: return `Event: ${eventType}`;
  }
}

export async function logAuditEvent(
  envelopeId: string,
  eventType: AuditEventType,
  recipientId?: string,
  ctx: AuditContext = {},
  details: AuditDetails = {}
) {
  const occurredAt = new Date();
  return prisma.auditEvent.create({
    data: {
      envelopeId,
      recipientId,
      eventType,
      summary: buildSummary(eventType, details, occurredAt),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      geo: ctx.geo as any,
    },
  });
}

/** Pulls IP/user-agent out of a Next.js request for audit logging — geo is left to the caller (a geo-IP lookup, done once per request to avoid an extra call here). */
export function requestContext(req: NextRequest): Pick<AuditContext, "ipAddress" | "userAgent"> {
  return {
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}
