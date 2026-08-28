// DEPLOY TO: lib/billing/refund.ts
//
// Issues a refund through whichever payment provider is currently active,
// then records it as its own ledger row (kind: "refund", negative
// amounts) linked back to the original charge — never a mutation of the
// original invoice's own status, so that row stays an accurate record of
// what actually happened when it happened. Summing amountCents across an
// original ($9.00) and its refund (-$9.00) nets to zero automatically, no
// separate "net revenue" calculation needed anywhere that reads the ledger.
//
// Provider-agnostic: the actual charge-resolution logic (a checkout
// session id vs. a subscription id vs. a raw payment reference) lives in
// lib/billing/providers/stripe.ts, behind the interface — this file only
// ever calls provider.refundCharge(reference).

import { prisma } from "../db";
import { getActivePaymentProvider } from "./active-provider";
import { createInvoice } from "./invoice";

export async function refundInvoice(invoiceId: string, reason: string) {
  const original = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

  if (original.kind === "refund") {
    throw new Error("Can't refund a refund.");
  }
  if (original.status !== "paid") {
    throw new Error("Can only refund a paid invoice.");
  }
  const alreadyRefunded = await prisma.invoice.findFirst({ where: { refundOfInvoiceId: original.id } });
  if (alreadyRefunded) {
    throw new Error("This invoice has already been refunded.");
  }
  if (!original.externalReference) {
    throw new Error("This invoice has no payment reference on file — can't issue an automatic refund. Handle it directly with your payment provider.");
  }

  const provider = await getActivePaymentProvider();
  await provider.refundCharge(original.externalReference);

  return createInvoice({
    tenantId: original.tenantId,
    kind: "refund",
    description: `Refund: ${original.description}${reason ? ` — ${reason}` : ""}`,
    subtotalCents: -original.amountCents, // negative — a refund's own tax field is deliberately null (see invoice.ts), so subtotal alone carries the full negative total
    status: "paid",
    refundOfInvoiceId: original.id,
  });
}
