// DEPLOY TO: lib/signing/docx-convert.ts
//
// Converts an uploaded .docx to PDF bytes at upload time, so everything
// downstream — storage, field-map extraction, the field-placement builder
// (which renders via pdfjs-dist), the recipient signing page, PKI signing —
// stays exactly as-is. The template is always a PDF from the moment it's
// stored; ".docx support" means "convert once at the door," not "teach
// every part of the pipeline to also understand Word documents."
//
// Pipeline: mammoth (docx -> HTML, preserves headings/bold/tables/lists)
// -> lib/documents/html-to-pdf.ts's shared headless-Chromium renderer.
//
// Fidelity note: this reproduces the document's text, structure, and basic
// formatting (bold/italic/headings/lists/tables), not pixel-exact layout
// of complex Word features (text boxes, exotic manual positioning,
// embedded OLE objects). For the signable-document use case (offer
// letters, NDAs, policy acknowledgments) that covers the real-world case;
// flagging the boundary rather than overclaiming perfect fidelity.

import mammoth from "mammoth";
import { wrapHtml, renderHtmlToPdf } from "../documents/html-to-pdf";

export interface DocxConversionResult {
  pdfBytes: Buffer;
  warnings: string[];
}

export async function convertDocxToPdf(docxBytes: Buffer): Promise<DocxConversionResult> {
  const { value: bodyHtml, messages } = await mammoth.convertToHtml({ buffer: docxBytes });
  const warnings = messages.filter((m) => m.type === "warning").map((m) => m.message);

  const pdfBytes = await renderHtmlToPdf(wrapHtml(bodyHtml));
  return { pdfBytes, warnings };
}

export function isDocxFile(file: File): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}
