"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";

interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string[];
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export function ApiKeysCard({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const { show } = useToast();
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dashboard/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setNewRawKey(json.raw_key);
      setKeys((k) => [...k, { id: json.id, name: json.name, scopes: json.scopes, revokedAt: null, lastUsedAt: null }]);
      setName("");
    } catch (err: any) {
      show({ message: err.message ?? "Failed to create key", type: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this key? Anything using it (like Upfinity Talent) will stop working immediately.")) return;
    const res = await fetch(`/api/dashboard/api-keys/${id}/revoke`, { method: "POST" });
    if (res.status === 401) return router.push("/dashboard/login");
    if (res.ok) setKeys((k) => k.map((key) => (key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key)));
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>API keys</h3>
      <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Used by external systems (like Upfinity Talent / Dvxel Qbank) to send envelopes on this
        workspace's behalf — see the integration docs in the README for the request shape.
      </p>

      {newRawKey && (
        <div
          className="card"
          style={{ background: "var(--accent-soft)", borderColor: "var(--accent)", marginTop: 12, marginBottom: 16 }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
            Copy this now — it won't be shown again.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                flex: 1,
                fontSize: 12,
                background: "var(--bg-surface)",
                padding: "8px 12px",
                borderRadius: 8,
                overflowX: "auto",
                whiteSpace: "nowrap",
              }}
            >
              {newRawKey}
            </code>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(newRawKey);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button variant="secondary" style={{ marginTop: 12 }} onClick={() => setNewRawKey(null)}>
            Done
          </Button>
        </div>
      )}

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Scopes</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{k.scopes.join(", ")}</td>
              <td>
                <span className={`badge ${k.revokedAt ? "badge-danger" : "badge-success"}`}>
                  {k.revokedAt ? "Revoked" : "Active"}
                </span>
              </td>
              <td>
                {!k.revokedAt && (
                  <Button variant="secondary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => handleRevoke(k.id)}>
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-state">
                No API keys yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input placeholder="e.g. Upfinity Talent integration" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" disabled={creating} style={{ whiteSpace: "nowrap" }}>
          {creating ? "Creating…" : "Create key"}
        </Button>
      </form>
    </div>
  );
}
