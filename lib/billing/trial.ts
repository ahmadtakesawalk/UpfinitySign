// DEPLOY TO: lib/billing/trial.ts
//
// Free-tier trial lifecycle: 60 days from signup, no card needed for the
// first 45; after that, sending a NEW envelope requires a card on file
// (existing data/envelopes stay fully accessible either way — this is a
// send-gate, not an account lock). At day 60, a tenant with a card
// converts automatically to a real paid subscription; without one, the
// account is suspended until a card is added. See config.trial for the
// actual numbers.

import { prisma } from "../db";
import { config } from "../config";
import { getActivePaymentProvider } from "./active-provider";
import { createInvoice } from "./invoice";
import { PLATFORM_TIER_PRICING } from "./providers.config";
import { sendEmail } from "../email";
import { captureException } from "../monitoring";
import type { Tenant } from "@prisma/client";

/** The date a card becomes required, derived from trialEndsAt rather than stored separately — always lengthDays - cardRequiredAfterDays before the trial actually ends. */
function cardRequiredAt(trialEndsAt: Date): Date {
  const d = new Date(trialEndsAt);
  d.setDate(d.getDate() - (config.trial.lengthDays - config.trial.cardRequiredAfterDays));
  return d;
}

export function isCardOnFile(tenant: Pick<Tenant, "trialExternalCustomerId">): boolean {
  return Boolean(tenant.trialExternalCustomerId);
}

/**
 * Throws if this tenant is past the card-required point in their trial
 * and hasn't added one. Call from createEnvelope() — this gates NEW
 * sends only, never read access to existing data.
 */
export async function assertTrialCardRequirementMet(tenant: Tenant): Promise<void> {
  if (tenant.tier !== "free" || !tenant.trialEndsAt) return; // not on a trial — nothing to check
  if (isCardOnFile(tenant)) return;

  if (new Date() >= cardRequiredAt(tenant.trialEndsAt)) {
    const daysLeft = Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    throw new TrialCardRequiredError(daysLeft);
  }
}

export class TrialCardRequiredError extends Error {
  constructor(public daysLeft: number) {
    super(
      daysLeft > 0
        ? `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — add a payment method in Settings to keep sending.`
        : `Your free trial has ended — add a payment method in Settings to keep sending.`
    );
  }
}

/**
 * Called daily from a cron (see app/api/cron/trial-processing). Finds
 * every free-tier tenant whose trial just ended and either converts them
 * to a real subscription (card on file) or suspends them (no card) —
 * each tenant is processed exactly once, since after this runs they're
 * no longer tier==="free" with a past trialEndsAt (either converted to a
 * paid tier, or suspended — both fall out of the query below).
 */
export async function processTrialExpirations(): Promise<{ converted: number; suspended: number; notified: number }> {
  const notified = await sendUpcomingChargeNotices();

  const dueTenants = await prisma.tenant.findMany({
    where: { tier: "free", trialEndsAt: { lte: new Date() }, suspended: false },
  });

  let converted = 0;
  let suspendedCount = 0;

  for (const tenant of dueTenants) {
    try {
      if (isCardOnFile(tenant)) {
        await convertTrialToSubscription(tenant);
        converted++;
      } else {
        await suspendExpiredTrial(tenant);
        suspendedCount++;
      }
    } catch (err) {
      await captureException(err, { context: "process_trial_expiration", tenantId: tenant.id });
    }
  }

  return { converted, suspended: suspendedCount, notified };
}

// Advance notice before the automatic charge — the actual fix for "found
// out I was billed with no warning." Fires once per tenant: catches
// whoever's trialEndsAt falls exactly NOTICE_DAYS_BEFORE_CHARGE from now,
// in a window as wide as this cron's own run interval (daily), so a daily
// cron catches each tenant exactly once without needing a separate
// "already notified" flag on Tenant. Only sent to tenants with a card on
// file — no card on file means no charge is coming, just the existing
// suspension-warning path (see suspendExpiredTrial), which is a different
// message entirely.
const NOTICE_DAYS_BEFORE_CHARGE = 3;

async function sendUpcomingChargeNotices(): Promise<number> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() + NOTICE_DAYS_BEFORE_CHARGE);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 1);

  const dueSoon = await prisma.tenant.findMany({
    where: { tier: "free", suspended: false, trialEndsAt: { gte: windowStart, lt: windowEnd }, trialExternalCustomerId: { not: null } },
  });

  let notified = 0;
  for (const tenant of dueSoon) {
    try {
      const owner = await prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, role: "owner" } });
      if (!owner) continue;
      const priceUsd = PLATFORM_TIER_PRICING[config.trial.autoConvertToTier]?.monthlyUsd;
      await sendEmail(
        {
          to: owner.email,
          subject: `Your free trial ends in ${NOTICE_DAYS_BEFORE_CHARGE} days — here's what happens next`,
          html: `<p>Your free trial ends on ${tenant.trialEndsAt!.toLocaleDateString()}. After that, your workspace moves to the ${config.trial.autoConvertToTier} plan${priceUsd !== undefined ? ` ($${priceUsd.toFixed(2)}/month)` : ""} using the payment method on file — no action needed if that works for you.</p><p>If you'd rather not continue, you can cancel any time before then from Settings → Plan, with no charge.</p>`,
        },
        { tenantId: tenant.id }
      ).catch((err) => captureException(err, { context: "trial_upcoming_charge_notice", tenantId: tenant.id }));
      notified++;
    } catch (err) {
      await captureException(err, { context: "trial_upcoming_charge_notice", tenantId: tenant.id });
    }
  }
  return notified;
}

export async function convertTrialToSubscription(tenant: Tenant) {
  if (!tenant.trialExternalCustomerId) throw new Error("convertTrialToSubscription called without a payment provider customer id");

  const targetTier = config.trial.autoConvertToTier;
  const provider = await getActivePaymentProvider();
  // Charging an already-saved card for the first time on a schedule we
  // control (not the person clicking "checkout" right now) is a real
  // subscription creation, not a checkout session — checkout sessions are
  // for an active browser flow. This calls the provider's own
  // subscription-creation path rather than forcing it through
  // createCheckoutSession, which assumes an interactive redirect.
  const { subscriptionReference } = await provider.createSubscriptionForExistingCustomer(tenant.trialExternalCustomerId, targetTier);

  await prisma.tenant.update({ where: { id: tenant.id }, data: { tier: targetTier, consecutiveFailedPayments: 0 } });

  const priceUsd = PLATFORM_TIER_PRICING[targetTier]?.monthlyUsd;
  if (priceUsd !== undefined) {
    // kind: "trial_conversion" (not "subscription") specifically so the
    // dashboard can distinguish "your trial just converted" from an
    // ordinary self-serve upgrade — that's what powers the one-time
    // "membership started" banner rather than a generic billing receipt.
    await createInvoice({
      tenantId: tenant.id,
      kind: "trial_conversion",
      description: `${targetTier[0].toUpperCase()}${targetTier.slice(1)} plan — trial converted`,
      subtotalCents: Math.round(priceUsd * 100),
      status: "paid",
      externalReference: subscriptionReference,
    });
  }

  const owner = await prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, role: "owner" } });
  if (owner) {
    sendEmail({
      to: owner.email,
      subject: "Your Upfinity Sign trial has ended — you're now on the paid plan",
      html: `<p>Your 60-day free trial has ended and your workspace has moved to the ${targetTier} plan using the payment method on file. No action needed — you can manage or cancel this anytime in Settings.</p>`,
    }, { tenantId: tenant.id }).catch((err) => captureException(err, { context: "trial_converted_email", tenantId: tenant.id }));
  }
}

async function suspendExpiredTrial(tenant: Tenant) {
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { suspended: true, suspensionReason: "trial_expired_no_card" },
  });

  const owner = await prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, role: "owner" } });
  if (owner) {
    sendEmail({
      to: owner.email,
      subject: "Your Upfinity Sign trial has ended",
      html: `<p>Your 60-day free trial has ended without a payment method on file, so your workspace is now paused. Add a payment method any time to pick up right where you left off — nothing has been deleted.</p>`,
    }, { tenantId: tenant.id }).catch((err) => captureException(err, { context: "trial_suspended_email", tenantId: tenant.id }));
  }
}
