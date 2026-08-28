// DEPLOY TO: app/dashboard/webhook-activity/page.tsx
//
// Surfaces DeadLetterWebhook rows for this tenant — deliveries that
// failed every automatic retry (config.webhooks.maxRetries, exponential
// backoff) and would otherwise only ever have existed as a raw database
// row nobody without direct DB access could see.
//
// Displayed to users as "Integration Alerts" — the route/URL stays
// /dashboard/webhook-activity (no need to churn bookmarks/links over a
// label change), but every visible string here is plain-language: event
// names, timestamps, attempt counts, and the "Failed" status are all
// humanized. The underlying concept (a failed webhook delivery) is
// unavoidably technical, but nothing forces the reader to know that term
// to understand what happened and what to do about it.

import { redirect } from "next/navigation";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/motion/Card";
import { SiteFooter } from "@/components/SiteFooter";
import { WebhookRetryButton } from "@/components/WebhookRetryButton";

const EVENT_LABELS: Record<string, string> = {
  "envelope.sent": "Document sent",
  "envelope.completed": "Document completed",
  "envelope.declined": "Document declined",
  "envelope.voided": "Document voided",
  "envelope.expired": "Document expired",
};

function friendlyEventLabel(event?: string): string {
  if (!event) return "An update";
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  // Fallback for any event not in the map above — turn "envelope.foo_bar"
  // into "Envelope foo bar" rather than showing the raw dotted string.
  return event.replace(/\./g, " ").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

function AlertIcon({ resolved }: { resolved: boolean }) {
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: resolved ? "var(--success-bg)" : "var(--danger-bg)",
        color: resolved ? "var(--success)" : "var(--danger)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {resolved ? (
        <svg width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-6.5" /></svg>
      ) : (
        <svg width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2L1.5 13.5h13L8 2z" /><path d="M8 6.5v3M8 11.5v.01" /></svg>
      )}
    </div>
  );
}

export default async function WebhookActivityPage() {
  const user = await getCurrentTenantUser();
  if (!user) redirect("/dashboard/login");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const deadLetters = await prisma.deadLetterWebhook.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unresolved = deadLetters.filter((d) => !d.resolvedAt);

  return (
    <>
      <TopBar
        logoutHref="/api/dashboard/logout"
        links={[
          { href: "/dashboard", label: "Envelopes" },
          { href: "/dashboard/templates", label: "Templates" },
          { href: "/dashboard/webhook-activity", label: `Integration Alerts${unresolved.length ? ` (${unresolved.length})` : ""}` },
          { href: "/dashboard/settings", label: "Settings" },
        ]}
      />
      <div className="page-shell wide">
        <h1>Integration Alerts</h1>
        <div className="signature-rule" />
        <p style={{ marginBottom: 20, fontSize: 14, color: "var(--text-secondary)" }}>
          When we try to notify your connected integration about something (a document being sent, signed,
          or declined) and it doesn't go through, it shows up here. Your documents and their history are
          never affected either way — this only means your integration didn't hear about it yet.
        </p>

        {!tenant.webhookUrl && (
          <Card style={{ marginBottom: 16, background: "var(--bg-subtle)" }}>
            <p style={{ fontSize: 14 }}>
              You haven't connected an integration yet — nothing will show up here until you add a
              webhook URL in <a href="/dashboard/settings">Settings</a>.
            </p>
          </Card>
        )}

        {deadLetters.length === 0 ? (
          <Card>
            <div className="empty-state">
              <p style={{ color: "var(--text-primary)", fontWeight: 500 }}>You're all caught up</p>
              <p>Everything we've sent to your integration has gone through successfully.</p>
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {deadLetters.map((d, i) => {
              const payload = d.payload as { event?: string; envelope_id?: string };
              const resolved = Boolean(d.resolvedAt);
              return (
                <Card key={d.id} index={i}>
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <AlertIcon resolved={resolved} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                        <div>
                          <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{friendlyEventLabel(payload.event)}</span>
                          {payload.envelope_id && (
                            <>
                              {" "}
                              <a href={`/dashboard/envelopes/${payload.envelope_id}`} style={{ fontSize: 13, color: "var(--accent-dark)" }}>
                                View document →
                              </a>
                            </>
                          )}
                        </div>
                        <span className={resolved ? "badge badge-success" : "badge badge-danger"}>
                          {resolved ? "Resolved" : "Needs attention"}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>
                        {timeAgo(d.createdAt)} · tried {d.attempts} time{d.attempts === 1 ? "" : "s"}
                      </p>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)", background: "var(--bg-subtle)", padding: "8px 10px", borderRadius: "var(--radius-sm)", marginBottom: resolved ? 0 : 10 }}>
                        We tried reaching your integration and got: <span style={{ fontFamily: "monospace", fontSize: 12 }}>{d.lastError}</span>
                      </p>
                      {!resolved && <WebhookRetryButton deadLetterId={d.id} />}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
