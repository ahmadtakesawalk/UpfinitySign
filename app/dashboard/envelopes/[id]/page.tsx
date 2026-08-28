// DEPLOY TO: app/dashboard/envelopes/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { StatusBadge } from "@/components/StatusBadge";
import { TopBar } from "@/components/TopBar";
import { InPersonSignButton } from "@/components/InPersonSignButton";
import { SendReminderButton } from "@/components/SendReminderButton";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { SiteFooter } from "@/components/SiteFooter";

export default async function EnvelopeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) redirect("/dashboard/login");

  const { id } = await params;
  const envelope = await prisma.envelope.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      template: true,
      recipients: { orderBy: { signingOrder: "asc" } },
      certificate: true,
      auditEvents: { orderBy: { timestamp: "asc" } },
    },
  });
  if (!envelope) notFound();

  const canManage = requireTenantRole(user, ["owner", "admin"]);
  const canVoid = canManage && !["completed", "voided", "declined", "expired"].includes(envelope.status);

  return (
    <>
      <TopBar
        logoutHref="/api/dashboard/logout"
        links={[
          { href: "/dashboard", label: "Envelopes" },
          { href: "/dashboard/templates", label: "Templates" },
          { href: "/dashboard/webhook-activity", label: "Integration Alerts" },
          { href: "/dashboard/settings", label: "Settings" },
        ]}
      />
      <div className="page-shell wide">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <h1>{envelope.template.name}</h1>
            <div className="signature-rule" />
          </div>
          <StatusBadge status={envelope.status} />
        </div>

        <Card style={{ marginBottom: 16 }}>
          <h3>Details</h3>
          <p style={{ fontSize: 14 }}>External ref: {envelope.externalRef ?? "—"}</p>
          <p style={{ fontSize: 14 }}>Created: {envelope.createdAt.toLocaleString()}</p>
          <p style={{ fontSize: 14 }}>Expires: {envelope.expiresAt?.toLocaleString() ?? "—"}</p>
          {envelope.completedAt && <p style={{ fontSize: 14 }}>Completed: {envelope.completedAt.toLocaleString()}</p>}
          {envelope.legalHold && (
            <p style={{ fontSize: 13, color: "var(--warning)", marginTop: 8 }}>
              🔒 Legal hold active — exempt from automatic deletion even if this workspace's data is deleted.
            </p>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {envelope.signedPdfStorageKey && (
              <a href={storage.url(envelope.signedPdfStorageKey)} target="_blank" style={{ textDecoration: "none" }}>
                <Button variant="secondary">Download signed PDF</Button>
              </a>
            )}
            {envelope.certificate && (
              <a href={`/certificates/${envelope.id}`} target="_blank" style={{ textDecoration: "none" }}>
                <Button variant="secondary">View Certificate of Completion</Button>
              </a>
            )}
            {canManage && (
              <form action={`/api/dashboard/envelopes/${envelope.id}/legal-hold`} method="POST">
                <Button type="submit" variant="secondary">
                  {envelope.legalHold ? "Release legal hold" : "Place legal hold"}
                </Button>
              </form>
            )}
            {canVoid && (
              <form action={`/api/dashboard/envelopes/${envelope.id}/void`} method="POST">
                <Button type="submit" variant="danger">Void envelope</Button>
              </form>
            )}
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }} index={1}>
          <h3>Recipients</h3>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Acted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {envelope.recipients.map((r) => (
                <tr key={r.id}>
                  <td>{r.signingOrder}</td>
                  <td>{r.name} <span style={{ color: "var(--text-muted)" }}>({r.email})</span></td>
                  <td>{r.role}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.signedAt?.toLocaleString() ?? "—"}</td>
                  <td>
                    {!["signed", "declined"].includes(r.status) && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <InPersonSignButton envelopeId={envelope.id} recipientId={r.id} />
                        <span style={{ color: "var(--border-strong)" }}>·</span>
                        <SendReminderButton envelopeId={envelope.id} recipientId={r.id} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card index={2}>
          <h3>Audit trail</h3>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>IP</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {envelope.auditEvents.map((e) => (
                <tr key={e.id}>
                  <td>{e.eventType}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.ipAddress ?? "—"}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.timestamp.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <SiteFooter />
    </>
  );
}
