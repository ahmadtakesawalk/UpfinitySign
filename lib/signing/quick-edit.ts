// DEPLOY TO: lib/signing/quick-edit.ts
//
// Quick Edit's actual mechanic — "redact and redraw," the same approach
// any tool without a full PDF text-layout engine uses to edit existing PDF
// content: cover the original text with a rectangle, then draw the
// replacement text in roughly the same position/size. This is genuinely
// different from lib/signing/pdf.ts's burnFields(), which only ever draws
// NEW content into previously-empty field boxes — see the investigation
// notes from earlier in this project for why pdf-lib alone can't do
// true in-place text editing (no run extraction/reflow).
//
// Font/color matching: pdf-lib has no way to pull an arbitrary EMBEDDED
// font out of an existing PDF and reuse it for new text — that would
// require re-embedding, which needs the actual font file, which we don't
// have. What IS real and implemented here: pdf.js classifies every text
// run's font into a family/weight/style (content.styles[fontName]) as part
// of its own rendering pipeline — same information the browser uses to
// pick a fallback font when displaying the PDF. This lets the redraw match
// serif vs. sans vs. monospace, bold vs. regular, and italic vs. upright
// using pdf-lib's 14 built-in standard fonts (see STANDARD_FONT_FOR), and
// color is sampled from the already-rendered page canvas client-side (see
// the template editor's toggleQuickEdit/canvas-sampling) and passed
// through per edit. Genuinely still not a pixel-perfect match for a
// document using a distinctive custom/branded typeface — that's the one
// limitation left, and it's a re-embedding project, not a bug.
//
// Remaining, deliberate scope limits:
//  - Editing is LINE-level, not full-paragraph reflow.
//  - Redaction is an opaque rectangle in the sampled background color (see
//    QuickEdit.backgroundColor) — correct for the overwhelming majority of
//    documents; a line with a background that varies pixel-to-pixel behind
//    it (an image, a gradient) isn't something a flat rectangle can match.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type FontFamily = "helvetica" | "times" | "courier";

export interface EditableLine {
  id: string; // stable within one extraction pass — `${page}:${index}`; re-extract after each applied edit rather than trying to keep ids valid across edits
  page: number; // 0-indexed, matches FieldDefinition.page elsewhere in this codebase
  text: string;
  x: number;
  y: number; // baseline-ish y in pdf-lib's bottom-left-origin space — matches what burnFields already assumes elsewhere
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
}

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

// pdf.js's own font classification for a text run — same signal it uses
// internally to pick a canvas-rendering fallback font, repurposed here to
// pick the closest of pdf-lib's 14 standard fonts instead of always
// defaulting to Helvetica.
function classifyFont(fontFamilyRaw: string | undefined, fontNameRaw: string): { family: FontFamily; bold: boolean; italic: boolean } {
  const probe = `${fontFamilyRaw ?? ""} ${fontNameRaw}`.toLowerCase();
  const family: FontFamily = /courier|mono/.test(probe) ? "courier" : /times|serif|georgia|garamond|cambria/.test(probe) ? "times" : "helvetica";
  const bold = /bold|black|heavy|semibold/.test(probe);
  const italic = /italic|oblique/.test(probe);
  return { family, bold, italic };
}

// pdf.js gives per-run text items (a run breaks on font/style changes, not
// just at word boundaries) — this groups items that sit on the same visual
// line back into one editable unit, which is what "click a line" actually
// means to someone using this feature. Font/style is taken from the
// line's first run — a line that genuinely mixes two fonts mid-sentence
// (rare) redraws in whichever one starts the line.
const SAME_LINE_Y_TOLERANCE = 2; // pdf points

export async function extractEditableLines(pdfBytes: Buffer): Promise<EditableLine[]> {
  const doc = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const lines: EditableLine[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;

    const items: RawTextItem[] = (content.items as any[])
      .filter((item) => typeof item.str === "string" && item.str.trim().length > 0)
      .map((item) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        fontName: item.fontName ?? "",
      }));

    items.sort((a, b) => (Math.abs(a.y - b.y) > SAME_LINE_Y_TOLERANCE ? b.y - a.y : a.x - b.x));

    let current: RawTextItem[] = [];
    function flush() {
      if (current.length === 0) return;
      const text = current.map((i) => i.str).join("").replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        const minX = Math.min(...current.map((i) => i.x));
        const maxRight = Math.max(...current.map((i) => i.x + i.width));
        const maxHeight = Math.max(...current.map((i) => i.height));
        const classified = classifyFont(styles[current[0].fontName]?.fontFamily, current[0].fontName);
        lines.push({
          id: `${pageNum - 1}:${lines.length}`,
          page: pageNum - 1,
          text,
          x: minX,
          y: current[0].y,
          width: maxRight - minX,
          height: maxHeight,
          fontSize: maxHeight, // pdf.js's item height is a reasonable proxy for font size absent embedded-font metrics
          fontFamily: classified.family,
          bold: classified.bold,
          italic: classified.italic,
        });
      }
      current = [];
    }

    for (const item of items) {
      if (current.length > 0 && Math.abs(item.y - current[current.length - 1].y) > SAME_LINE_Y_TOLERANCE) flush();
      current.push(item);
    }
    flush();
  }

  return lines;
}

// Maps (family, bold, italic) onto pdf-lib's 14 built-in standard fonts —
// the only fonts embeddable without shipping actual font file bytes.
const STANDARD_FONT_FOR: Record<FontFamily, Record<"regular" | "bold" | "italic" | "boldItalic", StandardFonts>> = {
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, italic: StandardFonts.HelveticaOblique, boldItalic: StandardFonts.HelveticaBoldOblique },
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, italic: StandardFonts.TimesRomanItalic, boldItalic: StandardFonts.TimesRomanBoldItalic },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold, italic: StandardFonts.CourierOblique, boldItalic: StandardFonts.CourierBoldOblique },
};

export interface RgbColor {
  r: number; // 0-1
  g: number;
  b: number;
}

export interface QuickEdit {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  newText: string;
  fontFamily?: FontFamily; // defaults to helvetica if omitted
  bold?: boolean;
  italic?: boolean;
  textColor?: RgbColor; // defaults to black if omitted
  backgroundColor?: RgbColor; // the redaction rectangle's color — defaults to white if omitted; pass the sampled page background for a non-white document
}

export async function applyQuickEdits(pdfBytes: Buffer, edits: QuickEdit[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  // Embed each of the (up to) 12 text-style standard fonts lazily, once —
  // most documents only ever touch one or two of them.
  const embedded = new Map<StandardFonts, Awaited<ReturnType<typeof pdfDoc.embedFont>>>();
  async function fontFor(family: FontFamily, bold: boolean, italic: boolean) {
    const variant = bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular";
    const standard = STANDARD_FONT_FOR[family][variant];
    if (!embedded.has(standard)) embedded.set(standard, await pdfDoc.embedFont(standard));
    return embedded.get(standard)!;
  }

  for (const edit of edits) {
    const page = pages[edit.page];
    if (!page) continue;

    const bg = edit.backgroundColor ?? { r: 1, g: 1, b: 1 };
    const pad = 1.5;
    page.drawRectangle({
      x: edit.x - pad,
      y: edit.y - pad,
      width: edit.width + pad * 2,
      height: edit.height + pad * 2,
      color: rgb(bg.r, bg.g, bg.b),
    });

    if (edit.newText.trim().length === 0) continue; // a blank replacement is a real, supported case — "delete this line"

    const font = await fontFor(edit.fontFamily ?? "helvetica", edit.bold ?? false, edit.italic ?? false);
    const textColor = edit.textColor ?? { r: 0, g: 0, b: 0 };
    const fontSize = Math.max(6, Math.min(edit.height, 48));
    page.drawText(edit.newText, {
      x: edit.x,
      y: edit.y,
      size: fontSize,
      font,
      color: rgb(textColor.r, textColor.g, textColor.b),
    });
  }

  return Buffer.from(await pdfDoc.save());
}
