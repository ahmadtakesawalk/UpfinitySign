// DEPLOY TO: lib/billing/dunning.ts
//
// The actual recovery path for a customer suspended after repeated
// failed charges (see DUNNING_SUSPEND_AFTER in apply-event.ts). Adding a
// new card alone doesn't fix anything on its own — nothing automatically
// retries a failed charge against a newly-saved payment method just
// because it exists. This does the three things that actually matter:
// makes the new card the default, retries the specific charge that was
// failing, and only then lifts the suspension — in that order, so the
// suspension never lifts on a card that still doesn't work.
//
// Provider-agnostic on purpose: this file used to import the Stripe SDK
// directly, which meant switching payment providers would have required
// rewriting recovery logic here, not just implementing an interface — the
// exact thing lib/billing/payment-provider.ts exists to prevent. All the
// actual provider-specific work now lives in lib/billing/providers/
// stripe.ts's retryFailedPaymentWithNewCard, behind the interface.

import { prisma } from "../db";
import { getActivePaymentProvider } from "./active-provider";

export async function recoverFromDunning(tenantId: string, externalCustomerId: string): Promise<void> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const wasDunningSuspended = tenant.suspended && tenant.suspensionReason === "payment_failed_dunning";
  if (!wasDunningSuspended) return; // a card update outside an active dunning suspension has nothing to recover

  const provider = await getActivePaymentProvider();
  const { recovered } = await provider.retryFailedPaymentWithNewCard(externalCustomerId);

  if (recovered) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { suspended: false, suspensionReason: null, consecutiveFailedPayments: 0 },
    });
  }
  // If not recovered, deliberately leave the suspension in place — whoever's
  // watching Sentry (or the tenant, next time they check Settings) still
  // sees an accurate state, not a suspension lifted on faith.
}
