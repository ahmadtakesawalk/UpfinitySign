// HMAC-signed webhook dispatch (PRD.md §4). Every envelope status change
// pushes here — this is how Dvxel Qbank (or any tenant integration) learns
// an offer letter was signed without polling.

import { createHmac } from "crypto";
import { prisma } from "../db";
import { config } from "../config";
import { captureException } from "../monitoring";
import { logAuditEvent } from "../signing/audit";

export interface WebhookPayload {
  event: string;
  envelope_id: string;
  external_ref?: string | null;
  status?: string;
  reason?: string;
  [key: string]: unknown;
}

export async function dispatchWebhook(tenantId: string, payload: WebhookPayload) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.webhookUrl || !tenant.webhookSecret) return; // no webhook configured — not an error

  const body = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
  const signature = createHmac(config.webhooks.hmacAlgo, tenant.webhookSecret)
    .update(body)
    .digest("hex");

  await sendWithRetry(tenantId, tenant.webhookUrl, body, signature, payload.envelope_id);
}

async function sendWithRetry(
  tenantId: string,
  url: string,
  body: string,
  signature: string,
  envelopeId: string,
  attempt = 1
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-upfinity-signature": signature,
      },
      body,
    });
    if (!res.ok) throw new Error(`Webhook endpoint returned ${res.status}`);
  } catch (err) {
    if (attempt >= config.webhooks.maxRetries) {
      await captureException(err, { context: "webhook_delivery_failed", url, attempt });
      await prisma.deadLetterWebhook.create({
        data: { tenantId, payload: JSON.parse(body), lastError: String(err), attempts: attempt },
      });
      // This is what closes the gap that previously existed: a dead-
      // lettered webhook was only ever visible in server logs or a raw
      // database row — nothing in the tenant's own comprehensive audit
      // trail recorded that their integration stopped hearing about this
      // envelope. Tied to the envelope, not just the tenant, so it shows
      // up right on that envelope's own audit trail alongside everything
      // else that happened to it.
      await logAuditEvent(envelopeId, "webhook_delivery_failed", undefined, {}, {
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const backoffMs = 2 ** attempt * 1000;
    await new Promise((r) => setTimeout(r, backoffMs));
    return sendWithRetry(tenantId, url, body, signature, envelopeId, attempt + 1);
  }
}

/**
 * Manually re-attempts a single dead-lettered delivery — the "Retry now"
 * action on the tenant's webhook activity page. Uses the exact payload
 * and signature that were originally computed (re-signing with the
 * tenant's CURRENT webhookSecret, in case they rotated it since), one
 * attempt only — if it fails again, the row stays unresolved rather than
 * re-entering the automatic backoff sequence, since a human explicitly
 * asking for a retry should get a clear yes/no, not another silent queue.
 */
export async function retryDeadLetter(deadLetterId: string): Promise<{ success: boolean; error?: string }> {
  const deadLetter = await prisma.deadLetterWebhook.findUniqueOrThrow({ where: { id: deadLetterId } });
  const tenant = await prisma.tenant.findUnique({ where: { id: deadLetter.tenantId } });
  if (!tenant?.webhookUrl || !tenant.webhookSecret) {
    return { success: false, error: "No webhook URL/secret currently configured for this workspace." };
  }

  const body = JSON.stringify(deadLetter.payload);
  const signature = createHmac(config.webhooks.hmacAlgo, tenant.webhookSecret).update(body).digest("hex");

  try {
    const res = await fetch(tenant.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-upfinity-signature": signature },
      body,
    });
    if (!res.ok) throw new Error(`Webhook endpoint returned ${res.status}`);

    await prisma.deadLetterWebhook.update({ where: { id: deadLetterId }, data: { resolvedAt: new Date() } });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Verifies an inbound signature matches — for tenants who want to verify Upfinity's webhook is authentic (mirrors what Upfinity itself signs outbound). */
export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac(config.webhooks.hmacAlgo, secret).update(body).digest("hex");
  return expected === signature;
}
