// DEPLOY TO: app/api/dashboard/templates/[id]/documents/[docId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ACTIVE_ENVELOPE_STATUSES } from "@/lib/signing/envelopes";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = await prisma.templateDocument.findFirst({ where: { id: docId, templateId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: doc.id,
    name: doc.name,
    pdf_url: storage.url(doc.pdfStorageKey),
    field_map: doc.fieldMap,
    page_count: doc.pageCount,
  });
}

// PATCH — same "overwrite this document's own field snapshot" pattern as
// PATCH /api/dashboard/templates/[id] uses for the primary document; this
// is that same save action, scoped to one additional document instead.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = await prisma.templateDocument.findFirst({ where: { id: docId, templateId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.templateDocument.update({
    where: { id: docId },
    data: { fieldMap: body.field_map },
  });

  return NextResponse.json({ ok: true, field_map: updated.fieldMap });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const activeEnvelopeCount = await prisma.envelope.count({ where: { templateId: id, status: { in: [...ACTIVE_ENVELOPE_STATUSES] } } });
  if (activeEnvelopeCount > 0) {
    return NextResponse.json({ error: "This template has envelopes still in progress — its document set can't change until those finish." }, { status: 409 });
  }

  const doc = await prisma.templateDocument.findFirst({ where: { id: docId, templateId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.templateDocument.delete({ where: { id: docId } });
  // Close the order gap so remaining documents stay contiguous (0, 1, 2…) —
  // matters because documentIndex numbering elsewhere assumes no holes.
  await prisma.templateDocument.updateMany({
    where: { templateId: id, order: { gt: doc.order } },
    data: { order: { decrement: 1 } },
  });

  return NextResponse.json({ ok: true });
}
