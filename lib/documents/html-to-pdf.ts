// DEPLOY TO: lib/documents/html-to-pdf.ts
//
// The one place puppeteer-core + @sparticuz/chromium gets launched.
// Originally lived only inside docx-convert.ts; extracted here once the
// AI document generator (lib/llm/assistant.ts) needed the exact same
// "render HTML to a Letter-sized PDF" step for a different source of HTML
// (AI-authored, not mammoth-converted from a .docx) — same infrastructure,
// different HTML producer, so this is the shared part and each caller
// owns its own HTML-producing step.

let cachedChromiumExecutablePath: string | null = null;

async function launchBrowser() {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = await import("puppeteer-core");

  if (!cachedChromiumExecutablePath) {
    cachedChromiumExecutablePath = await chromium.executablePath();
  }

  return puppeteer.launch({
    args: chromium.args,
    executablePath: cachedChromiumExecutablePath,
    headless: true,
  });
}

export function wrapHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: Letter; margin: 1in; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; color: #1a1a1a; }
  h1, h2, h3 { font-family: Arial, sans-serif; margin-top: 1.2em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #999; padding: 6px 10px; }
  img { max-width: 100%; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Renders a full HTML document (already wrapped — pass through wrapHtml() first if you're starting from a body fragment) to Letter-sized PDF bytes. */
export async function renderHtmlToPdf(fullHtml: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });
    const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
