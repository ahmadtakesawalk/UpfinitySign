import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const currentUser = await getCurrentTenantUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(currentUser, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can remove teammates" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const target = await prisma.tenantUser.findFirst({ where: { id, tenantId: currentUser.tenantId } });
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (target.role === "owner") {
      const ownerCount = await prisma.tenantUser.count({ where: { tenantId: currentUser.tenantId, role: "owner" } });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "Can't remove the last owner — transfer ownership first." }, { status: 400 });
      }
    }

    await prisma.tenantUser.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "team_remove", tenantId: currentUser.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
