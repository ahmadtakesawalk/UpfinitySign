// Resolves which payment provider is active. Business logic calls
// getActivePaymentProvider() and gets back something satisfying
// PaymentProvider — it never knows or cares whether that's Stripe or
// anything else. The super admin's choice lives in PlatformSetting (see
// /admin/billing), with providers.config.ts's DEFAULT_PAYMENT_PROVIDER as
// the fallback if no super admin has set one yet — same pattern as
// lib/settings.ts's tier-limit resolution.

import { getPlatformSetting, setPlatformSetting } from "../settings";
import { DEFAULT_PAYMENT_PROVIDER, PAYMENT_PROVIDERS, type PaymentProviderId } from "./providers.config";
import type { PaymentProvider } from "./payment-provider";
import { stripeProvider } from "./providers/stripe";
import { paddleProvider } from "./providers/paddle";

const IMPLEMENTATIONS: Record<PaymentProviderId, PaymentProvider> = {
  stripe: stripeProvider,
  paddle: paddleProvider,
};

const ACTIVE_PROVIDER_SETTING_KEY = "billing.active_provider";

export async function getActiveProviderId(): Promise<PaymentProviderId> {
  return getPlatformSetting<PaymentProviderId>(ACTIVE_PROVIDER_SETTING_KEY, DEFAULT_PAYMENT_PROVIDER);
}

export async function setActiveProviderId(providerId: PaymentProviderId, updatedBy: string) {
  if (!PAYMENT_PROVIDERS[providerId]) throw new Error(`Unknown payment provider: ${providerId}`);
  return setPlatformSetting(ACTIVE_PROVIDER_SETTING_KEY, providerId, updatedBy);
}

export async function getActivePaymentProvider(): Promise<PaymentProvider> {
  const id = await getActiveProviderId();
  return IMPLEMENTATIONS[id];
}
