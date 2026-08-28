// DEPLOY TO: app/admin/settings/page.tsx
//
// Writes what lib/settings.ts's getEffectiveTierLimits() already reads —
// that function has existed since early in the build (PlatformSetting
// override → TenantSetting override → config.ts default), but nothing
// in the app ever let a super_admin actually set the override. This is
// that missing piece.
//
// Deliberately scoped to tier limits only, not a general "platform
// settings" catch-all — maintenance_mode isn't included here because
// nothing in the codebase currently reads that key at all (confirmed via
// a full-repo search); shipping a toggle for a flag nothing checks would
// be a UI that silently does nothing. Enforcing maintenance mode means
// adding a check in middleware.ts, which runs on every request platform-
// wide — a large-blast-radius change that deserves its own explicit,
// reviewed change rather than riding along with this one.

import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getPlatformSetting } from "@/lib/settings";
import { config } from "@/lib/config";
import { ALL_ADDONS } from "@/lib/billing/addons";
import { TopBar } from "@/components/TopBar";

interface TierLimits {
  envelopesPerMonth: number;
  aiMessagesPerMonth: number;
  retentionYears: number;
  addons: string[];
}

const ADDON_LABELS: Record<string, string> = {
  bulk_send: "Bulk send",
  id_verification: "ID verification",
  api_access: "API access",
  custom_branding: "Custom branding",
  byok: "Bring your own key",
};

function fmt(n: number): string {
  return n === Infinity ? "unlimited" : String(n);
}

export default async function AdminSettingsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const canManage = admin.role === "super_admin";
  const tiers = Object.keys(config.tiers) as (keyof typeof config.tiers)[];

  const effective: Record<string, TierLimits> = {};
  const isOverridden: Record<string, boolean> = {};
  for (const tier of tiers) {
    const override = await getPlatformSetting<TierLimits | null>(`tier_limits.${tier}`, null);
    isOverridden[tier] = override !== null;
    effective[tier] = override ?? { ...config.tiers[tier], addons: [...config.tiers[tier].addons] };
  }

  return (
    <>
      <TopBar
        links={[
          { href: "/admin", label: "Tenants" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/messages", label: "Messages" },
          { href: "/admin/ledger", label: "Ledger" },
          { href: "/admin/audit", label: "Audit trail" },
          { href: "/admin/billing", label: "Billing" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/docs", label: "Docs" },
        ]}
        brand="Upfinity Sign Admin"
        logoutHref="/api/admin/logout"
      />
      <div className="page-shell wide">
        <h1>Platform settings</h1>
        <div className="signature-rule" />
        <p style={{ marginBottom: 24 }}>
          Tier limits — applies to every tenant on that tier that doesn't already have a
          negotiated per-tenant exception (set from that tenant's own page).
        </p>

        {!canManage && (
          <div className="card">
            <p>Only super_admin can change tier limits. Your role ({admin.role}) can view the tenant list and billing but not this.</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {tiers.map((tier) => {
            const limits = effective[tier];
            return (
              <div key={tier} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h3 style={{ textTransform: "capitalize" }}>{tier}</h3>
                  <span className={`badge ${isOverridden[tier] ? "badge-pending" : "badge-success"}`}>
                    {isOverridden[tier] ? "Platform override active" : "Using code default"}
                  </span>
                </div>

                {canManage ? (
                  <form action="/api/admin/settings/tier-limits" method="POST" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <input type="hidden" name="tier" value={tier} />
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <label className="field-label">Envelopes / month</label>
                        <input name="envelopesPerMonth" defaultValue={fmt(limits.envelopesPerMonth)} style={{ width: 140 }} />
                      </div>
                      <div>
                        <label className="field-label">AI messages / month</label>
                        <input name="aiMessagesPerMonth" defaultValue={fmt(limits.aiMessagesPerMonth)} style={{ width: 140 }} />
                      </div>
                      <div>
                        <label className="field-label">Retention (years)</label>
                        <input name="retentionYears" defaultValue={String(limits.retentionYears)} style={{ width: 100 }} />
                      </div>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -6 }}>
                      Enter a number, or "unlimited" for no cap.
                    </p>

                    <div>
                      <label className="field-label">Add-ons included on this tier</label>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
                        {ALL_ADDONS.map((addon) => (
                          <label key={addon} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                            <input type="checkbox" name="addons" value={addon} defaultChecked={limits.addons.includes(addon)} style={{ width: "auto", height: "auto" }} />
                            {ADDON_LABELS[addon] ?? addon}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button type="submit" name="action" value="save" className="primary">
                        Save override
                      </button>
                      {isOverridden[tier] && (
                        <button type="submit" name="action" value="reset" className="secondary">
                          Reset to code default
                        </button>
                      )}
                    </div>
                  </form>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {fmt(limits.envelopesPerMonth)} envelopes/mo, {fmt(limits.aiMessagesPerMonth)} AI messages/mo,{" "}
                    {limits.retentionYears}-year retention. Add-ons: {limits.addons.length ? limits.addons.map((a) => ADDON_LABELS[a] ?? a).join(", ") : "none"}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
