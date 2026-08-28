// DEPLOY TO: app/dashboard/page.tsx
"use client";

// Dashboard home — the logged-in landing page. Layout follows the
// DocuSign reference: hero banner with primary CTAs, Tasks (empty-state
// for now — needs a real "assigned to me" task source, flagged below),
// Overview counts, and recent Agreement Activity, all backed by
// GET /api/dashboard/envelopes.
//
// "Get Signatures" / "Sign Document" both link to the real, working
// /dashboard/envelopes/new flow (template selection + recipients +
// message + options, all functional) — a previous version of this file
// opened a custom modal that duplicated that flow with a non-functional
// upload step. Removed in favor of the one real implementation.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/motion/Button";
import { SkeletonRows } from "@/components/motion/Skeleton";
import { SiteFooter } from "@/components/SiteFooter";

interface EnvelopeRow {
  id: string;
  name: string;
  status: string;
  recipients: { name: string; email: string; role: string; status: string }[];
  updated_at: string;
  expires_at: string | null;
}

function statusBadgeClass(status: string): string {
  if (status === "completed") return "badge badge-success";
  if (status === "declined" || status === "voided" || status === "expired") return "badge badge-danger";
  if (["sent", "delivered", "opened"].includes(status)) return "badge badge-pending";
  return "badge badge-warning";
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}

export default function DashboardHomePage() {
  const router = useRouter();
  const [envelopes, setEnvelopes] = useState<EnvelopeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/envelopes?limit=10");
      if (res.status === 401) return router.push("/dashboard/login");
      if (res.ok) {
        const json = await res.json();
        setEnvelopes(json.envelopes ?? []);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = envelopes.filter((e) => ["sent", "delivered", "opened"].includes(e.status)).length;
  const expiringSoonCount = envelopes.filter((e) => {
    if (!e.expires_at || !["sent", "delivered", "opened"].includes(e.status)) return false;
    const daysLeft = (new Date(e.expires_at).getTime() - Date.now()) / 86_400_000;
    return daysLeft >= 0 && daysLeft <= 3;
  }).length;
  const completedCount = envelopes.filter((e) => e.status === "completed").length;

  return (
    <>
      <TopBar
        logoutHref="/api/dashboard/logout"
        links={[
          { href: "/dashboard", label: "Home" },
          { href: "/dashboard/envelopes", label: "Envelopes" },
          { href: "/dashboard/templates", label: "Templates" },
          { href: "/dashboard/settings", label: "Settings" },
        ]}
      />

      <div
        style={{
          background: "var(--hero-gradient)",
          padding: "56px 24px",
          textAlign: "center",
          color: "#fff",
        }}
      >
        <h1 style={{ color: "#fff", fontSize: 28, marginBottom: 24 }}>Welcome back</h1>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/dashboard/envelopes/new" style={{ textDecoration: "none" }}>
            <Button variant="primary">▷ Get Signatures</Button>
          </a>
          <a href="/dashboard/envelopes/new" style={{ textDecoration: "none" }}>
            <Button variant="secondary" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.4)" }}>✎ Sign Document</Button>
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "32px auto", padding: "0 24px 48px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Tasks</h3>
            </div>
            <div className="empty-state">
              <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: 4 }}>You don't have any tasks yet</p>
              <p style={{ fontSize: 13 }}>When you have new tasks assigned to you, they'll show up here.</p>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Agreement Activity</h3>
            {loading ? (
              <SkeletonRows count={3} />
            ) : envelopes.length === 0 ? (
              <div className="empty-state"><p>No agreements yet — send your first envelope to see activity here.</p></div>
            ) : (
              <div>
                {envelopes.map((e) => (
                  <a
                    key={e.id}
                    href={`/dashboard/envelopes/${e.id}`}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none" }}
                  >
                    <div>
                      <p style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{e.name}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{timeAgo(e.updated_at)}</p>
                    </div>
                    <span className={statusBadgeClass(e.status)}>{statusLabel(e.status)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>Overview</h3>
          {[
            { label: "Waiting for others", value: activeCount },
            { label: "Expiring soon", value: expiringSoonCount },
            { label: "Completed", value: completedCount },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{loading ? "—" : row.value}</span>
            </div>
          ))}
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
