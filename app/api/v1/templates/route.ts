// POST /api/v1/templates — upload a PDF, get AI-proposed field placements
// back for confirmation in the template builder UI. See PRD.md §9.

// PDF layout extraction + an LLM call can exceed the default timeout on
// larger documents — see PRD §14 performance notes.
export const maxDuration = 60; // bumped from 30 — headless Chromium launch for .docx conversion adds real latency on top of PDF layout extraction + AI field placement

import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant, requireScope } from "@/lib/auth";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { proposeFields } from "@/lib/llm/field-placement";
import { extractPageLayout } from "@/lib/signing/pdf-layout";
import { convertDocxToPdf, isDocxFile } from "@/lib/signing/docx-convert";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const auth = await authenticateTenant(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Uploading a template is a write operation (it creates a new Template
  // row a sender/integration could then use to send envelopes) — same
  // scope requirement as creating an envelope, matching the vocabulary in
  // app/api/dashboard/api-keys/route.ts (there's no separate
  // templates:write scope). Previously unchecked here, unlike the other
  // write endpoints (bulk send, envelope creation) — unreachable through
  // the current UI since every key created there gets full default
  // scopes, but a key created with a narrower scopes array directly
  // against the dashboard API wouldn't have been restricted here.
  if (!requireScope(auth, "envelopes:write")) {
    return NextResponse.json({ error: "this API key does not have envelopes:write scope" }, { status: 403 });
  }

  try {
    await assertWithinRateLimit(auth.tenant.id);
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
    if (!file || !name) {
      return NextResponse.json({ error: "file and name are required" }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !isDocxFile(file)) {
      return NextResponse.json({ error: "only PDF or Word (.docx) files are supported" }, { status: 400 });
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
    const key = `templates/${auth.tenant.id}/${Date.now()}-${file.name.replace(/\.docx$/i, ".pdf")}`;
    const stored = await storage.put(key, pdfBytes, "application/pdf");

    let proposedFields: Awaited<ReturnType<typeof proposeFields>> = [];
    try {
      const layout = await extractPageLayout(pdfBytes);
      proposedFields = await proposeFields(layout);
    } catch {
      // Same reasoning as the dashboard upload route: AI placement is a
      // convenience, not a requirement. Previously this route let that
      // failure kill the whole upload — inconsistent with the dashboard
      // version, and worse for an integration that just wants the
      // template to exist so it can place fields itself via the API.
      proposedFields = [];
    }

    const template = await prisma.template.create({
      data: {
        tenantId: auth.tenant.id,
        name,
        pdfStorageKey: stored.key,
        fieldMap: proposedFields as any, // sender confirms/edits these in the builder UI before first send
      },
    });

    return NextResponse.json(
      { template_id: template.id, proposed_fields: proposedFields },
      { status: 201 }
    );
  } catch (err) {
    await captureException(err, { context: "v1_template_upload", tenantId: auth.tenant.id });
    return NextResponse.json({ error: "Something went wrong uploading this document. Please try again." }, { status: 500 });
  }
}
