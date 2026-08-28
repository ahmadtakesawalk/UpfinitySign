// GET /api/v1/tenant/export — full data export for the requesting tenant.
// Owner-only (dashboard session) — see PRD §14. Returns metadata + storage
// links, not the raw PDF bytes inline (keeps the response small; the
// storage URLs are already tenant-scoped and usable directly).

import { NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can export data" }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: user.tenantId },
    include: {
      templates: true,
      envelopes: {
        include: { recipients: true, certificate: true, auditEvents: true },
      },
      users: { select: { email: true, role: true, createdAt: true } }, // no passwordHash
      apiKeys: { select: { id: true, name: true, scopes: true, createdAt: true, revokedAt: true } }, // no keyHash
    },
  });

  const exportPayload = {
    exported_at: new Date().toISOString(),
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, tier: tenant.tier },
    templates: tenant.templates,
    envelopes: tenant.envelopes,
    users: tenant.users,
    api_keys: tenant.apiKeys,
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="upfinity-sign-export-${tenant.slug}.json"`,
    },
  });
}
