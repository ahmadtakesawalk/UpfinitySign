// DEPLOY TO: app/dashboard/envelopes/new/page.tsx
"use client";

// Recipients are fully sender-authored — no slot-derivation from the
// template's field roles anymore. Start with one blank row, add as many
// as you want, in any role, in any order. Signing order is just list
// order (top to bottom = who signs first) — reorder by moving rows.
//
// Each recipient row collapses to a one-line summary (name · email ·
// role) once it has content, matching DocuSign's recipient list — click
// the row to expand and edit. A newly-added row starts expanded so it
// can be filled in immediately.

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";
import { SiteFooter } from "@/components/SiteFooter";

interface TemplateSummary {
  id: string;
  name: string;
  fieldMap: unknown;
  aiDrafted?: boolean;
  aiReviewedAt?: string | null;
}

type RecipientRole = "signer" | "approver" | "cc";

const ROLE_OPTIONS: { value: RecipientRole; label: string; hint: string }[] = [
  { value: "signer", label: "Needs to sign", hint: "Must complete all required fields and sign" },
  { value: "approver", label: "Needs to approve", hint: "Reviews and approves before it moves on" },
  { value: "cc", label: "Receives a copy", hint: "Gets the final document, no action needed" },
];

const MAX_RECIPIENTS = 50; // generous ceiling to stop runaway lists, not a UX-facing limit
const DEFAULT_EXPIRES_DAYS = 30;
const DEFAULT_REMINDER_DAYS = 2;

let clientIdSeq = 0;
function newClientId() {
  clientIdSeq += 1;
  return `r_${Date.now()}_${clientIdSeq}`;
}

interface RecipientRow {
  clientId: string;
  name: string;
  email: string;
  role: RecipientRole;
  message: string;
  accessCodeEnabled: boolean;
  accessCode: string;
  customizeOpen: boolean;
  rowOpen: boolean; // collapsed to a one-line summary when false
}

function blankRecipient(): RecipientRow {
  return {
    clientId: newClientId(),
    name: "",
    email: "",
    role: "signer",
    message: "",
    accessCodeEnabled: false,
    accessCode: "",
    customizeOpen: false,
    rowOpen: true,
  };
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform var(--transition-fast, 100ms ease)", flexShrink: 0 }}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export default function NewEnvelopePage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading…</p></div>}>
      <NewEnvelopeForm />
    </Suspense>
  );
}

function NewEnvelopeForm() {
  const router = useRouter();
  const { show } = useToast();
  const preselected = useSearchParams().get("template");

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState(preselected ?? "");
  const [recipients, setRecipients] = useState<RecipientRow[]>([blankRecipient()]);
  const [externalRef, setExternalRef] = useState("");
  const [expiresDays, setExpiresDays] = useState(DEFAULT_EXPIRES_DAYS);
  const [reminderDays, setReminderDays] = useState(DEFAULT_REMINDER_DAYS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline upload — priority #6, skip the two-step "create template, then
  // send" trip. Reuses the same POST /api/dashboard/templates endpoint
  // templates/new already calls (autoplace happens server-side there); this
  // page just stops forcing a separate visit to reach it.
  const [templateSource, setTemplateSource] = useState<"existing" | "upload">("existing");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/templates");
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      setTemplates(json.templates ?? []);
      if ((json.templates ?? []).length === 0) setTemplateSource("upload");
      setLoadingTemplates(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRecipient(clientId: string, patch: Partial<RecipientRow>) {
    setRecipients((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)));
  }

  function handleUploadFile(f: File | null) {
    if (!f) return;
    const isPdf = f.type === "application/pdf";
    const isDocx = f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || f.name.toLowerCase().endsWith(".docx");
    if (!isPdf && !isDocx) {
      setUploadError("Only PDF or Word (.docx) files are supported.");
      return;
    }
    setUploadError(null);
    setUploadFile(f);
    if (!uploadName) setUploadName(f.name.replace(/\.(pdf|docx)$/i, ""));
  }

  async function handleUploadSubmit() {
    if (!uploadFile || !uploadName.trim()) {
      setUploadError("Give the document a name and choose a file.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("name", uploadName.trim());
    try {
      const res = await fetch("/api/dashboard/templates", { method: "POST", body: formData });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error ?? "Something went wrong.");
        setUploading(false);
        return;
      }
      // AI-proposed fields land on the new template already (server-side
      // autoplace) — drop straight into the recipients step below with it
      // selected, instead of redirecting away to review fields first.
      setTemplates((prev) => [{ id: json.template_id, name: uploadName.trim(), fieldMap: json.field_map ?? [] }, ...prev]);
      setTemplateId(json.template_id);
      setTemplateSource("existing");
      show({ message: "Document uploaded — fields were placed automatically. Review them anytime from Templates.", type: "success" });
    } catch {
      setUploadError("Network error — please try again.");
    } finally {
      setUploading(false);
    }
  }

  function addRecipient() {
    if (recipients.length >= MAX_RECIPIENTS) {
      show({ message: `You can add up to ${MAX_RECIPIENTS} recipients.`, type: "error" });
      return;
    }
    // Collapse existing filled-in rows so the new blank one stands out.
    setRecipients((prev) => [
      ...prev.map((r) => (r.name.trim() || r.email.trim() ? { ...r, rowOpen: false } : r)),
      blankRecipient(),
    ]);
  }

  function removeRecipient(clientId: string) {
    setRecipients((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.clientId !== clientId)));
  }

  function moveRecipient(index: number, dir: -1 | 1) {
    setRecipients((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function validate(): string | null {
    if (!templateId) return "Choose a template.";
    if (recipients.length === 0) return "Add at least one recipient to continue.";
    for (const r of recipients) {
      if (!r.name.trim() || !r.email.trim()) return "Every recipient needs a name and email.";
    }
    const emails = recipients.map((r) => r.email.trim().toLowerCase());
    if (new Set(emails).size !== emails.length) return "Each recipient needs a unique email address.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/dashboard/envelopes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          external_ref: externalRef.trim() || undefined,
          expires_in_hours: expiresDays * 24,
          reminder_after_hours: reminderDays * 24,
          recipients: recipients.map((r, i) => ({
            name: r.name.trim(),
            email: r.email.trim(),
            role: r.role,
            signing_order: i + 1,
            message: r.message.trim() || undefined,
            access_code: r.accessCodeEnabled && r.accessCode.trim() ? r.accessCode.trim() : undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      show({ message: "Envelope sent.", type: "success" });
      router.push(`/dashboard/envelopes/${json.envelope_id}`);
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
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
        <h1>Send an envelope</h1>
        <div className="signature-rule" />

        {loadingTemplates ? (
          <p>Loading templates…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", borderRadius: 8, padding: 3, marginBottom: 14, width: "fit-content" }}>
                <button type="button" onClick={() => setTemplateSource("existing")} disabled={templates.length === 0} style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 500, border: "none", borderRadius: 6, cursor: templates.length === 0 ? "not-allowed" : "pointer", opacity: templates.length === 0 ? 0.5 : 1, background: templateSource === "existing" ? "var(--bg-surface)" : "transparent", color: templateSource === "existing" ? "var(--text-primary)" : "var(--text-secondary)", boxShadow: templateSource === "existing" ? "var(--shadow-sm)" : "none" }}>
                  Use a template
                </button>
                <button type="button" onClick={() => setTemplateSource("upload")} style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 500, border: "none", borderRadius: 6, cursor: "pointer", background: templateSource === "upload" ? "var(--bg-surface)" : "transparent", color: templateSource === "upload" ? "var(--text-primary)" : "var(--text-secondary)", boxShadow: templateSource === "upload" ? "var(--shadow-sm)" : "none" }}>
                  Upload a document
                </button>
              </div>

              {templateSource === "upload" ? (
                <div>
                  <label className="field-label">Document</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleUploadFile(e.dataTransfer.files?.[0] ?? null); }}
                    style={{ border: "1.5px dashed var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "24px 16px", textAlign: "center", cursor: "pointer", background: "var(--bg-subtle)", marginBottom: 12 }}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,.docx" hidden onChange={(e) => handleUploadFile(e.target.files?.[0] ?? null)} />
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
                      {uploadFile ? uploadFile.name : "Drop your file here or click to browse"}
                    </p>
                    <p style={{ fontSize: 11.5, color: "var(--text-muted)" }}>PDF or Word (.docx)</p>
                  </div>
                  <label className="field-label">Name</label>
                  <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="e.g. Consulting Agreement" style={{ marginBottom: 12 }} />
                  {uploadError && <p style={{ color: "var(--danger)", fontSize: 12.5, marginBottom: 12 }}>{uploadError}</p>}
                  <Button type="button" variant="primary" onClick={handleUploadSubmit} disabled={uploading || !uploadFile}>
                    {uploading ? "Uploading & placing fields…" : "Upload"}
                  </Button>
                  {templateId && templates.some((t) => t.id === templateId) && (
                    <p style={{ fontSize: 12.5, color: "var(--success)", marginTop: 10 }}>
                      ✓ Using "{templates.find((t) => t.id === templateId)?.name}" — continue below, or{" "}
                      <a href={`/dashboard/templates/${templateId}`}>review its fields</a>.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="field-label">Template</label>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ marginBottom: 4 }}>
                    <option value="">Choose a template…</option>
                    {templates.map((t) => {
                      const needsReview = t.aiDrafted && !t.aiReviewedAt;
                      return (
                        <option key={t.id} value={t.id} disabled={needsReview}>
                          {t.name}{needsReview ? " (needs review before it can be sent)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <h3>Recipients</h3>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Signs in the order listed, top to bottom</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
                Add at least one recipient name and email address to continue.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recipients.map((r, i) => {
                  const summaryLabel = r.name.trim() || r.email.trim()
                    ? `${r.name.trim() || "Unnamed"}${r.email.trim() ? ` · ${r.email.trim()}` : ""} · ${ROLE_OPTIONS.find((o) => o.value === r.role)?.label}`
                    : "New recipient — click to fill in";

                  return (
                    <div
                      key={r.clientId}
                      style={{
                        border: "1px solid var(--recipient-border)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--recipient-bg)",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => updateRecipient(r.clientId, { rowOpen: !r.rowOpen })}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ width: 20, fontSize: 12, color: "var(--recipient-accent)", flexShrink: 0, fontWeight: 600 }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13, color: r.name.trim() || r.email.trim() ? "var(--text-primary)" : "var(--text-muted)" }}>
                          {summaryLabel}
                        </span>
                        <ChevronIcon open={r.rowOpen} />
                      </button>

                      {r.rowOpen && (
                        <div style={{ padding: "0 12px 12px" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 6 }}>
                              <button
                                type="button"
                                className="secondary"
                                disabled={i === 0}
                                onClick={() => moveRecipient(i, -1)}
                                style={{ width: 24, height: 20, padding: 0, fontSize: 11, lineHeight: 1 }}
                                aria-label="Move up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={i === recipients.length - 1}
                                onClick={() => moveRecipient(i, 1)}
                                style={{ width: 24, height: 20, padding: 0, fontSize: 11, lineHeight: 1 }}
                                aria-label="Move down"
                              >
                                ↓
                              </button>
                            </div>

                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", gap: 8 }}>
                                <input
                                  placeholder="Full name"
                                  value={r.name}
                                  onChange={(e) => updateRecipient(r.clientId, { name: e.target.value })}
                                  style={{ flex: 1 }}
                                  required
                                />
                                <input
                                  type="email"
                                  placeholder="email@company.com"
                                  value={r.email}
                                  onChange={(e) => updateRecipient(r.clientId, { email: e.target.value })}
                                  style={{ flex: 1 }}
                                  required
                                />
                                <select
                                  value={r.role}
                                  onChange={(e) => updateRecipient(r.clientId, { role: e.target.value as RecipientRole })}
                                  style={{ flex: "0 0 180px" }}
                                  title={ROLE_OPTIONS.find((o) => o.value === r.role)?.hint}
                                >
                                  {ROLE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <button
                                  type="button"
                                  onClick={() => updateRecipient(r.clientId, { customizeOpen: !r.customizeOpen })}
                                  style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--accent)", cursor: "pointer" }}
                                >
                                  {r.customizeOpen ? "Hide options" : "Customize"}
                                  {!r.customizeOpen && (r.message || r.accessCodeEnabled) ? " •" : ""}
                                </button>
                              </div>

                              {r.customizeOpen && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                                  <div>
                                    <label className="field-label">Message to this recipient (optional)</label>
                                    <textarea
                                      value={r.message}
                                      onChange={(e) => updateRecipient(r.clientId, { message: e.target.value })}
                                      rows={2}
                                      placeholder="Add a personal note — shown when they open the document"
                                      style={{ width: "100%", resize: "vertical" }}
                                    />
                                  </div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                    <input
                                      type="checkbox"
                                      style={{ width: "auto", height: "auto" }}
                                      checked={r.accessCodeEnabled}
                                      onChange={(e) => updateRecipient(r.clientId, { accessCodeEnabled: e.target.checked })}
                                    />
                                    Require an access code — only you and this recipient will know it
                                  </label>
                                  {r.accessCodeEnabled && (
                                    <input
                                      placeholder="Access code"
                                      value={r.accessCode}
                                      onChange={(e) => updateRecipient(r.clientId, { accessCode: e.target.value })}
                                      style={{ maxWidth: 220 }}
                                    />
                                  )}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              className="secondary"
                              disabled={recipients.length <= 1}
                              onClick={() => removeRecipient(r.clientId)}
                              style={{ flexShrink: 0, fontSize: 12, marginTop: 2 }}
                              aria-label="Remove recipient"
                              title="Remove recipient"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="secondary"
                onClick={addRecipient}
                style={{ marginTop: 12, fontSize: 13 }}
              >
                + Add recipient
              </button>
            </Card>

            {templateId && (
              <Card style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setOptionsOpen((o) => !o)}
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <h3 style={{ margin: 0 }}>Options</h3>
                  <ChevronIcon open={optionsOpen} />
                </button>

                {optionsOpen && (
                  <div style={{ marginTop: 16 }}>
                    <label className="field-label">External reference (optional)</label>
                    <input
                      placeholder="e.g. candidate ID, deal ID"
                      value={externalRef}
                      onChange={(e) => setExternalRef(e.target.value)}
                      style={{ marginBottom: 16 }}
                    />
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Expires after (days)</label>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={expiresDays}
                          onChange={(e) => setExpiresDays(Math.max(1, Number(e.target.value) || 1))}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Reminder after (days of inactivity)</label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={reminderDays}
                          onChange={(e) => setReminderDays(Math.max(1, Number(e.target.value) || 1))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button type="submit" variant="primary" disabled={submitting || !templateId}>
                {submitting ? "Sending…" : "Review and send"}
              </Button>
              <a href="/dashboard/envelopes/bulk" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Sending to a list of people? Use bulk send →
              </a>
            </div>
          </form>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
