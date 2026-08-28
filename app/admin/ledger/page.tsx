// DEPLOY TO: app/admin/ledger/page.tsx
//
// Platform-wide revenue view — every Invoice row, across every tenant,
// in one place. Reads the same table every tenant's own Settings →
// Invoices section reads, so there's exactly one source of truth for
// "did this charge happen" — never a separately-computed running total
// that can drift from what actually got billed.

import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";

export default async function AdminLedgerPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  const canView = admin.role === "super_admin" || admin.role === "billing_ops";

  const invoices = canView
    ? await prisma.invoice.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { tenant: { select: { name: true, slug: true } } },
      })
    : [];

  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const totalRevenueCents = paidInvoices.reduce((sum, i) => sum + i.amountCents, 0);
  const subscriptionRevenueCents = paidInvoices.filter((i) => i.kind === "subscription" || i.kind === "trial_conversion").reduce((sum, i) => sum + i.amountCents, 0);
  const creditRevenueCents = paidInvoices.filter((i) => i.kind === "credit_pack").reduce((sum, i) => sum + i.amountCents, 0);
  const failedCount = invoices.filter((i) => i.status === "failed").length;
  const refundedIds = new Set(invoices.filter((i) => i.refundOfInvoiceId).map((i) => i.refundOfInvoiceId as string));

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
      <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Revenue ledger</h1>
        <div className="signature-rule" />

        {!canView ? (
          <div className="card"><p>Only super_admin and billing_ops can view the ledger.</p></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              <div className="card">
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Total revenue (last 200 charges)</p>
                <p style={{ fontSize: 22, fontWeight: 600 }}>${(totalRevenueCents / 100).toFixed(2)}</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Membership fees</p>
                <p style={{ fontSize: 22, fontWeight: 600 }}>${(subscriptionRevenueCents / 100).toFixed(2)}</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Credit purchases</p>
                <p style={{ fontSize: 22, fontWeight: 600 }}>${(creditRevenueCents / 100).toFixed(2)}</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Failed charges</p>
                <p style={{ fontSize: 22, fontWeight: 600, color: failedCount ? "var(--danger)" : undefined }}>{failedCount}</p>
              </div>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Workspace</th>
                    <th>Kind</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>INV-{String(inv.invoiceNumber).padStart(6, "0")}</td>
                      <td style={{ fontSize: 13 }}>{inv.createdAt.toLocaleString()}</td>
                      <td style={{ fontSize: 13 }}>
                        <a href={`/admin/tenants/${inv.tenantId}`}>{inv.tenant.name}</a>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{inv.kind}</td>
                      <td style={{ fontSize: 13 }}>{inv.description}</td>
                      <td style={{ fontSize: 13 }}>
                        {inv.amountCents < 0 ? "-" : ""}${(Math.abs(inv.amountCents) / 100).toFixed(2)} {inv.currency.toUpperCase()}
                      </td>
                      <td>
                        <span className={`badge ${inv.status === "paid" ? "badge-success" : "badge-danger"}`}>
                          {inv.status === "paid" ? "Paid" : "Failed"}
                        </span>
                      </td>
                      <td>
                        {inv.status === "paid" && inv.kind !== "refund" && !refundedIds.has(inv.id) && (
                          <details>
                            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--danger)" }}>Refund</summary>
                            <form action={`/api/admin/ledger/${inv.id}/refund`} method="POST" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, width: 200 }}>
                              <input name="reason" placeholder="Reason (optional)" style={{ fontSize: 12 }} />
                              <button type="submit" className="danger" style={{ fontSize: 12 }}>Confirm refund</button>
                            </form>
                          </details>
                        )}
                        {refundedIds.has(inv.id) && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Refunded</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoices.length === 0 && <p style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No charges yet.</p>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
