// Usage metering. Tier limits live ONLY in lib/config.ts (config.tiers) —
// this file never hardcodes a number, so pricing changes are a config edit.

import { prisma } from "../db";
import { config } from "../config";
import { getEffectiveTierLimits } from "../settings";
import { assertTrialCardRequirementMet } from "./trial";

export type MeteredItem = "envelopes_sent" | "ai_messages" | "id_verifications" | "sms_sent" | "api_calls" | "storage_gb";

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function incrementUsage(tenantId: string, item: MeteredItem, qty = 1) {
  const period = currentPeriod();
  return prisma.usageMeter.upsert({
    where: { tenantId_meteredItem_period: { tenantId, meteredItem: item, period } },
    create: { tenantId, meteredItem: item, period, quantity: qty },
    update: { quantity: { increment: qty } },
  });
}

export async function getUsage(tenantId: string, item: MeteredItem): Promise<number> {
  const meter = await prisma.usageMeter.findUnique({
    where: { tenantId_meteredItem_period: { tenantId, meteredItem: item, period: currentPeriod() } },
  });
  return meter?.quantity ?? 0;
}

export async function getCreditBalance(tenantId: string, creditType: "envelopes" | "ai_messages"): Promise<number> {
  const credit = await prisma.usageCredit.findUnique({
    where: { tenantId_creditType: { tenantId, creditType } },
  });
  return credit?.balance ?? 0;
}

/**
 * Atomically consumes one purchased credit, IF the tenant has any. Returns
 * true if a credit was consumed (caller may proceed), false if the tenant
 * has no credits left (caller should block the action). The WHERE clause's
 * `balance: { gt: 0 }` is what makes this safe under concurrency — two
 * simultaneous requests can't both decrement the same last credit below
 * zero, because only one of the two updateMany calls will match a row
 * with balance > 0 by the time it runs.
 */
async function tryConsumeCredit(tenantId: string, creditType: "envelopes" | "ai_messages"): Promise<boolean> {
  const result = await prisma.usageCredit.updateMany({
    where: { tenantId, creditType, balance: { gt: 0 } },
    data: { balance: { decrement: 1 } },
  });
  return result.count > 0;
}

/**
 * Throws if the tenant is at or over their tier's limit for the given
 * metered item AND has no purchased credits left to cover it. Called
 * before any action that should be capped (e.g. sending an envelope,
 * sending an AI assistant message).
 *
 * Order of checks: suspended tenants are blocked outright regardless of
 * credits (a credit balance doesn't override a suspension) → within plan
 * allowance, nothing consumed → over plan allowance, try to consume one
 * purchased credit → no credits left, throw.
 */
export async function assertWithinTierLimit(tenantId: string, item: MeteredItem) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.suspended) {
    throw new TierLimitExceededError(tenant.tier, item, 0); // suspended tenants can't send regardless of tier or credits
  }
  if (item === "envelopes_sent") {
    // Checked here, not just in the UI — this reuses the tenant fetch this
    // function already does rather than a second query, and covers every
    // envelope-creation path the same way the AI-drafted-review guard
    // does. Card-required trial check only applies to envelope sends, not
    // AI messages — see lib/billing/trial.ts for why.
    await assertTrialCardRequirementMet(tenant);
  }
  const tierLimits = await getEffectiveTierLimits(tenantId, tenant.tier);

  if (item === "envelopes_sent") {
    await assertWithinLimitOrCredit(tenantId, item, tierLimits.envelopesPerMonth, "envelopes", tenant.tier);
  } else if (item === "ai_messages") {
    await assertWithinLimitOrCredit(tenantId, item, tierLimits.aiMessagesPerMonth, "ai_messages", tenant.tier);
  }
  // Other metered items (id_verifications, sms_sent, etc.) are add-on-gated
  // rather than a flat monthly number — gated via lib/billing/addons.ts
  // (tenantHasAddon/assertAddonEnabled) at each gated feature's call site,
  // not here — this function only covers flat monthly-allowance items.
}

async function assertWithinLimitOrCredit(
  tenantId: string,
  item: MeteredItem,
  monthlyLimit: number,
  creditType: "envelopes" | "ai_messages",
  tier: string
) {
  const used = await getUsage(tenantId, item);
  if (used < monthlyLimit) return; // within plan allowance — nothing to consume, nothing to check

  const consumed = await tryConsumeCredit(tenantId, creditType);
  if (!consumed) {
    throw new TierLimitExceededError(tier, item, monthlyLimit);
  }
}

export class TierLimitExceededError extends Error {
  constructor(public tier: string, public item: MeteredItem, public limit: number) {
    super(`Tenant on "${tier}" tier has reached its ${item} limit (${limit}/month) and has no purchased credits left`);
  }
}
