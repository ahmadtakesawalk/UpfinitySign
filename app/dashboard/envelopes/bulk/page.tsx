// DEPLOY TO: app/dashboard/envelopes/bulk/page.tsx
"use client";

// CSV columns are derived from the template's role slots, same convention
// as the single-send recipient form (see envelopes/new/page.tsx's
// parseSlots — duplicated here rather than shared, since bulk send's CSV
// header format and single-send's form fields are different enough
// consumers of the same underlying role data that forcing a shared
// abstraction would cost more than the ~15 duplicated lines).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { useToast } from "@/components/motion/Toast";
import { SiteFooter } from "@/components/SiteFooter";

interface TemplateSummary {
  id: string;
  name: string;
  fieldMap: unknown;
}

interface RoleSlot {
  role: "signer" | "approver" | "cc";
  order: number;
  columnPrefix: string; // e.g. "signer_1"
}

interface ParsedRow {
  external_ref?: string;
  recipients: { name: string; email: string; role: RoleSlot["role"]; signing_order: number }[];
}

interface BulkResult {
  succeeded: number;
  failed: number;
  results: { external_ref?: string; envelope_id?: string; error?: string }[];
}

function parseSlots(fieldMap: unknown): RoleSlot[] {
  if (!Array.isArray(fieldMap)) return [{ role: "signer", order: 1, columnPrefix: "signer_1" }];
  const roles = Array.from(new Set(fieldMap.map((f: any) => String(f.role ?? "signer_1"))));
  const slots: RoleSlot[] = roles.map((r) => {
    const match = r.match(/^(signer|approver|cc)_?(\d+)?$/i);
    const role = (match?.[1]?.toLowerCase() as RoleSlot["role"]) ?? "signer";
    const order = match?.[2] ? Number(match[2]) : 1;
    return { role, order, columnPrefix: `${role}_${order}` };
  });
  slots.sort((a, b) => (a.role === b.role ? a.order - b.order : a.role.localeCompare(b.role)));
  return slots.length ? slots : [{ role: "signer", order: 1, columnPrefix: "signer_1" }];
}

// Minimal CSV parser — handles quoted fields with embedded commas, which
// covers real-world exported CSVs (Excel/Sheets quote any field containing
// a comma) without pulling in a dependency for what's fundamentally a
// small, well-understood format here.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export default function BulkSendPage() {
  const router = useRouter();
  const { show } = useToast();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [slots, setSlots] = useState<RoleSlot[]>([]);
  const [csvText, setCsvText] = useState("");
  const [expiresHours, setExpiresHours] = useState(72);
  const [reminderHours, setReminderHours] = useState(48);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/templates")
      .then((res) => { if (res.status === 401) { router.push("/dashboard/login"); return null; } return res.json(); })
      .then((json) => { if (json) setTemplates(json.templates ?? []); })
      .finally(() => setLoadingTemplates(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!templateId) { setSlots([]); return; }
    fetch(`/api/dashboard/templates/${templateId}`)
      .then((res) => res.json())
      .then((json) => setSlots(parseSlots(json.field_map)));
  }, [templateId]);

  const expectedColumns = [...slots.flatMap((s) => [`${s.columnPrefix}_name`, `${s.columnPrefix}_email`]), "external_ref"];

  function parseRows(): { rows: ParsedRow[]; parseError: string | null } {
    const table = parseCsv(csvText.trim());
    if (table.length < 2) return { rows: [], parseError: "Paste at least a header row and one data row." };

    const header = table[0].map((h) => h.trim().toLowerCase());
    const rows: ParsedRow[] = [];

    for (const rawRow of table.slice(1)) {
      const get = (col: string) => {
        const idx = header.indexOf(col.toLowerCase());
        return idx >= 0 ? (rawRow[idx] ?? "").trim() : "";
      };

      const recipients = slots.map((s) => ({
        name: get(`${s.columnPrefix}_name`),
        email: get(`${s.columnPrefix}_email`),
        role: s.role,
        signing_order: s.order,
      }));

      if (recipients.some((r) => !r.name || !r.email)) {
        return { rows: [], parseError: `Missing name/email in a row — every column in ${expectedColumns.filter((c) => c !== "external_ref").join(", ")} is required for every row.` };
      }

      rows.push({ external_ref: get("external_ref") || undefined, recipients });
    }

    return { rows, parseError: null };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) { setError("Choose a template."); return; }
    const { rows, parseError } = parseRows();
    if (parseError) { setError(parseError); return; }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/dashboard/envelopes/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          expires_in_hours: expiresHours,
          reminder_after_hours: reminderHours,
          recipients_batches: rows,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      setResult(json);
      show({ message: `Sent ${json.succeeded} envelope${json.succeeded === 1 ? "" : "s"}.`, type: json.failed ? "info" : "success" });
    } catch {
      setError("Network error — please try again.");
    } finally {
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
        <h1>Bulk send</h1>
        <div className="signature-rule" />
        <p style={{ marginBottom: 20 }}>Send the same template to many recipients at once — each row becomes its own envelope.</p>

        {loadingTemplates ? (
          <Card><p style={{ fontSize: 14, color: "var(--text-muted)" }}>Loading templates…</p></Card>
        ) : templates.length === 0 ? (
          <Card>
            <div className="empty-state">
              <p style={{ marginBottom: 16, color: "var(--text-primary)", fontWeight: 500 }}>No templates yet</p>
              <p style={{ marginBottom: 20 }}>You need a template with fields placed before you can bulk send.</p>
              <a href="/dashboard/templates/new" style={{ textDecoration: "none" }}>
                <Button variant="primary">Create a template</Button>
              </a>
            </div>
          </Card>
        ) : (
        <form onSubmit={handleSubmit}>
          <Card style={{ marginBottom: 16 }}>
            <label className="field-label">Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Card>

          {templateId && slots.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8 }}>CSV format</h3>
              <p style={{ fontSize: 13, marginBottom: 8 }}>Header row must include these columns:</p>
              <code style={{ display: "block", background: "var(--bg-subtle)", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
                {expectedColumns.join(",")}
              </code>
              <label className="field-label">Paste CSV data</label>
              <textarea
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`${expectedColumns.join(",")}\nJane Doe,jane@company.com,REF-001`}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Card>
          )}

          {templateId && (
            <Card style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Options</h3>
              <label className="field-label">Each envelope expires after</label>
              <select value={expiresHours} onChange={(e) => setExpiresHours(Number(e.target.value))} style={{ marginBottom: 16 }}>
                <option value={24}>1 day</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
                <option value={720}>30 days</option>
              </select>
              <label className="field-label">Send reminder after</label>
              <select value={reminderHours} onChange={(e) => setReminderHours(Number(e.target.value))}>
                <option value={24}>1 day of inactivity</option>
                <option value={48}>2 days of inactivity (default)</option>
                <option value={72}>3 days of inactivity</option>
                <option value={168}>7 days of inactivity</option>
              </select>
            </Card>
          )}

          {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>{error}</p>}

          {result && (
            <Card style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Results</h3>
              <p style={{ fontSize: 14, marginBottom: 8 }}>
                {result.succeeded} sent, {result.failed} failed.
              </p>
              {result.failed > 0 && (
                <ul style={{ fontSize: 13, color: "var(--text-secondary)", paddingLeft: 18 }}>
                  {result.results.filter((r) => r.error).map((r, i) => (
                    <li key={i}>{r.external_ref ?? `Row ${i + 1}`}: {r.error}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Button type="submit" variant="primary" disabled={submitting || !templateId || !csvText.trim()}>
            {submitting ? "Sending…" : "Send bulk envelopes"}
          </Button>
        </form>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
