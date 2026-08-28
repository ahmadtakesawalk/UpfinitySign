// Public (no login) — Certificates of Completion are meant to be
// shareable/verifiable by anyone with the link, same as DocuSign's
// equivalent. Deliberately doesn't leak anything beyond what the
// certificate itself already contains (see lib/signing/certificate.ts).

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const envelope = await prisma.envelope.findUnique({
    where: { id },
    include: { certificate: true, template: true, recipients: true },
  });

  if (!envelope?.certificate) notFound();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div className="topbar-brand">Upfinity Sign</div>
        <span className="badge badge-success">Verified</span>
      </div>

      <div className="page-shell" style={{ flex: 1 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Certificate of Completion</h2>
          <p>{envelope.template.name}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Envelope ID: {envelope.id}</p>
          {envelope.certificate.timestampObtainedAt && (
            <p style={{ fontSize: 12.5, color: "var(--success)", marginTop: 6 }}>
              🕐 Trusted timestamp obtained {envelope.certificate.timestampObtainedAt.toLocaleString()} — independently proves this
              document existed at this exact moment, beyond the signing certificate's own validity period.
            </p>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14 }}>Signers</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {envelope.recipients.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.role}</td>
                  <td>{r.signedAt?.toLocaleString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <iframe
            src={storage.url(envelope.certificate.pdfStorageKey)}
            style={{ width: "100%", height: 640, border: "none", display: "block" }}
          />
        </div>
      </div>

      <div className="footer-note">
        This certificate is cryptographically signed. Powered by <a href="https://upfinity.ca">Upfinity Inc.</a>
        {" · "}
        <a href="/privacy">Privacy Policy</a>
        {" · "}
        <a href="/terms">Terms of Service</a>
      </div>
    </div>
  );
}
