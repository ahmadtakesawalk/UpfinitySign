// DEPLOY TO: app/dashboard/templates/[id]/page.tsx
"use client";

// Renders each PDF page to its own canvas via pdfjs-dist (all pages stacked
// vertically, scroll-to-browse), overlaying field previews positioned from
// FieldDefinition x/y/width/height. PDF coordinates are bottom-left origin
// (matches pdf-lib, used later for burn-in — see lib/signing/pdf-layout.ts).
//
// Left panel is a single slot that swaps content: the "Add fields" palette
// when nothing is selected, or a type-specific Field Details view when a
// field is selected — mirrors DocuSign's builder (no separate right-side
// panel). Selecting a field never changes its type; type is fixed at
// placement time, same as DocuSign (delete + re-add to change type).
//
// Zoom: BASE_PAGE_WIDTH is the 100% reference width in css px; the render
// width (`pageRenderWidth`) scales off `zoomPct`. The page column scrolls
// horizontally on its own so zooming in doesn't blow out the 3-column layout.
//
// Undo/redo: a linear history stack of full `fields` snapshots, committed on
// discrete edits (add/remove/inspector change/drag-release) — not on every
// pointermove, so one undo step is one meaningful action.

import { useEffect, useRef, useState, use as usePromise, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";
import { EditorChrome } from "@/components/EditorChrome";
import { Button } from "@/components/motion/Button";
import { Toggle } from "@/components/motion/Toggle";
import { IconButton } from "@/components/motion/IconButton";
import { Popover } from "@/components/motion/Popover";
import { useToast } from "@/components/motion/Toast";
import { AssistantChatPanel } from "@/components/assistant/AssistantChatPanel";
import type { FieldDefinition, FieldType } from "@/lib/signing/field-types";
import type { EditableLine, RgbColor } from "@/lib/signing/quick-edit"; // type-only — erased at compile time, doesn't pull pdf-lib/pdfjs into the client bundle
import { SiteFooter } from "@/components/SiteFooter";
import { PreviewModal } from "@/components/PreviewModal";

// Grouped palette, mirrors DocuSign's Signature / Contact Information /
// Inputs / Other sections instead of one flat stacked list.
const FIELD_GROUPS: { label: string; types: FieldType[] }[] = [
  { label: "Signature", types: ["signature", "initial", "date"] },
  { label: "Contact Information", types: ["full_name", "email", "company", "title"] },
  { label: "Inputs", types: ["text", "number", "checkbox", "radio_group", "dropdown"] },
  { label: "Actions", types: ["approve", "decline", "stamp"] },
  { label: "Other", types: ["note", "payment", "formula"] },
];

const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initial: "Initial",
  date: "Date",
  full_name: "Full name",
  email: "Email",
  company: "Company",
  title: "Title",
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  radio_group: "Radio group",
  dropdown: "Dropdown",
  note: "Note",
  payment: "Payment",
  attachment: "Attachment",
  custom: "Custom",
  formula: "Formula",
  approve: "Approve",
  decline: "Decline",
  stamp: "Stamp",
};

const ROLE_PRESETS = ["signer_1", "signer_2", "signer_3", "approver_1", "cc_1"];

const DEFAULT_SIZE: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 200, height: 50 },
  initial: { width: 80, height: 50 },
  date: { width: 130, height: 32 },
  full_name: { width: 190, height: 32 },
  email: { width: 190, height: 32 },
  company: { width: 190, height: 32 },
  title: { width: 170, height: 32 },
  text: { width: 170, height: 32 },
  number: { width: 130, height: 32 },
  checkbox: { width: 24, height: 24 },
  radio_group: { width: 180, height: 56 },
  dropdown: { width: 170, height: 32 },
  attachment: { width: 190, height: 32 },
  note: { width: 210, height: 40 },
  custom: { width: 170, height: 32 },
  formula: { width: 130, height: 32 },
  payment: { width: 170, height: 40 },
  approve: { width: 100, height: 36 },
  decline: { width: 100, height: 36 },
  stamp: { width: 120, height: 90 },
};

const BASE_PAGE_WIDTH = 760; // css px at 100% zoom — canvas + overlay + pixel-position fields all scale off this
const THUMB_WIDTH = 96; // css px — page-rail thumbnail width, independent of zoom

// Field box colors — matches the DocuSign reference (teal border/text on a
// light teal fill), not a design-system accent color, so these are their
// own constants rather than reusing --accent.
const FIELD_TEAL_BORDER = "#0d9488";
const FIELD_TEAL_BG = "rgba(13, 148, 136, 0.08)";
const FIELD_TEAL_TEXT = "#0f766e";

// ---------------------------------------------------------------------------
// Field-type icon set for the palette (inline SVG, no new dependency).
// ---------------------------------------------------------------------------
function FieldIcon({ type }: { type: FieldType }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "signature":
      return (
        <svg {...common}>
          <path d="M11.4 2.3a1.3 1.3 0 011.9 0l.4.4a1.3 1.3 0 010 1.9l-7.6 7.6-3 .7.7-3 7.6-7.6z" />
          <path d="M9.7 4l2.3 2.3" />
        </svg>
      );
    case "initial":
      return (
        <svg {...common}>
          <path d="M4 3v10M4 3h3.5a2 2 0 010 4H4m0 0h4a2 2 0 010 4H4" />
        </svg>
      );
    case "date":
      return (
        <svg {...common}>
          <rect x="2" y="3.5" width="12" height="10" rx="1.5" />
          <path d="M2 6.5h12M5 2v3M11 2v3" />
        </svg>
      );
    case "full_name":
      return (
        <svg {...common}>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
        </svg>
      );
    case "email":
      return (
        <svg {...common}>
          <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
          <path d="M2.5 4.5L8 9l5.5-4.5" />
        </svg>
      );
    case "company":
      return (
        <svg {...common}>
          <rect x="3" y="2" width="10" height="12" rx="1" />
          <path d="M6 5h1M9 5h1M6 8h1M9 8h1M6 11h1M9 11h1" />
        </svg>
      );
    case "title":
      return (
        <svg {...common}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M3 4h10M8 4v9" />
        </svg>
      );
    case "number":
      return (
        <svg {...common}>
          <path d="M5 2.5L3.5 13.5M12.5 2.5L11 13.5M2 6h12M1.5 10h12" />
        </svg>
      );
    case "checkbox":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M5 8l2 2 4-4" />
        </svg>
      );
    case "radio_group":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "dropdown":
      return (
        <svg {...common}>
          <rect x="2" y="4" width="12" height="8" rx="1.5" />
          <path d="M5.5 8l2 2 2-2" />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path d="M3 2.5h7L13 6v7.5H3z" />
          <path d="M10 2.5V6h3" />
        </svg>
      );
    case "payment":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v6M6.3 10c.3.7 1 1.1 1.9 1.1 1.1 0 2-.6 2-1.5s-.9-1.3-2-1.6c-1.1-.3-2-.7-2-1.6s.9-1.5 2-1.5c.9 0 1.6.4 1.9 1.1" />
        </svg>
      );
    case "formula":
      return (
        <svg {...common}>
          <rect x="2.5" y="2" width="11" height="12" rx="1.5" />
          <path d="M5 5.5h6M5 8h2M9 8h2M5 10.5h2M9 10.5h2" />
        </svg>
      );
    case "approve":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M5.3 8.2l1.8 1.8 3.6-3.8" />
        </svg>
      );
    case "decline":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      );
    case "stamp":
      return (
        <svg {...common}>
          <circle cx="8" cy="6.2" r="3.2" />
          <path d="M8 9.4V14M5 14h6M5.5 11.5h5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        </svg>
      );
  }
}

// Small chrome icons shared by the toolbar + collapsible sections.
function ChromeIcon({ name }: { name: "duplicate" | "trash" | "gear" | "chevron" | "back" }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "duplicate":
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
          <path d="M2.5 10.5v-7a1 1 0 011-1h7" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M4.5 4.5l.6 8.4a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8.4" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 2.5v1.3M8 12.2v1.3M12.3 5.7l-1.1.65M4.8 9.65l-1.1.65M13.5 8h-1.3M3.8 8H2.5M12.3 10.3l-1.1-.65M4.8 6.35l-1.1-.65" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common} width={10} height={10} strokeWidth={1.8}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      );
    case "back":
      return (
        <svg {...common} width={16} height={16} strokeWidth={1.6}>
          <path d="M10 3L5 8l5 5" />
        </svg>
      );
  }
}

// Zoom control — a real slider (not a dropdown) with an animated accent
// fill and custom thumb, matching the rest of the toolbar's motion feel.
function ZoomSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const min = 50;
  const max = 300;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <style>{`
        .zoom-range { appearance: none; -webkit-appearance: none; background: transparent; height: 20px; margin: 0; cursor: pointer; }
        .zoom-range::-webkit-slider-runnable-track { background: transparent; height: 4px; }
        .zoom-range::-moz-range-track { background: transparent; height: 4px; }
        .zoom-range::-webkit-slider-thumb {
          appearance: none; -webkit-appearance: none;
          width: 14px; height: 14px; margin-top: -5px;
          border-radius: 50%; background: var(--accent);
          border: 2px solid var(--bg-surface);
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
          transition: transform var(--transition-fast, 100ms) ease;
        }
        .zoom-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .zoom-range::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%; background: var(--accent);
          border: 2px solid var(--bg-surface); box-shadow: 0 1px 3px rgba(0,0,0,0.25); cursor: pointer;
        }
      `}</style>
      <div style={{ position: "relative", width: 110, height: 20, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "var(--accent)", transition: "width var(--transition-fast, 100ms) ease" }} />
        </div>
        <input
          type="range"
          className="zoom-range"
          min={min}
          max={max}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ position: "relative", width: "100%" }}
          title="Zoom"
        />
      </div>
      <span style={{ fontSize: 12, color: "var(--text-secondary)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}%</span>
    </div>
  );
}

function roleInitials(role: string): string {
  return (
    role
      .split("_")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

// "signer_1" -> "Signer 1"
function roleLabel(role: string): string {
  const [prefix, ordinal] = role.split("_");
  if (!prefix) return role;
  return `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}${ordinal ? ` ${ordinal}` : ""}`;
}

// Recipient-role selector above the field-type palette — templates don't
// have real recipients yet, so this picks which role-preset new fields
// default to, shown the same way the envelope editor shows a real person.
interface RolePickerProps { activeRole: string; onChange: (role: string) => void; }
function RolePicker({ activeRole, onChange }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--accent-soft)", cursor: "pointer" }}
      >
        <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {roleInitials(activeRole)}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{roleLabel(activeRole)}</span>
        <ChromeIcon name="chevron" />
      </button>
      <Popover open={open} style={{ top: 42, left: 0, right: 0, minWidth: "100%" }}>
        {ROLE_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => { onChange(r); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 12.5, border: "none", background: r === activeRole ? "var(--accent-soft)" : "transparent", borderRadius: 5, cursor: "pointer", color: "var(--text-primary)" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{roleInitials(r)}</span>
            {roleLabel(r)}
          </button>
        ))}
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type visual preview rendered *inside* each field box on the canvas —
// real native inputs (checkbox/radio/select), not styled lookalike divs.
// pointerEvents:"none" so a stray click passes through to the parent's drag
// handler instead of toggling the control while positioning it.
// ---------------------------------------------------------------------------
function FieldPreview({ f }: { f: FieldDefinition }) {
  switch (f.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={f.defaultValue === "true"}
          readOnly
          style={{ width: "60%", height: "60%", accentColor: FIELD_TEAL_BORDER, pointerEvents: "none" }}
        />
      );
    case "dropdown": {
      const opts = f.options && f.options.length > 0 ? f.options : ["Select…"];
      return (
        <select
          disabled
          value={f.defaultValue ?? opts[0]}
          style={{
            width: "100%",
            height: "100%",
            fontSize: 10,
            border: "none",
            background: "transparent",
            color: FIELD_TEAL_TEXT,
            pointerEvents: "none",
          }}
        >
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    case "radio_group": {
      const opts = f.options?.slice(0, 3) ?? ["Option 1", "Option 2"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, fontSize: 9, lineHeight: 1.3, width: "100%", padding: "3px 6px", pointerEvents: "none", overflow: "hidden" }}>
          {opts.map((o, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <input
                type="radio"
                checked={f.defaultValue === o}
                readOnly
                style={{ width: 9, height: 9, minWidth: 9, flexShrink: 0, accentColor: FIELD_TEAL_BORDER }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: FIELD_TEAL_TEXT }}>{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case "signature":
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Sign</span>
          <FieldIcon type="signature" />
        </div>
      );
    case "initial":
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Initial</span>
          <FieldIcon type="initial" />
        </div>
      );
    case "date":
      return <span style={{ fontSize: 10, color: FIELD_TEAL_TEXT }}>MM / DD / YYYY</span>;
    case "payment": {
      const amt = f.paymentConfig ? (f.paymentConfig.amountCents / 100).toFixed(2) : "0.00";
      const cur = (f.paymentConfig?.currency ?? "usd").toUpperCase();
      return (
        <span style={{ fontSize: 11, fontWeight: 600, color: FIELD_TEAL_TEXT }}>
          {cur} {amt}
        </span>
      );
    }
    case "note":
      return (
        <span style={{ fontSize: 9, color: FIELD_TEAL_TEXT, padding: "0 4px" }}>
          {f.customConfig?.label ?? "Note"}
        </span>
      );
    case "approve":
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", background: "var(--success-bg)", color: "var(--success)", fontSize: 11, fontWeight: 600, borderRadius: 4 }}>
          <FieldIcon type="approve" /> Approve
        </div>
      );
    case "decline":
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 11, fontWeight: 600, borderRadius: 4 }}>
          <FieldIcon type="decline" /> Decline
        </div>
      );
    case "stamp":
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: FIELD_TEAL_TEXT }}>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Stamp</span>
          <FieldIcon type="stamp" />
        </div>
      );
    default:
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: FIELD_TEAL_TEXT, padding: "0 4px", overflow: "hidden" }}>
          <FieldIcon type={f.type} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FIELD_LABELS[f.type] ?? f.type}</span>
        </div>
      );
  }
}

interface FieldToolbarProps {
  field: FieldDefinition;
  top: number;
  left: number;
  onChangeRole: (role: string) => void;
  onToggleRequired: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

// Floating pill toolbar anchored above the selected field — role badge,
// Required toggle, duplicate/delete. Settings/full editing lives in the
// left panel, which switches to this field automatically on selection.
function FieldToolbar({ field, top, left, onChangeRole, onToggleRequired, onDuplicate, onDelete }: FieldToolbarProps) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
      transition={reduceMotion ? { duration: 0.01 } : springs.micro}
      style={{
        position: "absolute",
        top,
        left,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 8px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow-md, 0 6px 20px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08))",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setRoleMenuOpen((o) => !o)}
          title={field.role}
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "none",
            background: "var(--accent-soft)",
            color: "var(--accent-dark)",
            fontSize: 10.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "transform var(--transition-fast, 100ms ease)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.06)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          {roleInitials(field.role)}
        </button>
        <Popover open={roleMenuOpen} style={{ top: 32, left: 0, minWidth: 110 }}>
          {ROLE_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChangeRole(r);
                setRoleMenuOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                fontSize: 12,
                border: "none",
                background: r === field.role ? "var(--accent-soft)" : "transparent",
                borderRadius: 5,
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              {r}
            </button>
          ))}
        </Popover>
      </div>

      <div style={{ width: 1, height: 18, background: "var(--border)" }} />

      <Toggle checked={field.required} onChange={onToggleRequired} label="Required" />

      <div style={{ width: 1, height: 18, background: "var(--border)" }} />

      <IconButton onClick={onDuplicate} title="Duplicate">
        <ChromeIcon name="duplicate" />
      </IconButton>
      <IconButton onClick={onDelete} title="Delete" variant="danger">
        <ChromeIcon name="trash" />
      </IconButton>
    </motion.div>
  );
}

// Collapsible section used inside the field details panel (Formatting /
// Location and Autoplace / Advanced) — mirrors the DocuSign field panel.
function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {title}
        <span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform var(--transition-fast, 100ms ease)", display: "flex", color: "var(--text-muted)" }}>
          <ChromeIcon name="chevron" />
        </span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

interface FieldDetailsPanelProps {
  field: FieldDefinition;
  fields: FieldDefinition[];
  pages: { widthPts: number; heightPts: number }[];
  fitWidth: number; // live 100%-zoom reference width — see the ResizeObserver note above; must match what the canvas actually renders at, not the stale BASE_PAGE_WIDTH constant
  onUpdate: (patch: Partial<FieldDefinition>) => void;
  onRemove: () => void;
  onBack: () => void;
  onAutoplace: () => void;
}

// Type-specific left-panel inspector — replaces the old generic right-side
// "Field details" card. The toggles + Data label/Tooltip + collapsible
// Formatting/Location/Advanced shell is shared across every type; the body
// in between (options list, payment amount, formula calculator, etc.)
// varies by `field.type`, same as DocuSign's own panel.
function FieldDetailsPanel({ field, fields, pages, fitWidth, onUpdate, onRemove, onBack, onAutoplace }: FieldDetailsPanelProps) {
  const dims = pages[field.page] ?? { widthPts: 612, heightPts: 792 };
  const baseScale = fitWidth / dims.widthPts;
  const pxLeft = Math.round(field.x * baseScale);
  const pxTop = Math.round((dims.heightPts - field.y - field.height) * baseScale);

  function setPxLeft(px: number) {
    onUpdate({ x: px / baseScale });
  }
  function setPxTop(px: number) {
    onUpdate({ y: dims.heightPts - field.height - px / baseScale });
  }

  const exprRef = useRef<HTMLTextAreaElement | null>(null);
  const insertableFields = fields.filter((f) => f.id !== field.id && ["text", "number", "formula", "date"].includes(f.type));

  function insertIntoExpression(token: string) {
    const el = exprRef.current;
    const current = field.formulaConfig?.expression ?? "";
    if (!el) {
      onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: current + token } });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: next } });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          onClick={onBack}
          title="Back"
          style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: "var(--text-secondary)" }}
        >
          <ChromeIcon name="back" />
        </button>
        <h3 style={{ fontSize: 14, margin: 0 }}>{FIELD_LABELS[field.type] ?? field.type}</h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>Read only</span>
          <Toggle checked={Boolean(field.readOnly)} onChange={() => onUpdate({ readOnly: !field.readOnly })} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>Required</span>
          <Toggle checked={field.required} onChange={() => onUpdate({ required: !field.required })} />
        </div>

        <div>
          <label className="field-label">Assigned to (role)</label>
          <input
            list="role-presets-panel"
            value={field.role}
            onChange={(e) => onUpdate({ role: e.target.value })}
            placeholder="signer_1"
          />
          <datalist id="role-presets-panel">
            {ROLE_PRESETS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>

        <div>
          <label className="field-label">Data label</label>
          <input
            value={field.dataLabel ?? ""}
            onChange={(e) => onUpdate({ dataLabel: e.target.value })}
            placeholder={`${FIELD_LABELS[field.type]} ${field.id}`}
          />
        </div>
        <div>
          <label className="field-label">Tooltip</label>
          <textarea
            rows={2}
            value={field.tooltip ?? ""}
            onChange={(e) => onUpdate({ tooltip: e.target.value })}
            placeholder="This text should be short and helpful"
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>

        {field.type === "checkbox" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              style={{ width: "auto", height: "auto" }}
              checked={field.defaultValue === "true"}
              onChange={(e) => onUpdate({ defaultValue: e.target.checked ? "true" : undefined })}
            />
            Pre-checked by default
          </label>
        )}

        {(field.type === "radio_group" || field.type === "dropdown") && (
          <div>
            <label className="field-label">{field.type === "radio_group" ? "Radio button values" : "Dropdown values"}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {(field.options ?? []).map((opt, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {field.type === "radio_group" && (
                    <input
                      type="radio"
                      checked={field.defaultValue === opt}
                      onChange={() => onUpdate({ defaultValue: opt })}
                      style={{ width: "auto", height: "auto", accentColor: "var(--accent-dark)" }}
                      title="Set as default selected option"
                    />
                  )}
                  <input
                    value={opt}
                    onChange={(e) => {
                      const next = [...(field.options ?? [])];
                      const prevVal = next[idx];
                      next[idx] = e.target.value;
                      onUpdate({ options: next, defaultValue: field.defaultValue === prevVal ? e.target.value : field.defaultValue });
                    }}
                    style={{ flex: 1 }}
                  />
                  <IconButton
                    onClick={() => {
                      const next = (field.options ?? []).filter((_, i) => i !== idx);
                      onUpdate({ options: next, defaultValue: field.defaultValue === opt ? undefined : field.defaultValue });
                    }}
                    title="Remove"
                    variant="danger"
                  >
                    <ChromeIcon name="trash" />
                  </IconButton>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 12 }}
                onClick={() => onUpdate({ options: [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`] })}
              >
                + Add value
              </button>
              {field.defaultValue && field.type === "radio_group" && (
                <button
                  type="button"
                  onClick={() => onUpdate({ defaultValue: undefined })}
                  style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--accent)", cursor: "pointer" }}
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>
        )}

        {field.type === "payment" && (
          <>
            <div>
              <label className="field-label">Description (shown at checkout)</label>
              <input
                value={field.paymentConfig?.label ?? ""}
                onChange={(e) => onUpdate({ paymentConfig: { label: e.target.value, amountCents: field.paymentConfig?.amountCents ?? 0, currency: field.paymentConfig?.currency ?? "usd" } })}
                placeholder="e.g. Deposit"
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Amount</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={field.paymentConfig ? (field.paymentConfig.amountCents / 100).toFixed(2) : ""}
                  onChange={(e) => {
                    const cents = Math.round(Number(e.target.value || 0) * 100);
                    onUpdate({ paymentConfig: { label: field.paymentConfig?.label ?? "", currency: field.paymentConfig?.currency ?? "usd", amountCents: cents } });
                  }}
                />
              </div>
              <div style={{ width: 90 }}>
                <label className="field-label">Currency</label>
                <select
                  value={field.paymentConfig?.currency ?? "usd"}
                  onChange={(e) => onUpdate({ paymentConfig: { label: field.paymentConfig?.label ?? "", amountCents: field.paymentConfig?.amountCents ?? 0, currency: e.target.value } })}
                >
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="gbp">GBP</option>
                  <option value="cad">CAD</option>
                </select>
              </div>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Requires Stripe connected in Settings — funds go to your own connected account, fixed amount only.
            </p>
          </>
        )}

        {field.type === "note" && (
          <div>
            <label className="field-label">Note text</label>
            <textarea
              rows={3}
              value={field.customConfig?.label ?? ""}
              onChange={(e) => onUpdate({ customConfig: { ...(field.customConfig ?? { label: "" }), label: e.target.value } })}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        )}

        {field.type === "formula" && (
          <div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
              Calculates a value from number and date fields in this document — updates automatically once every field it references is filled in.
            </p>
            <label className="field-label">Formula</label>
            <textarea
              ref={exprRef}
              rows={2}
              value={field.formulaConfig?.expression ?? ""}
              onChange={(e) => onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "" }), expression: e.target.value } })}
              placeholder="e.g. quantity * unit_price"
              style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
              {(["+", "−", "×", "÷", "(", ")"] as const).map((op) => {
                const tokenMap: Record<string, string> = { "−": "-", "×": "*", "÷": "/" };
                return (
                  <button
                    key={op}
                    type="button"
                    className="secondary"
                    onClick={() => insertIntoExpression(tokenMap[op] ?? op)}
                    style={{ width: 32, height: 32, padding: 0, fontSize: 15, fontWeight: 600, flexShrink: 0 }}
                  >
                    {op}
                  </button>
                );
              })}
              <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 2px" }} />
              {(["<", ">", "<=", ">=", "<>"] as const).map((op) => (
                <button
                  key={op}
                  type="button"
                  className="secondary"
                  onClick={() => insertIntoExpression(op)}
                  style={{ minWidth: 32, height: 32, padding: "0 6px", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}
                  title={op === "<>" ? "not equal to" : undefined}
                >
                  {op}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <label className="field-label">Functions</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  { label: "TODAY()", insert: "TODAY()" },
                  { label: "DAY( )", insert: "DAY()" },
                  { label: "MONTH( )", insert: "MONTH()" },
                  { label: "YEAR( )", insert: "YEAR()" },
                  { label: "DAYS_IN_MONTH( )", insert: "DAYS_IN_MONTH()" },
                  { label: "MIN(a, b)", insert: "MIN()" },
                  { label: "MAX(a, b)", insert: "MAX()" },
                  { label: "ROUND(val, decimals)", insert: "ROUND()" },
                ].map((fn) => (
                  <button
                    key={fn.label}
                    type="button"
                    className="secondary"
                    style={{ fontSize: 11, padding: "4px 8px", fontFamily: "monospace" }}
                    onClick={() => insertIntoExpression(fn.insert)}
                    title={fn.label.includes("DAY") || fn.label.startsWith("TODAY") ? "Takes a date field, converted to a day count" : undefined}
                  >
                    {fn.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>
                Date functions take a date field's value directly — no conversion needed.
              </p>
            </div>
            {insertableFields.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <label className="field-label">Insert field</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {insertableFields.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="secondary"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={() => insertIntoExpression(f.id)}
                    >
                      {f.dataLabel || `${FIELD_LABELS[f.type]} (${f.role})`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <label className="field-label" style={{ marginBottom: 0 }}>Decimal places</label>
              <input
                type="number"
                min={0}
                max={6}
                value={field.formulaConfig?.decimalPlaces ?? 2}
                onChange={(e) => onUpdate({ formulaConfig: { ...(field.formulaConfig ?? { label: "", expression: "" }), decimalPlaces: Number(e.target.value) } })}
                style={{ width: 64 }}
              />
            </div>
          </div>
        )}

        <CollapsibleSection title="Formatting">
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No formatting options yet for this field type.</p>
        </CollapsibleSection>

        <CollapsibleSection title="Location and Autoplace" defaultOpen>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Pixels from left</label>
              <input type="number" value={pxLeft} onChange={(e) => setPxLeft(Number(e.target.value) || 0)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Pixels from top</label>
              <input type="number" value={pxTop} onChange={(e) => setPxTop(Number(e.target.value) || 0)} />
            </div>
          </div>
          <button type="button" className="secondary" style={{ marginTop: 10, width: "100%", fontSize: 12 }} onClick={onAutoplace}>
            Set Up Autoplace
          </button>
        </CollapsibleSection>

        <CollapsibleSection title="Advanced">
          <label className="field-label">Show only if</label>
          <select
            value={field.visibleIf?.fieldId ?? ""}
            onChange={(e) => {
              if (!e.target.value) onUpdate({ visibleIf: undefined });
              else onUpdate({ visibleIf: { fieldId: e.target.value, equals: field.visibleIf?.equals ?? "true" } });
            }}
            style={{ marginBottom: 8 }}
          >
            <option value="">Always visible</option>
            {fields
              .filter((f) => f.id !== field.id && f.type !== "note" && f.type !== "formula")
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.dataLabel || `${FIELD_LABELS[f.type]} (${f.role})`}
                </option>
              ))}
          </select>
          {field.visibleIf && (
            <input
              placeholder={
                fields.find((f) => f.id === field.visibleIf?.fieldId)?.type === "checkbox" ? "true or false" : "value to match"
              }
              value={field.visibleIf.equals}
              onChange={(e) => onUpdate({ visibleIf: { ...field.visibleIf!, equals: e.target.value } })}
            />
          )}
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Only shown to the signer — and only counted as required — when the chosen field's value exactly matches what you enter here.
          </p>
        </CollapsibleSection>

        <button type="button" className="danger" style={{ fontSize: 13 }} onClick={onRemove}>
          Delete
        </button>
      </div>
    </div>
  );
}

function TemplateBuilderInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const docId = useSearchParams().get("doc"); // present when editing an additional document instead of the template's primary one — see TemplateDocument in schema.prisma
  const { show } = useToast();
  const reduceMotion = useReducedMotion();

  const [loading, setLoading] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // Quick Edit — line-level text editing on the underlying document. See
  // lib/signing/quick-edit.ts for the actual mechanic and its documented
  // limitations (Helvetica approximation, opaque-white redaction).
  const [quickEditMode, setQuickEditMode] = useState(false);
  const [editableLines, setEditableLines] = useState<EditableLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({}); // lineId -> staged new text, not yet applied
  const [applyingEdits, setApplyingEdits] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [savedFields, setSavedFields] = useState<FieldDefinition[]>([]);
  const [pages, setPages] = useState<{ widthPts: number; heightPts: number }[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolbarOpenId, setToolbarOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [leftTab, setLeftTab] = useState<"manual" | "assistant">("manual");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [aiReviewedAt, setAiReviewedAt] = useState<string | null>(null);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [selfServeEnabled, setSelfServeEnabled] = useState(false);
  const [selfServeUrl, setSelfServeUrl] = useState<string | null>(null);
  const [togglingSelfServe, setTogglingSelfServe] = useState(false);
  const [selfServeMenuOpen, setSelfServeMenuOpen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [placingType, setPlacingType] = useState<FieldType | null>(null);
  const [placingGhost, setPlacingGhost] = useState<{ pageIdx: number; x: number; y: number } | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  // "Who am I placing fields for" — templates have no real recipients yet
  // (those get resolved at send time), so this picks a role preset instead.
  // Replaces the old auto-distribute-next-empty-role behavior in
  // nextRoleForType with an explicit, visible choice, mirroring DocuSign.
  const [activeRole, setActiveRole] = useState<string>(ROLE_PRESETS[0]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const pdfDocRef = useRef<any>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const thumbCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pageColumnRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; field: FieldDefinition } | null>(null);
  const historyRef = useRef<FieldDefinition[][]>([]);

  // 100% zoom = "fills whatever width this column actually has" — measured
  // live via ResizeObserver rather than a fixed pixel guess, so the
  // default view is already large (like DocuSign's) regardless of how
  // much room the surrounding page/shell/sidebar leaves it.
  const [fitWidth, setFitWidth] = useState(BASE_PAGE_WIDTH);
  useEffect(() => {
    const el = pageColumnRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 100) setFitWidth(Math.floor(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isDirty = JSON.stringify(fields) !== JSON.stringify(savedFields);
  const pageRenderWidth = Math.round(fitWidth * (zoomPct / 100));

  function pushHistory(next: FieldDefinition[]) {
    const truncated = historyRef.current.slice(0, historyIndex + 1);
    truncated.push(next);
    historyRef.current = truncated;
    setHistoryIndex(truncated.length - 1);
  }

  function handleUndo() {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setFields(historyRef.current[newIndex]);
  }

  function handleRedo() {
    if (historyIndex >= historyRef.current.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setFields(historyRef.current[newIndex]);
  }

  useEffect(() => {
    (async () => {
      const res = docId
        ? await fetch(`/api/dashboard/templates/${id}/documents/${docId}`)
        : await fetch(`/api/dashboard/templates/${id}`);
      if (res.status === 401) return router.push("/dashboard/login");
      if (!res.ok) {
        show({ message: `Couldn't load this document.`, type: "error" });
        return router.push(`/dashboard/templates/${id}`);
      }
      const json = await res.json();
      const initialFields = json.field_map ?? [];
      setTemplateName(docId ? json.name : json.name);
      setPdfUrl(json.pdf_url);
      setFields(initialFields);
      setSavedFields(initialFields);
      historyRef.current = [initialFields];
      setHistoryIndex(0);
      // AI-review gate and self-serve links are template-level concepts —
      // an additional document doesn't have its own, it inherits the
      // primary document's review status implicitly via createEnvelope's
      // existing guard (which checks the Template, not each document).
      setAiDrafted(docId ? false : Boolean(json.ai_drafted));
      setAiReviewedAt(docId ? null : (json.ai_reviewed_at ?? null));
      setSelfServeEnabled(docId ? false : Boolean(json.self_serve_enabled));
      setSelfServeUrl(docId ? null : (json.self_serve_url ?? null));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, docId]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
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

    return () => {
      cancelled = true;
      pdfDocRef.current = null;
    };
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

    return () => {
      cancelled = true;
    };
    // fitWidth is a real dependency (pageRenderWidth derives from it) —
    // without it, the canvas raster stays stuck at whatever size it was
    // first rendered while the container's CSS width keeps updating,
    // stretching a stale image and making the document look soft/wrongly
    // sized. This was previously missing with an eslint-disable comment
    // suppressing the exact warning that would have caught it.
  }, [pages, zoomPct, fitWidth]);

  // Thumbnails are independent of zoomPct — the rail is a fixed overview.
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

    return () => {
      cancelled = true;
    };
  }, [pages]);

  useEffect(() => {
    if (pages.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (!best || entry.intersectionRatio > best.ratio) best = { idx, ratio: entry.intersectionRatio };
        }
        if (best) setCurrentPage(best.idx);
      },
      { threshold: [0.15, 0.35, 0.6] }
    );
    pageContainerRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && placingType) {
        setPlacingType(null);
        setPlacingGhost(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        // Don't hijack Backspace/Delete while the user is typing in a
        // field-details input (Data label, Tooltip, formula expression,
        // etc.) — only act on it when focus is on the canvas itself.
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        e.preventDefault();
        removeField(selectedId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingType, selectedId]);

  function goToPage(idx: number) {
    pageContainerRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pdfToScreen(f: FieldDefinition, pageIdx: number) {
    const dims = pages[pageIdx];
    if (!dims) return { left: 0, top: 0, width: 0, height: 0 };
    const s = pageRenderWidth / dims.widthPts;
    return {
      left: f.x * s,
      top: (dims.heightPts - f.y - f.height) * s,
      width: f.width * s,
      height: f.height * s,
    };
  }

  function updateField(fieldId: string, patch: Partial<FieldDefinition>) {
    setFields((prev) => {
      const next = prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
      if (!dragState.current) pushHistory(next);
      return next;
    });
  }

  // Places a new field at an exact PDF-point position — called from the
  // canvas click handler once placement mode (placingType) is armed, not
  // called directly from the palette anymore.
  function createFieldAt(type: FieldType, page: number, xPts: number, yPts: number) {
    const size = DEFAULT_SIZE[type];
    const id = `f_${Date.now()}`;
    const newField: FieldDefinition = {
      id,
      page,
      type,
      role: activeRole,
      x: Math.max(0, xPts),
      y: Math.max(0, yPts),
      width: size.width,
      height: size.height,
      required: type !== "note",
      ...(type === "radio_group" || type === "dropdown" ? { options: ["Option 1", "Option 2"] } : {}),
    };
    setFields((prev) => {
      const next = [...prev, newField];
      pushHistory(next);
      return next;
    });
    setSelectedId(id);
    setPlacingType(null);
  }

  function duplicateField(field: FieldDefinition) {
    const newField: FieldDefinition = { ...field, id: `f_${Date.now()}`, x: field.x + 20, y: Math.max(0, field.y - 20) };
    setFields((prev) => {
      const next = [...prev, newField];
      pushHistory(next);
      return next;
    });
    setSelectedId(newField.id);
  }

  function removeField(fieldId: string) {
    setFields((prev) => {
      const next = prev
        .filter((f) => f.id !== fieldId)
        .map((f) => (f.visibleIf?.fieldId === fieldId ? { ...f, visibleIf: undefined } : f));
      pushHistory(next);
      return next;
    });
    if (selectedId === fieldId) { setSelectedId(null); setToolbarOpenId(null); }
  }

  function onPointerDownField(e: React.PointerEvent, field: FieldDefinition, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedId(field.id);
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

    if (drag.mode === "move") {
      updateField(drag.id, {
        x: Math.max(0, drag.field.x + dxPts),
        y: Math.max(0, drag.field.y - dyPts),
      });
    } else {
      updateField(drag.id, {
        width: Math.max(16, drag.field.width + dxPts),
        height: Math.max(12, drag.field.height - dyPts),
      });
    }
  }

  function onPointerUp() {
    if (dragState.current) {
      dragState.current = null;
      setFields((prev) => {
        pushHistory(prev);
        return prev;
      });
    }
  }

  async function toggleQuickEdit() {
    if (quickEditMode) {
      // Leaving without applying — discard any staged-but-unapplied edits
      // rather than silently keeping them around for next time.
      setQuickEditMode(false);
      setEditingLineId(null);
      setPendingEdits({});
      setQuickEditError(null);
      return;
    }
    setLoadingLines(true);
    setQuickEditError(null);
    try {
      const res = await fetch(`/api/dashboard/templates/${id}/text-runs`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't read this document's text.");
      setEditableLines(json.lines ?? []);
      setQuickEditMode(true);
    } catch (err: any) {
      show({ message: err.message ?? "Couldn't start Quick Edit.", type: "error" });
    } finally {
      setLoadingLines(false);
    }
  }

  // Real, working color extraction — not guessed. Since the page is already
  // rendered to canvas for display, this samples actual pixels rather than
  // trying to parse fill-color PDF operators (which pdf.js's getTextContent
  // doesn't expose per-item anyway). Background: sampled just outside the
  // line's own box, in the surrounding page area. Text color: a grid of
  // sample points across the line, picking whichever point differs most
  // from the background — a real heuristic (most document text is darker
  // than its background), not perfect on a line with mixed-color text.
  function sampleLineColors(line: EditableLine): { textColor: RgbColor; backgroundColor: RgbColor } | null {
    const canvas = canvasRefs.current[line.page];
    const dims = pages[line.page];
    if (!canvas || !dims) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const scale = pageRenderWidth / dims.widthPts;
    const cssLeft = line.x * scale;
    const cssTop = (dims.heightPts - line.y - line.height) * scale;
    const cssWidth = line.width * scale;
    const cssHeight = line.height * scale;

    const bgX = Math.max(0, Math.round((cssLeft + 2) * dpr));
    const bgY = Math.max(0, Math.round((cssTop - 3) * dpr));
    const bgPixel = ctx.getImageData(Math.min(bgX, canvas.width - 1), Math.min(bgY, canvas.height - 1), 1, 1).data;
    const backgroundColor: RgbColor = { r: bgPixel[0] / 255, g: bgPixel[1] / 255, b: bgPixel[2] / 255 };
    const bgLum = 0.299 * bgPixel[0] + 0.587 * bgPixel[1] + 0.114 * bgPixel[2];

    let best: RgbColor = { r: 0, g: 0, b: 0 };
    let maxDist = -1;
    const STEPS = 6;
    for (let sx = 0; sx < STEPS; sx++) {
      for (let sy = 0; sy < STEPS; sy++) {
        const px = Math.round((cssLeft + (cssWidth * (sx + 0.5)) / STEPS) * dpr);
        const py = Math.round((cssTop + (cssHeight * (sy + 0.5)) / STEPS) * dpr);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        const lum = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
        const dist = Math.abs(lum - bgLum);
        if (dist > maxDist) {
          maxDist = dist;
          best = { r: pixel[0] / 255, g: pixel[1] / 255, b: pixel[2] / 255 };
        }
      }
    }
    return { textColor: maxDist > 15 ? best : { r: 0, g: 0, b: 0 }, backgroundColor };
  }

  async function applyQuickEdits() {
    const edited = editableLines.filter((l) => l.id in pendingEdits);
    const edits = edited.map((l) => {
      const sampled = sampleLineColors(l);
      return {
        page: l.page, x: l.x, y: l.y, width: l.width, height: l.height,
        newText: pendingEdits[l.id],
        fontFamily: l.fontFamily, bold: l.bold, italic: l.italic,
        textColor: sampled?.textColor, backgroundColor: sampled?.backgroundColor,
      };
    });
    if (edits.length === 0) {
      setQuickEditMode(false);
      return;
    }
    setApplyingEdits(true);
    setQuickEditError(null);
    try {
      const res = await fetch(`/api/dashboard/templates/${id}/quick-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't apply those edits.");
      setPdfUrl(json.pdf_url); // triggers the existing render effect to redraw the canvas with the edited PDF
      setPendingEdits({});
      setEditingLineId(null);
      setQuickEditMode(false);
      show({ message: `${edits.length} edit${edits.length === 1 ? "" : "s"} applied.`, type: "success" });
    } catch (err: any) {
      setQuickEditError(err.message ?? "Couldn't apply those edits.");
    } finally {
      setApplyingEdits(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = docId
        ? await fetch(`/api/dashboard/templates/${id}/documents/${docId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ field_map: fields }),
          })
        : await fetch(`/api/dashboard/templates/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ field_map: fields }),
          });
      if (!res.ok) {
        const json = await res.json();
        show({ message: json.error ?? "Couldn't save.", type: "error" });
        return;
      }
      setSavedFields(fields);
      show({ message: "Fields saved.", type: "success" });
    } catch {
      show({ message: "Network error — try saving again.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setFields(savedFields);
    setSelectedId(null);
    setToolbarOpenId(null);
    historyRef.current = [savedFields];
    setHistoryIndex(0);
    show({ message: "Changes discarded.", type: "info" });
  }

  async function handleToggleSelfServe() {
    setTogglingSelfServe(true);
    try {
      if (selfServeEnabled) {
        const res = await fetch(`/api/dashboard/templates/${id}/self-serve-link`, { method: "DELETE" });
        if (!res.ok) {
          const json = await res.json();
          show({ message: json.error ?? "Couldn't disable this.", type: "error" });
          return;
        }
        setSelfServeEnabled(false);
        show({ message: "Self-serve link disabled.", type: "info" });
      } else {
        const res = await fetch(`/api/dashboard/templates/${id}/self-serve-link`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          show({ message: json.error ?? "Couldn't enable this.", type: "error" });
          return;
        }
        setSelfServeEnabled(true);
        setSelfServeUrl(json.url);
        show({ message: "Self-serve link enabled.", type: "success" });
      }
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setTogglingSelfServe(false);
    }
  }

  async function handleMarkReviewed() {
    setMarkingReviewed(true);
    try {
      const res = await fetch(`/api/dashboard/templates/${id}/mark-reviewed`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        show({ message: json.error ?? "Couldn't mark this reviewed.", type: "error" });
        return;
      }
      setAiReviewedAt(new Date().toISOString());
      show({ message: "Marked reviewed — this document can now be sent.", type: "success" });
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setMarkingReviewed(false);
    }
  }

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/dashboard/templates/${id}/duplicate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Couldn't duplicate this template.", type: "error" });
        return;
      }
      show({ message: "Template duplicated.", type: "success" });
      router.push(`/dashboard/templates/${json.template_id}`);
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setDuplicating(false);
    }
  }

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  if (loading) {
    return (
      <>
        <EditorChrome backHref="/dashboard/templates" crumbs={[{ label: "Templates", href: "/dashboard/templates" }, { label: "Fields" }]} />
        <div className="page-shell"><p>Loading template…</p></div>
      </>
    );
  }

  const needsReview = aiDrafted && !aiReviewedAt;

  return (
    <>
      <EditorChrome
        backHref="/dashboard/templates"
        crumbs={[{ label: "Templates", href: "/dashboard/templates" }, { label: templateName }]}
        actions={
          <>
            <span style={{ fontSize: 12, color: isDirty ? "var(--warning)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
              {saving ? "Saving…" : isDirty ? "Unsaved changes" : "All changes saved"}
            </span>
            {!docId && (
              <Button variant="secondary" onClick={toggleQuickEdit} disabled={loadingLines}>
                {loadingLines ? "Loading…" : quickEditMode ? "Exit Quick Edit" : "Quick Edit"}
              </Button>
            )}
            {quickEditMode && Object.keys(pendingEdits).length > 0 && (
              <Button variant="primary" onClick={applyQuickEdits} disabled={applyingEdits}>
                {applyingEdits ? "Applying…" : `Apply ${Object.keys(pendingEdits).length} edit${Object.keys(pendingEdits).length === 1 ? "" : "s"}`}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPreviewOpen(true)}>Preview</Button>
            {needsReview ? (
              <Button variant="secondary" disabled title="AI-drafted documents must be reviewed before they can be used to send an envelope">
                Use this template →
              </Button>
            ) : (
              <a href={`/dashboard/envelopes/new?template=${id}`} style={{ textDecoration: "none" }}>
                <Button variant="secondary">Use this template →</Button>
              </a>
            )}
            <div style={{ position: "relative" }}>
              <Button variant="secondary" onClick={() => setSelfServeMenuOpen((o) => !o)}>
                Self-serve link {selfServeEnabled && <span style={{ color: "var(--success)" }}>●</span>}
              </Button>
              <Popover open={selfServeMenuOpen} origin="top right" style={{ top: 44, right: 0, minWidth: 260 }}>
                <div style={{ padding: 8 }}>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                    A public link anyone can use to fill in their own details and sign this document — single-signer templates only.
                  </p>
                  <Button variant={selfServeEnabled ? "secondary" : "primary"} onClick={handleToggleSelfServe} disabled={togglingSelfServe} style={{ fontSize: 13, width: "100%" }}>
                    {togglingSelfServe ? "…" : selfServeEnabled ? "Disable self-serve link" : "Enable self-serve link"}
                  </Button>
                  {selfServeEnabled && selfServeUrl && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      <input readOnly value={selfServeUrl} style={{ fontSize: 11 }} onClick={(e) => (e.target as HTMLInputElement).select()} />
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: 12, flexShrink: 0 }}
                        onClick={() => { navigator.clipboard.writeText(selfServeUrl); show({ message: "Link copied.", type: "success" }); }}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              </Popover>
            </div>
            <Button variant="secondary" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating ? "Duplicating…" : "Duplicate"}
            </Button>
            <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !isDirty}>
              {saving ? "Saving…" : "Save fields"}
            </Button>
          </>
        }
      />
      <div style={{ padding: "16px 24px 0" }}>
        <p style={{ fontSize: 13 }}>{quickEditMode ? "Click a highlighted line to edit its text. Edited lines turn amber — Apply when you're done." : "Click a field to edit it, drag to move, use the corner handle to resize. Scroll to browse pages."}</p>
        {quickEditError && <p style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 4 }}>{quickEditError}</p>}
      </div>

      {needsReview && (
        <div style={{ margin: "12px auto 0", padding: "0 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", padding: "10px 16px" }}>
            <p style={{ fontSize: 13, color: "var(--text-primary)" }}>
              <strong>AI-drafted</strong> — this document's content was generated from a description, not uploaded. Review it before it can be used to send an envelope.
            </p>
            <Button variant="primary" onClick={handleMarkReviewed} disabled={markingReviewed} style={{ fontSize: 13, flexShrink: 0 }}>
              {markingReviewed ? "Marking…" : "I've reviewed this — mark reviewed"}
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, margin: "16px auto", padding: "0 24px 48px", alignItems: "flex-start" }}>
        {/* Left panel: Add fields palette, or the type-specific Field Details view when a field is selected */}
        <div style={{ width: 300, flexShrink: 0, position: "sticky", top: 24 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedField ? `field-${selectedField.id}` : "palette"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={springs.standard}
            >
          {selectedField ? (
            <FieldDetailsPanel
              field={selectedField}
              fields={fields}
              pages={pages}
              fitWidth={fitWidth}
              onUpdate={(patch) => updateField(selectedField.id, patch)}
              onRemove={() => removeField(selectedField.id)}
              onBack={() => { setSelectedId(null); setToolbarOpenId(null); }}
              onAutoplace={() => show({ message: "Autoplace is coming soon.", type: "info" })}
            />
          ) : (
            <>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setLeftTab("manual")}
                  style={{ flex: 1, fontSize: 12, padding: "8px 0", borderRadius: "8px 8px 0 0", border: "none", background: leftTab === "manual" ? "var(--bg-surface)" : "var(--bg-subtle)", fontWeight: leftTab === "manual" ? 600 : 400, cursor: "pointer", boxShadow: leftTab === "manual" ? "var(--shadow-sm)" : "none" }}
                >
                  Add fields
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab("assistant")}
                  style={{ flex: 1, fontSize: 12, padding: "8px 0", borderRadius: "8px 8px 0 0", border: "none", background: leftTab === "assistant" ? "var(--bg-surface)" : "var(--bg-subtle)", fontWeight: leftTab === "assistant" ? 600 : 400, cursor: "pointer", boxShadow: leftTab === "assistant" ? "var(--shadow-sm)" : "none" }}
                >
                  ✨ Assistant
                </button>
              </div>

              {leftTab === "manual" ? (
                <div className="card" style={{ padding: 14 }}>
                  <RolePicker activeRole={activeRole} onChange={setActiveRole} />
                  <h3 style={{ fontSize: 13, marginBottom: 4 }}>Add a field</h3>
                  <p style={{ fontSize: 11.5, color: placingType ? "var(--accent-dark)" : "var(--text-muted)", marginBottom: 12, transition: "color var(--transition-fast, 100ms) ease" }}>
                    {placingType ? `Click on the document to place a ${FIELD_LABELS[placingType]} — Esc to cancel` : "Pick a field, then click the document to place it"}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {FIELD_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 }}>
                          {group.label}
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          {group.types.map((type) => {
                            const armed = placingType === type;
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={() => {
                                  setPlacingType((prev) => (prev === type ? null : type));
                                  setPlacingGhost(null);
                                }}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "10px 6px",
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  border: armed ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                                  borderRadius: 8,
                                  background: armed ? "var(--accent-soft)" : "var(--bg-surface)",
                                  cursor: "pointer",
                                  color: armed ? "var(--accent-dark)" : "var(--text-primary)",
                                  transform: armed ? "scale(1.03)" : "scale(1)",
                                  transition: "border-color var(--transition-fast, 120ms) ease, background var(--transition-fast, 120ms) ease, transform var(--transition-fast, 120ms) ease",
                                }}
                                onMouseEnter={(e) => {
                                  if (armed) return;
                                  e.currentTarget.style.borderColor = "var(--accent)";
                                  e.currentTarget.style.background = "var(--accent-soft)";
                                }}
                                onMouseLeave={(e) => {
                                  if (armed) return;
                                  e.currentTarget.style.borderColor = "var(--border)";
                                  e.currentTarget.style.background = "var(--bg-surface)";
                                }}
                              >
                                <FieldIcon type={type} />
                                {FIELD_LABELS[type]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, height: 520, overflow: "hidden" }}>
                  <AssistantChatPanel
                    templateId={id}
                    onFieldsChanged={(updatedFields) => setFields(updatedFields as FieldDefinition[])}
                  />
                </div>
              )}
            </>
          )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* PDF pages */}
        <div ref={pageColumnRef} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" className="secondary" onClick={handleUndo} disabled={!canUndo} title="Undo" style={{ padding: "4px 10px" }}>
                ↶ Undo
              </button>
              <button type="button" className="secondary" onClick={handleRedo} disabled={!canRedo} title="Redo" style={{ padding: "4px 10px" }}>
                ↷ Redo
              </button>
            </div>
            <ZoomSlider value={zoomPct} onChange={setZoomPct} />
            {pages.length > 1 && (
              <>
                <button className="secondary" disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)}>← Prev</button>
                <span>Page {currentPage + 1} of {pages.length}</span>
                <button className="secondary" disabled={currentPage === pages.length - 1} onClick={() => goToPage(currentPage + 1)}>Next →</button>
              </>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>Scroll to browse pages</span>
          </div>

          {pages.length === 0 && <p style={{ fontSize: 13 }}>Rendering document…</p>}

          {/* Bounded, self-contained scroll region — this column manages
              its own overflow (both axes) so zooming in always stays
              visible and scrollable, regardless of what wraps this page
              (a modal, a fixed-height shell, etc.). */}
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 220px)", paddingBottom: 8, paddingRight: 4 }}>
            {pages.map((dims, i) => (
              <div
                key={i}
                ref={(el) => { pageContainerRefs.current[i] = el; }}
                data-page-index={i}
                style={{ position: "relative", width: pageRenderWidth, transition: "width var(--transition-base, 180ms) ease", marginBottom: 24, boxShadow: "var(--shadow)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}
              >
                <canvas ref={(el) => { canvasRefs.current[i] = el; }} style={{ display: "block", width: "100%" }} />
                {quickEditMode && (
                  <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
                    {editableLines.filter((l) => l.page === i).map((line) => {
                      const scale = pageRenderWidth / dims.widthPts;
                      const left = line.x * scale;
                      const top = (dims.heightPts - line.y - line.height) * scale;
                      const width = line.width * scale;
                      const height = line.height * scale;
                      const isEditing = editingLineId === line.id;
                      const isEdited = line.id in pendingEdits;
                      if (isEditing) {
                        return (
                          <input
                            key={line.id}
                            autoFocus
                            defaultValue={pendingEdits[line.id] ?? line.text}
                            onBlur={(e) => {
                              setPendingEdits((prev) => ({ ...prev, [line.id]: e.target.value }));
                              setEditingLineId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingLineId(null);
                            }}
                            style={{
                              position: "absolute", left, top: top - 2, width: Math.max(width, 60), height: height + 4,
                              fontSize: Math.max(10, height * 0.8), padding: "0 2px", border: "1.5px solid var(--accent)", borderRadius: 2, background: "#fff", zIndex: 10,
                              fontFamily: line.fontFamily === "times" ? "Georgia, 'Times New Roman', serif" : line.fontFamily === "courier" ? "'Courier New', monospace" : "Arial, Helvetica, sans-serif",
                              fontWeight: line.bold ? 700 : 400,
                              fontStyle: line.italic ? "italic" : "normal",
                            }}
                          />
                        );
                      }
                      return (
                        <button
                          key={line.id}
                          type="button"
                          title={isEdited ? pendingEdits[line.id] : line.text}
                          onClick={() => setEditingLineId(line.id)}
                          style={{
                            position: "absolute", left, top, width, height,
                            border: `1.5px ${isEdited ? "solid" : "dashed"} ${isEdited ? "var(--warning)" : "var(--accent)"}`,
                            borderRadius: 2,
                            background: isEdited ? "var(--warning-bg)" : "rgba(75, 43, 255, 0.05)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                )}
                <div
                  style={{ position: "absolute", inset: 0, cursor: placingType ? "none" : "default", pointerEvents: quickEditMode ? "none" : "auto" }}
                  onPointerMove={(e) => {
                    onPointerMove(e);
                    if (placingType) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPlacingGhost({ pageIdx: i, x: e.clientX - rect.left, y: e.clientY - rect.top });
                    }
                  }}
                  onPointerLeave={() => setPlacingGhost(null)}
                  onPointerUp={onPointerUp}
                  onClick={(e) => {
                    if (placingType) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const clickY = e.clientY - rect.top;
                      const scale = pageRenderWidth / dims.widthPts;
                      const size = DEFAULT_SIZE[placingType];
                      const xPts = clickX / scale - size.width / 2;
                      const yPts = dims.heightPts - clickY / scale - size.height / 2;
                      createFieldAt(placingType, i, xPts, yPts);
                      setPlacingGhost(null);
                    } else {
                      setSelectedId(null);
                      setToolbarOpenId(null);
                    }
                  }}
                >
                  {placingType && placingGhost && placingGhost.pageIdx === i && (
                    <div
                      style={{
                        position: "absolute",
                        left: placingGhost.x - (DEFAULT_SIZE[placingType].width * (pageRenderWidth / dims.widthPts)) / 2,
                        top: placingGhost.y - (DEFAULT_SIZE[placingType].height * (pageRenderWidth / dims.widthPts)) / 2,
                        width: DEFAULT_SIZE[placingType].width * (pageRenderWidth / dims.widthPts),
                        height: DEFAULT_SIZE[placingType].height * (pageRenderWidth / dims.widthPts),
                        border: `2.5px solid ${FIELD_TEAL_BORDER}`,
                        borderRadius: 4,
                        background: FIELD_TEAL_BG,
                        opacity: 0.9,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        pointerEvents: "none",
                        zIndex: 25,
                        color: FIELD_TEAL_TEXT,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      <FieldIcon type={placingType} />
                      {FIELD_LABELS[placingType]}
                    </div>
                  )}
                  {fields
                    .filter((f) => f.page === i)
                    .map((f) => {
                      const pos = pdfToScreen(f, i);
                      const isSelected = f.id === selectedId;
                      const isHovered = hoveredFieldId === f.id;
                      const toolbarAbove = pos.top >= 46;
                      const toolbarTop = toolbarAbove ? pos.top - 42 : pos.top + pos.height + 8;
                      const toolbarLeft = Math.min(Math.max(pos.left, 0), Math.max(pageRenderWidth - 170, 0));
                      return (
                        <div key={f.id}>
                          <div
                            onPointerDown={(e) => onPointerDownField(e, f, "move")}
                            onClick={(e) => e.stopPropagation()}
                            onMouseEnter={() => setHoveredFieldId(f.id)}
                            onMouseLeave={() => setHoveredFieldId((prev) => (prev === f.id ? null : prev))}
                            style={{
                              position: "absolute",
                              left: pos.left,
                              top: pos.top,
                              width: pos.width,
                              height: pos.height,
                              border: isSelected ? "2px solid var(--accent)" : `2.5px solid ${FIELD_TEAL_BORDER}`,
                              background: isSelected ? "var(--accent-soft)" : FIELD_TEAL_BG,
                              borderRadius: f.type === "checkbox" ? 3 : 4,
                              cursor: "move",
                              userSelect: "none",
                            }}
                          >
                            <div style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <FieldPreview f={f} />
                            </div>
                            {f.tooltip && isHovered && (
                              <div
                                style={{
                                  position: "absolute",
                                  bottom: "calc(100% + 6px)",
                                  left: "50%",
                                  transform: "translateX(-50%)",
                                  zIndex: 30,
                                  pointerEvents: "none",
                                }}
                              >
                                <motion.div
                                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={reduceMotion ? { duration: 0.01 } : springs.micro}
                                  style={{
                                    background: "var(--text-primary)",
                                    color: "#fff",
                                    fontSize: 11,
                                    padding: "5px 9px",
                                    borderRadius: 6,
                                    whiteSpace: "nowrap",
                                    maxWidth: 220,
                                    boxShadow: "var(--shadow-md, 0 6px 20px rgba(0,0,0,0.12))",
                                  }}
                                >
                                  {f.tooltip}
                                </motion.div>
                              </div>
                            )}
                            {f.visibleIf && (
                              <span
                                title="Conditionally visible"
                                style={{
                                  position: "absolute",
                                  top: -4,
                                  left: -4,
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: "var(--warning)",
                                  border: "1.5px solid var(--bg-surface)",
                                }}
                              />
                            )}
                            <div
                              onPointerDown={(e) => onPointerDownField(e, f, "resize")}
                              style={{
                                position: "absolute",
                                right: -4,
                                bottom: -4,
                                width: 10,
                                height: 10,
                                background: "var(--accent)",
                                borderRadius: 3,
                                cursor: "nwse-resize",
                                display: isSelected ? "block" : "none",
                              }}
                            />
                            {isSelected && (
                              <button
                                type="button"
                                title="Field settings"
                                onClick={(e) => { e.stopPropagation(); setToolbarOpenId((prev) => (prev === f.id ? null : f.id)); }}
                                style={{ position: "absolute", top: -12, right: -12, width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--border-strong)", background: toolbarOpenId === f.id ? "var(--accent)" : "#fff", color: toolbarOpenId === f.id ? "#fff" : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 25, padding: 0 }}
                              >
                                <ChromeIcon name="gear" />
                              </button>
                            )}
                          </div>
                          <AnimatePresence>
                            {toolbarOpenId === f.id && (
                              <FieldToolbar
                                key={`toolbar-${f.id}`}
                                field={f}
                                top={toolbarTop}
                                left={toolbarLeft}
                                onChangeRole={(role) => updateField(f.id, { role })}
                                onToggleRequired={() => updateField(f.id, { required: !f.required })}
                                onDuplicate={() => duplicateField(f)}
                                onDelete={() => { removeField(f.id); setToolbarOpenId(null); }}
                              />
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

        {/* Page thumbnail rail */}
        {pages.length > 0 && (
          <div style={{ width: THUMB_WIDTH + 14, flexShrink: 0, position: "sticky", top: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 }}>
              Pages
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goToPage(i)}
                  style={{
                    padding: 0,
                    border: i === currentPage ? "2px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 4,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "var(--bg-surface)",
                  }}
                >
                  <canvas ref={(el) => { thumbCanvasRefs.current[i] = el; }} style={{ display: "block", width: "100%" }} />
                  <span style={{ display: "block", fontSize: 10, textAlign: "center", padding: "3px 0", color: i === currentPage ? "var(--accent)" : "var(--text-muted)" }}>
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} pdfUrl={pdfUrl} fields={fields} roleLabel={roleLabel} />
      <SiteFooter />
    </>
  );
}

export default function TemplateBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading…</p></div>}>
      <TemplateBuilderInner params={params} />
    </Suspense>
  );
}
