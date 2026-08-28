// DEPLOY TO: app/api/dashboard/assistant/apply/route.ts
//
// The chat endpoint only ever proposes — this is the one place a proposal
// actually becomes a database write, and only after the person clicked
// confirm in the UI. Field edits are applied against the template's
// CURRENT field map fetched fresh here (not whatever the client last had
// in memory), so a stale client can't clobber a concurrent edit from
// another tab/teammate.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { wrapHtml, renderHtmlToPdf } from "@/lib/documents/html-to-pdf";
import type { AssistantAction } from "@/lib/llm/assistant";
import { captureException } from "@/lib/monitoring";

interface ApplyBody {
  action: AssistantAction;
  templateId?: string;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as ApplyBody;
    const { action } = body;

    if (action.kind === "clarify") {
      return NextResponse.json({ error: "Nothing to apply — this turn was a clarifying question, not a proposal." }, { status: 400 });
    }

    if (action.kind === "generate_document") {
      try {
        const pdfBytes = await renderHtmlToPdf(wrapHtml(action.bodyHtml));
        const key = `templates/${user.tenantId}/${Date.now()}-ai-generated.pdf`;
        const stored = await storage.put(key, pdfBytes, "application/pdf");

        const fieldMap = action.suggestedFields.map((f, i) => ({ id: `f_${Date.now()}_${i}`, ...f }));

        const template = await prisma.template.create({
          data: {
            tenantId: user.tenantId,
            name: action.title,
            pdfStorageKey: stored.key,
            fieldMap: fieldMap as any,
            aiDrafted: true, // must be explicitly reviewed before it can be used to send — see lib/signing/envelopes.ts's createEnvelope guard
          },
        });
        return NextResponse.json({ template_id: template.id });
      } catch (err) {
        // Kept as its own specific message (distinct from the outer
        // catch's generic one) — document generation involves headless
        // Chromium + storage upload, genuinely more likely to fail than a
        // simple field edit, and "couldn't generate the document" is more
        // actionable than a generic error here.
        await captureException(err, { context: "assistant_apply_generate_document", tenantId: user.tenantId });
        return NextResponse.json({ error: "Couldn't generate the document — try again." }, { status: 500 });
      }
    }

    // Everything else is a field mutation on an existing template.
    if (!body.templateId) {
      return NextResponse.json({ error: "Missing templateId." }, { status: 400 });
    }
    const template = await prisma.template.findFirst({ where: { id: body.templateId, tenantId: user.tenantId } });
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });

    const currentFields = (template.fieldMap as any[]) ?? [];
    let updatedFields: any[];

    if (action.kind === "add_field") {
      const newField = { id: `f_${Date.now()}`, ...action.field };
      updatedFields = [...currentFields, newField];
    } else if (action.kind === "edit_field") {
      if (!currentFields.some((f) => f.id === action.fieldId)) {
        return NextResponse.json({ error: "That field no longer exists — it may have been removed since this was proposed." }, { status: 409 });
      }
      updatedFields = currentFields.map((f) => (f.id === action.fieldId ? { ...f, ...action.changes } : f));
    } else if (action.kind === "remove_field") {
      updatedFields = currentFields.filter((f) => f.id !== action.fieldId);
    } else {
      return NextResponse.json({ error: "Unknown action kind." }, { status: 400 });
    }

    await prisma.template.update({ where: { id: template.id }, data: { fieldMap: updatedFields as any } });
    return NextResponse.json({ field_map: updatedFields });
  } catch (err) {
    // This outer catch is what was actually missing — the field-edit path
    // (add_field/edit_field/remove_field, the more common case) had zero
    // protection before this; only generate_document did.
    await captureException(err, { context: "assistant_apply", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong applying that change. Please try again." }, { status: 500 });
  }
}
