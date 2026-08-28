// DEPLOY TO: app/api/dashboard/envelopes/draft/route.ts
// POST — saves a draft (createDraftEnvelope). GET — lists this tenant's
// current drafts, for surfacing "continue where you left off" (dashboard
// home + post-login).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { createDraftEnvelope } from "@/lib/signing/envelopes";
import { captureException } from "@/lib/monitoring";
import type { RecipientRole } from "@prisma/client";

interface CreateDraftBody {
  template_id: string;
  external_ref?: string;
  expires_in_hours?: number;
  reminder_after_hours?: number;
  recipients: { name: string; email: string; role?: RecipientRole; signing_order?: number; message?: string; access_code?: string }[];
}

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: CreateDraftBody = await req.json();
  if (!body.template_id || !body.recipients?.length) {
    return NextResponse.json({ error: "template_id and at least one recipient are required." }, { status: 400 });
  }

  try {
    const draft = await createDraftEnvelope(user.tenantId, {
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
    return NextResponse.json({ envelope_id: draft.id, status: draft.status });
  } catch (err) {
    await captureException(err, { context: "dashboard_create_draft", tenantId: user.tenantId });
    const message = err instanceof Error ? err.message : "Couldn't save this draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const drafts = await prisma.envelope.findMany({
    where: { tenantId: user.tenantId, status: "draft" },
    orderBy: { updatedAt: "desc" },
    include: { template: { select: { name: true } }, recipients: { select: { name: true, email: true } } },
    take: 20,
  });

  return NextResponse.json({
    drafts: drafts.map((d: (typeof drafts)[number]) => ({
      envelope_id: d.id,
      template_name: d.template.name,
      recipient_count: d.recipients.length,
      updated_at: d.updatedAt,
    })),
  });
}
