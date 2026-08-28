// The one interface every payment provider implements. Business logic
// (checkout initiation, webhook handling → tier updates, refunds, dunning
// recovery) calls THIS, never a provider SDK directly — same discipline as
// lib/llm/client.ts and lib/storage/index.ts. Adding a third provider
// (LemonSqueezy, Chargebee, whatever) means writing one file that satisfies
// this interface and registering it in providers.config.ts +
// getActiveProvider() below — nothing else in the app changes.
//
// Every field and parameter here is deliberately named "external", not
// "stripe" — even though Stripe is currently the only real implementation.
// Naming a field after today's provider is exactly the kind of leak that
// defeats the whole point of having this interface; see lib/billing/
// dunning.ts and lib/billing/refund.ts, which used to import the Stripe
// SDK directly and got rewritten to call through here instead.

export interface CheckoutSessionResult {
  checkoutUrl: string;
}

export interface BillingEvent {
  type: "checkout_completed" | "subscription_cancelled" | "payment_failed" | "credits_purchased" | "trial_card_added" | "payment_method_updated";
  tenantId: string;
  tier?: string; // present for checkout_completed
  packId?: string; // present for credits_purchased — key into CREDIT_PACKS
  externalCustomerId?: string; // present for checkout_completed, trial_card_added, and payment_method_updated — the provider's own customer reference
  externalChargeReference?: string; // present for checkout_completed/credits_purchased — stored on the resulting Invoice row so a refund can resolve back to the actual charge later, whatever form that reference takes for the active provider
}

// Three distinct checkout shapes: a recurring tier subscription, a
// one-time credit pack top-up, or (for the free-trial card requirement,
// and for dunning recovery) a card-only setup with no charge at all.
// Discriminated on `kind` rather than separate methods —
// providers.config.ts's CREDIT_PACKS is where a new pack gets added, not
// here.
export type CheckoutProduct =
  | { kind: "tier"; tier: string }
  | { kind: "credit_pack"; packId: string }
  | { kind: "trial_card_setup" }
  | { kind: "update_payment_method"; existingExternalCustomerId?: string };

export interface PaymentProvider {
  createCheckoutSession(
    params: {
      tenantId: string;
      tenantEmail: string;
      successUrl: string;
      cancelUrl: string;
    } & CheckoutProduct
  ): Promise<CheckoutSessionResult>;

  /**
   * Charges an already-saved payment method for a recurring tier
   * subscription, with no interactive checkout redirect involved — used
   * only by the trial-conversion cron (lib/billing/trial.ts), where the
   * card was saved days earlier via a trial_card_setup checkout and now
   * needs to actually be billed on a schedule the platform controls, not
   * in response to someone clicking a button right now.
   */
  createSubscriptionForExistingCustomer(externalCustomerId: string, tier: string): Promise<{ subscriptionReference: string }>;

  /**
   * The actual recovery mechanic for a dunning-suspended tenant who just
   * added a new card: makes the new card the customer's default, retries
   * whatever charge was failing, and reports back whether it actually
   * succeeded — the caller (lib/billing/dunning.ts) only lifts the
   * suspension if this returns true, never on faith that saving a card
   * was enough.
   */
  retryFailedPaymentWithNewCard(externalCustomerId: string): Promise<{ recovered: boolean }>;

  /**
   * Issues a real refund against a previously charged reference (the
   * externalChargeReference stored on the original Invoice row) — called
   * only by lib/billing/refund.ts, never anywhere else.
   */
  refundCharge(externalChargeReference: string): Promise<void>;

  /**
   * Self-serve subscription cancellation, owner-initiated from Settings.
   * Deliberately schedules cancellation for the end of the current billing
   * period rather than cancelling immediately — the tenant keeps the
   * access they already paid for instead of losing it mid-period, and
   * nothing here forces an immediate downgrade that could interrupt an
   * envelope in progress. The actual tier downgrade happens later, through
   * the existing customer.subscription.deleted webhook -> subscription_cancelled
   * BillingEvent path (see apply-event.ts) — this method only schedules it.
   */
  cancelSubscription(externalCustomerId: string): Promise<void>;

  /** Verifies the webhook signature and parses it into a provider-agnostic BillingEvent. Throws if the signature is invalid. */
  parseWebhook(rawBody: string, signatureHeader: string): Promise<BillingEvent>;
}
