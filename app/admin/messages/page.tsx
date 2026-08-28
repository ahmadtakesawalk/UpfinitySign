// DEPLOY TO: app/admin/messages/page.tsx
//
// Simple by design — a contact inbox, not a full ticketing system. If
// volume ever justifies it, this is where threading/assignment/SLA
// tracking would go; not built ahead of actual need.

import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";

export default async function AdminMessagesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const messages = await prisma.supportMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { tenant: { select: { name: true, slug: true } } },
  });
  const openCount = messages.filter((m) => m.status === "open").length;

  return (
    <>
      <TopBar
        links={[
          { href: "/admin", label: "Tenants" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/messages", label: `Messages${openCount ? ` (${openCount})` : ""}` },
          { href: "/admin/ledger", label: "Ledger" },
          { href: "/admin/audit", label: "Audit trail" },
          { href: "/admin/billing", label: "Billing" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/docs", label: "Docs" },
        ]}
        brand="Upfinity Sign Admin"
        logoutHref="/api/admin/logout"
      />
      <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
        <h1>Messages</h1>
        <div className="signature-rule" />

        {messages.length === 0 ? (
          <div className="card"><p style={{ fontSize: 14 }}>No messages yet.</p></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m) => (
              <div key={m.id} className="card" style={m.status === "open" ? { borderColor: "var(--accent)" } : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>{m.subject}</strong>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 8px" }}>
                      {m.tenant.name} ({m.tenant.slug}) · {m.senderEmail} · {m.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <span className={`badge ${m.status === "resolved" ? "badge-success" : "badge-pending"}`}>
                    {m.status === "resolved" ? "Resolved" : "Open"}
                  </span>
                </div>
                <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.body}</p>
                {m.status === "open" && (
                  <form action={`/api/admin/messages/${m.id}`} method="POST">
                    <button type="submit" className="secondary" style={{ fontSize: 13 }}>Mark resolved</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
