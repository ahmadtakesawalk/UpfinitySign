// DEPLOY TO: app/api/dashboard/templates/[id]/self-serve-link/route.ts
//
// Self-serve links only make sense for single-signer templates — the
// visitor filling out the form IS the signer, so there's no sensible way
// for them to also supply a second recipient's or an approver's details.
// Enabling is refused outright for a template with more than one distinct
// role rather than silently only filling the first slot and leaving
// others blank.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

function uniqueRoles(fieldMap: unknown): Set<string> {
  if (!Array.isArray(fieldMap)) return new Set();
  return new Set(fieldMap.map((f: any) => String(f.role ?? "signer_1")));
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (template.aiDrafted && !template.aiReviewedAt) {
      return NextResponse.json({ error: "Review this AI-drafted document before enabling a self-serve link for it." }, { status: 409 });
    }

    const roles = uniqueRoles(template.fieldMap);
    if (roles.size > 1) {
      return NextResponse.json(
        { error: "Self-serve links only work for single-signer templates — this one has multiple recipient roles." },
        { status: 400 }
      );
    }

    const token = template.selfServeToken ?? randomBytes(20).toString("hex");
    await prisma.template.update({
      where: { id },
      data: { selfServeEnabled: true, selfServeToken: token },
    });

    return NextResponse.json({ url: `${config.appUrl}/self-serve/${token}` });
  } catch (err) {
    await captureException(err, { context: "self_serve_link_enable", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const template = await prisma.template.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Disable only — keep the token so re-enabling doesn't silently break a
    // link someone may have already shared/bookmarked.
    await prisma.template.update({ where: { id }, data: { selfServeEnabled: false } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await captureException(err, { context: "self_serve_link_disable", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
