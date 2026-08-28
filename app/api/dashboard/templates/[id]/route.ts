// DEPLOY TO: app/api/dashboard/templates/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: template.id,
    name: template.name,
    field_map: template.fieldMap,
    pdf_url: storage.url(template.pdfStorageKey),
    created_at: template.createdAt,
    ai_drafted: template.aiDrafted,
    ai_reviewed_at: template.aiReviewedAt,
    self_serve_enabled: template.selfServeEnabled,
    self_serve_url: template.selfServeToken ? `${config.appUrl}/self-serve/${template.selfServeToken}` : null,
  });
}

interface UpdateBody {
  name?: string;
  field_map?: unknown;
  folder_id?: string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = (await req.json()) as UpdateBody;
    if (body.folder_id) {
      const folder = await prisma.templateFolder.findFirst({ where: { id: body.folder_id, tenantId: user.tenantId } });
      if (!folder) return NextResponse.json({ error: "That folder doesn't exist." }, { status: 400 });
    }

    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.field_map !== undefined ? { fieldMap: body.field_map as any } : {}),
        ...(body.folder_id !== undefined ? { folderId: body.folder_id } : {}),
      },
    });

    return NextResponse.json({ id: template.id, name: template.name, field_map: template.fieldMap, folder_id: template.folderId });
  } catch (err) {
    await captureException(err, { context: "template_update", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.template.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { _count: { select: { envelopes: true } } },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing._count.envelopes > 0) {
      return NextResponse.json(
        { error: "This template has envelopes sent from it and can't be deleted — its send history has to stay intact." },
        { status: 409 }
      );
    }

    await prisma.template.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "template_delete", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
