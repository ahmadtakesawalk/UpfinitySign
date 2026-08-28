// Applies a parsed BillingEvent to the DB. Called by every provider's
// webhook route AFTER that provider's parseWebhook() has already verified
// the signature — this function trusts its input completely, so it must
// never be reachable except from a route that just did that verification.

import { prisma } from "../db";
import { captureException } from "../monitoring";
import { sendEmail } from "../email";
import { CREDIT_PACKS, PLATFORM_TIER_PRICING } from "./providers.config";
import { convertTrialToSubscription } from "./trial";
import { createInvoice } from "./invoice";
import { recoverFromDunning } from "./dunning";
import type { BillingEvent } from "./payment-provider";

// Dunning escalation — Stripe's own Smart Retries already spaces out
// multiple invoice.payment_failed webhooks over roughly two weeks by
// default, so this doesn't need its own retry scheduler; it just reacts
// with increasing severity each time Stripe tells us another attempt
// failed. Suspending after the 3rd is a real consequence, not just
// another email, which is what a "dunning flow" actually means as
// opposed to a single notification.
const DUNNING_SUSPEND_AFTER = 3;

export async function applyBillingEvent(event: BillingEvent) {
  switch (event.type) {
    case "checkout_completed": {
      if (!event.tier) throw new Error("checkout_completed event missing tier");
      await prisma.tenant.update({ where: { id: event.tenantId }, data: { tier: event.tier as any, consecutiveFailedPayments: 0 } });
      await prisma.subscription.upsert({
        where: { tenantId: event.tenantId },
        create: { tenantId: event.tenantId, tier: event.tier as any, cardOnFile: true, externalCustomerId: event.externalCustomerId },
        update: { tier: event.tier as any, cardOnFile: true, externalCustomerId: event.externalCustomerId },
      });

      const priceUsd = PLATFORM_TIER_PRICING[event.tier]?.monthlyUsd;
      if (priceUsd !== undefined) {
        await createInvoice({
          tenantId: event.tenantId,
          kind: "subscription",
          description: `${event.tier[0].toUpperCase()}${event.tier.slice(1)} plan — monthly`,
          subtotalCents: Math.round(priceUsd * 100),
          status: "paid",
          externalReference: event.externalChargeReference,
        });
      }
      break;
    }
    case "subscription_cancelled": {
      // Downgrade to free rather than leaving the tier stale — a cancelled
      // subscription shouldn't keep paid-tier limits in effect.
      await prisma.tenant.update({ where: { id: event.tenantId }, data: { tier: "free" } });
      await prisma.subscription.update({ where: { tenantId: event.tenantId }, data: { tier: "free", cardOnFile: false } }).catch(() => {
        // No Subscription row yet is fine — nothing to update.
      });
      break;
    }
    case "payment_failed": {
      const tenant = await prisma.tenant.update({
        where: { id: event.tenantId },
        data: { consecutiveFailedPayments: { increment: 1 } },
      });
      const failureCount = tenant.consecutiveFailedPayments;
      const willSuspend = failureCount >= DUNNING_SUSPEND_AFTER;

      if (willSuspend) {
        await prisma.tenant.update({
          where: { id: event.tenantId },
          data: { suspended: true, suspensionReason: "payment_failed_dunning" },
        });
      }

      try {
        const owner = await prisma.tenantUser.findFirst({ where: { tenantId: event.tenantId, role: "owner" } });
        if (owner) {
          await sendEmail({
            to: owner.email,
            subject: willSuspend
              ? "Your Upfinity Sign workspace has been paused — payment failed"
              : `Your Upfinity Sign payment failed (attempt ${failureCount} of ${DUNNING_SUSPEND_AFTER})`,
            html: willSuspend
              ? `<p>We were unable to charge your payment method after ${failureCount} attempts, so your workspace is now paused. Nothing has been deleted — update your payment method in Settings to resume immediately.</p>`
              : `<p>We weren't able to process your latest payment (attempt ${failureCount} of ${DUNNING_SUSPEND_AFTER} before your workspace is paused). Please update your payment method in Settings to avoid any interruption.</p>`,
          });
        }
      } catch (err) {
        await captureException(err, { context: "billing_payment_failed_notify", tenantId: event.tenantId });
      }

      // A failed charge still belongs in the ledger — a platform admin
      // reviewing revenue needs to see attempts that didn't go through,
      // not just successful ones. Amount is unknown from this event alone
      // (Stripe's invoice.payment_failed doesn't carry it in the fields
      // this codebase currently extracts), so this is a zero-amount
      // marker row — real amount can be cross-referenced via
      // externalReference on the invoice if needed.
      await createInvoice({
        tenantId: event.tenantId,
        kind: "subscription",
        description: `Payment attempt failed (${failureCount} of ${DUNNING_SUSPEND_AFTER})`,
        subtotalCents: 0,
        status: "failed",
      });
      break;
    }
    case "credits_purchased": {
      if (!event.packId) throw new Error("credits_purchased event missing packId");
      const pack = CREDIT_PACKS[event.packId];
      if (!pack) throw new Error(`credits_purchased event references unknown pack "${event.packId}"`);

      await prisma.usageCredit.upsert({
        where: { tenantId_creditType: { tenantId: event.tenantId, creditType: pack.creditType } },
        create: { tenantId: event.tenantId, creditType: pack.creditType, balance: pack.quantity },
        update: { balance: { increment: pack.quantity } },
      });
      await prisma.tenant.update({ where: { id: event.tenantId }, data: { consecutiveFailedPayments: 0 } });

      await createInvoice({
        tenantId: event.tenantId,
        kind: "credit_pack",
        description: pack.label,
        subtotalCents: Math.round(pack.usdPrice * 100),
        status: "paid",
        externalReference: event.externalChargeReference,
      });
      break;
    }
    case "payment_method_updated": {
      if (!event.externalCustomerId) throw new Error("payment_method_updated event missing externalCustomerId");

      // The card is saved on the customer at this point (the checkout
      // provider did that as part of the setup-mode checkout) — this is
      // the part that was actually missing before: nothing made it the
      // DEFAULT method, and nothing retried the charge that was already
      // failing. Without this, a dunning-suspended customer could add a
      // new card and remain stuck exactly where they were.
      await recoverFromDunning(event.tenantId, event.externalCustomerId);
      break;
    }
    case "trial_card_added": {
      if (!event.externalCustomerId) throw new Error("trial_card_added event missing externalCustomerId");
      const tenant = await prisma.tenant.update({
        where: { id: event.tenantId },
        data: { trialExternalCustomerId: event.externalCustomerId, trialCardAddedAt: new Date() },
      });

      // If this tenant was already suspended for having missed the
      // card-required deadline, don't make them wait up to 24 hours for
      // the next trial-processing cron run to notice the card and
      // reinstate them — that's exactly the moment recovery speed
      // matters most. Convert them right now instead.
      if (tenant.suspended && tenant.suspensionReason === "trial_expired_no_card") {
        await convertTrialToSubscription(tenant);
        await prisma.tenant.update({ where: { id: tenant.id }, data: { suspended: false, suspensionReason: null } });
      }
      break;
    }
  }
}
