// Extracts per-page text lines with coordinates, for lib/llm/field-placement.ts
// to reason about where signature/date/text fields belong.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageLayout } from "../llm/field-placement";

export async function extractPageLayout(pdfBytes: Buffer): Promise<PageLayout[]> {
  const doc = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const layout: PageLayout[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const lines = content.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      // pdf.js origin is bottom-left already, matching pdf-lib's coordinate
      // system used later for field burn-in — no flip needed here.
      y: item.transform[5],
      width: item.width,
      height: item.height,
    }));

    layout.push({ page: pageNum - 1, lines }); // 0-indexed to match FilledField.page in lib/signing/pdf.ts
  }

  return layout;
}
