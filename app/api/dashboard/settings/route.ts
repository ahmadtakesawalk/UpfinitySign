import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const webhookUrl = formData.get("webhookUrl") as string;

    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: { webhookUrl: webhookUrl || null },
    });

    return NextResponse.redirect(new URL("/dashboard/settings", req.url), 303);
  } catch (err) {
    await captureException(err, { context: "settings_webhook_update", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
