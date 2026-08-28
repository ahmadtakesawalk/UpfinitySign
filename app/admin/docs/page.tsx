// DEPLOY TO: app/admin/docs/page.tsx
//
// Renders ADMIN_GUIDE.md, WIKI.md, and INTEGRATIONS.md directly inside
// the admin console with client-side search — previously these existed
// only as raw files in the repo, unreachable from the app itself even by
// staff. Reads the actual files at request time, so this can never drift
// out of sync with the source docs the way a copy-pasted version could.

import { readFileSync } from "fs";
import path from "path";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { TopBar } from "@/components/TopBar";
import { DocsSearch, type DocSection } from "@/components/admin/DocsSearch";

function loadSections(filename: string, docLabel: string): DocSection[] {
  const raw = readFileSync(path.join(process.cwd(), filename), "utf-8");
  // Split on "## " headings — every doc in this repo uses that level
  // consistently for its major sections, confirmed against all three
  // files before relying on it here.
  const parts = raw.split(/\n(?=## )/);
  return parts
    .filter((p) => p.trim())
    .map((p) => {
      const headingMatch = p.match(/^##\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1] : docLabel;
      return { doc: docLabel, heading, body: p.trim() };
    });
}

export default async function AdminDocsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  let sections: DocSection[] = [];
  try {
    sections = [
      ...loadSections("ADMIN_GUIDE.md", "Admin Guide"),
      ...loadSections("WIKI.md", "Wiki"),
      ...loadSections("INTEGRATIONS.md", "Integrations"),
    ];
  } catch {
    // Reading these files can only fail if the deploy doesn't include them
    // at the expected repo-root path — surface that plainly instead of a
    // blank page with no explanation.
  }

  return (
    <>
      <TopBar
        links={[
          { href: "/admin", label: "Tenants" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/messages", label: "Messages" },
          { href: "/admin/ledger", label: "Ledger" },
          { href: "/admin/audit", label: "Audit trail" },
          { href: "/admin/billing", label: "Billing" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/docs", label: "Docs" },
        ]}
        brand="Upfinity Sign Admin"
        logoutHref="/api/admin/logout"
      />
      <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
        <h1>Docs</h1>
        <div className="signature-rule" />
        {sections.length === 0 ? (
          <div className="card"><p>Couldn't load the docs files — check they're included in this deployment.</p></div>
        ) : (
          <DocsSearch sections={sections} />
        )}
      </div>
    </>
  );
}
