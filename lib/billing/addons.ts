// Add-on gating. config.tiers[tier].addons lists what a tier includes, but
// nothing was actually checking it at the point of use — this closes that
// gap. Every gated feature (ID verification, bulk send, API access, custom
// branding) should call assertAddonEnabled() before doing its work.

import { prisma } from "../db";
import { config } from "../config";
import { getPlatformSetting } from "../settings";

export type Addon = "bulk_send" | "id_verification" | "api_access" | "custom_branding" | "byok";

// Single source of truth for "every addon that exists" — anywhere that
// needs to enumerate them (e.g. the admin tier-limits form) imports this
// instead of hand-copying the Addon union as a runtime array, which would
// silently drift out of sync the next time a new addon is added here.
export const ALL_ADDONS: Addon[] = ["bulk_send", "id_verification", "api_access", "custom_branding", "byok"];

export class AddonNotEnabledError extends Error {
  constructor(public addon: Addon, public tier: string) {
    super(`"${addon}" is not included in the "${tier}" tier and has not been purchased as an add-on`);
  }
}

export async function tenantHasAddon(tenantId: string, addon: Addon): Promise<boolean> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Tier-included add-ons (platform-setting override respected, same
  // pattern as getEffectiveTierLimits in lib/settings.ts).
  const tierAddons = await getPlatformSetting<Addon[] | null>(`tier_addons.${tenant.tier}`, null);
  const includedInTier = (tierAddons ?? config.tiers[tenant.tier].addons) as Addon[];
  if (includedInTier.includes(addon)) return true;

  // Individually purchased add-on, independent of tier (e.g. a Starter
  // tenant who bought bulk_send à la carte — see PRD §6 add-on pricing).
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  const purchasedAddons = (subscription?.addons as Addon[] | undefined) ?? [];
  return purchasedAddons.includes(addon);
}

export async function assertAddonEnabled(tenantId: string, addon: Addon) {
  const enabled = await tenantHasAddon(tenantId, addon);
  if (!enabled) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    throw new AddonNotEnabledError(addon, tenant.tier);
  }
}
