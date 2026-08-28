import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { setPlatformSetting } from "@/lib/settings";
import { getActiveProviderId } from "@/lib/billing/active-provider";
import { PLATFORM_TIER_PRICING, CREDIT_PACKS } from "@/lib/billing/providers.config";

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireRole(["super_admin", "billing_ops"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const activeProviderId = await getActiveProviderId();
  const formData = await req.formData();

  for (const tier of Object.keys(PLATFORM_TIER_PRICING)) {
    const priceId = formData.get(`price_${tier}`) as string;
    if (priceId?.trim()) {
      await setPlatformSetting(`billing_price_id.${activeProviderId}.${tier}`, priceId.trim(), admin.id);
    }
  }

  for (const packId of Object.keys(CREDIT_PACKS)) {
    const priceId = formData.get(`price_pack_${packId}`) as string;
    if (priceId?.trim()) {
      await setPlatformSetting(`billing_price_id.${activeProviderId}.credit_pack.${packId}`, priceId.trim(), admin.id);
    }
  }

  await logAdminAction(admin, "billing.price_ids_updated", undefined, { provider: activeProviderId }, req.headers.get("x-forwarded-for") ?? undefined);

  return NextResponse.redirect(new URL("/admin/billing", req.url), 303);
}
