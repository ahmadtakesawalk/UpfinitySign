// GET /api/v1/envelopes/:id — status lookup for polling integrations
// (most tenants should use the webhook instead — see lib/webhooks/dispatch.ts —
// but this covers manual checks/debugging).

import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant, requireScope } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateTenant(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Same reasoning as the write-scope fix on app/api/v1/templates/route.ts
  // — this was unchecked here, unlike the other v1 routes that enforce
  // scope. Unreachable through the current UI (every key created there
  // gets full default scopes) but a narrower-scoped key created directly
  // against the dashboard API wouldn't have been restricted here.
  if (!requireScope(auth, "envelopes:read")) {
    return NextResponse.json({ error: "this API key does not have envelopes:read scope" }, { status: 403 });
  }

  const { id } = await params;
  const envelope = await prisma.envelope.findFirst({
    where: { id, tenantId: auth.tenant.id },
    include: {
      recipients: {
        select: { id: true, name: true, email: true, role: true, status: true, signedAt: true },
      },
      certificate: true,
    },
  });

  if (!envelope) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    envelope_id: envelope.id,
    status: envelope.status,
    external_ref: envelope.externalRef,
    expires_at: envelope.expiresAt,
    completed_at: envelope.completedAt,
    recipients: envelope.recipients,
    signed_pdf_url: envelope.signedPdfStorageKey ? storage.url(envelope.signedPdfStorageKey) : null,
    certificate_url: envelope.certificate?.webViewUrl ?? null,
  });
}
