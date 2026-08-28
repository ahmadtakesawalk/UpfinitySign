// DEPLOY TO: app/dashboard/templates/new/page.tsx
"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";
import { AssistantChatPanel } from "@/components/assistant/AssistantChatPanel";
import { SiteFooter } from "@/components/SiteFooter";
import { TEMPLATE_STARTERS } from "@/lib/templates/starters";

interface Folder {
  id: string;
  name: string;
}

// useSearchParams() requires a Suspense boundary in the App Router — this
// wrapper/inner-component split is the same pattern already used in
// envelopes/new/page.tsx. Missed it here when folder preselection was
// added after this file's initial version; Next.js only rejects it at
// build/prerender time, not in local `tsc` type-checking, which is why it
// didn't surface until an actual `next build`.
export default function NewTemplatePage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading…</p></div>}>
      <NewTemplateForm />
    </Suspense>
  );
}

function NewTemplateForm() {
  const router = useRouter();
  const { show } = useToast();
  const preselectedFolder = useSearchParams().get("folder");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState(preselectedFolder && preselectedFolder !== "none" ? preselectedFolder : "");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"upload" | "describe" | "starter">("upload");
  const [starterSubmitting, setStarterSubmitting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/template-folders")
      .then((res) => { if (res.status === 401) { router.push("/dashboard/login"); return null; } return res.json(); })
      .then((json) => json && setFolders(json.folders ?? []));
  }, [router]);

  function handleFile(f: File | null) {
    if (!f) return;
    const isPdf = f.type === "application/pdf";
    const isDocx = f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || f.name.toLowerCase().endsWith(".docx");
    if (!isPdf && !isDocx) {
      setError("Only PDF or Word (.docx) files are supported.");
      return;
    }
    setError(null);
    setFile(f);
    if (!name) setName(f.name.replace(/\.(pdf|docx)$/i, ""));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) {
      setError("Give the template a name and choose a PDF.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name.trim());
    if (folderId) formData.append("folder_id", folderId);

    try {
      const res = await fetch("/api/dashboard/templates", { method: "POST", body: formData });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      show({ message: "Template created — review the suggested fields below.", type: "success" });
      router.push(`/dashboard/templates/${json.template_id}`);
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  }

  async function handleStarterPick(starterId: string) {
    setStarterSubmitting(starterId);
    try {
      const res = await fetch("/api/dashboard/templates/from-starter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starterId, folderId: folderId || undefined }),
      });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Something went wrong.", type: "error" });
        setStarterSubmitting(null);
        return;
      }
      show({ message: "Template created from starter — customize it before sending.", type: "success" });
      router.push(`/dashboard/templates/${json.template_id}`);
    } catch {
      show({ message: "Network error — try again.", type: "error" });
      setStarterSubmitting(null);
    }
  }

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
      <div className="page-shell">
        <h1>Create a template</h1>
        <div className="signature-rule" />

        <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={mode === "upload" ? "primary" : "secondary"}
            style={{ fontSize: 13 }}
          >
            Upload a document
          </button>
          <button
            type="button"
            onClick={() => setMode("starter")}
            className={mode === "starter" ? "primary" : "secondary"}
            style={{ fontSize: 13 }}
          >
            Start from a common template
          </button>
          <button
            type="button"
            onClick={() => setMode("describe")}
            className={mode === "describe" ? "primary" : "secondary"}
            style={{ fontSize: 13 }}
          >
            ✨ Describe it to the assistant
          </button>
        </div>

        {mode === "starter" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {TEMPLATE_STARTERS.map((s) => (
              <Card key={s.id} style={{ cursor: starterSubmitting ? "default" : "pointer", opacity: starterSubmitting && starterSubmitting !== s.id ? 0.5 : 1 }}>
                <h3 style={{ marginBottom: 4 }}>{s.name}</h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>{s.description}</p>
                <Button
                  variant="secondary"
                  disabled={Boolean(starterSubmitting)}
                  onClick={() => handleStarterPick(s.id)}
                  style={{ width: "100%" }}
                >
                  {starterSubmitting === s.id ? "Creating…" : "Use this template"}
                </Button>
              </Card>
            ))}
          </div>
        )}

        {mode === "describe" && (
          <Card style={{ padding: 0, height: 560, overflow: "hidden" }}>
            <AssistantChatPanel onDocumentGenerated={(templateId) => router.push(`/dashboard/templates/${templateId}`)} />
          </Card>
        )}

        {mode === "upload" && (
        <form onSubmit={handleSubmit}>
          <Card style={{ marginBottom: 16 }}>
            <label className="field-label">Template name</label>
            <input
              placeholder="e.g. NDA — standard"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="field-label">Folder (optional)</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={{ marginBottom: 16 }}>
              <option value="">Uncategorized</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>

            <label className="field-label">Document</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0] ?? null); }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border-strong)"}`,
                borderRadius: "var(--radius)",
                padding: "40px 20px",
                textAlign: "center",
                cursor: "pointer",
                background: dragOver ? "var(--accent-soft)" : "var(--bg-subtle)",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              {file ? (
                <p style={{ color: "var(--text-primary)", fontWeight: 500 }}>{file.name}</p>
              ) : (
                <>
                  <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: 4 }}>
                    Drop a PDF or Word document here, or click to browse
                  </p>
                  <p style={{ fontSize: 13 }}>We'll suggest field placements automatically — you'll confirm them next.</p>
                </>
              )}
            </div>

            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
          </Card>

          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Uploading…" : "Continue to field placement"}
          </Button>
        </form>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
