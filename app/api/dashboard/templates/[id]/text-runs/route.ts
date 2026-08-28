// DEPLOY TO: app/api/dashboard/templates/[id]/text-runs/route.ts
// GET — extracted, editable text lines for this template's current PDF.
// Re-run this after every applied Quick Edit rather than trying to patch
// previously-returned line positions/ids client-side — line ids are only
// stable within one extraction pass (see extractEditableLines's comment).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { extractEditableLines } from "@/lib/signing/quick-edit";
import { captureException } from "@/lib/monitoring";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const pdfBytes = await storage.get(template.pdfStorageKey);
    const lines = await extractEditableLines(pdfBytes);
    return NextResponse.json({ lines });
  } catch (err) {
    await captureException(err, { context: "quick_edit_text_runs", templateId: id });
    return NextResponse.json({ error: "Couldn't read this document's text." }, { status: 500 });
  }
}
