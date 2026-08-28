// DEPLOY TO: app/faq/page.tsx
//
// Content lives in lib/content/faq-data.ts — this page just renders it
// through the searchable/browsable FaqLibrary component. Previously this
// was ~200 lines of hand-written JSX with the content baked directly
// into markup; splitting content from presentation is what makes real
// search possible (searching against actual strings, not JSX structure)
// and keeps this page from needing to change every time a question does.

import { SiteFooter } from "@/components/SiteFooter";
import { FaqLibrary } from "@/components/FaqLibrary";
import { FAQ_CATEGORIES } from "@/lib/content/faq-data";

export default function FaqPage() {
  return (
    <>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px 80px" }}>
        <a href="/" className="topbar-brand" style={{ display: "inline-block", marginBottom: 24 }}>Upfinity Sign</a>
        <h1>FAQ</h1>
        <div className="signature-rule" />

        <FaqLibrary categories={FAQ_CATEGORIES} />

        <p style={{ marginTop: 48 }}>
          <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> ·{" "}
          <a href="/ai-policy">AI Assistant Notice</a> · <a href="/integrations">Integrations</a> ·{" "}
          <a href="/">Back to Upfinity Sign</a>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
