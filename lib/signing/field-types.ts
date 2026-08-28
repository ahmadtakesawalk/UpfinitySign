// DEPLOY TO: lib/signing/field-types.ts
// Field type system — single source of truth for what a field CAN be.
// Coverage is at parity with DocuSign's standard field set, plus formula
// (calculated) fields, which DocuSign also offers — see PRD §8b.
export type FieldType =
  | "signature"
  | "initial"
  | "date"
  | "full_name" // auto-filled from Recipient.name
  | "email" // auto-filled from Recipient.email
  | "company"
  | "title"
  | "text"
  | "number"
  | "checkbox"
  | "radio_group"
  | "dropdown"
  | "attachment"
  | "note" // sender-authored, read-only annotation
  | "custom" // sender-defined validation via CustomFieldConfig
  | "formula" // computed from other fields — see FormulaConfig, never directly editable by the signer
  | "payment" // one-time payment collected via Stripe Checkout before signing can complete — see lib/signing/payment.ts
  | "approve" // in-document Approve button for an approver recipient — triggers the SAME whole-envelope approve action the bottom action bar already does, just placed inline where DocuSign's Actions group puts it. Not a separate per-field approval state.
  | "decline" // in-document Decline button — same relationship to the existing decline flow as "approve" above
  | "stamp"; // company/official seal image — same capture mechanic as signature/initial (type/draw/upload), semantically distinct: applied by an approver/admin, not a personal signature
export interface PaymentFieldConfig {
  label: string;
  amountCents: number; // fixed amount, in the smallest currency unit — no "let the signer type an amount" mode, that's a different (and riskier) feature
  currency: string; // ISO 4217, lowercase — e.g. "usd"
  description?: string; // shown on the Stripe Checkout page
}
export interface CustomFieldConfig {
  label: string;
  pattern?: string; // regex, e.g. SSN/zip/phone formats
  patternErrorMessage?: string;
  maxLength?: number;
}
export interface FormulaConfig {
  label: string;
  // Expression referencing other fields by their `id` — e.g.
  // "quantity * unit_price". Evaluated by lib/signing/formula.ts's
  // hand-rolled parser — arithmetic (+, -, *, /, parens), comparisons
  // (<, >, <=, >=, <>), field-id references, and a small function set
  // (TODAY, DAY, MONTH, YEAR, DAYS_IN_MONTH, MIN, MAX, ROUND).
  // Deliberately NOT eval()'d — a formula field is sender-
  // authored input; eval-ing arbitrary strings server-side is a real
  // injection surface worth just not having.
  expression: string;
  decimalPlaces?: number;
}
export interface VisibilityCondition {
  fieldId: string; // the OTHER field this one depends on
  equals: string; // shown only when that field's current value equals this exactly
}
export interface FieldDefinition {
  id: string; // stable — formula fields reference OTHER fields by this id
  page: number;
  type: FieldType;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options?: string[]; // radio_group/dropdown
  customConfig?: CustomFieldConfig;
  formulaConfig?: FormulaConfig;
  paymentConfig?: PaymentFieldConfig;
  visibleIf?: VisibilityCondition; // omitted = always visible
  readOnly?: boolean; // pre-filled/locked — signer sees it but can't edit
  tooltip?: string; // short helper text shown to the signer on hover/focus
  dataLabel?: string; // sender-facing display name for this field, distinct from its internal `id`
  // Pre-selected value shown before the signer interacts — "true"/"false"
  // for checkbox, one of `options` for radio_group/dropdown. Purely a
  // starting state; the signer can still change it unless `readOnly`.
  defaultValue?: string;
}
/**
 * Single source of truth for "is this field currently visible" — used by
 * both the signing page (to decide what to render) and server-side
 * validation (to decide what's actually required). A field with no
 * visibleIf is always visible. Deliberately ONE condition, not a rules
 * engine (AND/OR trees, nested conditions) — that covers the real cases
 * ("show X only if Y is checked/equals Z") without the complexity of a
 * general boolean expression system nobody asked for.
 */
export function isFieldVisible(field: FieldDefinition, values: Record<string, string>): boolean {
  if (!field.visibleIf) return true;
  return values[field.visibleIf.fieldId] === field.visibleIf.equals;
}
// AUTO_FILLED fields close a real DocuSign complaint class (values
// attributed to the wrong recipient after a template edit) — pulling
// straight from the Recipient row structurally prevents that mismatch.
export const AUTO_FILLED_TYPES: FieldType[] = ["full_name", "email"];
export const REQUIRES_OPTIONS: FieldType[] = ["radio_group", "dropdown"];
export function isAutoFilled(type: FieldType): boolean {
  return AUTO_FILLED_TYPES.includes(type);
}
