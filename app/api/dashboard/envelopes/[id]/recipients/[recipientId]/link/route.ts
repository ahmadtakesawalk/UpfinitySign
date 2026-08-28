// DEPLOY TO: app/api/dashboard/envelopes/[id]/recipients/[recipientId]/link/route.ts
//
// For in-person signing: the sender hands their own device to the
// recipient right now instead of waiting on an email. This is the ONLY
// other place besides the reminder-email flow that decrypts
// accessTokenEncrypted — same reasoning as reminders: recovering the
// exact link already sent, not minting a new one, and never used to
// authenticate a request (accessTokenHash is what auth checks against).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/token-crypto";
import { config } from "@/lib/config";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; recipientId: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, recipientId } = await params;
  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId, envelopeId: id, envelope: { tenantId: user.tenantId } },
  });
  if (!recipient) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["signed", "declined"].includes(recipient.status)) {
    return NextResponse.json({ error: "This recipient has already acted — nothing to open." }, { status: 409 });
  }
  if (!recipient.accessTokenEncrypted) {
    return NextResponse.json({ error: "This envelope was sent before link recovery was added — void and resend to get a link." }, { status: 410 });
  }

  const rawToken = decryptToken(recipient.accessTokenEncrypted);
  return NextResponse.json({ url: `${config.appUrl}/sign/${rawToken}` });
}
