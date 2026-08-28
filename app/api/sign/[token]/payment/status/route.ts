// DEPLOY TO: app/api/sign/[token]/payment/status/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { isFieldPaid } from "@/lib/signing/payment";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const fieldId = req.nextUrl.searchParams.get("field_id");
  if (!fieldId) return NextResponse.json({ error: "field_id required" }, { status: 400 });

  const recipient = await prisma.recipient.findUnique({ where: { accessTokenHash: hashToken(token) } });
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });

  const paid = await isFieldPaid(recipient.envelopeId, fieldId);
  return NextResponse.json({ paid });
}
