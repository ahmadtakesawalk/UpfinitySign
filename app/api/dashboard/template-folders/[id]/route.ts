// DEPLOY TO: app/api/dashboard/template-folders/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

/** Same duck-typed P2002 check as the folder-create route — see that file's comment for why instanceof against Prisma's error class isn't used here. */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.templateFolder.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) return NextResponse.json({ error: "Folder name is required." }, { status: 400 });

    const folder = await prisma.templateFolder.update({ where: { id }, data: { name: name.trim() } });
    return NextResponse.json({ folder });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ error: "A folder with that name already exists." }, { status: 409 });
    }
    await captureException(err, { context: "template_folder_rename", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.templateFolder.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Deleting a folder never deletes templates — they just fall back to "Uncategorized".
    await prisma.template.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await prisma.templateFolder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "template_folder_delete", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
