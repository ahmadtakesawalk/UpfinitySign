import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { assertAddonEnabled, AddonNotEnabledError } from "@/lib/billing/addons";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Re-check here even though the page only shows this form when the
  // add-on is present — the form's existence is a UI convenience, not the
  // security boundary. A direct POST to this endpoint must be gated too.
  try {
    await assertAddonEnabled(user.tenantId, "custom_branding");
  } catch (err) {
    if (err instanceof AddonNotEnabledError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const formData = await req.formData();
  const customLogoUrl = formData.get("customLogoUrl") as string;

  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { customLogoUrl: customLogoUrl || null, brandingEnabled: !!customLogoUrl },
  });

  return NextResponse.redirect(new URL("/dashboard/settings", req.url), 303);
}
