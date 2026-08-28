// DEPLOY TO: app/api/dashboard/envelopes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { storage } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const envelope = await prisma.envelope.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      template: true,
      recipients: { orderBy: { signingOrder: "asc" } },
    },
  });

  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: envelope.id,
    name: envelope.template.name,
    template_id: envelope.templateId,
    // Resolved via the storage adapter's url() — same pattern as
    // app/dashboard/envelopes/[id]/page.tsx's storage.url(envelope.signedPdfStorageKey).
    pdf_url: storage.url(envelope.template.pdfStorageKey),
    status: envelope.status,
    // Falls back to the template's own fields for older envelopes created
    // before fieldMap existed on Envelope — see lib/signing/envelopes.ts.
    field_map: envelope.fieldMap ?? envelope.template.fieldMap ?? [],
    message: envelope.message,
    external_ref: envelope.externalRef,
    expires_at: envelope.expiresAt,
    recipients: envelope.recipients.map((r: (typeof envelope.recipients)[number]) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      signing_order: r.signingOrder,
      status: r.status,
    })),
  });
}
