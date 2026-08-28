// POST /api/dashboard/billing/checkout?tier=business  (subscription upgrade)
// POST /api/dashboard/billing/checkout?pack=envelopes_50  (one-time credit top-up)
// POST /api/dashboard/billing/checkout?add_card=1  (trial: save a card, no charge yet)
// POST /api/dashboard/billing/checkout?update_payment=1  (existing customer replacing a failed card — dunning recovery)
// Redirects the tenant to whichever payment provider is currently active
// — this route never mentions Stripe or any other provider by name.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { getActivePaymentProvider } from "@/lib/billing/active-provider";
import { PLATFORM_TIER_PRICING, CREDIT_PACKS } from "@/lib/billing/providers.config";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner"])) {
    return NextResponse.json({ error: "only the workspace owner can change billing" }, { status: 403 });
  }

  const tier = req.nextUrl.searchParams.get("tier");
  const packId = req.nextUrl.searchParams.get("pack");
  const addCard = req.nextUrl.searchParams.get("add_card") === "1";
  const updatePayment = req.nextUrl.searchParams.get("update_payment") === "1";

  if (!tier && !packId && !addCard && !updatePayment) {
    return NextResponse.json({ error: "Provide ?tier=, ?pack=, ?add_card=1, or ?update_payment=1" }, { status: 400 });
  }
  if (tier && !PLATFORM_TIER_PRICING[tier]) {
    return NextResponse.json({ error: `"${tier}" isn't a self-serve tier — see PLATFORM_TIER_PRICING` }, { status: 400 });
  }
  if (packId && !CREDIT_PACKS[packId]) {
    return NextResponse.json({ error: `"${packId}" isn't a known credit pack — see CREDIT_PACKS` }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });

  try {
    const provider = await getActivePaymentProvider();
    let product;
    if (updatePayment) {
      const subscription = await prisma.subscription.findUnique({ where: { tenantId: tenant.id } });
      product = { kind: "update_payment_method" as const, existingExternalCustomerId: subscription?.externalCustomerId ?? undefined };
    } else if (addCard) {
      product = { kind: "trial_card_setup" as const };
    } else if (packId) {
      product = { kind: "credit_pack" as const, packId };
    } else {
      product = { kind: "tier" as const, tier: tier! };
    }

    const { checkoutUrl } = await provider.createCheckoutSession({
      tenantId: tenant.id,
      tenantEmail: user.email,
      successUrl: `${config.appUrl}/dashboard/settings?billing=success`,
      cancelUrl: `${config.appUrl}/dashboard/settings?billing=cancelled`,
      ...product,
    });
    return NextResponse.redirect(checkoutUrl, 303);
  } catch (err) {
    await captureException(err, { context: "billing_checkout_init", tenantId: tenant.id, tier, packId, addCard, updatePayment });
    return NextResponse.json({ error: "Couldn't start checkout — the billing provider may not be fully configured yet." }, { status: 500 });
  }
}
