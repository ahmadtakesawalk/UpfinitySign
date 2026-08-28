// DEPLOY TO: lib/signing/formula-inputs.ts
import type { FieldDefinition } from "./field-types";

const MS_PER_DAY = 86_400_000;

/**
 * Builds the numeric values object evaluateFormula() expects, from a
 * template's field definitions and the raw (string) values a signer has
 * entered so far. Shared between the live in-browser recompute
 * (app/sign/[token]/page.tsx) and the server-side recompute on submit
 * (app/api/sign/[token]/route.ts) so the two can't drift out of sync.
 *
 * Date fields convert to days-since-epoch (UTC) — the convention
 * lib/signing/formula.ts documents — so DAY()/MONTH()/DAYS_IN_MONTH() and
 * plain arithmetic on two dates both work correctly. Non-numeric,
 * non-date, or missing values are simply omitted; a formula that
 * references an omitted field fails with "unknown field", which callers
 * already catch as a FormulaError.
 */
export function buildNumericInputs(
  fieldMap: FieldDefinition[],
  valuesById: Record<string, string | undefined>
): Record<string, number> {
  const numericInputs: Record<string, number> = {};
  for (const f of fieldMap) {
    const raw = valuesById[f.id];
    if (raw === undefined) continue;
    if (f.type === "date") {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) numericInputs[f.id] = Math.floor(t / MS_PER_DAY);
    } else {
      const n = Number(raw);
      if (!Number.isNaN(n)) numericInputs[f.id] = n;
    }
  }
  return numericInputs;
}
