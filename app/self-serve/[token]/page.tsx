// DEPLOY TO: app/self-serve/[token]/page.tsx
"use client";

// Validates the token on mount (GET) before showing the form — previously
// this page rendered the name/email form unconditionally regardless of
// whether the link was actually valid, so someone with an expired or
// self-serve-disabled link would fill in their details and only find out
// it didn't work after submitting. Same "check before you commit" pattern
// already used in app/sign/[token]/page.tsx.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/motion/Button";

export default function SelfServePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/self-serve/${token}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setLinkError(json.error ?? "This signing link isn't available.");
          return;
        }
        setTemplateName(json.template_name);
      })
      .catch(() => setLinkError("Something went wrong — please try again."))
      .finally(() => setChecking(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/self-serve/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push(`/sign/${json.sign_token}`);
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {checking ? (
          <div className="card" style={{ width: 420, textAlign: "center", color: "var(--text-muted)" }}>
            Checking this link…
          </div>
        ) : linkError ? (
          <div className="card" style={{ width: 420, textAlign: "center" }}>
            <div className="topbar-brand" style={{ marginBottom: 16, justifyContent: "center" }}>Upfinity Sign</div>
            <h2>Link not available</h2>
            <p style={{ fontSize: 14 }}>{linkError}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card" style={{ width: 420 }}>
            <div className="topbar-brand" style={{ marginBottom: 16 }}>Upfinity Sign</div>
            <h2>Sign {templateName}</h2>
            <p style={{ fontSize: 13, marginBottom: 4 }}>Enter your details to get started.</p>
            <div className="signature-rule" />

            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

            <div style={{ marginBottom: 16 }}>
              <label className="field-label">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="field-label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={submitting}>
              {submitting ? "Preparing your document…" : "Continue to sign"}
            </Button>
          </form>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
