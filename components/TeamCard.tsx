"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";

interface TeamMember {
  id: string;
  email: string;
  role: string;
}

export function TeamCard({ initialMembers, currentUserIsOwner }: { initialMembers: TeamMember[]; currentUserIsOwner: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("sender");
  const [inviting, setInviting] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/dashboard/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMembers((m) => [...m, { id: json.id, email: json.email, role: json.role }]);
      setEmail("");
    } catch (err: any) {
      show({ message: err.message ?? "Failed to send invite", type: "error" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this teammate? They'll lose access immediately.")) return;
    const res = await fetch(`/api/dashboard/team/${id}/remove`, { method: "POST" });
    if (res.status === 401) return router.push("/dashboard/login");
    const json = await res.json();
    if (!res.ok) return show({ message: json.error ?? "Failed to remove", type: "error" });
    setMembers((m) => m.filter((u) => u.id !== id));
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Team</h3>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            {currentUserIsOwner && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              {currentUserIsOwner && (
                <td>
                  {u.role !== "owner" && (
                    <Button variant="secondary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => handleRemove(u.id)}>
                      Remove
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {currentUserIsOwner && (
        <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <input placeholder="teammate@company.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 130 }}>
            <option value="admin">Admin</option>
            <option value="sender">Sender</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button type="submit" variant="primary" disabled={inviting} style={{ whiteSpace: "nowrap" }}>
            {inviting ? "Inviting…" : "Invite"}
          </Button>
        </form>
      )}
    </div>
  );
}
