// DEPLOY TO: app/api/dashboard/envelopes/route.ts
//
// Dashboard (session-authed) equivalent of POST /api/v1/envelopes — same
// createEnvelope() call underneath, just reached from the UI instead of
// an API key. This is what lets a sender actually send from the product
// instead of being told to "use your integration."
//
// GET added below the existing POST — lists this tenant's envelopes for
// the Dashboard home and Inbox pages.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { createEnvelope } from "@/lib/signing/envelopes";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { TrialCardRequiredError } from "@/lib/billing/trial";
import { captureException } from "@/lib/monitoring";
import type { RecipientRole } from "@prisma/client";

interface CreateEnvelopeBody {
  template_id: string;
  external_ref?: string;
  expires_in_hours?: number;
  reminder_after_hours?: number;
  recipients: {
    name: string;
    email: string;
    role?: RecipientRole;
    signing_order?: number;
    message?: string;
    access_code?: string;
  }[];
}

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await assertWithinRateLimit(user.tenantId);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } });
    }
    throw err;
  }
  const body = (await req.json()) as CreateEnvelopeBody;
  if (!body.template_id || !body.recipients?.length) {
    return NextResponse.json({ error: "Choose a template and add at least one recipient." }, { status: 400 });
  }
  for (const r of body.recipients) {
    if (!r.name?.trim() || !r.email?.trim()) {
      return NextResponse.json({ error: "Every recipient needs a name and an email address." }, { status: 400 });
    }
  }
  const MAX_RECIPIENTS = 50;
  if (body.recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS}).` }, { status: 400 });
  }
  const seenEmails = new Set<string>();
  for (const r of body.recipients) {
    const emailKey = r.email.trim().toLowerCase();
    if (seenEmails.has(emailKey)) {
      return NextResponse.json({ error: `Duplicate recipient email: ${r.email.trim()}` }, { status: 400 });
    }
    seenEmails.add(emailKey);
  }
  try {
    const envelope = await createEnvelope(user.tenantId, {
      templateId: body.template_id,
      externalRef: body.external_ref,
      expiresInHours: body.expires_in_hours,
      reminderAfterHours: body.reminder_after_hours,
      recipients: body.recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        signingOrder: r.signing_order,
        message: r.message,
        accessCode: r.access_code,
      })),
    });
    return NextResponse.json({ envelope_id: envelope.id, status: envelope.status }, { status: 201 });
  } catch (err) {
    if (err instanceof TierLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof TrialCardRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    if (err instanceof Error && err.message === "Template not found for this tenant") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    await captureException(err, { context: "dashboard_create_envelope", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong sending this envelope. Try again." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 25, 100);

  const envelopes = await prisma.envelope.findMany({
    where: { tenantId: user.tenantId },
    include: { template: true, recipients: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    envelopes: envelopes.map((e) => ({
      id: e.id,
      name: e.template.name,
      status: e.status,
      external_ref: e.externalRef,
      recipients: e.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, status: r.status })),
      updated_at: e.updatedAt,
      created_at: e.createdAt,
      expires_at: e.expiresAt,
      signed_pdf_url: e.signedPdfStorageKey ? storage.url(e.signedPdfStorageKey) : null,
    })),
  });
}
