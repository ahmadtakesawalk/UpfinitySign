// DEPLOY TO: lib/billing/invoice-pdf.ts
//
// Branded PDF bill generation — same visual language (accent color,
// pagination-safe footer) as lib/signing/certificate.ts, so a customer's
// invoice and their Certificate of Completion visibly come from the same
// product rather than looking like two different tools bolted together.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "../db";
import { storage } from "../storage";
import type { Invoice, Tenant } from "@prisma/client";

const ACCENT = rgb(0.294, 0.169, 1); // #4b2bff — matches the product's signature accent

export async function generateInvoicePdf(invoice: Invoice, tenant: Tenant): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]); // US Letter

  page.drawRectangle({ x: 56, y: 730, width: 500, height: 3, color: ACCENT });
  page.drawText("Upfinity Sign", { x: 56, y: 690, size: 22, font: boldFont, color: rgb(0.08, 0.08, 0.1) });
  page.drawText(invoice.kind === "refund" ? "Credit Note" : "Receipt", { x: 56, y: 665, size: 13, font, color: rgb(0.4, 0.4, 0.45) });

  const invoiceNumber = `INV-${String(invoice.invoiceNumber).padStart(6, "0")}`;
  page.drawText(invoiceNumber, { x: 400, y: 690, size: 10, font, color: rgb(0.4, 0.4, 0.45) });
  page.drawText(invoice.createdAt.toLocaleDateString(), { x: 400, y: 675, size: 10, font, color: rgb(0.4, 0.4, 0.45) });

  let y = 620;
  const drawRow = (label: string, value: string, bold = false) => {
    page.drawText(label, { x: 56, y, size: 11, font: bold ? boldFont : font, color: rgb(0.15, 0.15, 0.18) });
    page.drawText(value, { x: 350, y, size: 11, font: bold ? boldFont : font, color: rgb(0.15, 0.15, 0.18) });
    y -= 22;
  };

  page.drawText("Billed to", { x: 56, y, size: 10, font: boldFont, color: rgb(0.4, 0.4, 0.45) });
  y -= 18;
  drawRow(tenant.name, "");
  y -= 20;

  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 24;

  page.drawText("Description", { x: 56, y, size: 10, font: boldFont, color: rgb(0.4, 0.4, 0.45) });
  page.drawText("Amount", { x: 480, y, size: 10, font: boldFont, color: rgb(0.4, 0.4, 0.45) });
  y -= 20;

  const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`;
  page.drawText(invoice.description, { x: 56, y, size: 11, font, color: rgb(0.15, 0.15, 0.18) });
  page.drawText(money(invoice.subtotalCents), { x: 480, y, size: 11, font, color: rgb(0.15, 0.15, 0.18) });
  y -= 24;

  // Tax only gets its own line when one was actually applied — an
  // invoice with no tax rate on file just shows the single line item and
  // total, rather than a confusing "$0.00 tax" row on every receipt.
  if (invoice.taxCents !== 0 || invoice.taxRatePercent) {
    page.drawText(`Tax${invoice.taxRatePercent ? ` (${invoice.taxRatePercent}%)` : ""}`, { x: 56, y, size: 11, font, color: rgb(0.4, 0.4, 0.45) });
    page.drawText(money(invoice.taxCents), { x: 480, y, size: 11, font, color: rgb(0.4, 0.4, 0.45) });
    y -= 24;
  }
  y -= 6;

  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 24;

  page.drawText(invoice.kind === "refund" ? "Total refunded" : "Total", { x: 400, y, size: 13, font: boldFont, color: rgb(0.08, 0.08, 0.1) });
  page.drawText(money(invoice.amountCents), { x: 480, y, size: 13, font: boldFont, color: rgb(0.08, 0.08, 0.1) });
  y -= 30;

  const statusColor = invoice.status === "paid" ? rgb(0.06, 0.54, 0.37) : rgb(0.85, 0.2, 0.16);
  const statusLabel = invoice.kind === "refund" ? "REFUNDED" : invoice.status === "paid" ? "PAID" : "PAYMENT FAILED";
  page.drawText(statusLabel, { x: 56, y, size: 10, font: boldFont, color: statusColor });

  page.drawText("Upfinity Sign — a product of Upfinity Inc.", { x: 56, y: 40, size: 8, font, color: rgb(0.55, 0.55, 0.58) });
  page.drawText("140 Carlton Street, Toronto, ON M5A 3W7, Canada — privacy@upfinity.ca", { x: 56, y: 28, size: 8, font, color: rgb(0.55, 0.55, 0.58) });

  return Buffer.from(await pdfDoc.save());
}

/** Generates the PDF and stores it, updating the Invoice row's pdfStorageKey — called once, right after the Invoice row is created (lib/billing/apply-event.ts and lib/billing/trial.ts). */
export async function generateAndStoreInvoicePdf(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });

  const pdfBytes = await generateInvoicePdf(invoice, tenant);
  const key = `invoices/${invoice.tenantId}/${invoice.id}.pdf`;
  const stored = await storage.put(key, pdfBytes, "application/pdf");

  await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfStorageKey: stored.key } });
}
