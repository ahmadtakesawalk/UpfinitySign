// Burns filled field values into the PDF, then embeds a real PKI digital
// signature (PRD.md §5). Rendering auto-fits/wraps/vertically-centers text
// by construction — see PRD §8b for the DocuSign complaint research this
// fixes.
//
// Signing library migrated from node-signpdf@2 (deprecated upstream) to
// the maintained @signpdf/* family. Verified against the actual installed
// packages' .d.ts files before writing this. @signpdf/placeholder-pdf-lib
// works directly against a pdf-lib PDFDocument rather than raw bytes.
//
// Signature/initial fields are handled specially (see burnSignatureField):
// a "data:image/..." value (from the Draw or Upload capture modes on the
// signing page) is embedded as an actual image, not text. A plain-text
// value (Type mode) is rendered in a real cursive font
// (lib/signing/fonts/signature-script.ttf — OFL-licensed Dancing Script)
// via pdf-lib's custom font embedding (requires @pdf-lib/fontkit,
// registered once below), instead of the same bold sans-serif used for
// every other field type. This is what makes a signature look like a
// signature on the final document rather than a form field.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import forge from "node-forge";
import { readFile } from "fs/promises";
import path from "path";
import { getSigningCert } from "./cert";
import type { FieldType } from "./field-types";

export interface FilledField {
  id: string;
  page: number;
  type: FieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
}

const INK_COLOR = rgb(0.1, 0.1, 0.4);
const MAX_FONT_SIZE = 14;
const MIN_FONT_SIZE = 6;
const LINE_HEIGHT_MULTIPLIER = 1.15;

const SIGNATURE_FONT_PATH = path.join(process.cwd(), "lib/signing/fonts/signature-script.ttf");
const SIGNATURE_TYPES: FieldType[] = ["signature", "initial", "stamp"];

let cachedSignatureFontBytes: Buffer | null = null;
async function loadSignatureFontBytes(): Promise<Buffer> {
  if (!cachedSignatureFontBytes) cachedSignatureFontBytes = await readFile(SIGNATURE_FONT_PATH);
  return cachedSignatureFontBytes;
}

export async function burnFields(pdfBytes: Buffer, fields: FilledField[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Only embedded lazily if at least one field actually needs it — most
  // envelopes have a handful of signature/initial fields, not dozens.
  let signatureFont: PDFFont | null = null;
  async function getSignatureFont(): Promise<PDFFont> {
    if (!signatureFont) signatureFont = await pdfDoc.embedFont(await loadSignatureFontBytes());
    return signatureFont;
  }

  for (const field of fields) {
    const page = pages[field.page];
    if (!page) continue;
    if (field.type === "checkbox") {
      drawCheckbox(page, field);
    } else if (field.type === "note" || field.type === "attachment" || field.type === "payment") {
      // Payment fields are never burned as raw text either — the value
      // here (if anything) would be a Stripe session id, not something
      // meaningful printed on a document. A paid payment field could
      // reasonably print a small "Paid" receipt marker in a future pass;
      // for now it's simply omitted rather than printing garbage.
      continue;
    } else if (SIGNATURE_TYPES.includes(field.type) && field.value) {
      await burnSignatureField(pdfDoc, page, field, await getSignatureFont());
    } else if (field.value) {
      drawFittedText(page, font, field);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Signature/initial-specific burn: a "data:image/..." value came from the
 * Draw or Upload capture mode and is embedded as an actual image, scaled
 * to fit the field box while preserving aspect ratio and bottom-aligned
 * (matches how a real signature sits on a line). A plain-text value came
 * from Type mode and is rendered in the cursive signature font instead of
 * the standard bold sans used for every other field.
 */
async function burnSignatureField(pdfDoc: PDFDocument, page: PDFPage, field: FilledField, signatureFont: PDFFont) {
  if (field.value.startsWith("data:image")) {
    const isPng = field.value.startsWith("data:image/png");
    const base64 = field.value.split(",")[1] ?? "";
    const imageBytes = Buffer.from(base64, "base64");
    const image = isPng ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);

    const scale = Math.min(field.width / image.width, field.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: field.x + (field.width - drawWidth) / 2,
      y: field.y + (field.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    return;
  }

  // Typed signature — cursive font, sized to fill the field height
  // (capped at a sensible max so a short field box doesn't produce a
  // tiny illegible signature), left-aligned, vertically centered.
  let fontSize = Math.min(field.height * 0.72, 34);
  while (fontSize > 10 && signatureFont.widthOfTextAtSize(field.value, fontSize) > field.width) {
    fontSize -= 1;
  }
  const textHeight = signatureFont.heightAtSize(fontSize);
  page.drawText(field.value, {
    x: field.x,
    y: field.y + (field.height - textHeight) / 2 + textHeight * 0.15,
    size: fontSize,
    font: signatureFont,
    color: INK_COLOR,
  });
}

/** Wraps text across multiple lines within the field's height first, only shrinking font as a secondary measure, then vertically centers the block — the complete fix for the alignment complaint, not just a font-shrink patch. */
function drawFittedText(page: PDFPage, font: PDFFont, field: FilledField) {
  let fontSize = MAX_FONT_SIZE;
  let lines: string[] = [];

  while (fontSize >= MIN_FONT_SIZE) {
    lines = wrapText(field.value, font, fontSize, field.width);
    const blockHeight = lines.length * font.heightAtSize(fontSize) * LINE_HEIGHT_MULTIPLIER;
    if (blockHeight <= field.height || fontSize === MIN_FONT_SIZE) break;
    fontSize -= 0.5;
  }

  const lineHeight = font.heightAtSize(fontSize) * LINE_HEIGHT_MULTIPLIER;
  const blockHeight = lines.length * lineHeight;
  let cursorY = field.y + (field.height + blockHeight) / 2 - lineHeight * 0.85;

  for (const line of lines) {
    page.drawText(line, { x: field.x, y: cursorY, size: fontSize, font, color: INK_COLOR });
    cursorY -= lineHeight;
  }
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        lines.push(...hardSplit(word, font, fontSize, maxWidth));
        current = "";
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function hardSplit(word: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const ch of word) {
    if (font.widthOfTextAtSize(current + ch, fontSize) <= maxWidth) {
      current += ch;
    } else {
      if (current) chunks.push(current);
      current = ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function drawCheckbox(page: PDFPage, field: FilledField) {
  const checked = field.value === "true";
  const size = Math.min(field.width, field.height);
  page.drawRectangle({ x: field.x, y: field.y, width: size, height: size, borderColor: INK_COLOR, borderWidth: 1 });
  if (checked) {
    const inset = size * 0.25;
    page.drawRectangle({ x: field.x + inset, y: field.y + inset, width: size - inset * 2, height: size - inset * 2, color: INK_COLOR });
  }
}

export async function embedPkiSignature(pdfBytes: Buffer): Promise<Buffer> {
  const cert = await getSigningCert();
  const p12Der = buildP12(cert.privateKeyPem, cert.certificatePem);

  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdflibAddPlaceholder({
    pdfDoc,
    reason: "Signed via Upfinity Sign",
    contactInfo: "support@upfinitysign.com",
    name: "Upfinity Sign",
    location: "",
    signatureLength: 8192,
  });
  const pdfWithPlaceholder = Buffer.from(await pdfDoc.save());

  const signer = new P12Signer(p12Der, { passphrase: "" });
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, signer);

  // Timestamp: lib/signing/timestamp.ts has a working (UNVERIFIED — see
  // that file's header) RFC 3161 client. Not called here yet.

  return signedPdf;
}

function buildP12(privateKeyPem: string, certificatePem: string): Buffer {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], "", { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

export async function finalizePdf(pdfBytes: Buffer, fields: FilledField[]): Promise<Buffer> {
  const burned = await burnFields(pdfBytes, fields);
  return embedPkiSignature(burned);
}
