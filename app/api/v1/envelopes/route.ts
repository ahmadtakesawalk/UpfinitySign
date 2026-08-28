// POST /api/v1/envelopes
// Called by external platforms (e.g. Dvxel Qbank) to send a signature request.
// See PRD.md §4 for the integration contract.

import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant, requireScope } from "@/lib/auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { createEnvelope } from "@/lib/signing/envelopes";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { TrialCardRequiredError } from "@/lib/billing/trial";
import { captureException } from "@/lib/monitoring";

interface CreateEnvelopeBody {
  template_id: string;
  external_ref?: string;
  recipients: {
    name: string;
    email: string;
    role?: "signer" | "cc" | "approver";
    signing_order?: number;
  }[];
  expires_in_hours?: number;
}

export async function POST(req: NextRequest) {
  const auth = await authenticateTenant(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireScope(auth, "envelopes:write")) {
    return NextResponse.json({ error: "this API key does not have envelopes:write scope" }, { status: 403 });
  }

  try {
    await assertWithinRateLimit(auth.tenant.id);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } }
      );
    }
    throw err;
  }

  const body = (await req.json()) as CreateEnvelopeBody;
  if (!body.template_id || !body.recipients?.length) {
    return NextResponse.json(
      { error: "template_id and at least one recipient are required" },
      { status: 400 }
    );
  }

  try {
    const envelope = await createEnvelope(auth.tenant.id, {
      templateId: body.template_id,
      externalRef: body.external_ref,
      expiresInHours: body.expires_in_hours,
      recipients: body.recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        signingOrder: r.signing_order,
      })),
    });
    return NextResponse.json(
      { envelope_id: envelope.id, status: envelope.status },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof TierLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof TrialCardRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    await captureException(err, { context: "create_envelope", tenantId: auth.tenant.id });
    return NextResponse.json({ error: "failed to create envelope" }, { status: 500 });
  }
}
