// DEPLOY TO: app/api/admin/staff/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

async function countSuperAdmins(excludeId?: string): Promise<number> {
  return prisma.platformAdmin.count({
    where: { role: "super_admin", ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let currentAdmin;
  try {
    currentAdmin = await requireRole(["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { role } = await req.json();
  const validRoles = ["super_admin", "support", "billing_ops"];
  if (!role || !validRoles.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
  }

  const target = await prisma.platformAdmin.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (target.role === "super_admin" && role !== "super_admin") {
    // Demoting the last super_admin would leave nobody able to manage
    // staff at all — including undoing this exact mistake. Refuse rather
    // than allow a platform to lock itself out of its own admin tier.
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) {
      return NextResponse.json({ error: "Can't demote the last super_admin — promote someone else first." }, { status: 409 });
    }
  }

  await prisma.platformAdmin.update({ where: { id }, data: { role } });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  await logAdminAction(currentAdmin, "staff.role_changed", undefined, { targetAdminId: id, targetEmail: target.email, newRole: role }, ip);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let currentAdmin;
  try {
    currentAdmin = await requireRole(["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === currentAdmin.id) {
    return NextResponse.json({ error: "You can't remove your own access — have another super_admin do it." }, { status: 400 });
  }

  const target = await prisma.platformAdmin.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (target.role === "super_admin") {
    const remaining = await countSuperAdmins(target.id);
    if (remaining === 0) {
      return NextResponse.json({ error: "Can't remove the last super_admin." }, { status: 409 });
    }
  }

  await prisma.platformAdmin.delete({ where: { id } });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  await logAdminAction(currentAdmin, "staff.removed", undefined, { targetEmail: target.email }, ip);

  return NextResponse.json({ ok: true });
}
