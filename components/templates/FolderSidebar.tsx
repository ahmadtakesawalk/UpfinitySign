// DEPLOY TO: components/templates/FolderSidebar.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/motion/Toast";
import { Button } from "@/components/motion/Button";

interface Folder {
  id: string;
  name: string;
  _count: { templates: number };
}

// activeFolder is passed down from the server component (which already
// parses `searchParams` server-side) rather than read here via
// useSearchParams() — avoids requiring a Suspense boundary in the parent
// page for what the page already knows, and avoids a redundant
// server/client parse of the same query param.
export function FolderSidebar({
  folders,
  totalCount,
  uncategorizedCount,
  activeFolder,
}: {
  folders: Folder[];
  totalCount: number;
  uncategorizedCount: number;
  activeFolder: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/dashboard/template-folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.status === 401) return router.push("/dashboard/login");
    const json = await res.json();
    if (!res.ok) {
      show({ message: json.error ?? "Couldn't create folder.", type: "error" });
      return;
    }
    setNewName("");
    setCreating(false);
    show({ message: "Folder created.", type: "success" });
    router.refresh();
  }

  async function renameFolder(id: string) {
    if (!renameValue.trim()) return;
    const res = await fetch(`/api/dashboard/template-folders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (res.status === 401) return router.push("/dashboard/login");
    if (!res.ok) {
      const json = await res.json();
      show({ message: json.error ?? "Couldn't rename folder.", type: "error" });
      return;
    }
    setRenamingId(null);
    router.refresh();
  }

  async function deleteFolder(id: string) {
    const res = await fetch(`/api/dashboard/template-folders/${id}`, { method: "DELETE" });
    if (res.status === 401) return router.push("/dashboard/login");
    if (!res.ok) {
      const json = await res.json();
      show({ message: json.error ?? "Couldn't delete folder.", type: "error" });
      return;
    }
    show({ message: "Folder deleted — its templates moved to Uncategorized.", type: "success" });
    if (activeFolder === id) router.push("/dashboard/templates");
    router.refresh();
  }

  return (
    <div className="card" style={{ width: 220, flexShrink: 0 }}>
      <h3 style={{ fontSize: 13, marginBottom: 10 }}>Folders</h3>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
        <a
          href="/dashboard/templates"
          style={{
            fontSize: 14,
            padding: "6px 8px",
            borderRadius: 6,
            textDecoration: "none",
            color: !activeFolder ? "var(--accent-dark)" : "var(--text-primary)",
            background: !activeFolder ? "var(--accent-soft)" : "transparent",
            fontWeight: !activeFolder ? 600 : 400,
          }}
        >
          All templates ({totalCount})
        </a>
        <a
          href="/dashboard/templates?folder=none"
          style={{
            fontSize: 14,
            padding: "6px 8px",
            borderRadius: 6,
            textDecoration: "none",
            color: activeFolder === "none" ? "var(--accent-dark)" : "var(--text-primary)",
            background: activeFolder === "none" ? "var(--accent-soft)" : "transparent",
            fontWeight: activeFolder === "none" ? 600 : 400,
          }}
        >
          Uncategorized ({uncategorizedCount})
        </a>
        {folders.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {renamingId === f.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => renameFolder(f.id)}
                onKeyDown={(e) => e.key === "Enter" && renameFolder(f.id)}
                style={{ height: 30, fontSize: 13 }}
              />
            ) : (
              <>
                <a
                  href={`/dashboard/templates?folder=${f.id}`}
                  style={{
                    flex: 1,
                    fontSize: 14,
                    padding: "6px 8px",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: activeFolder === f.id ? "var(--accent-dark)" : "var(--text-primary)",
                    background: activeFolder === f.id ? "var(--accent-soft)" : "transparent",
                    fontWeight: activeFolder === f.id ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  onDoubleClick={(e) => { e.preventDefault(); setRenamingId(f.id); setRenameValue(f.name); }}
                >
                  {f.name} ({f._count.templates})
                </a>
                <button
                  type="button"
                  onClick={() => deleteFolder(f.id)}
                  title="Delete folder"
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: "0 4px" }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
      </nav>

      {creating ? (
        <form onSubmit={createFolder} style={{ display: "flex", gap: 4 }}>
          <input autoFocus placeholder="Folder name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ height: 32, fontSize: 13 }} />
          <Button type="submit" variant="secondary" style={{ padding: "6px 10px", fontSize: 12 }}>Add</Button>
        </form>
      ) : (
        <Button variant="secondary" style={{ fontSize: 12, padding: "6px 10px", width: "100%" }} onClick={() => setCreating(true)}>
          + New folder
        </Button>
      )}
    </div>
  );
}
