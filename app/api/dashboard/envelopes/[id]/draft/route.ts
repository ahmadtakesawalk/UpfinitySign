// DEPLOY TO: app/api/dashboard/envelopes/[id]/draft/route.ts
// PATCH — overwrites a draft's recipients and settings (updateDraftEnvelope).
// Called right before publish when Send is clicked on a resumed draft, so
// in-session edits actually get saved rather than publishing whatever was
// on the draft when it was first created.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { updateDraftEnvelope } from "@/lib/signing/envelopes";
import { captureException } from "@/lib/monitoring";
import type { RecipientRole } from "@prisma/client";

interface UpdateDraftBody {
  template_id: string;
  external_ref?: string;
  expires_in_hours?: number;
  reminder_after_hours?: number;
  recipients: { name: string; email: string; role?: RecipientRole; signing_order?: number; message?: string; access_code?: string }[];
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body: UpdateDraftBody = await req.json();
  if (!body.template_id || !body.recipients?.length) {
    return NextResponse.json({ error: "template_id and at least one recipient are required." }, { status: 400 });
  }

  try {
    const draft = await updateDraftEnvelope(user.tenantId, id, {
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
    await captureException(err, { context: "dashboard_update_draft", tenantId: user.tenantId, envelopeId: id });
    const message = err instanceof Error ? err.message : "Couldn't save this draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
