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
  pdf_url?: string;
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

// Preset-dropdown-with-custom-fallback — matches DocuSign's own reminder/
// expiry pattern (a handful of common day counts, plus "Custom…" for
// anything else) instead of a bare free-text number input.
// Multi-document list — shown once a primary document is selected. Small
// preview per document (native browser PDF rendering, scaled down — no
// extra rendering library needed for a thumbnail this size), hover for a
// "View" overlay, "+ Add document" respects the tier's docsPerEnvelope cap
// server-side (the 402 error from the upload endpoint surfaces here rather
// than duplicating the limit-check client-side).
interface AdditionalDoc { id: string; name: string; pdf_url: string; page_count: number; field_count: number }
function AdditionalDocuments({ templateId }: { templateId: string }) {
  const [docs, setDocs] = useState<AdditionalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/templates/${templateId}/documents`)
      .then((res) => res.json())
      .then((json) => setDocs(json.documents ?? []))
      .finally(() => setLoading(false));
  }, [templateId]);

  async function handleAdd(file: File | null) {
    if (!file) return;
    setAdding(true);
    setAddError(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", file.name.replace(/\.(pdf|docx)$/i, ""));
    try {
      const res = await fetch(`/api/dashboard/templates/${templateId}/documents`, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) { setAddError(json.error ?? "Couldn't add that document."); return; }
      setDocs((prev) => [...prev, { id: json.document_id, name: file.name.replace(/\.(pdf|docx)$/i, ""), pdf_url: json.pdf_url, page_count: json.page_count, field_count: (json.field_map ?? []).length }]);
    } catch {
      setAddError("Network error — please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(docId: string) {
    const res = await fetch(`/api/dashboard/templates/${templateId}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId));
  }

  if (loading) return null;

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <label className="field-label">Additional documents</label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        {docs.map((d) => (
          <AdditionalDocThumb key={d.id} doc={d} templateId={templateId} onRemove={() => handleRemove(d.id)} />
        ))}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={adding}
          style={{ width: 96, height: 128, border: "1.5px dashed var(--border-strong)", borderRadius: 6, background: "var(--bg-subtle)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, cursor: "pointer", color: "var(--text-secondary)", fontSize: 11 }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
          {adding ? "Uploading…" : "Add document"}
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx" hidden onChange={(e) => handleAdd(e.target.files?.[0] ?? null)} />
      </div>
      {addError && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{addError}</p>}
    </div>
  );
}

function AdditionalDocThumb({ doc, templateId, onRemove }: { doc: AdditionalDoc; templateId: string; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ width: 96 }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: "relative", width: 96, height: 128, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--bg-subtle)" }}
      >
        <iframe src={`${doc.pdf_url}#toolbar=0`} title={doc.name} style={{ width: 320, height: 427, transform: "scale(0.3)", transformOrigin: "top left", border: "none", pointerEvents: "none" }} />
        <a
          href={doc.pdf_url}
          target="_blank"
          rel="noreferrer"
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,21,26,0.55)", color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none", opacity: hovered ? 1 : 0, transition: "opacity var(--transition-fast, 100ms) ease" }}
        >
          View
        </a>
      </div>
      <p style={{ fontSize: 11, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={doc.name}>{doc.name}</p>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <a href={`/dashboard/templates/${templateId}?doc=${doc.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent-dark)" }}>Edit fields</a>
        <button type="button" onClick={onRemove} style={{ fontSize: 11, color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Remove</button>
      </div>
    </div>
  );
}

function PresetDaysSelect({ value, onChange, presets, max }: { value: number; onChange: (n: number) => void; presets: number[]; max: number }) {
  const [customMode, setCustomMode] = useState(!presets.includes(value));

  if (customMode) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
          style={{ width: 80 }}
        />
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>days</span>
        {presets.length > 0 && (
          <button
            type="button"
            onClick={() => { setCustomMode(false); if (!presets.includes(value)) onChange(presets[0]); }}
            style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent-dark)", cursor: "pointer", padding: 0 }}
          >
            Use preset
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "custom") { setCustomMode(true); return; }
        onChange(Number(e.target.value));
      }}
    >
      {presets.map((p) => (
        <option key={p} value={p}>{p} day{p === 1 ? "" : "s"}</option>
      ))}
      <option value="custom">Custom…</option>
    </select>
  );
}

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
  const draftId = useSearchParams().get("draft");

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string; email: string }[]>([]);
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
  const [uploadedPdfUrl, setUploadedPdfUrl] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [otherDrafts, setOtherDrafts] = useState<{ envelope_id: string; template_name: string; recipient_count: number; updated_at: string }[]>([]);
  // Matches the accordion pattern from the DocuSign reference this flow
  // was built against (Add documents / Add recipients / Add message,
  // collapsed until you reach them) — Recipients starts collapsed and
  // opens once a document is actually selected, instead of always being
  // fully expanded regardless of how far along you are.
  const [recipientsOpen, setRecipientsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/templates");
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      setTemplates(json.templates ?? []);
      if ((json.templates ?? []).length === 0) setTemplateSource("upload");
      setLoadingTemplates(false);
    })();
    fetch("/api/dashboard/contacts")
      .then((res) => res.json())
      .then((json) => setContacts(json.contacts ?? []))
      .catch(() => {}); // contacts picker is a convenience — its own load failure shouldn't block the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resuming a draft (?draft=<id>) — pre-fill everything from what was
  // saved, using the same single-envelope GET the envelope detail page
  // already uses (drafts are real Envelope rows, just status="draft", so
  // this endpoint already returns everything needed).
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const res = await fetch(`/api/dashboard/envelopes/${draftId}`);
      if (res.status === 401) return router.push("/dashboard/login");
      if (!res.ok) { show({ message: "Couldn't load that draft.", type: "error" }); return; }
      const json = await res.json();
      setTemplateId(json.template_id ?? "");
      setExternalRef(json.external_ref ?? "");
      if (Array.isArray(json.recipients) && json.recipients.length > 0) {
        setRecipients(
          json.recipients.map((r: any) => ({
            clientId: newClientId(),
            name: r.name ?? "",
            email: r.email ?? "",
            role: (r.role as RecipientRole) ?? "signer",
            message: "",
            accessCodeEnabled: false,
            accessCode: "",
          }))
        );
      }
      setRecipientsOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Surfaces "continue where you left off" — every existing draft for this
  // tenant, regardless of whether one is currently being resumed. Landing
  // on /dashboard/envelopes/new (the natural place to end up after login,
  // or from "New envelope") is when this actually needs to be seen.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/envelopes/draft");
      if (!res.ok) return;
      const json = await res.json();
      setOtherDrafts((json.drafts ?? []).filter((d: { envelope_id: string }) => d.envelope_id !== draftId));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Recipients starts collapsed and stays that way until you open it
  // yourself — it does NOT auto-open just because a template got selected
  // (that auto-open was the bug: arriving via a "Use this template" link
  // pre-fills templateId before the first render, so it looked permanently
  // expanded no matter what).
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
      setUploadedPdfUrl(json.pdf_url ?? null);
      const fieldCount = (json.field_map ?? []).length;
      show({ message: fieldCount > 0 ? `Document uploaded — ${fieldCount} field${fieldCount === 1 ? "" : "s"} placed automatically.` : "Document uploaded — no fields were auto-placed, add them manually before sending.", type: fieldCount > 0 ? "success" : "info" });
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

  async function handleSaveDraft() {
    if (!templateId) {
      setError("Choose or upload a document before saving a draft.");
      return;
    }
    setSavingDraft(true);
    setError(null);
    const payload = {
      template_id: templateId,
      external_ref: externalRef.trim() || undefined,
      expires_in_hours: expiresDays * 24,
      reminder_after_hours: reminderDays * 24,
      recipients: recipients
        .filter((r) => r.name.trim() || r.email.trim())
        .map((r, i) => ({
          name: r.name.trim(),
          email: r.email.trim(),
          role: r.role,
          signing_order: i + 1,
          message: r.message.trim() || undefined,
          access_code: r.accessCodeEnabled && r.accessCode.trim() ? r.accessCode.trim() : undefined,
        })),
    };
    try {
      const res = draftId
        ? await fetch(`/api/dashboard/envelopes/${draftId}/draft`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/dashboard/envelopes/draft", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't save this draft.");
        return;
      }
      show({ message: "Draft saved.", type: "success" });
      if (!draftId) router.push(`/dashboard/envelopes/new?draft=${json.envelope_id}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSavingDraft(false);
    }
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

    // Resuming a draft — save whatever's currently in the form back to the
    // draft first (PATCH), then publish that same row. This is what makes
    // editing a resumed draft before sending actually take effect, instead
    // of publishing whatever was on the draft when it was first created.
    if (draftId) {
      try {
        const patchRes = await fetch(`/api/dashboard/envelopes/${draftId}/draft`, {
          method: "PATCH",
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
        const patchJson = await patchRes.json();
        if (!patchRes.ok) {
          setError(patchJson.error ?? "Couldn't save your changes to this draft.");
          setSubmitting(false);
          return;
        }

        const res = await fetch(`/api/dashboard/envelopes/${draftId}/publish`, { method: "POST" });
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
      return;
    }

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

        {otherDrafts.length > 0 && (
          <div className="card" style={{ marginBottom: 16, background: "var(--bg-subtle)" }}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Continue a draft</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {otherDrafts.map((d) => (
                <a key={d.envelope_id} href={`/dashboard/envelopes/new?draft=${d.envelope_id}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, textDecoration: "none", color: "var(--text-primary)", padding: "4px 0" }}>
                  <span>{d.template_name} — {d.recipient_count} recipient{d.recipient_count === 1 ? "" : "s"}</span>
                  <span style={{ color: "var(--accent-dark)" }}>Continue →</span>
                </a>
              ))}
            </div>
          </div>
        )}

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
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 12.5, color: "var(--success)", marginBottom: 8 }}>
                        ✓ Using "{templates.find((t) => t.id === templateId)?.name}"
                      </p>
                      {uploadedPdfUrl && (
                        <iframe
                          src={uploadedPdfUrl}
                          title="Document preview"
                          style={{ width: "100%", height: 320, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 8 }}
                        />
                      )}
                      <a href={`/dashboard/templates/${templateId}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        <Button type="button" variant="secondary" style={{ width: "100%" }}>
                          Review & place fields →
                        </Button>
                      </a>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                        Opens in a new tab — your recipients below stay filled in.
                      </p>
                    </div>
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
                  {templateId && (() => {
                    const selected = templates.find((t) => t.id === templateId);
                    if (!selected) return null;
                    return (
                      <div style={{ marginTop: 12 }}>
                        {selected.pdf_url && (
                          <iframe
                            src={selected.pdf_url}
                            title="Document preview"
                            style={{ width: "100%", height: 320, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 8 }}
                          />
                        )}
                        <a href={`/dashboard/templates/${templateId}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          <Button type="button" variant="secondary" style={{ width: "100%" }}>
                            Review & edit fields →
                          </Button>
                        </a>
                      </div>
                    );
                  })()}
                </div>
              )}

              {templateId && <AdditionalDocuments templateId={templateId} />}
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => setRecipientsOpen((o) => !o)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0 }}>Recipients</h3>
                  {!recipientsOpen && recipients.some((r) => r.name.trim() || r.email.trim()) && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      ({recipients.filter((r) => r.name.trim() || r.email.trim()).length} added)
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Signs in the order listed, top to bottom</span>
                  <span style={{ display: "inline-block", transition: "transform var(--transition-fast) ease", transform: recipientsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                </span>
              </button>

              {recipientsOpen && (
                <>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16, marginTop: 12 }}>
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
                              {contacts.length > 0 && (
                                <select
                                  value=""
                                  onChange={(e) => {
                                    const contact = contacts.find((c) => c.id === e.target.value);
                                    if (contact) updateRecipient(r.clientId, { name: contact.name, email: contact.email });
                                  }}
                                  style={{ fontSize: 12.5 }}
                                >
                                  <option value="">Choose from contacts…</option>
                                  {contacts.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name} · {c.email}</option>
                                  ))}
                                </select>
                              )}
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
                              onClick={() => {
                                if (recipients.length <= 1) {
                                  show({ message: "At least 1 recipient is required.", type: "error" });
                                  return;
                                }
                                removeRecipient(r.clientId);
                              }}
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
                </>
              )}
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
                        <label className="field-label">Expires after</label>
                        <PresetDaysSelect value={expiresDays} onChange={setExpiresDays} presets={[7, 14, 30, 90]} max={365} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Reminder after (days of inactivity)</label>
                        <PresetDaysSelect value={reminderDays} onChange={setReminderDays} presets={[1, 2, 3, 7]} max={30} />
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button type="submit" variant="primary" disabled={submitting || !templateId}>
                {submitting ? "Sending…" : draftId ? "Send draft" : "Review and send"}
              </Button>
              {!draftId && (
                <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={savingDraft || !templateId}>
                  {savingDraft ? "Saving…" : "Save as draft"}
                </Button>
              )}
              {draftId && (
                <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={savingDraft || !templateId}>
                  {savingDraft ? "Saving…" : "Save changes"}
                </Button>
              )}
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
