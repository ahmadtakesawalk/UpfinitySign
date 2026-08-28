// Stripe implementation of lib/billing/payment-provider.ts. Method
// signatures verified against the actual installed `stripe` package's
// .d.ts files, not assumed from memory — same discipline as lib/jackson.ts.
// Genuinely inert until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are
// set — no account was or can be created from in here.
//
// This is the ONLY file in the codebase allowed to import the `stripe`
// package or know Stripe-specific concepts (payment intents, setup mode,
// price IDs). Everything it exposes outward — through the PaymentProvider
// interface — uses provider-neutral naming (externalCustomerId,
// externalChargeReference), never "stripe" in a field name. Two whole
// pieces of logic (dunning recovery, refunds) used to live directly in
// lib/billing/dunning.ts and lib/billing/refund.ts, importing this SDK
// straight from generic code — moved in here where they actually belong,
// see retryFailedPaymentWithNewCard and refundCharge below.

import Stripe from "stripe";
import { getPlatformSetting } from "../../settings";
import { CREDIT_PACKS } from "../providers.config";
import type { PaymentProvider, CheckoutSessionResult, BillingEvent } from "../payment-provider";

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — required to use Stripe as the active billing provider");
  return new Stripe(key);
}

/** Stripe Price IDs are provider-specific and set by the super admin, not hardcoded — see /admin/billing. */
async function priceIdForTier(tier: string): Promise<string> {
  const priceId = await getPlatformSetting<string | null>(`billing_price_id.stripe.${tier}`, null);
  if (!priceId) throw new Error(`No Stripe Price ID configured for tier "${tier}" — set it in /admin/billing first`);
  return priceId;
}

/** Separate key namespace from tier prices — a credit pack is a one-time Price object in Stripe, not a recurring one, so it can't share the tier's Price ID even if the pack and tier happened to cost the same. */
async function priceIdForCreditPack(packId: string): Promise<string> {
  const priceId = await getPlatformSetting<string | null>(`billing_price_id.stripe.credit_pack.${packId}`, null);
  if (!priceId) throw new Error(`No Stripe Price ID configured for credit pack "${packId}" — set it in /admin/billing first`);
  return priceId;
}

/**
 * Resolves a Checkout Session id (or, if given directly, a subscription
 * id) down to a chargeable payment intent id. Genuinely non-trivial:
 * a one-time "payment" mode session has payment_intent directly on it; a
 * "subscription" mode session does not — the actual charge lives on the
 * subscription's latest invoice, one hop further away.
 */
async function resolvePaymentIntentId(stripe: Stripe, reference: string): Promise<string | null> {
  if (reference.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(reference);
    if (session.payment_intent) {
      return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
    }
    if (session.subscription) {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      return resolvePaymentIntentId(stripe, subscriptionId);
    }
    return null;
  }
  if (reference.startsWith("sub_")) {
    const subscription = await stripe.subscriptions.retrieve(reference, { expand: ["latest_invoice.payment_intent"] });
    const latestInvoice = subscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice !== "string" && latestInvoice.payment_intent) {
      return typeof latestInvoice.payment_intent === "string" ? latestInvoice.payment_intent : latestInvoice.payment_intent.id;
    }
    return null;
  }
  return reference; // already a payment intent / charge id
}

export const stripeProvider: PaymentProvider = {
  async createCheckoutSession(params): Promise<CheckoutSessionResult> {
    const { tenantId, tenantEmail, successUrl, cancelUrl } = params;

    if (params.kind === "update_payment_method") {
      // Distinct from trial_card_setup: this is for an existing paying
      // customer whose card needs replacing (dunning recovery), so it
      // reuses their real Stripe customer if we have one on file rather
      // than creating a duplicate customer record the way trial signup
      // does (where no customer exists yet at all).
      const session = await client().checkout.sessions.create({
        mode: "setup",
        ...(params.existingExternalCustomerId
          ? { customer: params.existingExternalCustomerId }
          : { customer_email: tenantEmail, customer_creation: "always" }),
        client_reference_id: tenantId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { tenantId, kind: "update_payment_method" },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { checkoutUrl: session.url };
    }

    if (params.kind === "trial_card_setup") {
      // mode: "setup" collects and saves a payment method WITHOUT charging
      // anything — exactly what "card required to keep using the trial"
      // needs. customer_creation: "always" makes Stripe create a real
      // Customer object even though nothing's being charged yet, so the
      // resulting customer id can be billed for real once the trial
      // converts (see lib/billing/trial.ts).
      const session = await client().checkout.sessions.create({
        mode: "setup",
        customer_email: tenantEmail,
        customer_creation: "always",
        client_reference_id: tenantId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { tenantId, kind: "trial_card_setup" },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { checkoutUrl: session.url };
    }

    if (params.kind === "credit_pack") {
      const pack = CREDIT_PACKS[params.packId];
      if (!pack) throw new Error(`Unknown credit pack "${params.packId}"`);
      const priceId = await priceIdForCreditPack(params.packId);

      const session = await client().checkout.sessions.create({
        mode: "payment", // one-time, not "subscription" — this is the whole reason tier and credit-pack checkout can't share one code path
        customer_email: tenantEmail,
        client_reference_id: tenantId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { tenantId, kind: "credit_pack", packId: params.packId },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { checkoutUrl: session.url };
    }

    const priceId = await priceIdForTier(params.tier);
    const session = await client().checkout.sessions.create({
      mode: "subscription",
      customer_email: tenantEmail,
      client_reference_id: tenantId, // this is how the webhook maps back to a Tenant row — see parseWebhook below
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenantId, kind: "tier", tier: params.tier }, // on the CHECKOUT SESSION — covers checkout.session.completed
      subscription_data: { metadata: { tenantId, tier: params.tier } }, // also on the resulting SUBSCRIPTION — covers customer.subscription.deleted, which fires on the subscription object, not the session
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { checkoutUrl: session.url };
  },

  async createSubscriptionForExistingCustomer(externalCustomerId: string, tier: string): Promise<{ subscriptionReference: string }> {
    const priceId = await priceIdForTier(tier);
    const stripe = client();

    // The card saved during trial_card_setup is attached to the customer
    // but not yet set as their default payment method for invoicing —
    // list it and set it explicitly, otherwise this subscription creation
    // has no payment method to charge and would just fail or go unpaid.
    const paymentMethods = await stripe.paymentMethods.list({ customer: externalCustomerId, type: "card" });
    const paymentMethodId = paymentMethods.data[0]?.id;
    if (!paymentMethodId) throw new Error(`Stripe customer ${externalCustomerId} has no saved card to charge`);

    await stripe.customers.update(externalCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: externalCustomerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      metadata: { tier },
    });
    return { subscriptionReference: subscription.id };
  },

  async retryFailedPaymentWithNewCard(externalCustomerId: string): Promise<{ recovered: boolean }> {
    const stripe = client();

    const paymentMethods = await stripe.paymentMethods.list({ customer: externalCustomerId, type: "card" });
    const newest = paymentMethods.data.sort((a, b) => b.created - a.created)[0];
    if (!newest) return { recovered: false };

    await stripe.customers.update(externalCustomerId, {
      invoice_settings: { default_payment_method: newest.id },
    });

    const openInvoices = await stripe.invoices.list({ customer: externalCustomerId, status: "open", limit: 1 });
    const outstanding = openInvoices.data[0];
    if (!outstanding?.id) return { recovered: true }; // nothing currently owed — the new card is on file, that's success

    try {
      await stripe.invoices.pay(outstanding.id, { payment_method: newest.id });
      return { recovered: true };
    } catch {
      return { recovered: false }; // the new card failed too — caller must NOT lift the suspension
    }
  },

  async refundCharge(externalChargeReference: string): Promise<void> {
    const stripe = client();
    const paymentIntentId = await resolvePaymentIntentId(stripe, externalChargeReference);
    if (!paymentIntentId) {
      throw new Error("Couldn't resolve a chargeable payment for this reference — handle the refund directly in the Stripe dashboard.");
    }
    await stripe.refunds.create({ payment_intent: paymentIntentId, reason: "requested_by_customer" });
  },

  async cancelSubscription(externalCustomerId: string): Promise<void> {
    const stripe = client();
    const subscriptions = await stripe.subscriptions.list({ customer: externalCustomerId, status: "active", limit: 1 });
    const subscription = subscriptions.data[0];
    if (!subscription) {
      throw new Error("No active subscription found for this account — nothing to cancel.");
    }
    // cancel_at_period_end, not an immediate cancel() — keeps access through
    // what's already been paid for. The tier downgrade itself happens later
    // via the customer.subscription.deleted webhook once the period actually
    // ends (see the case below and apply-event.ts).
    await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
  },

  async parseWebhook(rawBody: string, signatureHeader: string): Promise<BillingEvent> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

    // constructEvent does the actual signature verification — this is the
    // security-critical line, and it's Stripe's own vetted code doing it,
    // not anything hand-rolled here.
    const event = client().webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id ?? (session.metadata?.tenantId as string | undefined);
        if (!tenantId) throw new Error("checkout.session.completed event is missing tenantId metadata");

        if (session.metadata?.kind === "trial_card_setup") {
          const externalCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
          if (!externalCustomerId) throw new Error("trial_card_setup checkout.session.completed event has no customer id");
          return { type: "trial_card_added", tenantId, externalCustomerId };
        }

        if (session.metadata?.kind === "update_payment_method") {
          const externalCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
          if (!externalCustomerId) throw new Error("update_payment_method checkout.session.completed event has no customer id");
          return { type: "payment_method_updated", tenantId, externalCustomerId };
        }

        if (session.metadata?.kind === "credit_pack") {
          const packId = session.metadata?.packId;
          if (!packId) throw new Error("credit_pack checkout.session.completed event is missing packId metadata");
          return { type: "credits_purchased", tenantId, packId, externalChargeReference: session.id };
        }

        const tier = session.metadata?.tier;
        if (!tier) throw new Error("checkout.session.completed event is missing tier metadata");
        const externalCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        return { type: "checkout_completed", tenantId, tier, externalChargeReference: session.id, externalCustomerId };
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId as string | undefined;
        if (!tenantId) {
          // Shouldn't happen — createCheckoutSession sets subscription_data.metadata.tenantId
          // above, so every subscription this app creates carries it. This only fires for a
          // subscription that somehow exists without that metadata (manually created in the
          // Stripe dashboard, or from before this field was added) — flagging loudly rather
          // than silently no-ops on a real cancellation.
          throw new Error("customer.subscription.deleted: tenantId not in subscription metadata");
        }
        return { type: "subscription_cancelled", tenantId };
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        return { type: "payment_failed", tenantId: (invoice.metadata?.tenantId as string) ?? "" };
      }
      default:
        throw new Error(`Unhandled Stripe event type: ${event.type}`);
    }
  },
};
