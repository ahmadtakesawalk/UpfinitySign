// DEPLOY TO: components/RequestRefundButton.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/motion/Button";

export function RequestRefundButton({ invoiceId, description, amountLabel }: { invoiceId: string; description: string; amountLabel: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("category", "refund");
      formData.set("invoiceId", invoiceId);
      formData.set("subject", `Refund request — ${description} (${amountLabel})`);
      formData.set("body", reason.trim() || "No additional details provided.");
      const res = await fetch("/api/dashboard/support", { method: "POST", body: formData });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Something went wrong.");
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  if (sent) return <span style={{ fontSize: 11, color: "var(--success)" }}>Refund requested</span>;

  if (!open) {
    // Deliberately a plain text link here, not the motion Button component
    // — this needs to read as an inline link inside a table cell (like
    // "Download PDF" and "Email me a copy" next to it), not a full chunky
    // button. The two real actions below (Cancel/Submit) do use Button.
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 0 }}>
        Request refund
      </button>
    );
  }

  return (
    <div style={{ marginTop: 6, padding: 10, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--bg-subtle)", minWidth: 220 }}>
      <textarea
        rows={2}
        placeholder="Why are you requesting a refund? (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: 12, width: "100%", marginBottom: 8 }}
      />
      {error && <p style={{ fontSize: 11.5, color: "var(--danger)", marginBottom: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={sending} style={{ fontSize: 12 }}>Cancel</Button>
        <Button variant="danger" onClick={submit} disabled={sending} style={{ fontSize: 12 }}>
          {sending ? "Sending…" : "Submit request"}
        </Button>
      </div>
    </div>
  );
}
