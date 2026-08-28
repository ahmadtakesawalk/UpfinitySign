// DEPLOY TO: app/admin/staff/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/motion/Button";
import { Card } from "@/components/motion/Card";
import { useToast } from "@/components/motion/Toast";

interface StaffMember {
  id: string;
  email: string;
  role: "super_admin" | "support" | "billing_ops";
  created_at: string;
  pending_setup: boolean;
}

const ROLES = [
  { value: "super_admin", label: "Super admin — full platform control, incl. managing other staff" },
  { value: "billing_ops", label: "Billing ops — manage tiers/subscriptions, no raw tenant document access" },
  { value: "support", label: "Support — read tenant data + assist, no billing/tier changes" },
];

export default function AdminStaffPage() {
  const router = useRouter();
  const { show } = useToast();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support");
  const [inviting, setInviting] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/staff");
    if (res.status === 401) return router.push("/admin/login");
    if (res.status === 403) return setForbidden(true);
    const json = await res.json();
    setStaff(json.staff);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Couldn't send that invite.", type: "error" });
        return;
      }
      show({ message: `Invited ${email}.`, type: "success" });
      setEmail("");
      load();
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(id: string, newRole: string) {
    const res = await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    const json = await res.json();
    if (!res.ok) {
      show({ message: json.error ?? "Couldn't change that role.", type: "error" });
      load(); // revert the optimistic-looking select back to server truth
      return;
    }
    show({ message: "Role updated.", type: "success" });
    load();
  }

  async function handleRemove(id: string, memberEmail: string) {
    if (!confirm(`Remove platform admin access for ${memberEmail}?`)) return;
    const res = await fetch(`/api/admin/staff/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      show({ message: json.error ?? "Couldn't remove this admin.", type: "error" });
      return;
    }
    show({ message: "Removed.", type: "success" });
    load();
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
      <div style={{ padding: 32, maxWidth: 800, margin: "0 auto" }}>
        <h1>Platform admin staff</h1>
        <div className="signature-rule" />

        {forbidden ? (
          <Card>
            <p>Only super_admin can manage platform staff.</p>
          </Card>
        ) : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 10 }}>Invite a platform admin</h3>
              <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="email"
                  placeholder="teammate@upfinity.ca"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{ flex: 1 }}
                />
                <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 160 }}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
                </select>
                <Button type="submit" variant="primary" disabled={inviting}>
                  {inviting ? "Inviting…" : "Invite"}
                </Button>
              </form>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                {ROLES.find((r) => r.value === role)?.label}
              </p>
            </Card>

            <Card>
              <h3 style={{ marginBottom: 10 }}>Current staff</h3>
              {!staff ? (
                <p style={{ fontSize: 13 }}>Loading…</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id}>
                        <td>{s.email}</td>
                        <td>
                          <select value={s.role} onChange={(e) => handleRoleChange(s.id, e.target.value)} style={{ fontSize: 13, height: 32 }}>
                            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
                          </select>
                        </td>
                        <td>
                          {s.pending_setup ? (
                            <span className="badge badge-pending">Invite pending</span>
                          ) : (
                            <span className="badge badge-success">Active</span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="danger" style={{ fontSize: 12 }} onClick={() => handleRemove(s.id, s.email)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
