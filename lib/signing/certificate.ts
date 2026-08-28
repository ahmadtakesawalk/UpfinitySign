// Generates the Certificate of Completion: a separate, tamper-evident PDF
// (not just a DB log) stapled to the envelope, plus a shareable web view.
// PRD.md §5.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "../db";
import { storage } from "../storage";
import { embedPkiSignature } from "./pdf";

export async function generateCertificate(envelopeId: string) {
  const envelope = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { recipients: true, auditEvents: { orderBy: { timestamp: "asc" } }, template: true },
  });

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_SIZE: [number, number] = [612, 792]; // US Letter
  const TOP_Y = 740;
  const BOTTOM_MARGIN = 56;

  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = TOP_Y;
  const ACCENT = rgb(0.294, 0.169, 1); // #4b2bff — matches the product's signature accent

  const drawFooter = (p: typeof page) => {
    p.drawText("Upfinity Sign — Certificate of Completion", {
      x: 56, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.58),
    });
  };
  drawFooter(page);
  page.drawRectangle({ x: 56, y: TOP_Y + 22, width: 500, height: 2, color: ACCENT });

  const drawLine = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 11;
    if (y - size < BOTTOM_MARGIN) {
      page = pdfDoc.addPage(PAGE_SIZE);
      y = TOP_Y;
      drawFooter(page);
    }
    page.drawText(text, {
      x: 56,
      y,
      size,
      font: opts.bold ? boldFont : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 8;
  };

  drawLine("Certificate of Completion", { bold: true, size: 20 });
  drawLine(`Upfinity Sign — ${envelope.template.name}`, { size: 12 });
  y -= 10;
  drawLine("Envelope", { bold: true });
  drawLine(`ID: ${envelope.id}`);
  drawLine(`Status: ${envelope.status}`);
  drawLine(`Completed: ${envelope.completedAt?.toISOString() ?? "N/A"}`);
  y -= 10;

  drawLine("Signers", { bold: true });
  for (const r of envelope.recipients) {
    drawLine(
      `${r.name} <${r.email}> — ${r.status} — signed ${r.signedAt?.toISOString() ?? "N/A"} — IP ${r.ipAddress ?? "N/A"}`
    );
  }
  y -= 10;

  drawLine("Chain of Custody", { bold: true });
  for (const e of envelope.auditEvents) {
    drawLine(`${e.timestamp.toISOString()} — ${e.eventType} — IP ${e.ipAddress ?? "N/A"}`, {
      size: 9,
    });
  }

  const rawBytes = Buffer.from(await pdfDoc.save());
  // The certificate itself gets the same PKI signature treatment as the
  // signed document — it's a legal artifact too, not just a summary.
  const signedBytes = await embedPkiSignature(rawBytes);

  const key = `certificates/${envelope.tenantId}/${envelope.id}.pdf`;
  const stored = await storage.put(key, signedBytes, "application/pdf");

  const certificate = await prisma.certificate.upsert({
    where: { envelopeId: envelope.id },
    create: { envelopeId: envelope.id, pdfStorageKey: stored.key, webViewUrl: `/certificates/${envelope.id}` },
    update: { pdfStorageKey: stored.key },
  });

  return certificate;
}
