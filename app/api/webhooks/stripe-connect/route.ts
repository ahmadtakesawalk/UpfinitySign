// DEPLOY TO: app/api/webhooks/stripe-connect/route.ts
//
// Separate endpoint from /api/webhooks/stripe on purpose: that one
// verifies against STRIPE_WEBHOOK_SECRET for the platform's own Stripe
// account's events (tenant subscriptions/credits). This one verifies
// against a DIFFERENT webhook secret configured on Stripe Connect's
// platform-level webhook (which receives events across every connected
// account) — mixing the two into one switch statement would make it easy
// to accidentally cross-wire a platform billing event with tenant payment
// money, which is exactly the kind of bug that shouldn't be possible by
// construction. Configure this endpoint URL in the Stripe Dashboard's
// Connect webhook settings, not the regular webhook settings.

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { captureException } from "@/lib/monitoring";

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = client().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    await captureException(err, { context: "stripe_connect_webhook_signature" });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        if (account.charges_enabled) {
          await prisma.tenant.updateMany({
            where: { stripeConnectedAccountId: account.id },
            data: { stripeConnectOnboarded: true },
          });
        }
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind !== "envelope_payment") break; // not ours — some other Connect checkout, ignore
        await prisma.envelopePayment.updateMany({
          where: { stripeCheckoutSessionId: session.id },
          data: { status: "paid", paidAt: new Date() },
        });
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind !== "envelope_payment") break;
        await prisma.envelopePayment.updateMany({
          where: { stripeCheckoutSessionId: session.id, status: "pending" },
          data: { status: "expired" },
        });
        break;
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    await captureException(err, { context: "stripe_connect_webhook_handling", eventType: event.type });
    return NextResponse.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
