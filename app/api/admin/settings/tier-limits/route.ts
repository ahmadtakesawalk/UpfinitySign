// DEPLOY TO: app/api/admin/settings/tier-limits/route.ts
//
// Writes the tier_limits.{tier} PlatformSetting rows that
// getEffectiveTierLimits() (lib/settings.ts) already reads — that read
// path has existed since early in the build; this is the missing write
// side, so a super_admin can adjust limits platform-wide without a code
// deploy, matching the whole point of the PlatformSetting mechanism (see
// the comment at the top of lib/settings.ts).
//
// super_admin only — unlike billing copy edits, this directly controls
// what every tenant on a tier is allowed to send/use, so it sits at the
// same sensitivity level as staff management, not the lighter
// billing_ops-included bar used elsewhere in /admin.

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { setPlatformSetting, deletePlatformSetting } from "@/lib/settings";
import { config } from "@/lib/config";
import { ALL_ADDONS } from "@/lib/billing/addons";

const VALID_TIERS = Object.keys(config.tiers);

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireRole(["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const tier = formData.get("tier") as string;
  const action = formData.get("action") as string;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

  if (!VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: `unknown tier: ${tier}` }, { status: 400 });
  }

  if (action === "reset") {
    await deletePlatformSetting(`tier_limits.${tier}`);
    await logAdminAction(admin, "tier_limits.reset", undefined, { tier }, ip);
    return NextResponse.redirect(new URL("/admin/settings", req.url), 303);
  }

  // Always writes the complete object, never a partial merge —
  // getEffectiveTierLimits() does `platformOverride ?? config.tiers[tier]`,
  // which swaps in the WHOLE override object when present, not a per-key
  // merge. A partial save here would silently zero out whichever fields
  // the form didn't submit for every tenant on this tier.
  const envelopesRaw = (formData.get("envelopesPerMonth") as string)?.trim();
  const aiMessagesRaw = (formData.get("aiMessagesPerMonth") as string)?.trim();
  const retentionRaw = (formData.get("retentionYears") as string)?.trim();
  const addons = formData.getAll("addons") as string[];

  const parseLimit = (raw: string): number | null => {
    if (raw.toLowerCase() === "unlimited") return Infinity;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const envelopesPerMonth = parseLimit(envelopesRaw ?? "");
  const aiMessagesPerMonth = parseLimit(aiMessagesRaw ?? "");
  const retentionYears = Number(retentionRaw);

  if (envelopesPerMonth === null || aiMessagesPerMonth === null || !Number.isFinite(retentionYears) || retentionYears < 0) {
    return NextResponse.json({ error: "Enter a non-negative number (or \"unlimited\") for each limit." }, { status: 400 });
  }
  const invalidAddon = addons.find((a) => !ALL_ADDONS.includes(a as any));
  if (invalidAddon) {
    return NextResponse.json({ error: `unknown addon: ${invalidAddon}` }, { status: 400 });
  }

  await setPlatformSetting(
    `tier_limits.${tier}`,
    { envelopesPerMonth, aiMessagesPerMonth, retentionYears, addons },
    admin.id
  );
  await logAdminAction(admin, "tier_limits.updated", undefined, { tier, envelopesPerMonth, aiMessagesPerMonth, retentionYears, addons }, ip);

  return NextResponse.redirect(new URL("/admin/settings", req.url), 303);
}
