// DEPLOY TO: app/api/v1/envelopes/list/route.ts
// GET /api/v1/envelopes/list — lists this tenant's envelopes, newest first.
// Separate route from /api/v1/envelopes (POST-only, creation) rather than
// making that route handle both methods — keeps the create contract and
// the list contract independently documented and versioned.
//
// This is what an integrating platform (e.g. Dvxel HR) uses to build its
// own "sent / pending / completed" view without polling single envelopes
// one at a time — the same status/signed-pdf/certificate shape as
// GET /api/v1/envelopes/:id, just as a paginated collection.

import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant, requireScope } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

// Provider-facing status groups — collapses the underlying EnvelopeStatus
// enum into the three buckets an integration actually wants to filter by,
// rather than making every caller know our exact internal status names.
const STATUS_GROUPS: Record<string, string[]> = {
  pending: ["sent", "delivered", "opened", "signed"], // in-flight, not yet fully completed — "signed" covers a multi-recipient envelope where one has signed but others haven't
  completed: ["completed"],
  declined: ["declined"],
  voided: ["voided"],
  expired: ["expired"],
};

export async function GET(req: NextRequest) {
  const auth = await authenticateTenant(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireScope(auth, "envelopes:read")) {
    return NextResponse.json({ error: "this API key does not have envelopes:read scope" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status"); // "pending" | "completed" | "declined" | "voided" | "expired" — omit for all
  const externalRef = searchParams.get("external_ref");
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(searchParams.get("limit")) || PAGE_SIZE_DEFAULT));
  const cursor = searchParams.get("cursor"); // opaque — the previous page's last envelope_id, echoed back as next_cursor

  if (statusParam && !STATUS_GROUPS[statusParam]) {
    return NextResponse.json({ error: `status must be one of: ${Object.keys(STATUS_GROUPS).join(", ")}` }, { status: 400 });
  }

  const where = {
    tenantId: auth.tenant.id,
    ...(statusParam ? { status: { in: STATUS_GROUPS[statusParam] } } : {}),
    ...(externalRef ? { externalRef } : {}),
  };

  const envelopes = await prisma.envelope.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to know whether there's a next page, without a separate count query
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      recipients: { select: { id: true, name: true, email: true, role: true, status: true, signedAt: true } },
      certificate: true,
    },
  });

  const hasMore = envelopes.length > limit;
  const page = hasMore ? envelopes.slice(0, limit) : envelopes;

  return NextResponse.json({
    envelopes: page.map((envelope: (typeof page)[number]) => ({
      envelope_id: envelope.id,
      status: envelope.status,
      external_ref: envelope.externalRef,
      created_at: envelope.createdAt,
      expires_at: envelope.expiresAt,
      completed_at: envelope.completedAt,
      recipients: envelope.recipients,
      signed_pdf_url: envelope.signedPdfStorageKey ? storage.url(envelope.signedPdfStorageKey) : null,
      certificate_url: envelope.certificate?.webViewUrl ?? null,
    })),
    next_cursor: hasMore ? page[page.length - 1].id : null,
  });
}
