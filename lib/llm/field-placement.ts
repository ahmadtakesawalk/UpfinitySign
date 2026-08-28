// Upfinity Sign — AI auto field placement (PRD.md §9, Phase 1).
// Given extracted text/layout from an uploaded PDF, propose where fields
// should go, using the full field type set (lib/signing/field-types.ts) —
// not just signature/date/text. Sender confirms/edits the result in the
// template builder before sending.

import { complete } from "./client";
import type { FieldType } from "../signing/field-types";

export interface PageLayout {
  page: number;
  // Simple line-level text + position extraction from pdf-lib/pdf.js —
  // populate this from the actual PDF parsing step in lib/signing.
  lines: { text: string; x: number; y: number; width: number; height: number }[];
}

export interface ProposedField {
  id: string;
  page: number;
  type: FieldType;
  role: string; // e.g. "signer_1", "signer_2", "approver"
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options?: string[]; // for radio_group/dropdown
  confidence: number;
}

const SYSTEM_PROMPT = `You place fields on documents for an e-signature product.
Given page text with coordinates, return a JSON array of proposed fields.

Field types available: signature, initial, date, full_name, email, company,
title, text, number, checkbox, radio_group, dropdown, attachment, note,
formula.

Cues to look for:
- "Signature:", "Sign here", a blank line near the bottom of the last page → signature
- "Initial:", "Initials:" repeated near the top/margin of each page → initial
- "Date:" near a signature → date
- A labeled blank next to "Name:" → full_name (this is auto-filled from the
  recipient's own record, not manually typed — still place the field so the
  value renders in the right spot)
- "Email:" → email
- "Company:", "Employer:" → company
- "Title:", "Job Title:" → title
- A checkbox glyph (☐, □, or a small drawn box) next to a statement → checkbox
- Multiple mutually exclusive options with checkboxes/circles → radio_group
  (include the option labels in "options")
- Any other labeled blank that doesn't match the above → text
- A blank clearly expecting digits only (SSN, phone, zip, amount) → number
- A total/subtotal/sum near line items with quantities and prices → formula
  (do NOT set a formula expression yourself — flag it as type "formula" and
  leave the expression for the sender to configure in the field editor,
  since only they know the correct field-id references)

Set "required": true for anything that looks mandatory (most fields), false
for anything that reads optional. Do NOT include an "id" field — ids are
assigned after parsing, not by you. Return ONLY valid JSON, no prose.`;

export async function proposeFields(layout: PageLayout[]): Promise<ProposedField[]> {
  const result = await complete({
    feature: "fieldPlacement",
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(layout),
    maxTokens: 3072, // bumped up from 2048 — richer field objects (options arrays, required flag) take more tokens per field
    temperature: 0,
  });

  let parsed: any[];
  try {
    parsed = JSON.parse(result.text);
  } catch {
    // If the model wrapped the JSON in prose/fences despite instructions, strip and retry once.
    const cleaned = result.text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  // Assign stable ids here rather than trusting the model to generate
  // unique ones — formula fields and the canvas both depend on ids being
  // genuinely unique, which an LLM has no reliable way to guarantee across
  // a batch of similar-looking field objects.
  return parsed.map((f, i) => ({ ...f, id: `f_${Date.now()}_${i}` }));
}
