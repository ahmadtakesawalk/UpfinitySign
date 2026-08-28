// DEPLOY TO: app/api/dashboard/templates/[id]/quick-edit/route.ts
// POST — applies one or more line-level text edits to this template's PDF
// and replaces pdfStorageKey with the result (a new storage object, old
// one left in place — no cleanup job for it here, matches how the rest of
// this codebase treats storage as cheap and doesn't proactively delete
// superseded files elsewhere either).
//
// Blocked while any envelope sent from this template is still active: the
// signing page (app/api/sign/[token]/route.ts) resolves pdf_url straight
// from Envelope -> Template.pdfStorageKey, not from a per-envelope PDF
// snapshot — only the field_map gets snapshotted onto the envelope. So
// editing the template's PDF while someone's mid-signing would silently
// change the document underneath them, including possibly after they've
// already reviewed it. That's a correctness problem regardless of intent,
// not just a cautious default — see ACTIVE_ENVELOPE_STATUSES import.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { applyQuickEdits, type QuickEdit } from "@/lib/signing/quick-edit";
import { ACTIVE_ENVELOPE_STATUSES } from "@/lib/signing/envelopes";
import { captureException } from "@/lib/monitoring";

interface Body {
  edits: QuickEdit[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  const activeEnvelopeCount = await prisma.envelope.count({
    where: { templateId: id, status: { in: [...ACTIVE_ENVELOPE_STATUSES] } },
  });
  if (activeEnvelopeCount > 0) {
    return NextResponse.json(
      { error: `${activeEnvelopeCount} envelope${activeEnvelopeCount === 1 ? " is" : "s are"} still in progress from this template — editing the document now would change what's on someone's screen mid-signing. Duplicate this template to send an edited version instead, or wait until those finish.` },
      { status: 409 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(body.edits) || body.edits.length === 0) {
    return NextResponse.json({ error: "No edits provided." }, { status: 400 });
  }

  try {
    const pdfBytes = await storage.get(template.pdfStorageKey);
    const editedBytes = await applyQuickEdits(pdfBytes, body.edits);
    const key = `templates/${id}/quick-edit-${Date.now()}.pdf`;
    const stored = await storage.put(key, editedBytes, "application/pdf");
    await prisma.template.update({ where: { id }, data: { pdfStorageKey: stored.key } });
    return NextResponse.json({ ok: true, pdf_url: storage.url(stored.key) });
  } catch (err) {
    await captureException(err, { context: "quick_edit_apply", templateId: id });
    return NextResponse.json({ error: "Couldn't apply those edits — please try again." }, { status: 500 });
  }
}
