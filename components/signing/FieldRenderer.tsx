// DEPLOY TO: components/signing/FieldRenderer.tsx
"use client";

// Extracted from app/sign/[token]/page.tsx (previously defined inline there)
// so the live signing page and the template/envelope editor's Preview modal
// render every field type identically — same signature pad, same checkbox,
// same dropdown, same payment button — instead of Preview drawing simplified
// lookalike boxes. Behavior on the live sign page is unchanged; this is a
// pure extraction, not a rewrite.
//
// Attachment/Payment are the two field types that talk to the network
// (upload endpoint, Stripe Checkout) keyed on a real recipient `token` —
// neither makes sense against a preview session, so both take a
// `previewMode` flag that swaps the real call for a local, no-network
// simulation instead. Every other field type was already pure local state
// and needed no change to be safely reusable in preview.

import { useState, useEffect } from "react";
import { Button } from "@/components/motion/Button";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { SIGNATURE_STYLES, DEFAULT_SIGNATURE_STYLE_ID } from "@/lib/signing/field-types";

export interface Field {
  id: string;
  page: number;
  type: "signature" | "initial" | "date" | "full_name" | "email" | "company" | "title" | "text" | "number" | "checkbox" | "radio_group" | "dropdown" | "attachment" | "note" | "custom" | "formula" | "payment" | "approve" | "decline" | "stamp";
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  options?: string[];
  customConfig?: { label: string; pattern?: string; patternErrorMessage?: string; maxLength?: number };
  formulaConfig?: { label: string; expression: string; decimalPlaces?: number };
  visibleIf?: { fieldId: string; equals: string };
  paymentConfig?: { label: string; amountCents: number; currency: string; description?: string };
}

export const AUTO_FILLED: Field["type"][] = ["full_name", "email"];

export function FieldOverlay({
  field,
  pos,
  interactive,
  value,
  fieldFont,
  error,
  onChange,
  onOpenSignature,
  token,
  previewMode = false,
  onApprove,
  onDecline,
}: {
  field: Field;
  pos: { left: number; top: number; width: number; height: number };
  interactive: boolean;
  value: string;
  // Which SIGNATURE_STYLES id was picked for a Type-mode signature/
  // initial/stamp — irrelevant for every other field type, and for a
  // Draw/Upload image value (isImage below), which has no font.
  fieldFont?: string;
  error?: string;
  onChange: (v: string, signatureFont?: string) => void;
  onOpenSignature: () => void;
  token: string;
  previewMode?: boolean;
  // Real completion actions — an approve/decline field triggers the SAME
  // whole-envelope action the bottom action bar already does, not a
  // separate per-field state. Omit both (as PreviewModal does) and the
  // field falls back to a local value-only toggle, since a preview has no
  // real envelope to act on.
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const isAutoFilled = AUTO_FILLED.includes(field.type);
  const isReadOnly = isAutoFilled || field.type === "formula" || !interactive;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: pos.left,
    top: pos.top,
    width: pos.width,
    height: pos.height,
  };

  if (field.type === "note") {
    return (
      <div
        id={`field-${field.id}`}
        style={{ ...baseStyle, height: "auto", minHeight: pos.height, background: "rgba(255, 240, 200, 0.9)", border: "1px solid #e0c568", borderRadius: 4, padding: "4px 6px", fontSize: 11, color: "#5c4a1a", overflow: "visible" }}
      >
        {value || "Note"}
      </div>
    );
  }

  if (field.type === "signature" || field.type === "initial" || field.type === "stamp") {
    const isImage = value.startsWith("data:image");
    const actionWord = field.type === "initial" ? "initial" : field.type === "stamp" ? "stamp" : "sign";
    const resolvedStyle = SIGNATURE_STYLES.find((s) => s.id === fieldFont) ?? SIGNATURE_STYLES.find((s) => s.id === DEFAULT_SIGNATURE_STYLE_ID)!;
    return (
      <button
        type="button"
        id={`field-${field.id}`}
        onClick={interactive ? onOpenSignature : undefined}
        style={{
          ...baseStyle,
          border: `2px ${error ? "solid var(--danger)" : "dashed var(--accent)"}`,
          borderRadius: 4,
          background: value ? "#fff" : "rgba(75, 43, 255, 0.06)",
          cursor: interactive ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
          overflow: "hidden",
        }}
        title={field.required ? "Required" : undefined}
      >
        {isImage ? (
          <img src={value} alt={field.type === "stamp" ? "Stamp" : "Signature"} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : value ? (
          <span style={{ fontFamily: resolvedStyle.cssFontFamily, fontSize: Math.min(pos.height * 0.6, 20) }}>{value}</span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--accent-dark)", fontWeight: 600 }}>
            ✎ Click to {actionWord}{field.required && " *"}
          </span>
        )}
      </button>
    );
  }

  if (field.type === "approve" || field.type === "decline") {
    const isApprove = field.type === "approve";
    const done = value === (isApprove ? "approved" : "declined");
    const color = isApprove ? "var(--success)" : "var(--danger)";
    const colorBg = isApprove ? "var(--success-bg)" : "var(--danger-bg)";
    const realHandler = isApprove ? onApprove : onDecline;
    // A real onApprove/onDecline handler means this is the live sign page,
    // not Preview — clickable regardless of the canvas's general
    // `interactive` flag (which is false for an approver on every OTHER
    // field type, since approvers were never meant to edit field values).
    // The action itself is still validated server-side against the
    // recipient's actual role when submitAction posts it — this is only
    // about the button being pressable, not a security boundary.
    const clickable = realHandler ? true : interactive;
    const handleClick = () => {
      if (!clickable) return;
      if (realHandler) {
        realHandler(); // real envelope action — sign page wires this to the same submitAction the bottom bar uses
      } else {
        onChange(isApprove ? "approved" : "declined"); // preview mode — local visual toggle only, nothing is actually submitted
      }
    };
    return (
      <button
        type="button"
        id={`field-${field.id}`}
        onClick={handleClick}
        disabled={!clickable}
        style={{
          ...baseStyle,
          border: "none",
          borderRadius: 4,
          background: done ? color : colorBg,
          color: done ? "#fff" : color,
          fontWeight: 600,
          fontSize: 12,
          cursor: clickable ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        {done ? (isApprove ? "✓ Approved" : "✕ Declined") : (isApprove ? "Approve" : "Decline")}
      </button>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label id={`field-${field.id}`} style={{ ...baseStyle, display: "flex", alignItems: "center", cursor: interactive ? "pointer" : "default" }}>
        <input
          type="checkbox"
          checked={value === "true"}
          disabled={!interactive}
          onChange={(e) => onChange(String(e.target.checked))}
          style={{ width: pos.height, height: pos.height, margin: 0, accentColor: "var(--accent)" }}
        />
      </label>
    );
  }

  if (field.type === "dropdown" || field.type === "radio_group") {
    return (
      <div id={`field-${field.id}`} style={baseStyle}>
        <select
          value={value}
          disabled={!interactive}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", height: "100%", fontSize: 12, borderColor: error ? "var(--danger)" : undefined }}
        >
          <option value="">Select…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === "attachment") {
    return (
      <AttachmentOverlay field={field} pos={pos} value={value} error={error} onChange={onChange} token={token} interactive={interactive} previewMode={previewMode} />
    );
  }

  if (field.type === "payment") {
    return (
      <PaymentOverlay field={field} pos={pos} value={value} onChange={onChange} token={token} interactive={interactive} previewMode={previewMode} />
    );
  }

  // text / number / date / company / title / custom / formula / full_name / email
  return (
    <div id={`field-${field.id}`} style={baseStyle}>
      <input
        type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
        value={value}
        readOnly={isReadOnly}
        disabled={!interactive && !isAutoFilled}
        maxLength={field.customConfig?.maxLength}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: "100%",
          fontSize: 12,
          padding: "0 6px",
          background: isReadOnly ? "var(--bg-subtle)" : "#fff",
          borderColor: error ? "var(--danger)" : undefined,
        }}
        title={isAutoFilled ? "Filled from your recipient details" : field.type === "formula" ? "Calculated automatically" : undefined}
      />
    </div>
  );
}

function AttachmentOverlay({
  field, pos, value, error, onChange, token, interactive, previewMode = false,
}: { field: Field; pos: { left: number; top: number; width: number; height: number }; value: string; error?: string; onChange: (v: string) => void; token: string; interactive: boolean; previewMode?: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (previewMode) {
      // No real recipient token to upload against — just reflect the
      // chosen filename locally so the preview looks/feels right.
      setFilename(file.name);
      onChange(`preview:${file.name}`);
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("field_id", field.id);
    try {
      const res = await fetch(`/api/sign/${token}/attachment`, { method: "POST", body: formData });
      const json = await res.json();
      if (res.ok) {
        setFilename(json.filename);
        onChange(json.key);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <label
      id={`field-${field.id}`}
      style={{
        position: "absolute", left: pos.left, top: pos.top, width: Math.max(pos.width, 120), height: pos.height,
        border: `1px dashed ${error ? "var(--danger)" : "var(--border-strong)"}`,
        borderRadius: 4, background: "var(--bg-subtle)", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, cursor: interactive ? "pointer" : "default", padding: "0 6px", textAlign: "center",
      }}
    >
      <input type="file" style={{ display: "none" }} disabled={!interactive} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      {uploading ? "Uploading…" : value && filename ? filename : value ? "Attached" : "📎 Attach file"}
    </label>
  );
}

function PaymentOverlay({
  field, pos, value, onChange, token, interactive, previewMode = false,
}: { field: Field; pos: { left: number; top: number; width: number; height: number }; value: string; onChange: (v: string) => void; token: string; interactive: boolean; previewMode?: boolean }) {
  const [paid, setPaid] = useState(value === "paid");
  const [starting, setStarting] = useState(false);
  const [checkedInitial, setCheckedInitial] = useState(previewMode); // preview has nothing to check — skip straight to "ready"

  // Check paid status on mount (covers reload after returning from Stripe
  // Checkout) — this is a convenience read; the server independently
  // re-verifies at submit time regardless of what this shows. Skipped in
  // preview: there's no real payment record to check against.
  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/sign/${token}/payment/status?field_id=${field.id}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.paid) {
          setPaid(true);
          onChange("paid");
        }
      })
      .finally(() => setCheckedInitial(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id, previewMode]);

  async function startPayment() {
    if (previewMode) {
      // No real Stripe Checkout in a preview — flip to "paid" locally so
      // the sender can see what a completed payment field looks like.
      setPaid(true);
      onChange("paid");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch(`/api/sign/${token}/payment/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field_id: field.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Couldn't start payment.");
        setStarting(false);
        return;
      }
      window.location.href = json.checkout_url; // full redirect to Stripe Checkout — returns to this exact page on success/cancel
    } catch {
      alert("Network error — try again.");
      setStarting(false);
    }
  }

  const amount = field.paymentConfig ? (field.paymentConfig.amountCents / 100).toFixed(2) : "?";
  const currency = field.paymentConfig?.currency?.toUpperCase() ?? "";

  return (
    <div
      id={`field-${field.id}`}
      style={{
        position: "absolute", left: pos.left, top: pos.top, width: Math.max(pos.width, 130), height: pos.height,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {paid ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", background: "var(--success-bg)", borderRadius: 4, padding: "4px 10px", width: "100%", textAlign: "center" }}>
          ✓ Paid {currency} {amount}
        </span>
      ) : (
        <button
          type="button"
          onClick={startPayment}
          disabled={!interactive || starting || !checkedInitial}
          style={{
            width: "100%", height: "100%", fontSize: 12, fontWeight: 600,
            background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4,
            cursor: interactive ? "pointer" : "default",
          }}
        >
          {starting ? "Redirecting…" : `Pay ${currency} ${amount}`}
        </button>
      )}
    </div>
  );
}

export type SignatureMode = "type" | "draw" | "upload";

/**
 * Three ways to provide a signature/initial, matching what people expect
 * from any real e-signature product:
 *  - Type: rendered live in a cursive web font (Dancing Script) matching
 *    the exact font burned into the final PDF server-side — see
 *    lib/signing/fonts/signature-script.ttf and lib/signing/pdf.ts.
 *  - Draw: captured via SignaturePad as a PNG data URL, embedded as an
 *    image on the signed PDF (not text) — see burnFields' image branch.
 *  - Upload: an existing signature image file, handled identically to Draw.
 * The submitted `value` is either plain text (Type) or a "data:image/...
 * data URL (Draw/Upload) — lib/signing/pdf.ts branches on that prefix.
 * Entirely local/client-side (FileReader + canvas) — no network — so it's
 * identically reusable in Preview with zero changes.
 */
export function SignatureFieldInput({ field, value, fieldFont, error, onChange }: { field: Field; value: string; fieldFont?: string; error?: string; onChange: (v: string, signatureFont?: string) => void }) {
  const isImage = value.startsWith("data:image");
  const [mode, setMode] = useState<SignatureMode>(isImage ? "draw" : "type");
  const [styleId, setStyleId] = useState<string>(fieldFont ?? DEFAULT_SIGNATURE_STYLE_ID);
  const label = field.type === "initial" ? "Initial" : "Signature";

  function handleUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label className="field-label">{label} {field.required && <span style={{ color: "var(--accent)" }}>*</span>}</label>

      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {(["type", "draw", "upload"] as SignatureMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); onChange(""); }}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid " + (mode === m ? "var(--accent)" : "var(--border-strong)"),
              background: mode === m ? "var(--accent-soft)" : "transparent",
              color: mode === m ? "var(--accent-dark)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {m === "type" ? "Type" : m === "draw" ? "Draw" : "Upload"}
          </button>
        ))}
      </div>

      {mode === "type" && (
        <div>
          <input
            style={{ fontFamily: (SIGNATURE_STYLES.find((s) => s.id === styleId) ?? SIGNATURE_STYLES[0]).cssFontFamily, fontSize: 26, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", height: 64, padding: "0 14px" }}
            placeholder="Type your full name"
            value={isImage ? "" : value}
            onChange={(e) => onChange(e.target.value, styleId)}
          />
          {!isImage && value && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {SIGNATURE_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setStyleId(s.id); onChange(value, s.id); }}
                  title={s.label}
                  style={{
                    flex: "1 1 auto", minWidth: 90, padding: "8px 6px", border: `1.5px solid ${styleId === s.id ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)", background: styleId === s.id ? "var(--accent-soft)" : "var(--bg-surface)", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  }}
                >
                  <span style={{ fontFamily: s.cssFontFamily, fontSize: 18, color: "var(--text-primary)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{value}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "10px 0 0" }}>Pick a style above, or draw/upload your own instead</p>
        </div>
      )}

      {mode === "draw" && (
        <SignaturePad onChange={onChange} />
      )}

      {mode === "upload" && (
        <div>
          {isImage ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src={value} alt="Uploaded signature" style={{ height: 60, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "#fff", padding: 4 }} />
              <button type="button" onClick={() => onChange("")} style={{ background: "none", border: "none", color: "var(--accent-dark)", fontSize: 12, cursor: "pointer" }}>
                Remove
              </button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={(e) => handleUpload(e.target.files?.[0])} />
          )}
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>Upload a photo or scan of your signature</p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "var(--danger)", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}

export function SignatureModal({
  field, value, fieldFont, error, onChange, onClose,
}: { field: Field; value: string; fieldFont?: string; error?: string; onChange: (v: string, signatureFont?: string) => void; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(20, 21, 26, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 420, width: "100%" }}>
        <SignatureFieldInput field={field} value={value} fieldFont={fieldFont} error={error} onChange={onChange} />
        <Button variant="primary" onClick={onClose} style={{ width: "100%" }}>
          Done
        </Button>
      </div>
    </div>
  );
}
