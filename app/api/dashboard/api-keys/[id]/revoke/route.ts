import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  // Scope the update by tenantId too — never trust the id alone, or a
  // tenant admin could revoke another tenant's key by guessing its id.
  const result = await prisma.apiKey.updateMany({
    where: { id, tenantId: user.tenantId },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
