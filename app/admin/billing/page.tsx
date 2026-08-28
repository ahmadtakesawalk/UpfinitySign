import { redirect } from "next/navigation";
import { getCurrentAdmin, requireRole } from "@/lib/admin-auth";
import { getActiveProviderId } from "@/lib/billing/active-provider";
import { PAYMENT_PROVIDERS, PLATFORM_TIER_PRICING, CREDIT_PACKS } from "@/lib/billing/providers.config";
import { getPlatformSetting } from "@/lib/settings";
import { TopBar } from "@/components/TopBar";

export default async function AdminBillingPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const canManage = ["super_admin", "billing_ops"].includes(admin.role);
  const activeProviderId = await getActiveProviderId();

  const priceIds: Record<string, string | null> = {};
  for (const tier of Object.keys(PLATFORM_TIER_PRICING)) {
    priceIds[tier] = await getPlatformSetting<string | null>(`billing_price_id.${activeProviderId}.${tier}`, null);
  }
  const packPriceIds: Record<string, string | null> = {};
  for (const packId of Object.keys(CREDIT_PACKS)) {
    packPriceIds[packId] = await getPlatformSetting<string | null>(`billing_price_id.${activeProviderId}.credit_pack.${packId}`, null);
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
      <h1>Billing</h1>
      <div className="signature-rule" />
      <p style={{ marginBottom: 24 }}>Platform-wide payment configuration — applies to every tenant.</p>

      {!canManage && (
        <div className="card">
          <p>Your role ({admin.role}) doesn't include billing management.</p>
        </div>
      )}

      {canManage && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Active payment provider</h3>
            <p style={{ fontSize: 13 }}>
              Switching this changes which gateway ALL tenants' checkouts and webhooks route
              through, platform-wide — not per-tenant. Existing subscriptions aren't migrated
              automatically.
            </p>
            <form action="/api/admin/billing/provider" method="POST" style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <select name="provider" defaultValue={activeProviderId} style={{ height: 42, borderRadius: 8, border: "1px solid var(--border)", padding: "0 12px" }}>
                {Object.entries(PAYMENT_PROVIDERS).map(([id, cfg]) => (
                  <option key={id} value={id}>
                    {cfg.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="primary">
                Set active provider
              </button>
            </form>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
              {PAYMENT_PROVIDERS[activeProviderId].label} requires these env vars to actually
              process payments: {PAYMENT_PROVIDERS[activeProviderId].requiredEnvVars.join(", ")}
            </p>
          </div>

          <div className="card">
            <h3>Tier pricing — {PAYMENT_PROVIDERS[activeProviderId].label} Price IDs</h3>
            <p style={{ fontSize: 13 }}>
              Map each self-serve tier to a Price ID created in your {PAYMENT_PROVIDERS[activeProviderId].label}{" "}
              dashboard. Platform-standard USD pricing (informational, set in code — see
              lib/billing/providers.config.ts): {Object.entries(PLATFORM_TIER_PRICING).map(([t, p]) => `${t}: $${p.monthlyUsd}/mo`).join(", ")}.
            </p>
            <form action="/api/admin/billing/price-ids" method="POST" style={{ marginTop: 12 }}>
              {Object.keys(PLATFORM_TIER_PRICING).map((tier) => (
                <div key={tier} style={{ marginBottom: 12 }}>
                  <label className="field-label">{tier}</label>
                  <input name={`price_${tier}`} defaultValue={priceIds[tier] ?? ""} placeholder={`${PAYMENT_PROVIDERS[activeProviderId].label} Price ID for ${tier}`} />
                </div>
              ))}
              <button type="submit" className="primary">
                Save price IDs
              </button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Credit packs — {PAYMENT_PROVIDERS[activeProviderId].label} Price IDs</h3>
            <p style={{ fontSize: 13 }}>
              One-time purchase top-ups tenants can buy from Settings when they exceed their plan
              allowance. These must be <strong>one-time</strong> Price IDs in{" "}
              {PAYMENT_PROVIDERS[activeProviderId].label} (not recurring) — see
              lib/billing/providers.config.ts CREDIT_PACKS for quantities/pricing.
            </p>
            <form action="/api/admin/billing/price-ids" method="POST" style={{ marginTop: 12 }}>
              {Object.entries(CREDIT_PACKS).map(([packId, pack]) => (
                <div key={packId} style={{ marginBottom: 12 }}>
                  <label className="field-label">{pack.label} (${pack.usdPrice})</label>
                  <input name={`price_pack_${packId}`} defaultValue={packPriceIds[packId] ?? ""} placeholder={`${PAYMENT_PROVIDERS[activeProviderId].label} one-time Price ID for ${packId}`} />
                </div>
              ))}
              <button type="submit" className="primary">
                Save credit pack price IDs
              </button>
            </form>
          </div>
        </>
      )}
    </div>
    </>
  );
}
