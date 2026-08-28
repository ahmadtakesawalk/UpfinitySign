// DEPLOY TO: app/dashboard/envelopes/[id]/fields/page.tsx
"use client";

// Field editor for a SPECIFIC ENVELOPE, not a template. Visually and
// interactionally identical to app/dashboard/templates/[id]/page.tsx
// (zoom, undo/redo, drag/resize, teal field styling, tooltips, click-to-
// place, formula calculator) — the differences are only:
//   - loads from/saves to the ENVELOPE's own fieldMap snapshot (see
//     lib/signing/envelopes.ts — createEnvelope() copies the template's
//     fields in at send time; editing here never touches the template)
//   - role assignment shows the envelope's REAL recipients (resolved by
//     name) instead of generic "signer_1"/"approver_1" placeholder text
//   - locked (read-only) once the envelope reaches a terminal status —
//     see ACTIVE_ENVELOPE_STATUSES in lib/signing/envelopes.ts
//
// This duplicates a fair amount of the template editor's code rather than
// sharing a component — flagged as a reasonable target for extraction
// into a shared component later, not done now to avoid touching/risking
// the already-working template editor in the same pass.

import { useEffect, useRef, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";
import { EditorChrome } from "@/components/EditorChrome";
import { Button } from "@/components/motion/Button";
import { Toggle } from "@/components/motion/Toggle";
import { IconButton } from "@/components/motion/IconButton";
import { Popover } from "@/components/motion/Popover";
import { useToast } from "@/components/motion/Toast";
import type { FieldDefinition, FieldType } from "@/lib/signing/field-types";
import { SiteFooter } from "@/components/SiteFooter";
import { PreviewModal } from "@/components/PreviewModal";

interface RecipientSummary {
  id: string;
  name: string;
  email: string;
  role: "signer" | "approver" | "cc" | "viewer";
  signing_order: number;
  status: string;
}

// Envelopes editable/resendable while in these states — mirrors
// ACTIVE_ENVELOPE_STATUSES in lib/signing/envelopes.ts. Duplicated here
// (not imported) since this is client code and that constant lives in a
// server-only module; keep the two lists in sync if either changes.
const ACTIVE_STATUSES = ["sent", "delivered", "opened"];

const FIELD_GROUPS: { label: string; types: FieldType[] }[] = [
  { label: "Signature", types: ["signature", "initial", "date"] },
  { label: "Contact Information", types: ["full_name", "email", "company", "title"] },
  { label: "Inputs", types: ["text", "number", "checkbox", "radio_group", "dropdown"] },
  { label: "Actions", types: ["approve", "decline", "stamp"] },
  { label: "Other", types: ["note", "payment", "formula"] },
];

const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature", initial: "Initial", date: "Date", full_name: "Full name",
  email: "Email", company: "Company", title: "Title", text: "Text", number: "Number",
  checkbox: "Checkbox", radio_group: "Radio group", dropdown: "Dropdown", note: "Note",
  payment: "Payment", attachment: "Attachment", custom: "Custom", formula: "Formula",
  approve: "Approve", decline: "Decline", stamp: "Stamp",
};

// Storage-key convention already baked into existing field_maps —
// "signer_1" means "the 1st recipient whose role is signer", etc. Same
// list the template editor uses; here it's resolved against REAL people.
const ROLE_KEYS = ["signer_1", "signer_2", "signer_3", "approver_1", "cc_1"];

function resolveRecipient(roleKey: string, recipients: RecipientSummary[]): RecipientSummary | null {
  const match = roleKey.match(/^(signer|approver|cc|viewer)_(\d+)$/);
  if (!match) return null;
  const [, rolePrefix, ordinalStr] = match;
  const ordinal = Number(ordinalStr);
  const candidates = recipients
    .filter((r) => r.role === rolePrefix)
    .sort((a, b) => a.signing_order - b.signing_order);
  return candidates[ordinal - 1] ?? null;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").slice(0, 2).join("") || "?";
}

const DEFAULT_SIZE: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 200, height: 50 }, initial: { width: 80, height: 50 }, date: { width: 130, height: 32 },
  full_name: { width: 190, height: 32 }, email: { width: 190, height: 32 }, company: { width: 190, height: 32 },
  title: { width: 170, height: 32 }, text: { width: 170, height: 32 }, number: { width: 130, height: 32 },
  checkbox: { width: 24, height: 24 }, radio_group: { width: 180, height: 56 }, dropdown: { width: 170, height: 32 },
  attachment: { width: 190, height: 32 }, note: { width: 210, height: 40 }, custom: { width: 170, height: 32 },
  formula: { width: 130, height: 32 }, payment: { width: 170, height: 40 },
  approve: { width: 100, height: 36 }, decline: { width: 100, height: 36 }, stamp: { width: 120, height: 90 },
};

const BASE_PAGE_WIDTH = 900;
const THUMB_WIDTH = 96;
const FIELD_TEAL_BORDER = "#0d9488";
const FIELD_TEAL_BG = "rgba(13, 148, 136, 0.08)";
const FIELD_TEAL_TEXT = "#0f766e";

function FieldIcon({ type }: { type: FieldType }) {
  const c = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" as const, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "signature": return <svg {...c}><path d="M11.4 2.3a1.3 1.3 0 011.9 0l.4.4a1.3 1.3 0 010 1.9l-7.6 7.6-3 .7.7-3 7.6-7.6z" /><path d="M9.7 4l2.3 2.3" /></svg>;
    case "initial": return <svg {...c}><path d="M4 3v10M4 3h3.5a2 2 0 010 4H4m0 0h4a2 2 0 010 4H4" /></svg>;
    case "date": return <svg {...c}><rect x="2" y="3.5" width="12" height="10" rx="1.5" /><path d="M2 6.5h12M5 2v3M11 2v3" /></svg>;
    case "full_name": return <svg {...c}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" /></svg>;
    case "email": return <svg {...c}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5L8 9l5.5-4.5" /></svg>;
    case "company": return <svg {...c}><rect x="3" y="2" width="10" height="12" rx="1" /><path d="M6 5h1M9 5h1M6 8h1M9 8h1M6 11h1M9 11h1" /></svg>;
    case "title": return <svg {...c}><path d="M3 4h10M3 8h10M3 12h6" /></svg>;
    case "text": return <svg {...c}><path d="M3 4h10M8 4v9" /></svg>;
    case "number": return <svg {...c}><path d="M5 2.5L3.5 13.5M12.5 2.5L11 13.5M2 6h12M1.5 10h12" /></svg>;
    case "checkbox": return <svg {...c}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 8l2 2 4-4" /></svg>;
    case "radio_group": return <svg {...c}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></svg>;
    case "dropdown": return <svg {...c}><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M5.5 8l2 2 2-2" /></svg>;
    case "note": return <svg {...c}><path d="M3 2.5h7L13 6v7.5H3z" /><path d="M10 2.5V6h3" /></svg>;
    case "payment": return <svg {...c}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v6M6.3 10c.3.7 1 1.1 1.9 1.1 1.1 0 2-.6 2-1.5s-.9-1.3-2-1.6c-1.1-.3-2-.7-2-1.6s.9-1.5 2-1.5c.9 0 1.6.4 1.9 1.1" /></svg>;
    case "formula": return <svg {...c}><rect x="2.5" y="2" width="11" height="12" rx="1.5" /><path d="M5 5.5h6M5 8h2M9 8h2M5 10.5h2M9 10.5h2" /></svg>;
    case "approve": return <svg {...c}><circle cx="8" cy="8" r="5.5" /><path d="M5.3 8.2l1.8 1.8 3.6-3.8" /></svg>;
    case "decline": return <svg {...c}><circle cx="8" cy="8" r="5.5" /><path d="M6 6l4 4M10 6l-4 4" /></svg>;
    case "stamp": return <svg {...c}><circle cx="8" cy="6.2" r="3.2" /><path d="M8 9.4V14M5 14h6M5.5 11.5h5" /></svg>;
    default: return <svg {...c}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /></svg>;
  }
}

function ChromeIcon({ name }: { name: "trash" | "chevron" | "back" | "undo" | "redo" }) {
  const c = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none" as const, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "trash") return <svg {...c}><path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M4.5 4.5l.6 8.4a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8.4" /></svg>;
  if (name === "chevron") return <svg {...c} width={10} height={10} strokeWidth={1.8}><path d="M4 6l4 4 4-4" /></svg>;
  if (name === "undo") return <svg {...c}><path d="M4 4.5v3.5h3.5" /><path d="M4.5 8a5 5 0 119.5 2.2" /></svg>;
  if (name === "redo") return <svg {...c}><path d="M12 4.5v3.5H8.5" /><path d="M11.5 8a5 5 0 10-9.5 2.2" /></svg>;
  return <svg {...c} width={16} height={16} strokeWidth={1.6}><path d="M10 3L5 8l5 5" /></svg>;
}

function FieldPreview({ f }: { f: FieldDefinition }) {
  switch (f.type) {
    case "checkbox":
      return <input type="checkbox" checked={f.defaultValue === "true"} readOnly style={{ width: "60%", height: "60%", accentColor: FIELD_TEAL_BORDER, pointerEvents: "none" }} />;
    case "dropdown": {
      const opts = f.options && f.options.length > 0 ? f.options : ["Select…"];
      return <select disabled value={f.defaultValue ?? opts[0]} style={{ width: "100%", height: "100%", fontSize: 10, border: "none", background: "transparent", color: FIELD_TEAL_TEXT, pointerEvents: "none" }}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    }
    case "radio_group": {
      const opts = f.options?.slice(0, 3) ?? ["Option 1", "Option 2"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, fontSize: 9, lineHeight: 1.3, width: "100%", padding: "3px 6px", pointerEvents: "none", overflow: "hidden" }}>
          {opts.map((o, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <input type="radio" checked={f.defaultValue === o} readOnly style={{ width: 9, height: 9, minWidth: 9, flexShrink: 0, accentColor: FIELD_TEAL_BORDER }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: FIELD_TEAL_TEXT }}>{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case "signature":
      return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}><span style={{ fontSize: 10, fontWeight: 600 }}>Sign</span><FieldIcon type="signature" /></div>;
    case "initial":
      return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}><span style={{ fontSize: 10, fontWeight: 600 }}>Initial</span><FieldIcon type="initial" /></div>;
    case "date":
      return <span style={{ fontSize: 10, color: FIELD_TEAL_TEXT }}>MM / DD / YYYY</span>;
    case "payment": {
      const amt = f.paymentConfig ? (f.paymentConfig.amountCents / 100).toFixed(2) : "0.00";
      const cur = (f.paymentConfig?.currency ?? "usd").toUpperCase();
      return <span style={{ fontSize: 11, fontWeight: 600, color: FIELD_TEAL_TEXT }}>{cur} {amt}</span>;
    }
    case "note":
      return <span style={{ fontSize: 9, color: FIELD_TEAL_TEXT, padding: "0 4px" }}>{f.customConfig?.label ?? "Note"}</span>;
    case "approve":
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", background: "var(--success-bg)", color: "var(--success)", fontSize: 11, fontWeight: 600, borderRadius: 4 }}><FieldIcon type="approve" /> Approve</div>;
    case "decline":
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 11, fontWeight: 600, borderRadius: 4 }}><FieldIcon type="decline" /> Decline</div>;
    case "stamp":
      return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}><span style={{ fontSize: 10, fontWeight: 600 }}>Stamp</span><FieldIcon type="stamp" /></div>;
    default:
      return <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: FIELD_TEAL_TEXT, padding: "0 4px", overflow: "hidden" }}><FieldIcon type={f.type} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FIELD_LABELS[f.type] ?? f.type}</span></div>;
  }
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
        {title}
        <span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform var(--transition-fast, 100ms) ease", display: "flex", color: "var(--text-muted)" }}><ChromeIcon name="chevron" /></span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

interface FieldToolbarProps {
  field: FieldDefinition; top: number; left: number; recipients: RecipientSummary[]; locked: boolean;
  onChangeRole: (role: string) => void; onToggleRequired: () => void; onDelete: () => void;
}
function FieldToolbar({ field, top, left, recipients, locked, onChangeRole, onToggleRequired, onDelete }: FieldToolbarProps) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const recipient = resolveRecipient(field.role, recipients);
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
      transition={reduceMotion ? { duration: 0.01 } : springs.micro}
      style={{ position: "absolute", top, left, zIndex: 20, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-md, 0 6px 20px rgba(0,0,0,0.12))", whiteSpace: "nowrap" }}
    >
      <div style={{ position: "relative" }}>
        <button type="button" onClick={() => !locked && setRoleMenuOpen((o) => !o)} title={recipient?.name ?? field.role} disabled={locked} style={{ width: 26, height: 26, borderRadius: "50%", border: "none", background: "var(--accent-soft)", color: "var(--accent-dark)", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: locked ? "default" : "pointer" }}>
          {recipient ? initials(recipient.name) : "?"}
        </button>
        <Popover open={roleMenuOpen} style={{ top: 32, left: 0, minWidth: 170 }}>
          {ROLE_KEYS.map((key) => {
            const r = resolveRecipient(key, recipients);
            if (!r) return null;
            return (
              <button key={key} type="button" onClick={() => { onChangeRole(key); setRoleMenuOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, border: "none", background: key === field.role ? "var(--accent-soft)" : "transparent", borderRadius: 5, cursor: "pointer", color: "var(--text-primary)" }}>
                {r.name} <span style={{ color: "var(--text-muted)", fontSize: 10.5 }}>({r.role})</span>
              </button>
            );
          })}
        </Popover>
      </div>
      <div style={{ width: 1, height: 18, background: "var(--border)" }} />
      <Toggle checked={field.required} onChange={onToggleRequired} label="Required" />
      {!locked && (
        <>
          <div style={{ width: 1, height: 18, background: "var(--border)" }} />
          <IconButton onClick={onDelete} title="Delete" variant="danger"><ChromeIcon name="trash" /></IconButton>
        </>
      )}
    </motion.div>
  );
}

interface FieldDetailsPanelProps {
  field: FieldDefinition; fields: FieldDefinition[]; recipients: RecipientSummary[]; pages: { widthPts: number; heightPts: number }[];
  fitWidth: number; // live 100%-zoom reference width — must match what the canvas actually renders at, not the stale BASE_PAGE_WIDTH constant
  locked: boolean; onUpdate: (patch: Partial<FieldDefinition>) => void; onRemove: () => void; onBack: () => void;
}
function FieldDetailsPanel({ field, fields, recipients, pages, fitWidth, locked, onUpdate, onRemove, onBack }: FieldDetailsPanelProps) {
  const dims = pages[field.page] ?? { widthPts: 612, heightPts: 792 };
  const baseScale = fitWidth / dims.widthPts;
  const pxLeft = Math.round(field.x * baseScale);
  const pxTop = Math.round((dims.heightPts - field.y - field.height) * baseScale);
  const exprRef = useRef<HTMLTextAreaElement | null>(null);
  const insertableFields = fields.filter((f) => f.id !== field.id && ["text", "number", "formula", "date"].includes(f.type));

  function insertIntoExpression(token: string) {
    const el = exprRef.current;
    const current = field.formulaConfig?.expression ?? "";
    if (!el) { onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: current + token } }); return; }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: next } });
    requestAnimationFrame(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); });
  }

  const assignedOptions = ROLE_KEYS.map((key) => ({ key, recipient: resolveRecipient(key, recipients) })).filter((o) => o.recipient);

  return (
    <div className="card" style={{ padding: 14, opacity: locked ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button type="button" onClick={onBack} title="Back" style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: "var(--text-secondary)" }}><ChromeIcon name="back" /></button>
        <h3 style={{ fontSize: 14, margin: 0 }}>{FIELD_LABELS[field.type] ?? field.type}</h3>
      </div>
      <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>Required</span>
          <Toggle checked={field.required} onChange={() => onUpdate({ required: !field.required })} />
        </div>
        <div>
          <label className="field-label">Assigned to</label>
          <select value={field.role} onChange={(e) => onUpdate({ role: e.target.value })}>
            {assignedOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.recipient!.name} ({o.recipient!.role})</option>
            ))}
          </select>
        </div>
        {(field.type === "radio_group" || field.type === "dropdown") && (
          <div>
            <label className="field-label">{field.type === "radio_group" ? "Radio button values" : "Dropdown values"}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {(field.options ?? []).map((opt, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {field.type === "radio_group" && <input type="radio" checked={field.defaultValue === opt} onChange={() => onUpdate({ defaultValue: opt })} style={{ width: "auto", height: "auto", accentColor: FIELD_TEAL_BORDER }} />}
                  <input value={opt} onChange={(e) => { const next = [...(field.options ?? [])]; const prevVal = next[idx]; next[idx] = e.target.value; onUpdate({ options: next, defaultValue: field.defaultValue === prevVal ? e.target.value : field.defaultValue }); }} style={{ flex: 1 }} />
                  <IconButton onClick={() => { const next = (field.options ?? []).filter((_, i) => i !== idx); onUpdate({ options: next, defaultValue: field.defaultValue === opt ? undefined : field.defaultValue }); }} title="Remove" variant="danger"><ChromeIcon name="trash" /></IconButton>
                </div>
              ))}
            </div>
            <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => onUpdate({ options: [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`] })}>+ Add value</button>
          </div>
        )}
        {field.type === "formula" && (
          <div>
            <label className="field-label">Formula</label>
            <textarea ref={exprRef} rows={2} value={field.formulaConfig?.expression ?? ""} onChange={(e) => onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: e.target.value } })} placeholder="e.g. quantity * unit_price" style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
              {(["+", "−", "×", "÷", "(", ")", "<", ">", "<=", ">=", "<>"] as const).map((op) => {
                const tokenMap: Record<string, string> = { "−": "-", "×": "*", "÷": "/" };
                return <button key={op} type="button" className="secondary" onClick={() => insertIntoExpression(tokenMap[op] ?? op)} style={{ minWidth: 30, height: 30, padding: "0 4px", fontSize: 13, fontWeight: 600 }}>{op}</button>;
              })}
            </div>
            {insertableFields.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <label className="field-label">Insert field</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {insertableFields.map((f) => <button key={f.id} type="button" className="secondary" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => insertIntoExpression(f.id)}>{f.dataLabel || `${FIELD_LABELS[f.type]}`}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
        <CollapsibleSection title="Location" defaultOpen>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label className="field-label">Pixels from left</label><input type="number" value={pxLeft} onChange={(e) => onUpdate({ x: (Number(e.target.value) || 0) / baseScale })} /></div>
            <div style={{ flex: 1 }}><label className="field-label">Pixels from top</label><input type="number" value={pxTop} onChange={(e) => onUpdate({ y: dims.heightPts - field.height - (Number(e.target.value) || 0) / baseScale })} /></div>
          </div>
        </CollapsibleSection>
        <button type="button" className="danger" style={{ fontSize: 13 }} onClick={onRemove}>Delete</button>
      </fieldset>
    </div>
  );
}

// Recipient selector sitting above the field-type palette (image 4's "AA /
// Ahmad Ajmal" pill) — sets who new fields default to, so assignment
// happens once up front instead of per field after placement.
interface RecipientPickerProps { activeRole: string; recipients: RecipientSummary[]; disabled: boolean; onChange: (role: string) => void; }
function RecipientPicker({ activeRole, recipients, disabled, onChange }: RecipientPickerProps) {
  const [open, setOpen] = useState(false);
  const active = resolveRecipient(activeRole, recipients);
  const options = ROLE_KEYS.map((key) => ({ key, recipient: resolveRecipient(key, recipients) })).filter((o) => o.recipient);
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <button
        type="button"
        disabled={disabled || options.length <= 1}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--accent-soft)", cursor: disabled || options.length <= 1 ? "default" : "pointer" }}
      >
        <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {active ? initials(active.name) : "?"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active ? active.name : "Unassigned"}
        </span>
        {options.length > 1 && <ChromeIcon name="chevron" />}
      </button>
      <Popover open={open} style={{ top: 42, left: 0, right: 0, minWidth: "100%" }}>
        {options.map((o) => (
          <button key={o.key} type="button" onClick={() => { onChange(o.key); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 12.5, border: "none", background: o.key === activeRole ? "var(--accent-soft)" : "transparent", borderRadius: 5, cursor: "pointer", color: "var(--text-primary)" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(o.recipient!.name)}</span>
            {o.recipient!.name} <span style={{ color: "var(--text-muted)", fontSize: 10.5 }}>({o.recipient!.role})</span>
          </button>
        ))}
      </Popover>
    </div>
  );
}

export default function EnvelopeFieldsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { show } = useToast();

  const [loading, setLoading] = useState(true);
  const [docName, setDocName] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("sent");
  const [recipients, setRecipients] = useState<RecipientSummary[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [savedFields, setSavedFields] = useState<FieldDefinition[]>([]);
  const [pages, setPages] = useState<{ widthPts: number; heightPts: number }[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [placingType, setPlacingType] = useState<FieldType | null>(null);
  const [placingGhost, setPlacingGhost] = useState<{ pageIdx: number; x: number; y: number } | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Undo/redo — a real history stack, not the placeholder undo/redo icons
  // from the reference screenshots that were never actually wired to
  // anything. Refs (not state) for the stacks themselves, since pushing to
  // them on every edit shouldn't itself trigger a re-render — historyTick
  // is the one piece of state that exists purely so the toolbar's
  // disabled={} on Undo/Redo updates when the stacks change.
  const undoStack = useRef<FieldDefinition[][]>([]);
  const redoStack = useRef<FieldDefinition[][]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  // "Who am I placing fields for" — set once from the palette (mirrors
  // DocuSign), instead of assigning role per-field after placement. Field
  // toolbar's per-field role change (FieldToolbar) still overrides this for
  // an individual field afterward; this is just the default at creation time.
  const [activeRole, setActiveRole] = useState<string>("signer_1");

  const pdfDocRef = useRef<any>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const thumbCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pageColumnRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; field: FieldDefinition } | null>(null);

  const locked = !ACTIVE_STATUSES.includes(status);
  const isDirty = JSON.stringify(fields) !== JSON.stringify(savedFields);
  const [fitWidth, setFitWidth] = useState(BASE_PAGE_WIDTH);
  useEffect(() => {
    const el = pageColumnRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => { const w = entries[0]?.contentRect.width; if (w && w > 100) setFitWidth(Math.floor(w)); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pageRenderWidth = Math.round(fitWidth * (zoomPct / 100));

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/dashboard/envelopes/${id}`);
      if (res.status === 401) return router.push("/dashboard/login");
      if (!res.ok) { show({ message: "Couldn't load this envelope.", type: "error" }); return router.push("/dashboard"); }
      const json = await res.json();
      setDocName(json.name);
      setPdfUrl(json.pdf_url);
      setStatus(json.status);
      setRecipients(json.recipients ?? []);
      setFields(json.field_map ?? []);
      setSavedFields(json.field_map ?? []);
      const firstRole = ROLE_KEYS.find((key) => resolveRecipient(key, json.recipients ?? []));
      if (firstRole) setActiveRole(firstRole);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) { if (!isDirty) return; e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (!pdfUrl) return;
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
  }, [pdfUrl]);

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
        const renderScale = pageRenderWidth / pages[i].widthPts;
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => { cancelled = true; };
    // fitWidth is a real dependency (pageRenderWidth derives from it) —
    // see the matching note in the template builder's copy of this effect.
  }, [pages, zoomPct, fitWidth]);

  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) return;
        const canvas = thumbCanvasRefs.current[i];
        if (!canvas) continue;
        const page = await doc.getPage(i + 1);
        const scale = THUMB_WIDTH / pages[i].widthPts;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => { cancelled = true; };
  }, [pages]);

  useEffect(() => {
    if (pages.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      let best: { idx: number; ratio: number } | null = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
        if (!best || entry.intersectionRatio > best.ratio) best = { idx, ratio: entry.intersectionRatio };
      }
      if (best) setCurrentPage(best.idx);
    }, { threshold: [0.15, 0.35, 0.6] });
    pageContainerRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && placingType) { setPlacingType(null); setPlacingGhost(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !locked) {
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        e.preventDefault();
        removeField(selectedId);
        return;
      }
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !locked) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !locked) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingType, selectedId, locked, fields]);

  function goToPage(idx: number) { pageContainerRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  function pdfToScreen(f: FieldDefinition, pageIdx: number) {
    const dims = pages[pageIdx];
    if (!dims) return { left: 0, top: 0, width: 0, height: 0 };
    const s = pageRenderWidth / dims.widthPts;
    return { left: f.x * s, top: (dims.heightPts - f.y - f.height) * s, width: f.width * s, height: f.height * s };
  }

  function updateField(fieldId: string, patch: Partial<FieldDefinition>, opts?: { skipHistory?: boolean }) {
    if (locked) return;
    if (!opts?.skipHistory) commitHistory();
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
  }

  // Snapshots the fields array as it stood BEFORE the change about to
  // happen — called once per discrete action (not per pixel of a drag; see
  // onPointerDownField, which calls this once at drag start, and
  // onPointerMove, which passes skipHistory to updateField during the drag
  // itself, so an entire move/resize collapses into a single undo step).
  function commitHistory() {
    undoStack.current = [...undoStack.current, fields].slice(-50);
    redoStack.current = [];
    setHistoryTick((v) => v + 1);
  }

  function handleUndo() {
    if (locked || undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, fields];
    setFields(prev);
    setSelectedId(null);
    setHistoryTick((v) => v + 1);
  }

  function handleRedo() {
    if (locked || redoStack.current.length === 0) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, fields];
    setFields(next);
    setSelectedId(null);
    setHistoryTick((v) => v + 1);
  }

  function createFieldAt(type: FieldType, page: number, xPts: number, yPts: number) {
    if (locked) return;
    commitHistory();
    const size = DEFAULT_SIZE[type];
    const id = `f_${Date.now()}`;
    const newField: FieldDefinition = { id, page, type, role: activeRole, x: Math.max(0, xPts), y: Math.max(0, yPts), width: size.width, height: size.height, required: type !== "note", ...(type === "radio_group" || type === "dropdown" ? { options: ["Option 1", "Option 2"] } : {}) };
    setFields((prev) => [...prev, newField]);
    setSelectedId(id);
    setPlacingType(null);
  }

  function removeField(fieldId: string) {
    if (locked) return;
    commitHistory();
    setFields((prev) => prev.filter((f) => f.id !== fieldId).map((f) => (f.visibleIf?.fieldId === fieldId ? { ...f, visibleIf: undefined } : f)));
    if (selectedId === fieldId) setSelectedId(null);
  }

  function onPointerDownField(e: React.PointerEvent, field: FieldDefinition, mode: "move" | "resize") {
    if (locked) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedId(field.id);
    commitHistory(); // one undo step for the whole drag, not one per pointermove
    dragState.current = { id: field.id, mode, startX: e.clientX, startY: e.clientY, field: { ...field } };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag) return;
    const dims = pages[drag.field.page];
    if (!dims) return;
    const s = pageRenderWidth / dims.widthPts;
    const dxPts = (e.clientX - drag.startX) / s;
    const dyPts = (e.clientY - drag.startY) / s;
    if (drag.mode === "move") updateField(drag.id, { x: Math.max(0, drag.field.x + dxPts), y: Math.max(0, drag.field.y - dyPts) }, { skipHistory: true });
    else updateField(drag.id, { width: Math.max(16, drag.field.width + dxPts), height: Math.max(12, drag.field.height - dyPts) }, { skipHistory: true });
  }

  function onPointerUp() { dragState.current = null; }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/envelopes/${id}/fields`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ field_map: fields }) });
      if (!res.ok) { const json = await res.json(); show({ message: json.error ?? "Couldn't save.", type: "error" }); return; }
      setSavedFields(fields);
      show({ message: "Fields saved.", type: "success" });
    } catch { show({ message: "Network error — try saving again.", type: "error" }); }
    finally { setSaving(false); }
  }

  function handleDiscard() { setFields(savedFields); setSelectedId(null); show({ message: "Changes discarded.", type: "info" }); }

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  if (loading) return (<><EditorChrome backHref="/dashboard/envelopes" crumbs={[{ label: "Envelopes", href: "/dashboard/envelopes" }, { label: "Fields" }]} /><div className="page-shell"><p>Loading envelope…</p></div></>);

  return (
    <>
      <EditorChrome
        backHref={`/dashboard/envelopes/${id}`}
        crumbs={[{ label: "Envelopes", href: "/dashboard/envelopes" }, { label: docName }]}
        actions={
          <>
            <span style={{ fontSize: 12, color: isDirty ? "var(--warning)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{saving ? "Saving…" : isDirty ? "Unsaved changes" : "All changes saved"}</span>
            {!locked && (
              <div style={{ display: "flex", gap: 2 }}>
                <IconButton title="Undo (Ctrl+Z)" onClick={handleUndo} disabled={undoStack.current.length === 0}><ChromeIcon name="undo" /></IconButton>
                <IconButton title="Redo (Ctrl+Shift+Z)" onClick={handleRedo} disabled={redoStack.current.length === 0}><ChromeIcon name="redo" /></IconButton>
              </div>
            )}
            <Button variant="secondary" onClick={() => setPreviewOpen(true)}>Preview</Button>
            {!locked && (
              <>
                <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty || saving}>Discard</Button>
                <Button variant="primary" onClick={handleSave} disabled={saving || !isDirty}>{saving ? "Saving…" : "Save fields"}</Button>
              </>
            )}
          </>
        }
      />
      <div style={{ padding: "16px 24px 0" }}>
        <p style={{ fontSize: 13 }}>{locked ? "This envelope is locked — it can no longer be edited." : "Click a field to edit it, drag to move, use the corner handle to resize."}</p>
      </div>

      {locked && (
        <div style={{ margin: "12px auto 0", padding: "0 24px" }}>
          <div style={{ background: "var(--pending-bg)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "10px 16px" }}>
            <p style={{ fontSize: 13, color: "var(--text-primary)" }}>This envelope is <strong>{status}</strong> and its fields are locked.</p>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, margin: "16px auto", padding: "0 24px 48px", alignItems: "flex-start" }}>
        <div style={{ width: 300, flexShrink: 0, position: "sticky", top: 24 }}>
          {selectedField ? (
            <FieldDetailsPanel field={selectedField} fields={fields} recipients={recipients} pages={pages} fitWidth={fitWidth} locked={locked} onUpdate={(patch) => updateField(selectedField.id, patch)} onRemove={() => removeField(selectedField.id)} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="card" style={{ padding: 14, opacity: locked ? 0.6 : 1, pointerEvents: locked ? "none" : "auto" }}>
              <RecipientPicker activeRole={activeRole} recipients={recipients} disabled={locked} onChange={setActiveRole} />
              <h3 style={{ fontSize: 13, marginBottom: 4 }}>Add a field</h3>
              <p style={{ fontSize: 11.5, color: placingType ? "var(--accent-dark)" : "var(--text-muted)", marginBottom: 12 }}>
                {placingType ? `Click on the document to place a ${FIELD_LABELS[placingType]} — Esc to cancel` : `Fields go to ${resolveRecipient(activeRole, recipients)?.name ?? "the selected recipient"} — pick a field, then click the document to place it`}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {FIELD_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 }}>{group.label}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {group.types.map((type) => {
                        const armed = placingType === type;
                        return (
                          <button key={type} type="button" onClick={() => setPlacingType((prev) => (prev === type ? null : type))} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 6px", fontSize: 11.5, fontWeight: 500, border: armed ? "1.5px solid var(--accent)" : "1px solid var(--border)", borderRadius: 8, background: armed ? "var(--accent-soft)" : "var(--bg-surface)", cursor: "pointer", color: armed ? "var(--accent-dark)" : "var(--text-primary)" }}>
                            <FieldIcon type={type} />{FIELD_LABELS[type]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div ref={pageColumnRef} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13, flexWrap: "wrap" }}>
            <input type="range" min={50} max={300} step={5} value={zoomPct} onChange={(e) => setZoomPct(Number(e.target.value))} style={{ width: 110 }} />
            <span style={{ fontSize: 12, color: "var(--text-secondary)", width: 38 }}>{zoomPct}%</span>
            {pages.length > 1 && (<><button className="secondary" disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)}>← Prev</button><span>Page {currentPage + 1} of {pages.length}</span><button className="secondary" disabled={currentPage === pages.length - 1} onClick={() => goToPage(currentPage + 1)}>Next →</button></>)}
          </div>
          {pages.length === 0 && <p style={{ fontSize: 13 }}>Rendering document…</p>}
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 220px)", paddingBottom: 8, paddingRight: 4 }}>
            {pages.map((dims, i) => (
              <div key={i} ref={(el) => { pageContainerRefs.current[i] = el; }} data-page-index={i} style={{ position: "relative", width: pageRenderWidth, transition: "width var(--transition-base, 180ms) ease", marginBottom: 24, boxShadow: "var(--shadow)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <canvas ref={(el) => { canvasRefs.current[i] = el; }} style={{ display: "block", width: "100%" }} />
                <div
                  style={{ position: "absolute", inset: 0, cursor: placingType ? "none" : "default" }}
                  onPointerMove={(e) => { onPointerMove(e); if (placingType) { const rect = e.currentTarget.getBoundingClientRect(); setPlacingGhost({ pageIdx: i, x: e.clientX - rect.left, y: e.clientY - rect.top }); } }}
                  onPointerLeave={() => setPlacingGhost(null)}
                  onPointerUp={onPointerUp}
                  onClick={(e) => {
                    if (placingType) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const scale = pageRenderWidth / dims.widthPts;
                      const size = DEFAULT_SIZE[placingType];
                      const xPts = (e.clientX - rect.left) / scale - size.width / 2;
                      const yPts = dims.heightPts - (e.clientY - rect.top) / scale - size.height / 2;
                      createFieldAt(placingType, i, xPts, yPts);
                      setPlacingGhost(null);
                    } else setSelectedId(null);
                  }}
                >
                  {placingType && placingGhost && placingGhost.pageIdx === i && (
                    <div style={{ position: "absolute", left: placingGhost.x - (DEFAULT_SIZE[placingType].width * (pageRenderWidth / dims.widthPts)) / 2, top: placingGhost.y - (DEFAULT_SIZE[placingType].height * (pageRenderWidth / dims.widthPts)) / 2, width: DEFAULT_SIZE[placingType].width * (pageRenderWidth / dims.widthPts), height: DEFAULT_SIZE[placingType].height * (pageRenderWidth / dims.widthPts), border: `2.5px solid ${FIELD_TEAL_BORDER}`, borderRadius: 4, background: FIELD_TEAL_BG, opacity: 0.9, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, pointerEvents: "none", zIndex: 25, color: FIELD_TEAL_TEXT, fontSize: 11, fontWeight: 600 }}>
                      <FieldIcon type={placingType} />{FIELD_LABELS[placingType]}
                    </div>
                  )}
                  {fields.filter((f) => f.page === i).map((f) => {
                    const pos = pdfToScreen(f, i);
                    const isSelected = f.id === selectedId;
                    const isHovered = hoveredFieldId === f.id;
                    const toolbarTop = pos.top >= 46 ? pos.top - 42 : pos.top + pos.height + 8;
                    const toolbarLeft = Math.min(Math.max(pos.left, 0), Math.max(pageRenderWidth - 170, 0));
                    return (
                      <div key={f.id}>
                        <div
                          onPointerDown={(e) => onPointerDownField(e, f, "move")}
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={() => setHoveredFieldId(f.id)}
                          onMouseLeave={() => setHoveredFieldId((prev) => (prev === f.id ? null : prev))}
                          style={{ position: "absolute", left: pos.left, top: pos.top, width: pos.width, height: pos.height, border: isSelected ? "2px solid var(--accent)" : `2.5px solid ${FIELD_TEAL_BORDER}`, background: isSelected ? "var(--accent-soft)" : FIELD_TEAL_BG, borderRadius: f.type === "checkbox" ? 3 : 4, cursor: locked ? "default" : "move", userSelect: "none" }}
                        >
                          <div style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}><FieldPreview f={f} /></div>
                          {f.tooltip && isHovered && (
                            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "var(--text-primary)", color: "#fff", fontSize: 11, padding: "5px 9px", borderRadius: 6, whiteSpace: "nowrap", maxWidth: 220, zIndex: 30, pointerEvents: "none" }}>{f.tooltip}</div>
                          )}
                          {!locked && <div onPointerDown={(e) => onPointerDownField(e, f, "resize")} style={{ position: "absolute", right: -4, bottom: -4, width: 10, height: 10, background: "var(--accent)", borderRadius: 3, cursor: "nwse-resize", display: isSelected ? "block" : "none" }} />}
                        </div>
                        <AnimatePresence>
                          {isSelected && !locked && (
                            <FieldToolbar key={`toolbar-${f.id}`} field={f} top={toolbarTop} left={toolbarLeft} recipients={recipients} locked={locked} onChangeRole={(role) => updateField(f.id, { role })} onToggleRequired={() => updateField(f.id, { required: !f.required })} onDelete={() => removeField(f.id)} />
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {pages.length > 0 && (
          <div style={{ width: THUMB_WIDTH + 14, flexShrink: 0, position: "sticky", top: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Pages</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pages.map((_, i) => (
                <button key={i} type="button" onClick={() => goToPage(i)} style={{ padding: 0, border: i === currentPage ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "var(--bg-surface)" }}>
                  <canvas ref={(el) => { thumbCanvasRefs.current[i] = el; }} style={{ display: "block", width: "100%" }} />
                  <span style={{ display: "block", fontSize: 10, textAlign: "center", padding: "3px 0", color: i === currentPage ? "var(--accent)" : "var(--text-muted)" }}>{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} pdfUrl={pdfUrl} fields={fields} roleLabel={(role) => resolveRecipient(role, recipients)?.name ?? role} />
      <SiteFooter />
    </>
  );
}
