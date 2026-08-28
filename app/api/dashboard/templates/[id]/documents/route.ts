// DEPLOY TO: app/api/dashboard/templates/[id]/documents/route.ts
//
// Additional documents on a multi-document template — the primary
// document stays on Template.pdfStorageKey/fieldMap exactly as before;
// these are documents 2+. Same upload + AI-autoplace pattern as
// POST /api/dashboard/templates, just writing to TemplateDocument instead
// of creating a whole new Template.
//
// Blocked from being added/removed while any envelope from this template
// is active — same reasoning as Quick Edit (lib/signing/quick-edit.ts):
// envelopes reference the template's documents directly rather than a
// per-envelope snapshot, so changing the document set mid-signing would
// change what's on someone's screen. See ACTIVE_ENVELOPE_STATUSES.

export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { proposeFields } from "@/lib/llm/field-placement";
import { extractPageLayout } from "@/lib/signing/pdf-layout";
import { convertDocxToPdf, isDocxFile } from "@/lib/signing/docx-convert";
import { captureException } from "@/lib/monitoring";
import { ACTIVE_ENVELOPE_STATUSES } from "@/lib/signing/envelopes";
import { getEffectiveTierLimits } from "@/lib/settings";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const documents = await prisma.templateDocument.findMany({ where: { templateId: id }, orderBy: { order: "asc" } });
  return NextResponse.json({
    documents: documents.map((d: (typeof documents)[number]) => ({
      id: d.id,
      name: d.name,
      pdf_url: storage.url(d.pdfStorageKey),
      page_count: d.pageCount,
      order: d.order,
      field_count: Array.isArray(d.fieldMap) ? d.fieldMap.length : 0,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const activeEnvelopeCount = await prisma.envelope.count({ where: { templateId: id, status: { in: [...ACTIVE_ENVELOPE_STATUSES] } } });
  if (activeEnvelopeCount > 0) {
    return NextResponse.json({ error: "This template has envelopes still in progress — its document set can't change until those finish." }, { status: 409 });
  }

  const existingCount = await prisma.templateDocument.count({ where: { templateId: id } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const limits = await getEffectiveTierLimits(user.tenantId, tenant.tier);
  const totalAfterAdd = existingCount + 2; // +1 for the primary document, +1 for the one being added now
  if (totalAfterAdd > limits.docsPerEnvelope) {
    return NextResponse.json({ error: `Your plan allows up to ${limits.docsPerEnvelope} document${limits.docsPerEnvelope === 1 ? "" : "s"} per envelope.` }, { status: 402 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;
    if (!file || !name) return NextResponse.json({ error: "file and name are required" }, { status: 400 });
    if (file.type !== "application/pdf" && !isDocxFile(file)) {
      return NextResponse.json({ error: "only PDF or Word (.docx) files are supported" }, { status: 400 });
    }

    let pdfBytes: Buffer = Buffer.from(await file.arrayBuffer());
    if (isDocxFile(file)) {
      try {
        pdfBytes = (await convertDocxToPdf(pdfBytes)).pdfBytes;
      } catch {
        return NextResponse.json({ error: "Couldn't convert this Word document. Try saving it as a PDF and uploading that instead." }, { status: 422 });
      }
    }
    const key = `templates/${user.tenantId}/${id}/${Date.now()}-${file.name.replace(/\.docx$/i, ".pdf")}`;
    const stored = await storage.put(key, pdfBytes, "application/pdf");

    let proposedFields: Awaited<ReturnType<typeof proposeFields>> = [];
    let pageCount = 1;
    try {
      const layout = await extractPageLayout(pdfBytes);
      pageCount = layout.length;
      proposedFields = await proposeFields(layout);
    } catch {
      proposedFields = []; // same convenience-not-requirement fallback as the primary-document upload path
    }

    const doc = await prisma.templateDocument.create({
      data: {
        templateId: id,
        name,
        pdfStorageKey: stored.key,
        fieldMap: proposedFields as any,
        pageCount,
        order: existingCount,
      },
    });

    return NextResponse.json({ document_id: doc.id, pdf_url: storage.url(stored.key), field_map: proposedFields, page_count: pageCount }, { status: 201 });
  } catch (err) {
    await captureException(err, { context: "template_document_upload", tenantId: user.tenantId, templateId: id });
    return NextResponse.json({ error: "Something went wrong uploading this document. Please try again." }, { status: 500 });
  }
}
