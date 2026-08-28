// POST /api/v1/envelopes/bulk — send the same template to many recipients
// at once (PRD §11 Phase 2 item 12). Gated by the bulk_send add-on — see
// lib/billing/addons.ts.

export const maxDuration = 60; // creating many envelopes in one request needs more headroom than a single send

import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant, requireScope } from "@/lib/auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { assertAddonEnabled, AddonNotEnabledError } from "@/lib/billing/addons";
import { createEnvelope } from "@/lib/signing/envelopes";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { TrialCardRequiredError } from "@/lib/billing/trial";
import { captureException } from "@/lib/monitoring";

interface BulkSendBody {
  template_id: string;
  expires_in_hours?: number;
  // Each entry is one envelope's recipient list — bulk send means "one
  // template, many independent envelopes", not "one envelope, many signers"
  // (that's the existing multi-recipient support on the regular endpoint).
  recipients_batches: {
    external_ref?: string;
    recipients: { name: string; email: string; role?: "signer" | "cc" | "approver"; signing_order?: number }[];
  }[];
}

const MAX_BATCH_SIZE = 500; // guardrail — a single request shouldn't try to create thousands of envelopes synchronously

export async function POST(req: NextRequest) {
  const auth = await authenticateTenant(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireScope(auth, "envelopes:write")) {
    return NextResponse.json({ error: "this API key does not have envelopes:write scope" }, { status: 403 });
  }

  try {
    await assertWithinRateLimit(auth.tenant.id);
    await assertAddonEnabled(auth.tenant.id, "bulk_send");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AddonNotEnabledError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const body = (await req.json()) as BulkSendBody;
  if (!body.template_id || !body.recipients_batches?.length) {
    return NextResponse.json(
      { error: "template_id and at least one entry in recipients_batches are required" },
      { status: 400 }
    );
  }
  if (body.recipients_batches.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `max ${MAX_BATCH_SIZE} envelopes per bulk request` }, { status: 400 });
  }

  const results: { external_ref?: string; envelope_id?: string; error?: string }[] = [];

  // Sequential, not Promise.all — each createEnvelope() call re-checks the
  // tenant's monthly envelope cap, so running these concurrently would let
  // a burst of parallel requests all pass the check before any of them
  // increments the counter (a classic check-then-act race). Bulk send is
  // not latency-sensitive the way a single send is, so serializing is the
  // correct tradeoff here, not just the easy one.
  for (const batch of body.recipients_batches) {
    try {
      const envelope = await createEnvelope(auth.tenant.id, {
        templateId: body.template_id,
        externalRef: batch.external_ref,
        expiresInHours: body.expires_in_hours,
        recipients: batch.recipients.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role,
          signingOrder: r.signing_order,
        })),
      });
      results.push({ external_ref: batch.external_ref, envelope_id: envelope.id });
    } catch (err) {
      if (err instanceof TierLimitExceededError || err instanceof TrialCardRequiredError) {
        // Stop the whole batch here — every subsequent entry would hit the
        // same cap, so continuing would just produce N identical errors.
        results.push({ external_ref: batch.external_ref, error: err.message });
        break;
      }
      await captureException(err, { context: "bulk_send_entry", tenantId: auth.tenant.id, externalRef: batch.external_ref });
      results.push({ external_ref: batch.external_ref, error: "failed to create this envelope" });
    }
  }

  const succeeded = results.filter((r) => r.envelope_id).length;
  return NextResponse.json({ succeeded, failed: results.length - succeeded, results }, { status: 207 });
}
