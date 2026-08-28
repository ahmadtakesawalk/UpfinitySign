// DEPLOY TO: lib/signing/payment.ts
//
// Payment fields collect money on behalf of a TENANT (their customer
// paying a fee, deposit, whatever the document calls for) — not on behalf
// of Upfinity. That distinction is the whole reason this can't reuse
// lib/billing/providers/stripe.ts: that file charges the PLATFORM's own
// Stripe account for tenant subscriptions/credits. This file uses Stripe
// Connect so the money lands in the TENANT's own connected account, with
// Upfinity never taking custody of it. Routing a tenant's customer's
// payment through the platform's own account would be a real legal/
// accounting problem, not just an architectural preference.
//
// Genuinely inert until STRIPE_SECRET_KEY is set, same as every other
// provider integration in this codebase — no account was or can be
// created from in here.

import Stripe from "stripe";
import { prisma } from "../db";
import { config } from "../config";

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — required for payment field collection");
  return new Stripe(key);
}

/** Generates (or resumes) Stripe's hosted onboarding flow for a tenant's connected account — this is what the "Connect Stripe" button in Settings drives. */
export async function createConnectOnboardingLink(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const stripe = client();

  let accountId = tenant.stripeConnectedAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({ type: "express" });
    accountId = account.id;
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeConnectedAccountId: accountId } });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${config.appUrl}/dashboard/settings?stripe_connect=refresh`,
    return_url: `${config.appUrl}/dashboard/settings?stripe_connect=return`,
    type: "account_onboarding",
  });
  return link.url;
}

export interface StartPaymentInput {
  envelopeId: string;
  recipientId: string;
  fieldId: string;
  tenantId: string;
  amountCents: number;
  currency: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
}

export async function startFieldPayment(input: StartPaymentInput): Promise<{ checkoutUrl: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
  if (!tenant.stripeConnectedAccountId || !tenant.stripeConnectOnboarded) {
    throw new Error("This workspace hasn't finished connecting Stripe yet — payment collection isn't available.");
  }

  const stripe = client();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: input.currency,
          unit_amount: input.amountCents,
          product_data: { name: input.description || "Payment" },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // This is the actual fund-routing line — transfer_data.destination
      // sends the charge to the TENANT's connected account. Without this,
      // the money would sit in the platform's own Stripe balance.
      transfer_data: { destination: tenant.stripeConnectedAccountId },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { kind: "envelope_payment", envelopeId: input.envelopeId, recipientId: input.recipientId, fieldId: input.fieldId },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  await prisma.envelopePayment.create({
    data: {
      envelopeId: input.envelopeId,
      recipientId: input.recipientId,
      fieldId: input.fieldId,
      stripeCheckoutSessionId: session.id,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "pending",
    },
  });

  return { checkoutUrl: session.url };
}

/** The only source of truth for "has this field been paid" — server-side, never derived from anything the client submits. */
export async function isFieldPaid(envelopeId: string, fieldId: string): Promise<boolean> {
  const payment = await prisma.envelopePayment.findFirst({
    where: { envelopeId, fieldId, status: "paid" },
  });
  return Boolean(payment);
}
