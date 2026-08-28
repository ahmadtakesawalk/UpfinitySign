// Settings resolution: a PlatformSetting or TenantSetting row, if one
// exists, overrides the static default in lib/config.ts. If no row exists,
// the config.ts value is used untouched. This is what makes tier limits,
// retention windows, and feature flags editable from the admin dashboards
// instead of requiring a code deploy — while keeping config.ts as the
// documented, version-controlled floor. See PRD.md §12.

import { prisma } from "./db";
import { config } from "./config";

export async function getPlatformSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setPlatformSetting(key: string, value: unknown, updatedBy: string) {
  return prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as any, updatedBy },
    update: { value: value as any, updatedBy },
  });
}

// Removes an override entirely, so getPlatformSetting's fallback (the
// config.ts default) takes effect again. Deliberately a delete, not a
// re-write of the current default values — a re-write would freeze in
// today's config.ts values and silently stop tracking future changes to
// the code default, which defeats the point of "this tenant/tier is back
// to platform-standard."
export async function deletePlatformSetting(key: string) {
  return prisma.platformSetting.deleteMany({ where: { key } });
}

export async function getTenantSetting<T = unknown>(
  tenantId: string,
  key: string,
  fallback: T
): Promise<T> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  return row ? (row.value as T) : fallback;
}

export async function setTenantSetting(tenantId: string, key: string, value: unknown) {
  return prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value: value as any },
    update: { value: value as any },
  });
}

/**
 * Resolves a tenant's effective tier limits: PlatformSetting override (if a
 * super admin has changed limits platform-wide) → TenantSetting override (if
 * that specific tenant has a negotiated exception) → config.ts default.
 * Every place that checks a limit (metering, retention, add-ons) should call
 * this instead of reading config.tiers directly.
 */
export async function getEffectiveTierLimits(tenantId: string, tier: keyof typeof config.tiers) {
  const platformOverride = await getPlatformSetting(`tier_limits.${tier}`, null);
  const base = platformOverride ?? config.tiers[tier];

  const tenantRetentionOverride = await getTenantSetting(tenantId, "retention_years", null);
  return {
    ...base,
    retentionYears: tenantRetentionOverride ?? base.retentionYears,
  };
}
