// DEPLOY TO: app/dashboard/templates/page.tsx

import { redirect } from "next/navigation";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { FolderSidebar } from "@/components/templates/FolderSidebar";
import { SiteFooter } from "@/components/SiteFooter";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) redirect("/dashboard/login");

  const { folder: folderParam } = await searchParams;

  const [folders, totalCount, uncategorizedCount, templates] = await Promise.all([
    prisma.templateFolder.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      include: { _count: { select: { templates: true } } },
    }),
    prisma.template.count({ where: { tenantId: user.tenantId } }),
    prisma.template.count({ where: { tenantId: user.tenantId, folderId: null } }),
    prisma.template.findMany({
      where: {
        tenantId: user.tenantId,
        ...(folderParam === "none" ? { folderId: null } : folderParam ? { folderId: folderParam } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { envelopes: true } } },
    }),
  ]);

  return (
    <>
      <TopBar
        logoutHref="/api/dashboard/logout"
        links={[
          { href: "/dashboard", label: "Envelopes" },
          { href: "/dashboard/templates", label: "Templates" },
          { href: "/dashboard/webhook-activity", label: "Integration Alerts" },
          { href: "/dashboard/settings", label: "Settings" },
        ]}
      />
      <div className="page-shell wide">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1>Templates</h1>
            <div className="signature-rule" />
          </div>
          <a href="/dashboard/templates/new" style={{ textDecoration: "none" }}>
            <Button variant="primary">Create template</Button>
          </a>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <FolderSidebar folders={folders} totalCount={totalCount} uncategorizedCount={uncategorizedCount} activeFolder={folderParam ?? null} />

          <div style={{ flex: 1 }}>
            {templates.length === 0 ? (
              <Card>
                <div className="empty-state">
                  <p style={{ marginBottom: 16, color: "var(--text-primary)", fontWeight: 500 }}>
                    {folderParam ? "No templates in this folder" : "No templates yet"}
                  </p>
                  <p style={{ marginBottom: 20 }}>
                    Upload a document once, place your fields, and send it as many times as you need.
                  </p>
                  <a href="/dashboard/templates/new" style={{ textDecoration: "none" }}>
                    <Button variant="primary">Create your first template</Button>
                  </a>
                </div>
              </Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
                {templates.map((t, i) => (
                  <Card key={t.id} index={i} hoverable>
                    <a href={`/dashboard/templates/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <h3 style={{ marginBottom: 4 }}>{t.name}</h3>
                      {t.aiDrafted && (
                        <span
                          className={`badge ${t.aiReviewedAt ? "badge-pending" : "badge-danger"}`}
                          style={{ marginBottom: 8, display: "inline-block" }}
                        >
                          {t.aiReviewedAt ? "AI-drafted · reviewed" : "AI-drafted · needs review"}
                        </span>
                      )}
                      <p style={{ fontSize: 13, marginBottom: 12 }}>
                        {Array.isArray(t.fieldMap) ? t.fieldMap.length : 0} field{Array.isArray(t.fieldMap) && t.fieldMap.length === 1 ? "" : "s"}
                      </p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {t._count.envelopes} envelope{t._count.envelopes === 1 ? "" : "s"} sent
                        </span>
                        <span style={{ fontSize: 13, color: "var(--accent-dark)", fontWeight: 500 }}>Edit fields →</span>
                      </div>
                    </a>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
