// DEPLOY TO: components/PreviewModal.tsx
"use client";

// Read-only-to-the-document, but fully interactive-to-the-fields "what will
// the recipient see" preview, opened from either field editor. Renders the
// same PDF via the same pdfjs-dist path the editor already uses (no new
// backend surface), and reuses the exact same FieldOverlay/SignatureModal
// components the live signing page renders — so a checkbox looks and clicks
// like a checkbox, a signature field opens the real signature pad, a
// payment field shows the real "Pay $X" button — instead of drawing
// simplified lookalike boxes. Attachment/Payment run in `previewMode`,
// which swaps their real network calls (upload, Stripe Checkout) for a
// local-only simulation — see FieldRenderer.tsx.
// Device-width toggle simulates how the layout reflows, matching DocuSign's
// three-breakpoint preview.

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/motion/Modal";
import { Button } from "@/components/motion/Button";
import type { FieldDefinition } from "@/lib/signing/field-types";
import { FieldOverlay, SignatureModal, type Field } from "@/components/signing/FieldRenderer";

const DEVICE_WIDTHS = { desktop: 900, tablet: 620, mobile: 375 } as const;
type Device = keyof typeof DEVICE_WIDTHS;

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  fields: FieldDefinition[];
  roleLabel: (role: string) => string; // caller resolves role -> display name (real recipient name, or "Signer 1" preset)
}

export function PreviewModal({ open, onClose, pdfUrl, fields, roleLabel }: PreviewModalProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [pages, setPages] = useState<{ widthPts: number; heightPts: number }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [signatureFonts, setSignatureFonts] = useState<Record<string, string>>({});
  const [signatureModalFieldId, setSignatureModalFieldId] = useState<string | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pdfDocRef = useRef<any>(null);
  const containerWidth = DEVICE_WIDTHS[device];
  const activeSignatureField = fields.find((f) => f.id === signatureModalFieldId) ?? null;

  function fieldValue(f: FieldDefinition): string {
    return values[f.id] ?? f.defaultValue ?? "";
  }

  useEffect(() => {
    if (!open) return;
    setValues({});
    setSignatureFonts({});
    setSignatureModalFieldId(null);
  }, [open]);

  useEffect(() => {
    if (!open || !pdfUrl) return;
    let cancelled = false;
    (async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
      const doc = await pdfjsLib.getDocument(pdfUrl).promise;
      if (cancelled) return;
      pdfDocRef.current = doc;
      const dims: { widthPts: number; heightPts: number }[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        dims.push({ widthPts: vp.width, heightPts: vp.height });
      }
      if (!cancelled) setPages(dims);
    })();
    return () => { cancelled = true; pdfDocRef.current = null; };
  }, [open, pdfUrl]);

  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) return;
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const page = await doc.getPage(i + 1);
        const renderScale = containerWidth / pages[i].widthPts;
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => { cancelled = true; };
  }, [pages, containerWidth]);

  return (
    <Modal open={open} onClose={onClose} fullBleed>
      <div className="topbar" style={{ flexShrink: 0 }}>
        <span className="topbar-brand" style={{ fontSize: 14 }}>Preview</span>
        <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", borderRadius: 8, padding: 3 }}>
          {(Object.keys(DEVICE_WIDTHS) as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDevice(d)}
              style={{ padding: "5px 12px", fontSize: 12.5, fontWeight: 500, border: "none", borderRadius: 6, cursor: "pointer", background: device === d ? "var(--bg-surface)" : "transparent", color: device === d ? "var(--text-primary)" : "var(--text-secondary)", boxShadow: device === d ? "var(--shadow-sm)" : "none", transition: "background var(--transition-fast) ease, box-shadow var(--transition-fast) ease" }}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => { setValues({}); setSignatureFonts({}); }} disabled={Object.keys(values).length === 0}>Reset</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg-subtle)", padding: "32px 16px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {!pdfUrl && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No document to preview yet.</p>}
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, textAlign: "center", maxWidth: 480 }}>
          This simulates what each recipient sees — click a field to try it. Nothing here is saved or sent.
        </p>
        {pages.map((dims, i) => {
          const scale = containerWidth / dims.widthPts;
          return (
            <div key={i} style={{ position: "relative", width: containerWidth, marginBottom: 24, boxShadow: "var(--shadow)", borderRadius: "var(--radius-sm)", overflow: "hidden", transition: "width var(--transition-base) ease", background: "var(--bg-surface)" }}>
              <canvas ref={(el) => { canvasRefs.current[i] = el; }} style={{ display: "block" }} />
              {fields.filter((f) => f.page === i).map((f) => {
                const pos = {
                  left: f.x * scale,
                  top: (dims.heightPts - f.y - f.height) * scale,
                  width: Math.max(f.width * scale, f.type === "checkbox" ? 20 : 90),
                  height: Math.max(f.height * scale, 26),
                };
                return (
                  <div key={f.id}>
                    <span
                      title={roleLabel(f.role)}
                      style={{ position: "absolute", left: pos.left, top: pos.top - 14, fontSize: 9, fontWeight: 600, color: "var(--accent-dark)", background: "var(--accent-soft)", borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap", zIndex: 1 }}
                    >
                      {roleLabel(f.role)}
                    </span>
                    <FieldOverlay
                      field={f as Field}
                      pos={pos}
                      interactive
                      value={fieldValue(f)}
                      fieldFont={signatureFonts[f.id]}
                      onChange={(v, font) => {
                        setValues((prev) => ({ ...prev, [f.id]: v }));
                        if (font) setSignatureFonts((prev) => ({ ...prev, [f.id]: font }));
                      }}
                      onOpenSignature={() => setSignatureModalFieldId(f.id)}
                      token=""
                      previewMode
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {activeSignatureField && (
        <SignatureModal
          field={activeSignatureField as Field}
          value={fieldValue(activeSignatureField)}
          fieldFont={signatureFonts[activeSignatureField.id]}
          onChange={(v, font) => {
            setValues((prev) => ({ ...prev, [activeSignatureField.id]: v }));
            if (font) setSignatureFonts((prev) => ({ ...prev, [activeSignatureField.id]: font }));
          }}
          onClose={() => setSignatureModalFieldId(null)}
        />
      )}
    </Modal>
  );
}
