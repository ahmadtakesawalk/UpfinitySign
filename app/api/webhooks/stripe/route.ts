// POST /api/webhooks/stripe — Stripe-specific because webhook signature
// verification is inherently provider-specific (different header names,
// different signing schemes). Everything past parseWebhook() is
// provider-agnostic — see lib/billing/apply-event.ts.

import { NextRequest, NextResponse } from "next/server";
import { stripeProvider } from "@/lib/billing/providers/stripe";
import { applyBillingEvent } from "@/lib/billing/apply-event";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const rawBody = await req.text(); // signature verification needs the raw, unparsed body
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing stripe-signature header" }, { status: 400 });

  try {
    const event = await stripeProvider.parseWebhook(rawBody, signature);
    await applyBillingEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    await captureException(err, { context: "stripe_webhook" });
    return NextResponse.json({ error: "webhook processing failed" }, { status: 400 });
  }
}
