import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { setActiveProviderId } from "@/lib/billing/active-provider";
import type { PaymentProviderId } from "@/lib/billing/providers.config";

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireRole(["super_admin", "billing_ops"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const provider = formData.get("provider") as PaymentProviderId;

  await setActiveProviderId(provider, admin.id);
  await logAdminAction(admin, "billing.provider_changed", undefined, { provider }, req.headers.get("x-forwarded-for") ?? undefined);

  return NextResponse.redirect(new URL("/admin/billing", req.url), 303);
}
