// DEPLOY TO: app/api/dashboard/envelopes/[id]/publish/route.ts
// POST — turns an existing draft into a real, sent envelope (see
// publishDraftEnvelope in lib/signing/envelopes.ts for what actually
// happens: tier-limit check, AI-review gate, status flip, first emails).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { publishDraftEnvelope } from "@/lib/signing/envelopes";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const envelope = await publishDraftEnvelope(user.tenantId, id);
    return NextResponse.json({ envelope_id: envelope.id, status: envelope.status });
  } catch (err) {
    if (err instanceof TierLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    await captureException(err, { context: "dashboard_publish_draft", tenantId: user.tenantId, envelopeId: id });
    const message = err instanceof Error ? err.message : "Couldn't send this draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
