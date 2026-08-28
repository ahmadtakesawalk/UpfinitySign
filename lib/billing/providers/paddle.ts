// Paddle implementation of lib/billing/payment-provider.ts — NOT YET
// IMPLEMENTED. Registered here (and in providers.config.ts) so the
// architecture is genuinely provider-agnostic and adding Paddle for real
// is "fill in this file," not "redesign the billing system." But I'm not
// faking a working implementation to make this file look more complete
// than it is.
//
// Why it's not just a Stripe-shaped port: verified against the real
// installed @paddle/paddle-node-sdk types (same discipline as stripe.ts),
// and Paddle Billing's checkout model is architecturally different from
// Stripe's — there's no server-side "create a session, get a redirect URL"
// primitive the same way. Paddle's SDK exposes a TransactionsResource, but
// standard Paddle checkout is normally rendered client-side via Paddle.js
// (an overlay or inline widget on your own page), not a URL you redirect
// to. Implementing this properly means a product decision first — overlay
// checkout embedded in the dashboard vs. Paddle's hosted price links — not
// just an API translation. Flagging that decision rather than guessing at
// it and shipping something that doesn't match how Paddle actually wants
// to be integrated.

import type { PaymentProvider } from "../payment-provider";

export const paddleProvider: PaymentProvider = {
  async createCheckoutSession() {
    throw new Error(
      "Paddle is registered but not implemented — see the comment at the top of lib/billing/providers/paddle.ts for what's blocking it (a checkout-UX decision, not a missing credential)."
    );
  },
  async createSubscriptionForExistingCustomer() {
    throw new Error("Paddle is registered but not implemented — see lib/billing/providers/paddle.ts.");
  },
  async retryFailedPaymentWithNewCard() {
    throw new Error("Paddle is registered but not implemented — see lib/billing/providers/paddle.ts.");
  },
  async refundCharge() {
    throw new Error("Paddle is registered but not implemented — see lib/billing/providers/paddle.ts.");
  },
  async cancelSubscription() {
    throw new Error("Paddle is registered but not implemented — see lib/billing/providers/paddle.ts.");
  },
  async parseWebhook() {
    throw new Error("Paddle webhook handling is not implemented — see lib/billing/providers/paddle.ts.");
  },
};
