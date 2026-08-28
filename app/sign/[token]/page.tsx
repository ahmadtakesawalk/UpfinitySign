"use client";

import { useEffect, useState, use, useMemo, useRef } from "react";
import { evaluateFormula, FormulaError } from "@/lib/signing/formula";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { buildNumericInputs } from "@/lib/signing/formula-inputs";
import { FieldOverlay, SignatureModal, AUTO_FILLED, type Field } from "@/components/signing/FieldRenderer";

// Mirrors lib/signing/field-types.ts's isFieldVisible — reimplemented
// locally rather than imported to avoid coupling this client component's
// looser local Field shape (several optional props that are required in
// the server-side FieldDefinition type) to that module's stricter type.
function isFieldVisible(field: Field, values: Record<string, string>): boolean {
  if (!field.visibleIf) return true;
  return values[field.visibleIf.fieldId] === field.visibleIf.equals;
}

interface EnvelopeData {
  locked?: boolean;
  reason?: string;
  already_acted?: boolean;
  status?: "signed" | "approved" | "declined";
  requires_otp?: boolean;
  otp_sent?: boolean;
  envelope_status: string;
  template_name: string;
  pdf_url?: string;
  field_map?: Field[];
  recipient: { name: string; email?: string; role: "signer" | "approver" | "cc" };
}

const RENDER_WIDTH = 700; // css px — every page scales to this width

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [data, setData] = useState<EnvelopeData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<"signed" | "approved" | "declined" | null>(null);
  const [certificateUrl, setCertificateUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signatureModalFieldId, setSignatureModalFieldId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const otpAutoSent = useRef(false);

  function loadEnvelope() {
    fetch(`/api/sign/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("This link is invalid or has expired.");
        return res.json();
      })
      .then((json) => {
        setData(json);
        if (json.field_map) {
          const initial: Record<string, string> = {};
          json.field_map.forEach((f: Field) => {
            if (f.type === "full_name") initial[f.id] = json.recipient.name;
            if (f.type === "email") initial[f.id] = json.recipient.email ?? "";
            if (f.type === "date") initial[f.id] = new Date().toLocaleDateString();
          });
          setValues(initial);
        }
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadEnvelope();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // First time we learn a code is required and none has gone out yet, send
  // one automatically — the recipient shouldn't have to find a "send code"
  // button just to get started. otpAutoSent guards against re-sending on
  // every re-render once data.otp_sent flips (which itself only updates on
  // the next loadEnvelope() call, not instantly).
  useEffect(() => {
    if (data?.requires_otp && !data.otp_sent && !otpAutoSent.current) {
      otpAutoSent.current = true;
      requestOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.requires_otp, data?.otp_sent]);

  async function requestOtp() {
    setOtpSending(true);
    setOtpError(null);
    try {
      const res = await fetch(`/api/sign/${token}/request-otp`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't send the code.");
    } catch (e: any) {
      setOtpError(e.message ?? "Couldn't send the code.");
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpSubmitting(true);
    setOtpError(null);
    try {
      const res = await fetch(`/api/sign/${token}/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: otpCode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Incorrect code.");
      setOtpCode("");
      loadEnvelope(); // re-fetch now that otpVerifiedAt is set — returns the real document this time
    } catch (e: any) {
      setOtpError(e.message ?? "Incorrect code.");
    } finally {
      setOtpSubmitting(false);
    }
  }

 const computedFormulas = useMemo(() => {
    if (!data?.field_map) return {};
    const numericInputs = buildNumericInputs(
      data.field_map.map(f => ({ ...f, required: f.required ?? false })),
      values
      );

    const results: Record<string, string> = {};
    for (const f of data.field_map) {
      if (f.type !== "formula" || !f.formulaConfig) continue;
      try {
        const resultsAsNumbers = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Number(v)]));
        const result = evaluateFormula(f.formulaConfig.expression, { ...numericInputs, ...resultsAsNumbers });
        results[f.id] = result.toFixed(f.formulaConfig.decimalPlaces ?? 2);
      } catch {
        results[f.id] = "—";
      }
    }
    return results;
  }, [data?.field_map, values]);

  function fieldValue(f: Field): string {
    if (f.type === "formula") return computedFormulas[f.id] ?? "—";
    if (f.type === "signature" || f.type === "initial") return values[f.id] ?? data?.recipient.name ?? "";
    return values[f.id] ?? "";
  }

  function validateFields(): boolean {
    if (!data?.field_map) return true;
    const errors: Record<string, string> = {};
    data.field_map.forEach((f) => {
      if (f.type === "note" || f.type === "formula") return;
      if (!isFieldVisible(f, values)) return; // hidden fields are never required — nothing to validate
      const val = fieldValue(f);
      if (f.required && !val) {
        errors[f.id] = "This field is required.";
        return;
      }
      if (f.type === "custom" && f.customConfig?.pattern && val) {
        const re = new RegExp(f.customConfig.pattern);
        if (!re.test(val)) errors[f.id] = f.customConfig.patternErrorMessage ?? "This doesn't match the expected format.";
      }
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submitAction(action: "sign" | "approve" | "decline") {
    if (!data) return;
    if (action === "sign" && !validateFields()) {
      // Jump straight to the first problem instead of leaving the person
      // to hunt for it — same navigation the floating "Next" button uses.
      const firstErrorId = data.field_map?.find((f) => fieldErrors[f.id])?.id;
      if (firstErrorId) jumpToField(firstErrorId);
      return;
    }

    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = { action };
    if (action === "sign" && data.field_map) {
      body.fields = data.field_map
        .filter((f) => f.type !== "note" && isFieldVisible(f, values))
        .map((f) => ({ id: f.id, page: f.page, type: f.type, x: f.x, y: f.y, width: f.width, height: f.height, value: fieldValue(f) }));
    }
    if (action === "decline") body.decline_reason = declineReason || "No reason provided";

    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      if (json.certificate_ready && json.envelope_id) setCertificateUrl(`/certificates/${json.envelope_id}`);
      setSubmitted(action === "sign" ? "signed" : action === "approve" ? "approved" : "declined");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function jumpToField(fieldId: string) {
    const field = data?.field_map?.find((f) => f.id === fieldId);
    const el = document.getElementById(`field-${fieldId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("field-pulse");
      window.setTimeout(() => el.classList.remove("field-pulse"), 1200);
    }
    if (field && (field.type === "signature" || field.type === "initial")) {
      setSignatureModalFieldId(fieldId);
    } else {
      window.setTimeout(() => {
        const input = el?.querySelector("input, select, textarea") as HTMLElement | null;
        input?.focus();
      }, 350);
    }
  }

  // Next unfilled required field, in reading order (top of doc to bottom,
  // across pages) — this single control is most of what makes a signing
  // flow feel fast instead of like a scavenger hunt.
  const nextRequiredField = useMemo(() => {
    if (!data?.field_map) return null;
    const candidates = data.field_map
      .filter((f) => f.required && f.type !== "note" && f.type !== "formula" && isFieldVisible(f, values))
      .filter((f) => !AUTO_FILLED.includes(f.type))
      .filter((f) => !fieldValue(f));
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y))[0];
  }, [data?.field_map, values]);

  if (error) {
    return <Shell><div className="card"><h2>Something's not right</h2><p>{error}</p></div></Shell>;
  }
  if (!data) {
    return <Shell><div className="card" style={{ textAlign: "center", color: "var(--text-muted)" }}>Loading document…</div></Shell>;
  }
  if (data.locked) {
    return (
      <Shell recipientName={data.recipient.name}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
          <h2>Not your turn yet</h2>
          <p>{data.reason ?? "This document is waiting on an earlier step to complete first."}</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>We'll email you the moment it's ready for you.</p>
        </div>
      </Shell>
    );
  }
  if (data.requires_otp) {
    return (
      <Shell recipientName={data.recipient.name}>
        <div className="card" style={{ maxWidth: 380, margin: "0 auto" }}>
          <div style={{ fontSize: 28, marginBottom: 8, textAlign: "center" }}>🔒</div>
          <h2 style={{ textAlign: "center" }}>Verify it's you</h2>
          <p style={{ textAlign: "center", marginBottom: 20 }}>
            We sent a 6-digit code to <strong>{data.recipient.email}</strong> — enter it below to open <strong>{data.template_name}</strong>.
          </p>
          <form onSubmit={verifyOtp}>
            <input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
              style={{ fontSize: 24, letterSpacing: 6, textAlign: "center", marginBottom: 12 }}
            />
            {otpError && <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 12 }}>{otpError}</p>}
            <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={otpSubmitting || otpCode.length !== 6}>
              {otpSubmitting ? "Verifying…" : "Verify & continue"}
            </Button>
          </form>
          <p style={{ textAlign: "center", marginTop: 14, fontSize: 12.5 }}>
            Didn't get it?{" "}
            <button type="button" onClick={requestOtp} disabled={otpSending} style={{ background: "none", border: "none", color: "var(--accent-dark)", cursor: "pointer", padding: 0, fontSize: 12.5 }}>
              {otpSending ? "Sending…" : "Resend code"}
            </button>
          </p>
          <p style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>Code expires in 10 minutes.</p>
        </div>
      </Shell>
    );
  }
  if (data.already_acted) {
    const copy =
      data.status === "declined"
        ? { emoji: "✕", title: "You already declined this document", body: "No further action is needed from you." }
        : data.status === "approved"
        ? { emoji: "✓", title: `You already approved this, ${data.recipient.name}.`, body: "No further action is needed from you." }
        : { emoji: "✓", title: `You already signed this, ${data.recipient.name}.`, body: "A confirmation was emailed to you when you completed it." };
    return (
      <Shell recipientName={data.recipient.name}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: data.status === "declined" ? "var(--danger-bg)" : "var(--success-bg)", color: data.status === "declined" ? "var(--danger)" : "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 16px" }}>
            {copy.emoji}
          </div>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      </Shell>
    );
  }
  if (submitted) {
    const copy =
      submitted === "declined"
        ? { emoji: "✕", title: "You declined this document", body: "No further action is needed from you." }
        : submitted === "approved"
        ? { emoji: "✓", title: `Thanks, ${data.recipient.name} — approved.`, body: "The document will move on to the next step." }
        : { emoji: "✓", title: `Thanks, ${data.recipient.name} — you're all set.`, body: `A confirmation and the signed document will be emailed to ${data.recipient.email}.` };
    return (
      <Shell recipientName={data.recipient.name}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: submitted === "declined" ? "var(--danger-bg)" : "var(--success-bg)", color: submitted === "declined" ? "var(--danger)" : "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 16px" }}>
            {copy.emoji}
          </div>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
          {certificateUrl && (
            <a href={certificateUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <button type="button" className="secondary" style={{ marginTop: 16 }}>View certificate of completion</button>
            </a>
          )}
        </div>
      </Shell>
    );
  }

  const isApprover = data.recipient.role === "approver";
  const activeSignatureField = data.field_map?.find((f) => f.id === signatureModalFieldId) ?? null;

  return (
    <Shell recipientName={data.recipient.name} wide>
      <Card style={{ marginBottom: 16 }}>
        <span className="badge badge-pending" style={{ marginBottom: 8 }}>{isApprover ? "Approval requested" : "Signature requested"}</span>
        <h2>{data.template_name}</h2>
        <p>Hi {data.recipient.name} — {isApprover ? "review the document below and approve it to move it forward." : "click each highlighted spot on the document below to fill it in."}</p>
      </Card>

      {data.pdf_url && (
        <DocumentCanvas
          pdfUrl={data.pdf_url}
          fields={(data.field_map ?? []).filter((f) => isFieldVisible(f, values))}
          interactive={!isApprover}
          values={values}
          fieldErrors={fieldErrors}
          fieldValue={fieldValue}
          onChange={(id, v) => setValues((prev) => ({ ...prev, [id]: v }))}
          onOpenSignature={(id) => setSignatureModalFieldId(id)}
          token={token}
          onApprove={() => submitAction("approve")}
          onDecline={() => setDeclining(true)}
        />
      )}

      {declining ? (
        <Card style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
            Not sure this is legitimate? You can say so directly instead of guessing what to write.
          </p>
          <button
            type="button"
            onClick={() => setDeclineReason("I don't recognize this request and wasn't expecting it — this may be sent in error or fraudulent.")}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 12, border: "1px solid var(--danger)", borderRadius: "var(--radius-sm)", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >
            🚩 I don't recognize this — flag as suspicious
          </button>
          <label className="field-label">Reason for declining (optional)</label>
          <textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} style={{ marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={() => setDeclining(false)} disabled={submitting}>Back</Button>
            <Button variant="danger" onClick={() => submitAction("decline")} disabled={submitting}>{submitting ? "Submitting…" : "Confirm decline"}</Button>
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <Button variant="secondary" onClick={() => setDeclining(true)} disabled={submitting}>Decline</Button>
          <Button variant="primary" onClick={() => submitAction(isApprover ? "approve" : "sign")} disabled={submitting}>
            {submitting ? "Submitting…" : isApprover ? "Approve" : "Sign & Complete"}
          </Button>
        </div>
      )}

      {!isApprover && !declining && nextRequiredField && (
        <button
          type="button"
          onClick={() => jumpToField(nextRequiredField.id)}
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            padding: "12px 20px",
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "var(--shadow-lg)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 100,
          }}
        >
          Next field ↓
        </button>
      )}

      {activeSignatureField && (
        <SignatureModal
          field={activeSignatureField}
          value={fieldValue(activeSignatureField)}
          error={fieldErrors[activeSignatureField.id]}
          onChange={(v) => setValues((prev) => ({ ...prev, [activeSignatureField.id]: v }))}
          onClose={() => setSignatureModalFieldId(null)}
        />
      )}
    </Shell>
  );
}

/**
 * Renders the actual document — every page, at real size — with each
 * field shown as an interactive control positioned exactly where it sits
 * on the page. This replaced an earlier version that put the PDF in a
 * plain read-only iframe with a separate flat list of form fields below
 * it: functional, but it broke the one thing that makes e-signature UX
 * intuitive — seeing exactly where on the document you're about to sign.
 * This is the same interaction model DocuSign/HelloSign use, not a novel
 * one — "simpler than DocuSign" means fewer steps and less clutter
 * *within* that same familiar pattern, not abandoning the pattern itself.
 */
function DocumentCanvas({
  pdfUrl,
  fields,
  interactive,
  values,
  fieldErrors,
  fieldValue,
  onChange,
  onOpenSignature,
  token,
  onApprove,
  onDecline,
}: {
  pdfUrl: string;
  fields: Field[];
  interactive: boolean;
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  fieldValue: (f: Field) => string;
  onChange: (fieldId: string, value: string) => void;
  onOpenSignature: (fieldId: string) => void;
  token: string;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ canvas: HTMLCanvasElement; widthPts: number; heightPts: number; scale: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
      const doc = await pdfjsLib.getDocument(pdfUrl).promise;
      if (cancelled) return;

      const rendered: { canvas: HTMLCanvasElement; widthPts: number; heightPts: number; scale: number }[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = RENDER_WIDTH / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        rendered.push({ canvas, widthPts: baseViewport.width, heightPts: baseViewport.height, scale });
      }
      if (!cancelled) {
        setPages(rendered);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Mount each pre-rendered canvas into its page container once pages are ready.
  const canvasHostRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    pages.forEach((p, i) => {
      const host = canvasHostRefs.current[i];
      if (host && !host.contains(p.canvas)) {
        host.innerHTML = "";
        p.canvas.style.width = "100%";
        p.canvas.style.display = "block";
        host.appendChild(p.canvas);
      }
    });
  }, [pages]);

  function pdfToScreen(f: Field, scale: number, heightPts: number) {
    return {
      left: f.x * scale,
      top: (heightPts - f.y - f.height) * scale,
      width: Math.max(f.width * scale, f.type === "checkbox" ? 20 : 90),
      height: Math.max(f.height * scale, 26),
    };
  }

  if (loading) {
    return (
      <Card style={{ marginBottom: 0, textAlign: "center", padding: 48 }}>
        <p style={{ color: "var(--text-muted)" }}>Loading document…</p>
      </Card>
    );
  }

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      {pages.map((p, pageIndex) => (
        <div
          key={pageIndex}
          style={{ position: "relative", width: RENDER_WIDTH, maxWidth: "100%", boxShadow: "var(--shadow)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "#fff" }}
        >
          <div ref={(el) => { canvasHostRefs.current[pageIndex] = el; }} />
          <div style={{ position: "absolute", inset: 0 }}>
            {fields.filter((f) => f.page === pageIndex).map((f) => {
              const pos = pdfToScreen(f, p.scale, p.heightPts);
              return (
                <FieldOverlay
                  key={f.id}
                  field={f}
                  pos={pos}
                  interactive={interactive}
                  value={fieldValue(f)}
                  error={fieldErrors[f.id]}
                  onChange={(v) => onChange(f.id, v)}
                  onOpenSignature={() => onOpenSignature(f.id)}
                  token={token}
                  onApprove={onApprove}
                  onDecline={onDecline}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Shell({ children, recipientName, wide }: { children: React.ReactNode; recipientName?: string; wide?: boolean }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div className="topbar-brand">Upfinity Sign</div>
        {recipientName && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{recipientName}</span>}
      </div>
      <div className={`page-shell${wide ? " wide" : ""}`} style={{ flex: 1, maxWidth: wide ? 760 : undefined }}>{children}</div>
      <div className="footer-note">Powered by <a href="https://upfinity.ca">Upfinity Inc.</a> · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></div>
    </div>
  );
}
