import { redirect, notFound } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getTenantSetting } from "@/lib/settings";
import { TopBar } from "@/components/TopBar";

export default async function TenantAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { subscription: true, apiKeys: true, settings: true, users: true },
  });
  if (!tenant) notFound();

  const canManageBilling = admin.role === "super_admin" || admin.role === "billing_ops";
  const retentionOverride = tenant.tier === "enterprise" ? await getTenantSetting<number | null>(id, "retention_years", null) : null;

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
    <div style={{ padding: 32, maxWidth: 800, margin: "0 auto" }}>
      <h1>{tenant.name}</h1>
      <div className="signature-rule" />

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Overview</h3>
        <p style={{ fontSize: 14 }}>Slug: {tenant.slug}</p>
        <p style={{ fontSize: 14 }}>Tier: {tenant.tier}</p>
        <p style={{ fontSize: 14 }}>
          Status:{" "}
          {tenant.suspended ? (
            <span style={{ color: "var(--danger)", fontWeight: 500 }}>
              Suspended
              {tenant.suspensionReason === "trial_expired_no_card" && " — trial ended, no payment method"}
              {tenant.suspensionReason === "admin_action" && " — by platform admin"}
              {tenant.suspensionReason === "deletion_requested" && " — deletion requested by workspace owner"}
              {tenant.suspensionReason === "payment_failed_dunning" && " — payment repeatedly failed"}
            </span>
          ) : (
            "Active"
          )}
        </p>
        {tenant.tier === "free" && tenant.trialEndsAt && (
          <p style={{ fontSize: 14 }}>
            Trial ends: {tenant.trialEndsAt.toLocaleDateString()}
            {tenant.trialExternalCustomerId ? " (card on file — will auto-convert)" : " (no card on file yet)"}
          </p>
        )}
        {tenant.tier === "free" && tenant.trialEndsAt && canManageBilling && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 13, cursor: "pointer", color: "var(--text-secondary)" }}>Extend trial</summary>
            <form action={`/api/admin/tenants/${tenant.id}`} method="POST" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
              <input type="hidden" name="action" value="extend_trial" />
              <label style={{ fontSize: 12 }}>
                Days to add (1–90)
                <input type="number" name="days" min={1} max={90} required style={{ display: "block", width: "100%" }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Reason (required, logged to the admin audit trail)
                <textarea name="reason" required rows={2} style={{ display: "block", width: "100%" }} />
              </label>
              <button type="submit" className="secondary" style={{ fontSize: 13 }}>Extend trial</button>
            </form>
          </details>
        )}
        <p style={{ fontSize: 14 }}>Team members: {tenant.users.length}</p>
        {canManageBilling && (
          <form action={`/api/admin/tenants/${tenant.id}`} method="POST" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input type="hidden" name="action" value="set_tax_rate" />
            <label style={{ fontSize: 12 }}>
              Tax rate %
              <input type="number" name="tax_rate" step="0.01" min={0} max={100} defaultValue={tenant.taxRatePercent ?? ""} placeholder="none" style={{ display: "block", width: 100 }} />
            </label>
            <button type="submit" className="secondary" style={{ fontSize: 12 }}>Save</button>
          </form>
        )}
      </div>

      {canManageBilling ? (
        <form action={`/api/admin/tenants/${tenant.id}`} method="POST" className="card" style={{ marginBottom: 16 }}>
          <h3>Tier & status</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Changing these takes effect immediately and is written to AdminAuditLog.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <select name="tier" defaultValue={tenant.tier} style={{ height: 40, borderRadius: 8, border: "1px solid var(--border)" }}>
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <button type="submit" name="action" value="update_tier" className="primary">
              Update tier
            </button>
            <button
              type="submit"
              name="action"
              value={tenant.suspended ? "reinstate" : "suspend"}
              className="primary"
              style={{ background: tenant.suspended ? "#3b6d11" : "#a32d2d" }}
            >
              {tenant.suspended ? "Reinstate" : "Suspend"}
            </button>
          </div>
        </form>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Your role ({admin.role}) doesn't include billing/tier management.
        </p>
      )}

      {tenant.tier === "enterprise" && canManageBilling && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Retention override</h3>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Enterprise-only — a negotiated exception on top of the tier default (see /admin/settings for the
            platform-wide default instead). {retentionOverride ? (
              <>Currently overridden to <strong>{retentionOverride} years</strong> for this tenant.</>
            ) : (
              "No override set — using the platform default."
            )}
          </p>
          <form action={`/api/admin/tenants/${tenant.id}`} method="POST" style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>
              Retention (years)
              <input type="number" name="retention_years" min={1} max={50} defaultValue={retentionOverride ?? ""} style={{ display: "block", width: 100 }} />
            </label>
            <button type="submit" name="action" value="set_retention_override" className="secondary" style={{ fontSize: 13 }}>
              Set override
            </button>
            {retentionOverride && (
              <button type="submit" name="action" value="clear_retention_override" className="secondary" style={{ fontSize: 13 }}>
                Clear override
              </button>
            )}
          </form>
        </div>
      )}

      <div className="card">
        <h3>API keys</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Last used</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tenant.apiKeys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{k.lastUsedAt?.toLocaleDateString() ?? "Never"}</td>
                <td>{k.revokedAt ? "Revoked" : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tenant.tier === "enterprise" && tenant.customFromEmail && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Custom sending domain</h3>
          <p style={{ fontSize: 14 }}>
            Requested: <strong>{tenant.customFromEmail}</strong>
            {" — "}
            {tenant.customFromEmailVerifiedAt
              ? `verified ${tenant.customFromEmailVerifiedAt.toLocaleDateString()}`
              : "not yet verified"}
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Confirm domain ownership (SPF/DKIM records, or however your provider verifies sending
            domains) before marking this verified — until then, this tenant's envelope emails
            still send from the platform default.
          </p>
          {canManageBilling && (
            <form action={`/api/admin/tenants/${tenant.id}`} method="POST" style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {!tenant.customFromEmailVerifiedAt && (
                <button type="submit" name="action" value="verify_email_domain" className="primary">
                  Mark verified
                </button>
              )}
              <button type="submit" name="action" value="revoke_email_domain" className="danger">
                Revoke
              </button>
            </form>
          )}
        </div>
      )}
    </div>
    </>
  );
}
