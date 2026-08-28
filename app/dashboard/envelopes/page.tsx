// DEPLOY TO: app/dashboard/envelopes/page.tsx
"use client";

// Agreements/Inbox list — layout matches the DocuSign reference (sidebar
// folders, search+filter row, table, pagination). Row actions are
// intentionally minimal: Download (a direct storage.url() link, same
// pattern as app/dashboard/envelopes/[id]/page.tsx) and Void. Resend was
// removed from here — the real endpoint
// (recipients/[recipientId]/send-reminder) is per-RECIPIENT, not
// per-envelope, so a single button on an envelope row was never the right
// shape; SendReminderButton on the envelope detail page already handles
// this correctly, per recipient. The row's Name links there for anything
// beyond download/void.
//
// FOLDER SEMANTICS still flagged: DocuSign's Inbox/Sent split assumes a
// user both sends AND receives within DocuSign. This product is
// sender-only (tenants send to external recipients who never log in
// here), so there's no real "received by me" set. Folders below are
// status-based filters as a reasonable stand-in.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonRows } from "@/components/motion/Skeleton";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";
import { SiteFooter } from "@/components/SiteFooter";

interface EnvelopeRow {
  id: string;
  name: string;
  status: string;
  external_ref?: string | null;
  recipients: { name: string; email: string; role: string; status: string }[];
  updated_at: string;
  created_at: string;
  expires_at: string | null;
  signed_pdf_url: string | null;
}

type Folder = "inbox" | "sent" | "completed" | "action_required";

const FOLDERS: { key: Folder; label: string; icon: string }[] = [
  { key: "inbox", label: "Inbox", icon: "M2 5h12v8H2z M2 5l6 4 6-4" },
  { key: "sent", label: "Sent", icon: "M2 8l12-6-4 12-2-5-6-1z" },
  { key: "completed", label: "Completed", icon: "M8 2a6 6 0 100 12A6 6 0 008 2zM5.5 8l1.8 1.8L10.5 6" },
  { key: "action_required", label: "Action Required", icon: "M8 2v8M8 12v.01" },
];

function matchesFolder(e: EnvelopeRow, folder: Folder): boolean {
  switch (folder) {
    case "completed": return e.status === "completed";
    case "action_required": return e.status === "declined";
    case "sent": return true; // sender-only product — "Sent" is effectively everything
    case "inbox": return true; // see file-header note — no real distinction exists yet
  }
}

function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

function SidebarIcon({ d }: { d: string }) {
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export default function EnvelopesInboxPage() {
  const router = useRouter();
  const { show } = useToast();
  const [envelopes, setEnvelopes] = useState<EnvelopeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voidingId, setVoidingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/envelopes?limit=100");
      if (res.status === 401) return router.push("/dashboard/login");
      if (res.ok) {
        const json = await res.json();
        setEnvelopes(json.envelopes ?? []);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return envelopes
      .filter((e) => matchesFolder(e, folder))
      .filter((e) => (statusFilter ? e.status === statusFilter : true))
      .filter((e) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return e.name.toLowerCase().includes(q) || e.recipients.some((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
      });
  }, [envelopes, folder, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  function toggleSelectAll() {
    if (selected.size === pageRows.length) setSelected(new Set());
    else setSelected(new Set(pageRows.map((r) => r.id)));
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleVoid(id: string) {
    if (!window.confirm("Void this envelope? This can't be undone.")) return;
    setVoidingId(id);
    try {
      // The real endpoint (app/api/dashboard/envelopes/[id]/void/route.ts)
      // is built for a native <form method="POST"> and responds with a
      // redirect — it takes no body and requires owner/admin. Using
      // redirect:'manual' here lets us call it via fetch without leaving
      // this list (a plain fetch would otherwise follow the redirect into
      // the detail page's HTML and choke trying to read it as JSON — same
      // class of bug fixed in the logout routes).
      const res = await fetch(`/api/dashboard/envelopes/${id}/void`, { method: "POST", redirect: "manual" });
      if (res.status === 403) {
        show({ message: "Only an owner or admin can void this envelope.", type: "error" });
        return;
      }
      if (res.type !== "opaqueredirect" && !res.ok) throw new Error();
      setEnvelopes((prev) => prev.map((e) => (e.id === id ? { ...e, status: "voided" } : e)));
      show({ message: "Envelope voided.", type: "success" });
    } catch {
      show({ message: "Couldn't void this envelope — try again.", type: "error" });
    } finally {
      setVoidingId(null);
    }
  }

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
      <div style={{ display: "flex", minHeight: "calc(100vh - 65px)" }}>
        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", padding: 20, display: "flex", flexDirection: "column" }}>
          <a href="/dashboard/envelopes/new" style={{ textDecoration: "none" }}>
            <Button variant="primary" style={{ width: "100%", marginBottom: 20 }}>
              Start Now
            </Button>
          </a>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 }}>Envelopes</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {FOLDERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => { setFolder(f.key); setPage(0); setSelected(new Set()); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--radius-sm)",
                  border: "none", background: folder === f.key ? "var(--accent-soft)" : "transparent",
                  color: folder === f.key ? "var(--accent-dark)" : "var(--text-secondary)",
                  fontSize: 13.5, fontWeight: folder === f.key ? 600 : 400, cursor: "pointer", textAlign: "left",
                  transition: "background var(--transition-fast, 100ms) ease",
                }}
              >
                <SidebarIcon d={f.icon} />
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: "32px 32px 48px", minWidth: 0 }}>
          <h1 style={{ marginBottom: 20 }}>{FOLDERS.find((f) => f.key === folder)?.label}</h1>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 260px", minWidth: 200 }}>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search Inbox and Folders"
                style={{ paddingLeft: 34 }}
              />
              <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.6" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
                <circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" />
              </svg>
            </div>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} style={{ width: 160, height: 42 }}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="opened">Opened</option>
              <option value="signed">Signed</option>
              <option value="completed">Completed</option>
              <option value="declined">Declined</option>
              <option value="voided">Voided</option>
              <option value="expired">Expired</option>
            </select>
            {(search || statusFilter) && (
              <Button variant="secondary" onClick={() => { setSearch(""); setStatusFilter(""); }}>Clear All</Button>
            )}
          </div>

          {loading ? (
            <SkeletonRows count={6} />
          ) : filtered.length === 0 ? (
            <div className="empty-state"><p>No agreements here yet.</p></div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" style={{ width: "auto", height: "auto" }} checked={pageRows.length > 0 && selected.size === pageRows.length} onChange={toggleSelectAll} />
                    </th>
                    <th>Name</th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 140 }}>Last Change</th>
                    <th style={{ width: 200 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e) => {
                    const { date, time } = formatDate(e.updated_at);
                    const canVoid = !["completed", "voided", "declined", "expired"].includes(e.status);
                    return (
                      <tr key={e.id}>
                        <td><input type="checkbox" style={{ width: "auto", height: "auto" }} checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} /></td>
                        <td>
                          <a href={`/dashboard/envelopes/${e.id}`} style={{ color: "var(--accent-dark)", fontWeight: 500, textDecoration: "none", display: "block" }}>{e.name}</a>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>To: {e.recipients.map((r) => r.name).join(", ")}</span>
                        </td>
                        <td><StatusBadge status={e.status} /></td>
                        <td><div>{date}</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>{time}</div></td>
                        <td>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                            {e.signed_pdf_url ? (
                              <a href={e.signed_pdf_url} target="_blank" rel="noreferrer" className="secondary" style={{ padding: "6px 14px", fontSize: 13, textDecoration: "none" }}>Download</a>
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not signed yet</span>
                            )}
                            {canVoid && (
                              <Button variant="secondary" disabled={voidingId === e.id} onClick={() => handleVoid(e.id)} style={{ padding: "6px 14px", fontSize: 13, color: "var(--danger)" }}>
                                {voidingId === e.id ? "Voiding…" : "Void"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ width: 110, height: 36, fontSize: 13 }}>
                  <option value={25}>25 / Page</option>
                  <option value={50}>50 / Page</option>
                  <option value={100}>100 / Page</option>
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span>Page {page + 1}</span>
                  <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ padding: "4px 10px" }}>‹</button>
                  <button type="button" className="secondary" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} style={{ padding: "4px 10px" }}>›</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
