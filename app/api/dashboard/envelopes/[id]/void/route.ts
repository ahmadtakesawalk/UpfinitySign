import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { voidEnvelope } from "@/lib/signing/envelopes";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await voidEnvelope(id, user.tenantId, `Voided by ${user.email}`);
  } catch {
    return NextResponse.json({ error: "not found or already in a final state" }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/dashboard/envelopes/${id}`, req.url), 303);
}
