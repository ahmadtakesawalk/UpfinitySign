import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const pageSize = 50;

  const [tenants, totalCount] = await Promise.all([
    prisma.tenant.findMany({
      include: {
        _count: { select: { envelopes: true, users: true } },
        subscription: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenant.count(),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <>
      <TopBar links={[{ href: "/admin", label: "Tenants" }, { href: "/admin/staff", label: "Staff" },
          { href: "/admin/messages", label: "Messages" },
          { href: "/admin/ledger", label: "Ledger" }, { href: "/admin/audit", label: "Audit trail" }, { href: "/admin/billing", label: "Billing" }, { href: "/admin/settings", label: "Settings" }, { href: "/admin/docs", label: "Docs" }]} brand="Upfinity Sign Admin" logoutHref="/api/admin/logout" />
      <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1>Platform admin</h1>
          <div className="signature-rule" />
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Signed in as {admin.email} ({admin.role})
        </p>
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Tier</th>
              <th>Envelopes</th>
              <th>Users</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.tier}</td>
                <td>{t._count.envelopes}</td>
                <td>{t._count.users}</td>
                <td>
                  {t.suspended ? (
                    <span style={{ color: "#a32d2d" }}>Suspended</span>
                  ) : (
                    <span style={{ color: "#3b6d11" }}>Active</span>
                  )}
                </td>
                <td>{t.createdAt.toLocaleDateString()}</td>
                <td>
                  <a href={`/admin/tenants/${t.id}`} style={{ color: "var(--accent-dark)", fontSize: 13 }}>
                    Manage
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tenants.length === 0 && (
          <p style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            No tenants yet — this list fills in as workspaces sign up.
          </p>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 24 }}>
        Every action taken from here (tier changes, suspend/reinstate) is written to AdminAuditLog —
        see PRD.md §12.
      </p>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 16, fontSize: 13 }}>
          {page > 1 && <a href={`/admin?page=${page - 1}`}>← Previous</a>}
          <span style={{ color: "var(--text-secondary)" }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && <a href={`/admin?page=${page + 1}`}>Next →</a>}
        </div>
      )}
      </div>
    </>
  );
}
