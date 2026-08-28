// DEPLOY TO: lib/billing/invoice.ts
//
// Extracted from apply-event.ts into its own file specifically to avoid a
// circular import: lib/billing/trial.ts needs to create an invoice on
// trial conversion, but apply-event.ts already imports FROM trial.ts
// (for the instant-conversion path when a card is added post-expiry) — so
// trial.ts importing back from apply-event.ts would cycle. Both files
// import this one instead.

import { prisma } from "../db";
import { captureException } from "../monitoring";
import { generateAndStoreInvoicePdf } from "./invoice-pdf";

/**
 * Creates the one ledger row every charge (or failed/refunded attempt)
 * produces — the admin-side revenue ledger and every tenant's own invoice
 * history both read from this table, never a separately-maintained
 * total. Tax is computed here, once, from the tenant's own
 * taxRatePercent — callers pass the pre-tax amount and never do tax math
 * themselves, so there's exactly one place that logic lives.
 *
 * Tax scope, stated plainly rather than left implicit: this applies a
 * flat rate an admin sets manually per tenant (Tenant.taxRatePercent) —
 * it does NOT determine what that rate should be. Real jurisdiction
 * detection, nexus rules, and multi-jurisdiction tax stacking are what a
 * service like Stripe Tax or Avalara is for; wiring one of those in is a
 * deliberate follow-up decision, not something to fake with invented
 * calculation logic.
 */
export async function createInvoice(params: {
  tenantId: string;
  kind: "subscription" | "credit_pack" | "trial_conversion" | "refund";
  description: string;
  subtotalCents: number;
  status: "paid" | "failed";
  externalReference?: string;
  refundOfInvoiceId?: string;
}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
  const taxRatePercent = params.kind === "refund" ? null : tenant?.taxRatePercent ?? null;
  const taxCents = taxRatePercent ? Math.round(params.subtotalCents * (taxRatePercent / 100)) : 0;

  const invoice = await prisma.invoice.create({
    data: {
      tenantId: params.tenantId,
      kind: params.kind,
      description: params.description,
      subtotalCents: params.subtotalCents,
      taxCents,
      taxRatePercent,
      amountCents: params.subtotalCents + taxCents,
      status: params.status,
      externalReference: params.externalReference,
      refundOfInvoiceId: params.refundOfInvoiceId,
    },
  });

  if (params.status === "paid") {
    try {
      await generateAndStoreInvoicePdf(invoice.id);
    } catch (err) {
      await captureException(err, { context: "invoice_pdf_generation", invoiceId: invoice.id });
    }
  }

  return invoice;
}
