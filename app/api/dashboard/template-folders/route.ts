// DEPLOY TO: app/api/dashboard/template-folders/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

/**
 * Duck-typed check for Prisma's "unique constraint violated" error, rather
 * than `instanceof Prisma.PrismaClientKnownRequestError` — that class is
 * only reliably resolvable against a fully generated Prisma Client, and
 * checking the shape directly (a `code` property equal to "P2002") works
 * regardless of exactly how the client was generated.
 */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export async function GET() {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const folders = await prisma.templateFolder.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      include: { _count: { select: { templates: true } } },
    });

    return NextResponse.json({ folders });
  } catch (err) {
    await captureException(err, { context: "template_folders_list", tenantId: user.tenantId });
    return NextResponse.json({ error: "Couldn't load folders. Please try again." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Folder name is required." }, { status: 400 });

  try {
    const folder = await prisma.templateFolder.create({
      data: { tenantId: user.tenantId, name: name.trim() },
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    // P2002 is Prisma's specific "unique constraint violated" code — this
    // is the ONLY case that means "a folder with that name already
    // exists". A bare catch{} here (the previous version) would've
    // mislabeled ANY failure — a database connection drop, a genuine bug
    // — as a naming conflict, which is actively misleading to whoever
    // sees the message.
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ error: "A folder with that name already exists." }, { status: 409 });
    }
    await captureException(err, { context: "template_folder_create", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong creating this folder. Please try again." }, { status: 500 });
  }
}
