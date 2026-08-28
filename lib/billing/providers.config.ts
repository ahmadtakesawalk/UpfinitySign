// Payment provider registry — one file to add/remove a provider, same
// pattern as lib/llm/providers.config.ts. The ACTIVE provider is a
// PlatformSetting (super admin editable from /admin/billing, no deploy
// needed to switch), with this file's `default` as the fallback. See
// PRD.md §15.

export type PaymentProviderId = "stripe" | "paddle";

export interface PaymentProviderConfig {
  label: string;
  // Env vars this provider needs — surfaced in the admin panel so a super
  // admin knows what to configure before switching to it, without having
  // to go read code.
  requiredEnvVars: string[];
}

export const PAYMENT_PROVIDERS: Record<PaymentProviderId, PaymentProviderConfig> = {
  stripe: {
    label: "Stripe",
    requiredEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  paddle: {
    label: "Paddle",
    requiredEnvVars: ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"],
  },
};

export const DEFAULT_PAYMENT_PROVIDER: PaymentProviderId = "stripe";

// Platform-standard tier pricing — the super admin's source of truth for
// what each tier costs, independent of which gateway processes the
// payment. Provider-specific price/product IDs (Stripe Price ID, Paddle
// Price ID) are stored separately per provider, since those differ even
// for the "same" $22/mo Business tier — see PlatformSetting keys
// `billing_price_id.<provider>.<tier>` in lib/billing/payments.ts.
export const PLATFORM_TIER_PRICING: Record<string, { monthlyUsd: number }> = {
  starter: { monthlyUsd: 9 },
  business: { monthlyUsd: 22 },
  // free and enterprise are deliberately absent — free has no charge,
  // enterprise is negotiated/custom and never goes through self-serve checkout.
};

// One-time top-up packs — for a tenant who's hit their monthly plan
// allowance but doesn't want to upgrade tiers, or wants extra AI assistant
// usage without changing plan. Purchased via one-time (not subscription)
// checkout — see the "credit_pack" branch in each provider's
// createCheckoutSession. Consumed automatically once monthly plan usage
// is exhausted — see lib/billing/metering.ts.
export interface CreditPack {
  label: string;
  creditType: "envelopes" | "ai_messages";
  quantity: number;
  usdPrice: number;
}

export const CREDIT_PACKS: Record<string, CreditPack> = {
  envelopes_50: { label: "50 extra envelopes", creditType: "envelopes", quantity: 50, usdPrice: 15 },
  envelopes_200: { label: "200 extra envelopes", creditType: "envelopes", quantity: 200, usdPrice: 45 },
  ai_messages_100: { label: "100 AI assistant messages", creditType: "ai_messages", quantity: 100, usdPrice: 10 },
  ai_messages_500: { label: "500 AI assistant messages", creditType: "ai_messages", quantity: 500, usdPrice: 40 },
};
