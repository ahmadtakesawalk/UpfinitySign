// DEPLOY TO: app/api/dashboard/envelopes/bulk/route.ts
//
// Dashboard (session-authed) equivalent of POST /api/v1/envelopes/bulk —
// same createEnvelope() loop, same addon gate, just reached from the UI.

export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { assertAddonEnabled, AddonNotEnabledError } from "@/lib/billing/addons";
import { createEnvelope } from "@/lib/signing/envelopes";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { TrialCardRequiredError } from "@/lib/billing/trial";
import { captureException } from "@/lib/monitoring";
import type { RecipientRole } from "@prisma/client";

interface BulkSendBody {
  template_id: string;
  expires_in_hours?: number;
  reminder_after_hours?: number;
  recipients_batches: {
    external_ref?: string;
    recipients: { name: string; email: string; role?: RecipientRole; signing_order?: number }[];
  }[];
}

const MAX_BATCH_SIZE = 500;

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    await assertWithinRateLimit(user.tenantId);
    await assertAddonEnabled(user.tenantId, "bulk_send");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AddonNotEnabledError) {
      return NextResponse.json({ error: "Bulk send isn't included on your current plan. Contact your workspace owner to upgrade." }, { status: 403 });
    }
    throw err;
  }

  const body = (await req.json()) as BulkSendBody;
  if (!body.template_id || !body.recipients_batches?.length) {
    return NextResponse.json({ error: "Choose a template and add at least one recipient row." }, { status: 400 });
  }
  if (body.recipients_batches.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Max ${MAX_BATCH_SIZE} envelopes per bulk send.` }, { status: 400 });
  }

  const results: { external_ref?: string; envelope_id?: string; error?: string }[] = [];

  // Sequential, not parallel — see the identical comment in the v1 route;
  // each createEnvelope() call re-checks the tenant's monthly cap, so
  // concurrent calls could all pass the check before any increments it.
  for (const batch of body.recipients_batches) {
    try {
      const envelope = await createEnvelope(user.tenantId, {
        templateId: body.template_id,
        externalRef: batch.external_ref,
        expiresInHours: body.expires_in_hours,
        reminderAfterHours: body.reminder_after_hours,
        recipients: batch.recipients.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role,
          signingOrder: r.signing_order,
        })),
      });
      results.push({ external_ref: batch.external_ref, envelope_id: envelope.id });
    } catch (err) {
      if (err instanceof TierLimitExceededError) {
        results.push({ external_ref: batch.external_ref, error: err.message });
        break;
      }
      if (err instanceof TrialCardRequiredError) {
        results.push({ external_ref: batch.external_ref, error: err.message });
        break;
      }
      await captureException(err, { context: "dashboard_bulk_send_entry", tenantId: user.tenantId, externalRef: batch.external_ref });
      results.push({ external_ref: batch.external_ref, error: "failed to create this envelope" });
    }
  }

  const succeeded = results.filter((r) => r.envelope_id).length;
  return NextResponse.json({ succeeded, failed: results.length - succeeded, results }, { status: 207 });
}
