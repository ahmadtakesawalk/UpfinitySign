// DEPLOY TO: app/admin/audit/page.tsx
//
// Distinct from AdminAuditLog (which only tracks platform-STAFF actions
// like tier changes and suspensions). This is the envelope/recipient
// activity trail across every tenant — sends, opens, signatures, and
// every failure mode — which is what a compliance reviewer actually
// needs to see, not just what the platform team did.

import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";

const EVENT_TYPES = [
  "sent", "delivered", "opened", "field_filled", "signed", "approved", "declined",
  "voided", "expired", "reminder_sent", "email_failed", "signing_validation_failed",
  "finalization_failed", "attachment_upload_failed",
  "legal_hold_placed", "legal_hold_released", "manual_reminder_sent", "webhook_delivery_failed",
];

const FAILURE_TYPES = new Set(["email_failed", "signing_validation_failed", "finalization_failed", "attachment_upload_failed", "webhook_delivery_failed"]);

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; event_type?: string; tenant_id?: string; failures_only?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const { page: pageParam, event_type: eventTypeFilter, tenant_id: tenantIdFilter, failures_only: failuresOnly } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const pageSize = 100;

  const where = {
    ...(eventTypeFilter ? { eventType: eventTypeFilter } : {}),
    ...(failuresOnly === "1" ? { eventType: { in: Array.from(FAILURE_TYPES) } } : {}),
    ...(tenantIdFilter ? { envelope: { tenantId: tenantIdFilter } } : {}),
  };

  const [events, totalCount, tenants] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { envelope: { include: { tenant: true, template: true } }, recipient: true },
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
    prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

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
      <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
        <h1>Platform audit trail</h1>
        <div className="signature-rule" />
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          Every envelope/recipient event across every tenant — sends, opens, signatures, declines,
          and every failure mode. Append-only; nothing here can be edited or deleted.
        </p>

        <form method="GET" style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <select name="tenant_id" defaultValue={tenantIdFilter ?? ""} style={{ height: 38, borderRadius: 8, border: "1px solid var(--border)", padding: "0 10px" }}>
            <option value="">All tenants</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select name="event_type" defaultValue={eventTypeFilter ?? ""} style={{ height: 38, borderRadius: 8, border: "1px solid var(--border)", padding: "0 10px" }}>
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" name="failures_only" value="1" defaultChecked={failuresOnly === "1"} style={{ width: "auto", height: "auto" }} />
            Failures only
          </label>
          <button type="submit" className="secondary">Filter</button>
        </form>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Tenant</th>
                <th>Document</th>
                <th>Event</th>
                <th>Summary</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} style={FAILURE_TYPES.has(e.eventType) ? { background: "var(--danger-bg)" } : undefined}>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{e.timestamp.toLocaleString()}</td>
                  <td style={{ fontSize: 13 }}>{e.envelope.tenant.name}</td>
                  <td style={{ fontSize: 13 }}>
                    <a href={`/dashboard/envelopes/${e.envelopeId}`} style={{ color: "var(--text-primary)" }}>
                      {e.envelope.template.name}
                    </a>
                  </td>
                  <td>
                    <span className={`badge ${FAILURE_TYPES.has(e.eventType) ? "badge-danger" : "badge-pending"}`}>
                      {e.eventType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{e.summary}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <p style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No events match these filters.</p>}
        </div>

        {totalPages > 1 && (() => {
          const baseParams = new URLSearchParams();
          if (tenantIdFilter) baseParams.set("tenant_id", tenantIdFilter);
          if (eventTypeFilter) baseParams.set("event_type", eventTypeFilter);
          if (failuresOnly === "1") baseParams.set("failures_only", "1");
          const linkFor = (p: number) => {
            const params = new URLSearchParams(baseParams);
            params.set("page", String(p));
            return `?${params.toString()}`;
          };
          return (
            <div style={{ display: "flex", gap: 8, marginTop: 16, fontSize: 13 }}>
              {page > 1 && <a href={linkFor(page - 1)}>← Previous</a>}
              <span style={{ color: "var(--text-secondary)" }}>Page {page} of {totalPages} ({totalCount} events)</span>
              {page < totalPages && <a href={linkFor(page + 1)}>Next →</a>}
            </div>
          );
        })()}
      </div>
    </>
  );
}
