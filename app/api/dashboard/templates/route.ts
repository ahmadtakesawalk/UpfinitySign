// DEPLOY TO: app/api/dashboard/templates/route.ts
//
// Dashboard (session-cookie authed) equivalent of POST /api/v1/templates —
// same underlying logic (storage, extractPageLayout, proposeFields), just
// authenticated via the tenant dashboard session instead of an API key.
// This is what unblocks template creation from the UI at all.

export const maxDuration = 60; // bumped from 30 — headless Chromium launch for .docx conversion adds real latency on top of PDF layout extraction + AI field placement

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { proposeFields } from "@/lib/llm/field-placement";
import { extractPageLayout } from "@/lib/signing/pdf-layout";
import { convertDocxToPdf, isDocxFile } from "@/lib/signing/docx-convert";
import { captureException } from "@/lib/monitoring";

export async function GET(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const folderId = req.nextUrl.searchParams.get("folder_id");
    const templates = await prisma.template.findMany({
      where: {
        tenantId: user.tenantId,
        ...(folderId === "none" ? { folderId: null } : folderId ? { folderId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { envelopes: true } }, folder: true },
    });

    return NextResponse.json({ templates: templates.map((t: (typeof templates)[number]) => ({ ...t, pdf_url: storage.url(t.pdfStorageKey) })) });
  } catch (err) {
    await captureException(err, { context: "templates_list", tenantId: user.tenantId });
    return NextResponse.json({ error: "Couldn't load templates. Please try again." }, { status: 500 });
  }
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

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;
    const folderId = (formData.get("folder_id") as string | null) || null;
    if (!file || !name) {
      return NextResponse.json({ error: "file and name are required" }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !isDocxFile(file)) {
      return NextResponse.json({ error: "only PDF or Word (.docx) files are supported" }, { status: 400 });
    }
    if (folderId) {
      const folder = await prisma.templateFolder.findFirst({ where: { id: folderId, tenantId: user.tenantId } });
      if (!folder) return NextResponse.json({ error: "That folder doesn't exist." }, { status: 400 });
    }

    let pdfBytes: Buffer = Buffer.from(await file.arrayBuffer());
    if (isDocxFile(file)) {
      try {
        const converted = await convertDocxToPdf(pdfBytes);
        pdfBytes = converted.pdfBytes;
      } catch {
        return NextResponse.json({ error: "Couldn't convert this Word document. Try saving it as a PDF and uploading that instead." }, { status: 422 });
      }
    }
    const key = `templates/${user.tenantId}/${Date.now()}-${file.name.replace(/\.docx$/i, ".pdf")}`;
    const stored = await storage.put(key, pdfBytes, "application/pdf");

    let proposedFields: Awaited<ReturnType<typeof proposeFields>> = [];
    try {
      const layout = await extractPageLayout(pdfBytes);
      proposedFields = await proposeFields(layout);
    } catch {
      // AI placement is a convenience, not a requirement — if it fails
      // (bad PDF text layer, provider hiccup), the sender lands in the
      // builder with zero fields and places them all manually. That's a
      // worse experience, not a broken one.
      proposedFields = [];
    }

    const template = await prisma.template.create({
      data: {
        tenantId: user.tenantId,
        name,
        pdfStorageKey: stored.key,
        fieldMap: proposedFields as any,
        folderId,
      },
    });

    return NextResponse.json({ template_id: template.id, pdf_url: storage.url(stored.key), field_map: proposedFields }, { status: 201 });
  } catch (err) {
    // This outer catch is the real fix here — storage.put() in particular
    // was completely unprotected, and misconfigured/missing storage
    // credentials on a fresh deployment is a genuinely common first-run
    // failure, not a hypothetical one.
    await captureException(err, { context: "template_upload", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong uploading this document. Please try again." }, { status: 500 });
  }
}
